/**
 * Ruu Engine — offscreen document içinde yaşar (SW değil: eviction'dan bağımsız).
 * Paralel Range fetch + dinamik tahsis + work-stealing; chunk'lar disk worker'a
 * transferable olarak akar, OPFS'e nihai konumda yazılır.
 *
 * Crash-resume (PRD F3): ack'lenmiş aralıklar jobs/<id>.meta sidecar'ına yazılır;
 * boot'ta meta'lı işler 'paused' olarak geri gelir, resume'da ETag doğrulanır.
 *
 * DİKKAT: offscreen document'ta chrome.storage ve çoğu chrome.* API YOK —
 * yalnızca runtime mesajlaşması. Ayarlar SW'den 'settings' mesajıyla gelir.
 */
import { RangeAllocator, type Claim } from '../engine/allocator';
import { autoTuneConnections, collectHints } from '../engine/autotune';
import { mergeRange, parseMeta, reconcileRanges, type JobMeta } from '../engine/manifest';
import { failThreshold } from '../engine/retry';
import {
  MIN_SPLIT,
  SEG_MAX,
  SEG_MIN,
  type JobSnapshot,
  type Msg,
} from '../engine/types';

const BACKPRESSURE_HIGH = 32 << 20;
const BACKPRESSURE_LOW = 8 << 20;
const SPEED_WINDOW_MS = 3000;
const META_INTERVAL_MS = 2000;

/** Kullanıcı ayarı: ağ hatasında yeniden deneme (varsayılan 1) — SW'den itilir. */
let maxRetries = 1;

let jobSeq = 0;
const jobs = new Map<string, Job>();

/** Canlı teşhis — cdp-eval ile okunur: __ruu */
const dbg = {
  fetches: 0, responses: 0, reads: 0, rbytes: 0,
  writes: 0, acks: 0, pumpErrors: [] as string[],
};
(globalThis as unknown as { __ruu: typeof dbg & { jobs: Map<string, Job> } }).__ruu =
  Object.assign(dbg, { jobs });

/**
 * Kalıcı depolama izni — yarım indirmelerin tarayıcı tarafından silinmesini
 * engeller (Chrome LRU eviction; Safari 7 gün etkileşimsizlikte origin verisini
 * siler). İzin verilmezse indirme yine çalışır, sadece eviction riski kalır.
 */
void navigator.storage?.persist?.().catch(() => undefined);

async function jobsDir(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle('jobs', { create: true });
}

class Job {
  id = `job-${Date.now()}-${jobSeq++}`;
  state: JobSnapshot['state'] = 'probing';
  filename = 'download';
  size: number | null = null;
  alloc: RangeAllocator | null = null;
  error?: string;
  native = false;
  etag?: string;
  lastModified?: string;

  /** Ack'lenmiş (diske inmiş) aralıklar — meta'nın tek kaynağı. */
  private acked: Array<[number, number]> = [];
  private needsRevalidate = false;
  private worker: Worker | null = null;
  private controllers = new Set<AbortController>();
  private pumps = 0;
  private sequentialErrors = 0;
  private inflight = 0;
  private drainWaiters: Array<() => void> = [];
  private ticks: Array<{ t: number; b: number }> = [];
  private blobUrl: string | null = null;
  private metaTimer: ReturnType<typeof setInterval> | null = null;
  private topSpeed = 0;
  downloadId?: number;
  priv = false; // gizli: geçmişe yazılmaz, istatistiğe girmez, kart kaybolur
  completedAt?: number;
  origin?: string;
  sender?: string;

  constructor(
    public url: string,
    readonly connections: number,
    readonly filenameHint?: string,
  ) {}

  /** Önceki oturumdan geri yükleme: veri + meta diskte, worker resume'da açılır. */
  static restored(id: string, meta: JobMeta): Job {
    const job = new Job(meta.url, meta.connections, meta.filename);
    job.id = id;
    job.filename = meta.filename;
    job.size = meta.size;
    job.etag = meta.etag;
    job.lastModified = meta.lastModified;
    job.acked = meta.ranges.map((r) => [...r] as [number, number]);
    job.alloc = RangeAllocator.restore(meta.size, meta.ranges, MIN_SPLIT);
    job.state = 'paused';
    job.needsRevalidate = true;
    return job;
  }

