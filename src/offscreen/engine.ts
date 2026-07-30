/**
 * Ruu Engine — offscreen document içinde yaşar (SW değil: eviction'dan bağımsız).
 * Paralel Range fetch + dinamik tahsis + work-stealing; chunk'lar disk worker'a
 * transferable olarak akar, OPFS'e nihai konumda yazılır.
 */
import { RangeAllocator, type Claim } from '../engine/allocator';
import { autoTuneConnections, collectHints } from '../engine/autotune';
import {
  MAX_SEQUENTIAL_ERRORS,
  MIN_SPLIT,
  SEG_MAX,
  SEG_MIN,
  type JobSnapshot,
  type Msg,
} from '../engine/types';

const BACKPRESSURE_HIGH = 32 << 20;
const BACKPRESSURE_LOW = 8 << 20;
const SPEED_WINDOW_MS = 3000;

let jobSeq = 0;
const jobs = new Map<string, Job>();

/** Canlı teşhis — cdp-eval ile okunur: __ruu */
const dbg = {
  fetches: 0, responses: 0, reads: 0, rbytes: 0,
  writes: 0, acks: 0, pumpErrors: [] as string[],
};
(globalThis as unknown as { __ruu: typeof dbg & { jobs: Map<string, Job> } }).__ruu =
  Object.assign(dbg, { jobs });

class Job {
  readonly id = `job-${Date.now()}-${jobSeq++}`;
  state: JobSnapshot['state'] = 'probing';
  filename = 'download';
  size: number | null = null;
  alloc: RangeAllocator | null = null;
  error?: string;
  native = false;

  private worker: Worker | null = null;
  private controllers = new Set<AbortController>();
  private pumps = 0;
  private sequentialErrors = 0;
  private inflight = 0;
  private drainWaiters: Array<() => void> = [];
  private ticks: Array<{ t: number; b: number }> = [];
  private blobUrl: string | null = null;

  constructor(
    readonly url: string,
    readonly connections: number,
    readonly filenameHint?: string,
  ) {}

  async start(): Promise<void> {
    try {
      const probe = await this.probeWithRetry();
      this.filename = pickFilename(this.url, probe.headers.get('content-disposition'), this.filenameHint);
      const total = parseTotal(probe);
      probe.body?.cancel().catch(() => undefined);

      if (probe.status !== 206 || total === null) {
        // Range yok → native indiriciye zarif düşüş (PRD F2)
        this.native = true;
        this.state = 'done';
        send({ target: 'sw', type: 'native-fallback', jobId: this.id, url: this.url });
        broadcast();
        return;
      }

      this.size = total;
      this.alloc = new RangeAllocator(total, MIN_SPLIT);
      await this.initDisk(total);
      this.state = 'downloading';
      keepAwake();
      this.spawnPumps();
      broadcast();
    } catch (err) {
      this.fail(err);
    }
  }