  async start(): Promise<void> {
    try {
      const probe = await this.probeWithRetry();
      this.filename = pickFilename(this.url, probe.headers.get('content-disposition'), this.filenameHint);
      this.etag = probe.headers.get('etag') ?? undefined;
      this.lastModified = probe.headers.get('last-modified') ?? undefined;
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
      await this.initDisk(total, true);
      this.beginDownloading();
    } catch (err) {
      this.fail(err);
    }
  }

  private beginDownloading(): void {
    this.state = 'downloading';
    keepAwake();
    this.sendMeta();
    if (!this.metaTimer) {
      this.metaTimer = setInterval(() => this.sendMeta(), META_INTERVAL_MS);
    }
    this.spawnPumps();
    broadcast();
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

  private initDisk(size: number, fresh: boolean): Promise<void> {
    return new Promise((resolve, reject) => {
      this.worker = new Worker('disk-worker.js', { type: 'module' });
      this.worker.onerror = (ev) => {
        const err = new Error(`disk worker yüklenemedi: ${ev.message || 'bilinmeyen'}`);
        reject(err);
        this.fail(err);
      };
      this.worker.onmessage = (ev) => {
        const m = ev.data as { type: string; offset?: number; bytes?: number; error?: string };
        switch (m.type) {
          case 'ready':
            resolve();
            break;
          case 'size-mismatch': {
            // dosya bozulmuş/uyumsuz → sıfırdan (aralıklar geçersiz)
            this.acked = [];
            this.alloc = new RangeAllocator(size, MIN_SPLIT);
            resolve();
            break;
          }
          case 'wrote': {
            dbg.acks++;
            const bytes = m.bytes ?? 0;
            mergeRange(this.acked, m.offset ?? 0, (m.offset ?? 0) + bytes);
            this.inflight -= bytes;
            if (this.inflight < BACKPRESSURE_LOW) {
              this.drainWaiters.splice(0).forEach((w) => w());
            }
            break;
          }
          case 'disk-error':
            reject(new Error(m.error));
            this.fail(new Error(`disk: ${m.error}`));
            break;
        }
      };
      this.worker.postMessage({ type: 'init', jobId: this.id, size, fresh });
    });
  }

  private buildMeta(): JobMeta {
    return {
      v: 1,
      url: this.url,
      filename: this.filename,
      size: this.size ?? 0,
      connections: this.connections,
      etag: this.etag,
      lastModified: this.lastModified,
      ranges: this.acked.map((r) => [...r] as [number, number]),
      updatedAt: Date.now(),
    };
  }

  private sendMeta(): void {
    if (!this.worker || !this.size) return;
    this.worker.postMessage({ type: 'meta', json: JSON.stringify(this.buildMeta()) });
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
        if (this.sequentialErrors >= failThreshold(this.connections, maxRetries)) {
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
      this.fail(new Error(this.error ?? 'errAllDown'));
    }
  }

  private async finalize(): Promise<void> {
    this.state = 'finalizing';
    this.stopMetaTimer();
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
    const dir = await jobsDir();
    const file = await (await dir.getFileHandle(this.id)).getFile();
    // slice: veri kopyalamadan MIME atar — boş MIME Chrome'un .txt eklemesine yol açıyor
    this.blobUrl = URL.createObjectURL(file.slice(0, file.size, 'application/octet-stream'));
    send({
      target: 'sw', type: 'deliver', jobId: this.id, blobUrl: this.blobUrl,
      filename: this.filename, size: this.size ?? file.size, topSpeed: this.topSpeed,
      priv: this.priv,
    });
  }

  async delivered(ok: boolean, error?: string, downloadId?: number): Promise<void> {
    this.downloadId = downloadId;
    if (this.blobUrl) URL.revokeObjectURL(this.blobUrl);
    this.worker?.terminate();
    this.worker = null;
    if (ok) {
      const dir = await jobsDir();
      await dir.removeEntry(this.id).catch(() => undefined);
      await dir.removeEntry(`${this.id}.meta`).catch(() => undefined);
      this.state = 'done';
      this.completedAt = Date.now();
      if (this.priv) {
        // gizli iş: kart kısa süre sonra panelden de silinir — iz kalmaz
        setTimeout(() => { jobs.delete(this.id); broadcast(); }, 6000);
      }
    } else {
      this.state = 'error';
      this.error = error ?? 'errDelivery';
    }
    keepAwake();
    broadcast();
  }

  pause(): void {
    if (this.state !== 'downloading') return;
    this.state = 'paused';
    this.abortConnections();
    this.sendMeta();
    this.stopMetaTimer();
    keepAwake();
    broadcast();
  }

  /**
   * Süresi dolan link kurtarma (kullanıcı acısı #1): yeni URL doğrulanır
   * (boyut + ETag aynı olmalı), MEVCUT aralıklarla kaldığı yerden devam edilir.
   */
  async renew(newUrl: string): Promise<void> {
    if (this.state !== 'error' && this.state !== 'paused') return;
    this.state = 'probing';
    this.error = undefined;
    broadcast();
    try {
      const probe = await fetch(newUrl, {
        headers: { Range: 'bytes=0-0' }, credentials: 'include', cache: 'no-store',
      });
      const total = parseTotal(probe);
      const newEtag = probe.headers.get('etag') ?? undefined;
      probe.body?.cancel().catch(() => undefined);
      if (probe.status !== 206 || total !== this.size) throw new Error('errRenewMismatch');
      if (this.etag && newEtag && this.etag !== newEtag) throw new Error('errRenewMismatch');
      this.url = newUrl;
      this.sequentialErrors = 0;
      this.needsRevalidate = false;
      if (!this.worker) await this.initDisk(this.size!, false);
      this.beginDownloading();
    } catch (err) {
      this.fail(err);
    }
  }

  resume(): void {
    if (this.state !== 'paused') return;
    this.sequentialErrors = 0;
    if (this.worker) {
      // oturum içi devam: worker açık, doğrulama gereksiz
      this.beginDownloading();
      return;
    }
    // önceki oturumdan geri yüklenen iş: doğrula + diski aç
    void this.resumeRestored();
  }

  private async resumeRestored(): Promise<void> {
    this.state = 'probing';
    broadcast();
    try {
      if (this.needsRevalidate) {
        const probe = await this.probeWithRetry();
        const newEtag = probe.headers.get('etag') ?? undefined;
        const newLm = probe.headers.get('last-modified') ?? undefined;
        probe.body?.cancel().catch(() => undefined);
        const changed =
          (this.etag && newEtag && this.etag !== newEtag) ||
          (!this.etag && this.lastModified && newLm && this.lastModified !== newLm);
        if (changed) {
          this.fail(new Error('errChanged'));
          return;
        }
        this.needsRevalidate = false;
      }
      await this.initDisk(this.size!, false);
      this.beginDownloading();
    } catch (err) {
      this.fail(err);
    }
  }

  async cancel(): Promise<void> {
    const hadWorker = this.worker !== null;
    this.state = 'error';
    this.error = 'errCancelled';
    this.abortConnections();
    this.stopMetaTimer();
    if (hadWorker) {
      this.worker!.postMessage({ type: 'abort' });
      this.worker!.terminate();
      this.worker = null;
    }
    const dir = await jobsDir();
    await dir.removeEntry(this.id).catch(() => undefined);
    await dir.removeEntry(`${this.id}.meta`).catch(() => undefined);
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

  private stopMetaTimer(): void {
    if (this.metaTimer) {
      clearInterval(this.metaTimer);
      this.metaTimer = null;
    }
  }

  private fail(err: unknown): void {
    if (this.state === 'error') return;
    this.state = 'error';
    this.error = err instanceof Error ? err.message : String(err);
    this.abortConnections();
    this.stopMetaTimer();
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
    const s = (bytes / span) * 1000;
    if (s > this.topSpeed) this.topSpeed = s;
    return s;
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
      ranges: this.alloc?.completed() ?? [],
      error: this.error,
      native: this.native,
      downloadId: this.downloadId,
      priv: this.priv || undefined,
      completedAt: this.completedAt,
      origin: this.origin,
      sender: this.sender,
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

/**
 * Boot: önceki oturumdan kalan işleri geri yükle (PRD F3).
 * Geçerli meta'sı olan veri dosyaları 'paused' iş olarak geri gelir;
 * eşleşmeyen artıklar silinir.
 */
async function restoreStale(): Promise<void> {
  try {
    const dir = await jobsDir();
    const names: string[] = [];
    for await (const name of (dir as unknown as { keys(): AsyncIterable<string> }).keys()) {
      names.push(name);
    }
    const dataFiles = names.filter((n) => !n.endsWith('.meta'));
    for (const name of dataFiles) {
      let meta: JobMeta | null = null;
      if (names.includes(`${name}.meta`)) {
        try {
          const f = await (await dir.getFileHandle(`${name}.meta`)).getFile();
          meta = parseMeta(await f.text());
        } catch { /* okunamadı → sil */ }
      }
      if (meta && meta.ranges.length > 0) {
        // Meta ile diskteki gerçeği uzlaştır: kayıtlı ilerleme dosya boyunu
        // aşamaz (meta ve veri yazımı atomik değil).
        let onDisk = meta.size;
        try {
          onDisk = (await (await dir.getFileHandle(name)).getFile()).size;
        } catch { /* okunamadı → meta'ya güven */ }
        const safe = reconcileRanges(meta.ranges, Math.min(onDisk, meta.size));
        if (safe.length === 0) {
          await dir.removeEntry(name).catch(() => undefined);
          await dir.removeEntry(`${name}.meta`).catch(() => undefined);
          continue;
        }
        jobs.set(name, Job.restored(name, { ...meta, ranges: safe }));
      } else {
        await dir.removeEntry(name).catch(() => undefined);
        await dir.removeEntry(`${name}.meta`).catch(() => undefined);
      }
    }
    // sahipsiz meta dosyaları
    for (const name of names.filter((n) => n.endsWith('.meta'))) {
      if (!dataFiles.includes(name.slice(0, -5))) {
        await dir.removeEntry(name).catch(() => undefined);
      }
    }
    if (jobs.size > 0) broadcast();
  } catch { /* OPFS yoksa sessiz geç */ }
}
void restoreStale();

chrome.runtime.onMessage.addListener((raw: Msg) => {
  if (raw.target !== 'engine') return;
  switch (raw.type) {
    case 'add': {
      const auto = autoTuneConnections(collectHints());
      const job = new Job(raw.url, Math.min(8, Math.max(1, raw.connections ?? auto)), raw.filenameHint);
      job.priv = raw.priv ?? false;
      job.origin = raw.origin;
      job.sender = raw.sender;
      jobs.set(job.id, job);
      void job.start();
      break;
    }
    case 'pause': jobs.get(raw.jobId)?.pause(); break;
    case 'resume': jobs.get(raw.jobId)?.resume(); break;
    case 'cancel': void jobs.get(raw.jobId)?.cancel(); break;
    case 'pause-all': for (const j of jobs.values()) j.pause(); break;
    case 'query': broadcast(); break;
    case 'delivered': void jobs.get(raw.jobId)?.delivered(raw.ok, raw.error, raw.downloadId); break;
    case 'settings': maxRetries = Math.min(10, Math.max(0, raw.maxRetries)); break;
    case 'renew': void jobs.get(raw.jobId)?.renew(raw.url); break;
  }
});