  /** Probe: 3 deneme, artan bekleme — anlık ağ sekmeleri işi düşürmesin. */
  private async probeWithRetry(): Promise<Response> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 400 * attempt));
      try {
        return await fetch(this.url, {
          headers: { Range: 'bytes=0-0' },
          credentials: 'include',
          cache: 'no-store',
        });
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr;
  }

  private initDisk(size: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.worker = new Worker('disk-worker.js', { type: 'module' });
      this.worker.onerror = (ev) => {
        const err = new Error(`disk worker yüklenemedi: ${ev.message || 'bilinmeyen'}`);
        reject(err);
        this.fail(err);
      };
      this.worker.onmessage = (ev) => {
        const m = ev.data as { type: string; bytes?: number; error?: string };
        switch (m.type) {
          case 'ready':
            resolve();
            break;
          case 'wrote':
            dbg.acks++;
            this.inflight -= m.bytes ?? 0;
            if (this.inflight < BACKPRESSURE_LOW) {
              this.drainWaiters.splice(0).forEach((w) => w());
            }
            break;
          case 'disk-error':
            reject(new Error(m.error));
            this.fail(new Error(`disk: ${m.error}`));
            break;
        }
      };
      this.worker.postMessage({ type: 'init', jobId: this.id, size });
    });
  }

  private segSize(): number {
    if (!this.alloc || this.size === null) return SEG_MIN;
    const remaining = this.size - this.alloc.downloadedBytes();
    const ideal = Math.ceil(remaining / this.connections);
    return Math.max(SEG_MIN, Math.min(SEG_MAX, ideal));
  }

  private spawnPumps(): void {
    while (this.pumps < this.connections && this.state === 'downloading') {
      const claim = this.alloc!.allocate(this.segSize()) ?? this.alloc!.steal();
      if (!claim) break;
      this.pumps++;
      void this.pump(claim).finally(() => {
        this.pumps--;
        this.onPumpExit();
      });
    }
  }

  private async pump(claim: Claim): Promise<void> {
    const controller = new AbortController();
    this.controllers.add(controller);
    try {
      while (claim.written < claim.end - claim.start && this.state === 'downloading') {
        const from = claim.start + claim.written;
        dbg.fetches++;
        const resp = await fetch(this.url, {
          signal: controller.signal,
          headers: { Range: `bytes=${from}-${claim.end - 1}` },
          credentials: 'include',
          cache: 'no-store',
        });
        dbg.responses++;
        if (resp.status !== 206 || !resp.body) throw new Error(`beklenmedik durum: ${resp.status}`);
        this.sequentialErrors = 0;
        const reader = resp.body.getReader();
        let gotAny = false;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          gotAny = true;
          dbg.reads++;
          dbg.rbytes += value.length;
          // steal ile end küçülmüş olabilir; kapasite kadarını yaz, fazlasını at
          const capacity = claim.end - claim.start - claim.written;
          if (capacity <= 0) {
            await reader.cancel();
            break;
          }
          const buf = value.length > capacity ? value.subarray(0, capacity) : value;
          // DİKKAT: write() buffer'ı worker'a TRANSFER eder — sonrasında buf.length
          // detach yüzünden 0 olur. Uzunluk transfer'den önce alınmak ZORUNDA.
          const len = buf.length;
          await this.write(claim.start + claim.written, buf);
          claim.written += len;
          this.tick(len);
          if (claim.written >= claim.end - claim.start) {
            await reader.cancel();
            break;
          }
        }
        // Sunucu aralığı erken kapattıysa (gotAny ama eksik) döngü yeni offset'ten devam eder;
        // hiç veri gelmeden kapandıysa hata say.
        if (!gotAny && claim.written < claim.end - claim.start) {
          throw new Error('sunucu boş yanıt kapattı');
        }
      }
      this.alloc!.settle(claim);
    } catch (err) {
      this.alloc!.settle(claim);
      const isAbort = controller.signal.aborted ||
        (err instanceof Error && err.name === 'AbortError');
      if (!isAbort && dbg.pumpErrors.length < 20) {
        dbg.pumpErrors.push(err instanceof Error ? `${err.name}: ${err.message}` : String(err));
      }
      if (this.state === 'downloading' && !controller.signal.aborted) {
        this.sequentialErrors++;
        if (this.sequentialErrors >= MAX_SEQUENTIAL_ERRORS) {
          this.fail(err);
        }
      }
    } finally {
      this.controllers.delete(controller);
    }
  }

  private write(offset: number, buf: Uint8Array): Promise<void> {
    // subarray transferi tüm buffer'ı taşır; dilimlendiyse kopyala
    const out = buf.byteOffset === 0 && buf.byteLength === buf.buffer.byteLength
      ? buf
      : buf.slice();
    this.inflight += out.byteLength;
    dbg.writes++;
    this.worker!.postMessage({ type: 'write', offset, buf: out }, [out.buffer]);
    if (this.inflight > BACKPRESSURE_HIGH) {
      return new Promise((r) => this.drainWaiters.push(r));
    }
    return Promise.resolve();
  }

  private onPumpExit(): void {
    if (this.state !== 'downloading') return;
    if (this.alloc!.isComplete()) {
      void this.finalize();
      return;
    }
    this.spawnPumps();
    if (this.pumps === 0) {
      // boşluk yok, çalınacak segment yok ama tamamlanmadı → tüm pompalar hata ile düştü
      this.fail(new Error(this.error ?? 'tüm bağlantılar düştü'));
    }
  }

  private async finalize(): Promise<void> {
    this.state = 'finalizing';
    broadcast();
    await new Promise<void>((resolve) => {
      const w = this.worker!;
      const prev = w.onmessage;
      w.onmessage = (ev) => {
        if ((ev.data as { type: string }).type === 'finalized') resolve();
        else prev?.call(w, ev);
      };
      w.postMessage({ type: 'finalize' });
    });
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('jobs');
    const file = await (await dir.getFileHandle(this.id)).getFile();
    // slice: veri kopyalamadan MIME atar — boş MIME Chrome'un .txt eklemesine yol açıyor
    this.blobUrl = URL.createObjectURL(file.slice(0, file.size, 'application/octet-stream'));
    send({ target: 'sw', type: 'deliver', jobId: this.id, blobUrl: this.blobUrl, filename: this.filename });
  }

  async delivered(ok: boolean, error?: string): Promise<void> {
    if (this.blobUrl) URL.revokeObjectURL(this.blobUrl);
    this.worker?.terminate();
    this.worker = null;
    if (ok) {
      const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('jobs');
      await dir.removeEntry(this.id).catch(() => undefined);
      this.state = 'done';
    } else {
      this.state = 'error';
      this.error = error ?? 'teslim başarısız';
    }
    keepAwake();
    broadcast();
  }

  pause(): void {
    if (this.state !== 'downloading') return;
    this.state = 'paused';
    this.abortConnections();
    keepAwake();
    broadcast();
  }

  resume(): void {
    if (this.state !== 'paused') return;
    this.state = 'downloading';
    this.sequentialErrors = 0;
    keepAwake();
    this.spawnPumps();
    broadcast();
  }

  async cancel(): Promise<void> {
    const hadWorker = this.worker !== null;
    this.state = 'error';
    this.error = 'iptal edildi';
    this.abortConnections();
    if (hadWorker) {
      this.worker!.postMessage({ type: 'abort' });
      this.worker!.terminate();
      this.worker = null;
      const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('jobs');
      await dir.removeEntry(this.id).catch(() => undefined);
    }
    jobs.delete(this.id);
    keepAwake();
    broadcast();
  }

  private abortConnections(): void {
    for (const c of this.controllers) c.abort();
    this.controllers.clear();
    this.drainWaiters.splice(0).forEach((w) => w());
    this.inflight = 0;
  }

  private fail(err: unknown): void {
    if (this.state === 'error') return;
    this.state = 'error';
    this.error = err instanceof Error ? err.message : String(err);
    this.abortConnections();
    keepAwake();
    broadcast();
  }

  private tick(bytes: number): void {
    const now = performance.now();
    this.ticks.push({ t: now, b: bytes });
    while (this.ticks.length && this.ticks[0]!.t < now - SPEED_WINDOW_MS) this.ticks.shift();
  }

  speed(): number {
    if (this.state !== 'downloading' || this.ticks.length === 0) return 0;
    const now = performance.now();
    const bytes = this.ticks.reduce((a, x) => a + x.b, 0);
    const span = Math.max(250, now - this.ticks[0]!.t);
    return (bytes / span) * 1000;
  }

  snapshot(): JobSnapshot {
    return {
      id: this.id,
      url: this.url,
      filename: this.filename,
      size: this.size,
      state: this.state,
      downloaded: this.alloc?.downloadedBytes() ?? 0,
      speed: this.speed(),
      connections: this.connections,
      claims: (this.alloc?.claims ?? []).map((c) => ({
        s: c.start, e: c.end, w: c.written, a: c.active,
      })),
      error: this.error,
      native: this.native,
    };
  }
}

// ── yardımcılar ──────────────────────────────────────────────────────────────

function parseTotal(resp: Response): number | null {
  const cr = resp.headers.get('content-range'); // "bytes 0-0/12345"
  const m = cr?.match(/\/(\d+)$/);
  if (m) return Number(m[1]);
  return null;
}

function pickFilename(url: string, disposition: string | null, hint?: string): string {
  const star = disposition?.match(/filename\*\s*=\s*(?:UTF-8'')?([^;]+)/i);
  if (star?.[1]) return decodeURIComponent(star[1].trim().replace(/^"|"$/g, ''));
  const plain = disposition?.match(/filename\s*=\s*"?([^";]+)"?/i);
  if (plain?.[1]) return plain[1].trim();
  if (hint) return hint; // devralmadan gelen tarayıcı dosya adı
  try {
    const base = new URL(url).pathname.split('/').filter(Boolean).pop();
    if (base) return decodeURIComponent(base);
  } catch { /* düşmeye devam */ }
  return 'download';
}

function send(msg: Msg): void {
  void chrome.runtime.sendMessage(msg).catch(() => undefined);
}

let broadcastTimer: ReturnType<typeof setTimeout> | null = null;
function broadcast(): void {
  if (broadcastTimer) return;
  broadcastTimer = setTimeout(() => {
    broadcastTimer = null;
    send({ target: 'panel', type: 'jobs', jobs: [...jobs.values()].map((j) => j.snapshot()) });
  }, 100);
}
setInterval(() => {
  if ([...jobs.values()].some((j) => j.state === 'downloading')) broadcast();
}, 500);

let awake = false;
function keepAwake(): void {
  const need = [...jobs.values()].some((j) => j.state === 'downloading' || j.state === 'finalizing');
  if (need !== awake) {
    awake = need;
    send({ target: 'sw', type: 'keepawake', on: need });
  }
}

/** Önceki oturumdan kalan OPFS artıklarını temizle (crash-resume v0'da yok — PRD F3 milestone). */
async function cleanupStale(): Promise<void> {
  try {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('jobs', { create: true });
    for await (const name of (dir as unknown as { keys(): AsyncIterable<string> }).keys()) {
      await dir.removeEntry(name).catch(() => undefined);
    }
  } catch { /* OPFS yoksa sessiz geç */ }
}
void cleanupStale();

chrome.runtime.onMessage.addListener((raw: Msg) => {
  if (raw.target !== 'engine') return;
  switch (raw.type) {
    case 'add': {
      const auto = autoTuneConnections(collectHints());
      const job = new Job(raw.url, Math.min(8, Math.max(1, raw.connections ?? auto)), raw.filenameHint);
      jobs.set(job.id, job);
      void job.start();
      break;
    }
    case 'pause': jobs.get(raw.jobId)?.pause(); break;
    case 'resume': jobs.get(raw.jobId)?.resume(); break;
    case 'cancel': void jobs.get(raw.jobId)?.cancel(); break;
    case 'pause-all': for (const j of jobs.values()) j.pause(); break;
    case 'query': broadcast(); break;
    case 'delivered': void jobs.get(raw.jobId)?.delivered(raw.ok, raw.error); break;
  }
});
