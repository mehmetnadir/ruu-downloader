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
import { autoTuneConnections, collectHints, MAX_CONNECTIONS } from '../engine/autotune';
import { bytesToBase64, digestMatches, parseDigestHeader, type ExpectedDigest } from '../engine/digest';
import { mergeRange, parseMeta, reconcileRanges, type JobMeta } from '../engine/manifest';
import { afterDecision, RAMP_START, shouldAddConnection, type RampState } from '../engine/ramp';
import { isRunning, nextToStart, shouldStartImmediately } from '../engine/queue';
import { sanitizeFilename } from '../engine/filename';
import {
  HelperClient, shouldUseHelper, toEngineRanges,
  type HelperCapabilities, type HelperHandshake,
} from '../engine/helper';
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
const DELIVERY_TIMEOUT_MS = 10 * 60_000;
/** Teslim Chrome'a devredildikten sonraki üst sınır (kaydetme penceresi payı). */
const DELIVERY_HANDOFF_MS = 6 * 60 * 60_000;
/** Bütünlük doğrulaması için üst sınır — üstünde OOM riski (bkz. finalize). */
const DIGEST_MAX_BYTES = 512 * 1024 * 1024;
const META_INTERVAL_MS = 2000;

/** Kullanıcı ayarı: ağ hatasında yeniden deneme (varsayılan 1) — SW'den itilir. */
let maxRetries = 1;

let jobSeq = 0;
const jobs = new Map<string, Job>();

/** Canlı teşhis — cdp-eval ile okunur: __ruu */
const dbg = {
  fetches: 0, responses: 0, reads: 0, rbytes: 0,
  writes: 0, acks: 0, pumpErrors: [] as string[],
  helperDecisions: [] as unknown[],
};
(globalThis as unknown as {
  __ruu: typeof dbg & { jobs: Map<string, Job>; helper: () => unknown };
}).__ruu = Object.assign(dbg, {
  jobs,
  // Saha testinin yardımcının gerçekten bağlandığını görebilmesi için.
  helper: () => (helper ? helper.caps : null),
  helperOpts: () => ({ continueAfterClose: helperContinueAfterClose, queueLimit, maxRetries }),
});

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
  /** Sunucu bir özet verdiyse indirme sonunda doğrulanır (yoksa hash hesaplanmaz). */
  expectedDigest?: ExpectedDigest | null;
  digestOk?: boolean;

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
  /** Adaptif rampa: kör paralellik hızlı hatlarda ZARARLI (saha ölçümü). */
  private ramp: RampState = { ...RAMP_START };
  private rampTimer: ReturnType<typeof setInterval> | null = null;
  /** İptal edildi mi — await sınırlarında devam etmeyi engelleyen bayrak. */
  private cancelled = false;
  private deliveryTimer: ReturnType<typeof setTimeout> | null = null;
  /** Sunucu özet verdi ama dosya doğrulanamayacak kadar büyüktü. */
  digestSkipped = false;
  /** Kuyruğa giriş sırası — FIFO için. */
  readonly seq = ++queueSeq;
  /** İş yerel yardımcıya devredildiyse true — teslim adımı ATLANIR. */
  viaHelper = false;
  /** Yardımcıya devretme denendi ve başarısız olduysa nedeni. */
  helperError?: string;
  private helperPoll: ReturnType<typeof setInterval> | null = null;
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
    // Meta ESKİ (temizlenmemiş) adı taşıyabilir — bu düzeltmeden önce yazılmış
    // sidecar'lar öyle. Kurtarılan iş yeniden teslim edilirken aynı
    // "Invalid filename" duvarına toslamasın.
    job.filename = sanitizeFilename(meta.filename);
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
      this.throwIfCancelled();
      this.filename = pickFilename(this.url, probe.headers.get('content-disposition'), this.filenameHint);
      this.etag = probe.headers.get('etag') ?? undefined;
      this.lastModified = probe.headers.get('last-modified') ?? undefined;
      this.expectedDigest = parseDigestHeader(probe.headers);
      const total = parseTotal(probe);
      probe.body?.cancel().catch(() => undefined);

      if (probe.status !== 206 || total === null) {
        // Range yok → native indiriciye zarif düşüş (PRD F2).
        // DİKKAT: burada 'done' demek YALAN olur — henüz tek bayt inmedi.
        // Chrome'un indirmesi de başarısız olabilir (süresi dolmuş link, 404);
        // 'done' dersek kullanıcı yeşil kartı görüp dosyanın indiğini sanır.
        // Gerçek sonucu SW, downloads.onChanged üzerinden geri bildirir.
        this.native = true;
        this.state = 'finalizing';
        this.armDeliveryWatchdog();
        send({ target: 'sw', type: 'native-fallback', jobId: this.id, url: this.url });
        broadcast();
        return;
      }

      this.size = total;
      this.alloc = new RangeAllocator(total, MIN_SPLIT);

      // Yardımcı bu iş için MANTIKLI mı? Karar burada verilir ve yardımcıya
      // yalnızca sonuç geçirilir — strateji eklentide kalır.
      // Karar KAYDEDİLİR. "Yardımcı açık ama kullanılmıyor" sorusunun cevabı
      // aksi halde hiçbir yerde yazmıyor (devralma için de aynı günlük var).
      const decision = {
        available: helper !== null,
        wantConnections: this.connections,
        browserCap: MAX_CONNECTIONS,
        continueAfterClose: helperContinueAfterClose,
        sizeBytes: total,
      };
      const useHelper = shouldUseHelper(decision);
      dbg.helperDecisions.push({ ...decision, useHelper });
      if (dbg.helperDecisions.length > 10) dbg.helperDecisions.shift();
      if (useHelper) {
        await this.runViaHelper();
        return;
      }

      await this.initDisk(total, true);
      this.throwIfCancelled();
      this.beginDownloading();
    } catch (err) {
      if (this.cancelled) return; // iptal zaten temizliği yaptı
      this.fail(err);
    }
  }

  /**
   * İşi yerel yardımcıya devreder ve ilerlemeyi yoklar.
   *
   * OPFS'e HİÇ yazılmaz ve teslim adımı çalışmaz: yardımcı dosyayı doğrudan
   * kullanıcının indirme dizinine yazar. Bu, tarayıcı motorunun 2× tepe disk
   * kullanımını da ortadan kaldırır.
   */
  private async runViaHelper(): Promise<void> {
    const h = helper;
    if (!h) { this.beginDownloading(); return; }
    this.viaHelper = true;
    this.state = 'downloading';
    keepAwake();
    broadcast();
    try {
      await h.client.start({
        id: this.id, url: this.url, dest: this.filename,
        size: this.size!, connections: Math.min(this.connections, h.caps.maxConnections),
      });
    } catch (err) {
      // Yardımcı reddettiyse KENDİ motorumuzla devam et — kullanıcı bir şey
      // kaybetmesin. Yardımcı bir kolaylık, tek yol değil.
      //
      // Ama SESSİZCE düşme: nedeni kaydet. Yoksa "yardımcı açık ama hiç
      // kullanılmıyor" durumu teşhis edilemez hale gelir.
      this.helperError = err instanceof Error ? err.message : String(err);
      dbg.pumpErrors.push(`helper: ${this.helperError}`);
      this.viaHelper = false;
      await this.initDisk(this.size!, true);
      this.beginDownloading();
      return;
    }
    this.watchHelper();
  }

  /** Yardımcıdaki işin durumunu yoklar ve panele yansıtır. */
  private watchHelper(): void {
    if (this.helperPoll) return;
    this.helperPoll = setInterval(() => {
      void (async () => {
        const h = helper;
        if (!h || this.cancelled) { this.stopHelperPoll(); return; }
        let st;
        try {
          st = await h.client.status(this.id);
        } catch {
          // Yardımcı yeniden başlıyor olabilir; yoklamaya devam — ama SW
          // durumu bilsin ki ikon/band gerçeği göstersin.
          send({ target: 'sw', type: 'helper-status', up: false });
          return;
        }
        this.acked = toEngineRanges(st.ranges);
        this.alloc = RangeAllocator.restore(this.size!, this.acked, MIN_SPLIT);
        if (st.state === 'done') {
          this.stopHelperPoll();
          this.state = 'done';
          this.completedAt = Date.now();
          keepAwake();
          pumpQueue();
        } else if (st.state === 'error' || st.state === 'cancelled') {
          this.stopHelperPoll();
          this.fail(new Error(st.error ?? 'errHelper'));
        }
        broadcast();
      })();
    }, 1000);
  }

  /** Geri bağlanan iş için yoklamayı dışarıdan başlatır. */
  watchHelperPublic(): void { this.watchHelper(); }

  /** Yardımcıdaki iş için yeniden doğrulama gereksiz — indirme zaten sürüyor. */
  skipRevalidate(): void { this.needsRevalidate = false; }

  private stopHelperPoll(): void {
    if (this.helperPoll) { clearInterval(this.helperPoll); this.helperPoll = null; }
  }

  private beginDownloading(): void {
    // Tamamlanma tespiti yalnızca onPumpExit'te yapılıyordu; hiç pompa
    // doğmazsa (tüm aralıklar zaten inmişse) hiç tetiklenmiyordu. Teslim
    // hatasından sonra "Yenile" ya da %100'de duraklat/devam et bu duruma
    // düşüyor ve iş sonsuza kadar "indiriliyor · %100"da kalıyordu.
    if (this.alloc?.isComplete()) {
      this.state = 'downloading';
      void this.finalize();
      return;
    }
    this.state = 'downloading';
    keepAwake();
    this.sendMeta();
    if (!this.metaTimer) {
      this.metaTimer = setInterval(() => this.sendMeta(), META_INTERVAL_MS);
    }
    this.startRamp();
    broadcast();
  }

  /**
   * Probe: 3 deneme, artan bekleme — anlık ağ sekmeleri işi düşürmesin.
   *
   * İptal edilebilir olmak ZORUNDA: probe uçarken kullanıcı iptal ederse ve
   * istek durdurulmazsa, cevap geldiğinde start() kaldığı yerden devam edip
   * iptal edilmiş dosyayı yeniden yaratıyordu (hayalet indirme).
   */
  private async probeWithRetry(): Promise<Response> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 400 * attempt));
      this.throwIfCancelled();
      const ctl = new AbortController();
      this.controllers.add(ctl);
      try {
        return await fetch(this.url, {
          headers: { Range: 'bytes=0-0' },
          credentials: 'include',
          cache: 'no-store',
          signal: ctl.signal,
        });
      } catch (err) {
        this.throwIfCancelled();
        lastErr = err;
      } finally {
        this.controllers.delete(ctl);
      }
    }
    throw lastErr;
  }

  /**
   * İptal bekçisi. Her `await` bir görev sınırıdır: beklerken iptal gelmiş
   * olabilir. Bunu kontrol etmeden devam etmek, silinmiş dosyayı yeniden
   * yaratıp kullanıcının açıkça durdurduğu indirmeyi tamamlamak demektir.
   */
  private throwIfCancelled(): void {
    if (this.cancelled) throw new Error('errCancelled');
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

  /**
   * Pompaları rampa kararına göre açar. Hedef sayı sabit değil: tek bağlantıyla
   * başlanır, her ölçüm turunda ekleme FAYDA ETTİĞİ sürece artırılır.
   */
  private spawnPumps(): void {
    const target = Math.max(1, this.ramp.active);
    while (this.pumps < target && this.state === 'downloading') {
      const claim = this.alloc!.allocate(this.segSize()) ?? this.alloc!.steal();
      if (!claim) break;
      this.pumps++;
      void this.pump(claim).finally(() => {
        this.pumps--;
        this.onPumpExit();
      });
    }
  }

  /** 1,5 sn'de bir hızı ölç ve rampayı ilerlet. */
  private startRamp(): void {
    if (this.rampTimer) return;
    // İlk pompa
    this.ramp = afterDecision(this.ramp, 0, true, this.connections);
    this.spawnPumps();
    this.rampTimer = setInterval(() => {
      if (this.state !== 'downloading') return;
      const speed = this.speed();
      const add = shouldAddConnection(this.ramp, speed, this.connections);
      this.ramp = afterDecision(this.ramp, speed, add, this.connections);
      if (add) this.spawnPumps();
      if (this.ramp.settled) this.stopRamp();
    }, 1500);
  }

  private stopRamp(): void {
    if (this.rampTimer) { clearInterval(this.rampTimer); this.rampTimer = null; }
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
    this.armDeliveryWatchdog();
    this.stopRamp();
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

    // Sunucu özet verdiyse doğrula. Bozuk proxy/yanlış birleştirme sessizce
    // geçemesin. Özet yoksa hash HESAPLANMAZ — karşılaştıracak referans yok.
    if (this.expectedDigest && file.size > DIGEST_MAX_BYTES) {
      // file.arrayBuffer() dosyanın TAMAMINI belleğe alır, digest üstüne bir
      // kopya daha çıkarır. Birkaç GB'da offscreen renderer OOM ile öldürülür
      // ve o an inen TÜM işler birlikte düşer (JS istisnası değil, proses
      // ölümü — try/catch yakalayamaz). Bu yüzden eşik var.
      // SESSİZCE atlamıyoruz: kullanıcı doğrulamanın yapılmadığını görmeli.
      this.digestSkipped = true;
    } else if (this.expectedDigest) {
      try {
        const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
        this.digestOk = digestMatches(this.expectedDigest, bytesToBase64(digest));
        if (!this.digestOk) {
          this.fail(new Error('errDigest'));
          return;
        }
      } catch {
        // Hesaplanamadı (ör. bellek). İndirmeyi ENGELLEMİYORUZ ama sessizce
        // de geçmiyoruz: kullanıcı "doğrulanmadı" bilgisini görmeli.
        this.digestOk = undefined;
        this.digestSkipped = true;
      }
    }
    // slice: veri kopyalamadan MIME atar — boş MIME Chrome'un .txt eklemesine yol açıyor
    this.blobUrl = URL.createObjectURL(file.slice(0, file.size, 'application/octet-stream'));
    send({
      target: 'sw', type: 'deliver', jobId: this.id, blobUrl: this.blobUrl,
      filename: this.filename, size: this.size ?? file.size, topSpeed: this.topSpeed,
      priv: this.priv, origin: this.origin, sender: this.sender,
    });
  }

  /**
   * Teslim bekçisi: SW 'delivered' haberini hiç göndermezse (SW çöktü,
   * mesaj düştü) iş sonsuza kadar 'finalizing'de kalır — keepAwake bırakılmaz
   * ve OPFS verisi silinmez. 10 dk sonra hatayla kapat; kullanıcı en azından
   * "Yenile" görebilsin.
   */
  private armDeliveryWatchdog(ms = DELIVERY_TIMEOUT_MS): void {
    if (this.deliveryTimer) clearTimeout(this.deliveryTimer);
    this.deliveryTimer = setTimeout(() => {
      if (this.state === 'finalizing') void this.delivered(false, 'errDelivery');
    }, ms);
  }

  /**
   * SW `downloads.download()` çağrısını başarıyla yaptı — teslim Chrome'a geçti.
   * Kısa bekçi artık yanlış: kullanıcının kaydetme penceresi dakikalarca açık
   * kalabilir ve bu bir arıza değildir. Yine de tamamen bırakmıyoruz; SW ölür
   * ve tamamlanma haberi hiç gelmezse iş sonsuza kadar asılı kalmasın.
   */
  deliverAck(): void {
    if (this.state === 'finalizing') this.armDeliveryWatchdog(DELIVERY_HANDOFF_MS);
  }

  async delivered(ok: boolean, error?: string, downloadId?: number): Promise<void> {
    if (this.deliveryTimer) { clearTimeout(this.deliveryTimer); this.deliveryTimer = null; }
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
    pumpQueue(); // slot boşaldı → kuyruktaki sıradaki başlasın
    broadcast();
  }

  pause(): void {
    if (this.state === 'queued') {
      // Kuyrukta beklerken duraklat = "sıramı kaybetmeden beni atla"
      this.state = 'paused';
      broadcast();
      return;
    }
    if (this.state !== 'downloading') return;
    this.state = 'paused';
    this.abortConnections();
    this.stopRamp();
    // Duraklama penceresi hız ölçümünü kirletir: speed() böleni
    // `now - ticks[0].t` olduğu için 5 dk duraklamış bir işte devam ettikten
    // sonraki ilk ölçüm saçma düşük çıkar ve rampa o yanlış tabandan tırmanır.
    this.ticks.length = 0;
    this.sendMeta();
    this.stopMetaTimer();
    keepAwake();
    pumpQueue(); // duraklatılan iş slotu bırakır
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
      // TÜM baytlar zaten diskteyse sunucuya HİÇ dokunma: indirilecek bir şey
      // yok, doğrulanacak bir şey yok. Bu, teslimi başarısız olmuş tamamlanmış
      // bir işin kurtarılmasını linkin ölmüş olmasından bağımsız kılar —
      // saha hatasında (TESLİM.zip, "Invalid filename") tam olarak bu durum
      // vardı: 1,5 GB hazırdı ama kurtarma yolu tek-kullanımlık linke bağlıydı.
      if (this.alloc?.isComplete()) {
        await this.initDisk(this.size!, false);
        this.beginDownloading(); // isComplete() → doğrudan finalize + teslim
        return;
      }
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
    this.cancelled = true;
    this.stopHelperPoll();
    if (this.viaHelper) {
      // Yardımcıdaki işi de durdur; kısmi dosyayı O saklar (devam edilebilir).
      await helper?.client.cancel(this.id).catch(() => undefined);
    }
    const hadWorker = this.worker !== null;
    this.state = 'error';
    this.error = 'errCancelled';
    this.abortConnections();
    this.stopRamp();
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
    pumpQueue();
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
    this.stopRamp();
    this.stopMetaTimer();
    keepAwake();
    pumpQueue(); // başarısız iş de slotu bırakır — kuyruk tıkanmasın
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
      connections: Math.max(1, this.ramp.active),
      claims: (this.alloc?.claims ?? []).map((c) => ({
        s: c.start, e: c.end, w: c.written, a: c.active,
      })),
      ranges: this.alloc?.completed() ?? [],
      error: this.error,
      native: this.native,
      downloadId: this.downloadId,
      priv: this.priv || undefined,
      completedAt: this.completedAt,
      digestOk: this.digestOk,
      digestSkipped: this.digestSkipped,
      viaHelper: this.viaHelper,
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

/**
 * Dosya adını belirler. Çıktı HER ZAMAN temizlenir.
 *
 * Eskiden sunucunun verdiği ad aynen geçiyordu ve Chrome
 * `downloads.download()` içinde "Invalid filename" ile reddedebiliyordu —
 * tamamlanmış 1,5 GB'lık bir indirme böyle teslim edilememişti (TESLİM.zip,
 * Türkçe İ). Adı üreten TEK kapı burasıdır; temizlik burada yapılır ki
 * hiçbir yol atlanamasın.
 */
function pickFilename(url: string, disposition: string | null, hint?: string): string {
  return sanitizeFilename(rawFilename(url, disposition, hint));
}

function rawFilename(url: string, disposition: string | null, hint?: string): string {
  const star = disposition?.match(/filename\*\s*=\s*(?:UTF-8'')?([^;]+)/i);
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1].trim().replace(/^"|"$/g, ''));
    } catch { /* bozuk yüzde kodlaması — sıradaki adaya geç */ }
  }
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

/**
 * Eşzamanlılık sınırı. 0 = sınırsız. Panelden ayarlanır.
 *
 * Kuyruk TAMAMEN eklenti içinde çalışır — yerel bir yardımcı program
 * gerektirmez. (Yardımcı program yalnızca "tarayıcı kapalıyken de devam et"
 * senaryosunu açardı; sıraya alma onun parçası değil.)
 */
let queueLimit = 0;
let queueSeq = 0;

/**
 * Yerel yardımcı — SW el sıkışmayı yaptıysa dolu, aksi halde null.
 * null olması NORMAL durumdur: uzantı tek başına tam işlevlidir.
 */
let helper: { client: HelperClient; caps: HelperCapabilities } | null = null;
/** Kullanıcı "tarayıcıyı kapatsam da devam etsin" dedi mi? */
let helperContinueAfterClose = false;

async function setHelper(hs: HelperHandshake | null): Promise<void> {
  if (!hs) { helper = null; return; }
  const client = new HelperClient(hs);
  try {
    helper = { client, caps: await client.health() };
  } catch {
    helper = null; // yardımcı kapanmış olabilir — kendi motorumuza dön
    send({ target: 'sw', type: 'helper-status', up: false }); // ikon yalan söylemesin
    broadcast();
    return;
  }
  await reattachHelperJobs();
  broadcast();
}

/**
 * Tarayıcı kapalıyken süren işlere geri bağlanır.
 *
 * Yardımcı tarayıcıdan bağımsız çalıştığı için, tarayıcı yeniden açıldığında
 * orada hâlâ inen (ya da bitmiş) işler olabilir. Bunları toplamazsak indirme
 * diskte tamamlanır ama panelde hiç görünmez — özelliğin yarısı teslim
 * edilmemiş olur.
 */
async function reattachHelperJobs(): Promise<void> {
  const h = helper;
  if (!h) return;
  let list;
  try {
    list = await h.client.list();
  } catch {
    return;
  }
  for (const st of list) {
    if (jobs.has(st.id)) continue;
    if (st.state === 'cancelled') continue;
    const job = Job.restored(st.id, {
      v: 1, url: '', filename: st.path?.split(/[/\\]/).pop() ?? 'download',
      size: st.size, connections: h.caps.maxConnections,
      ranges: toEngineRanges(st.ranges), updatedAt: Date.now(),
    });
    job.viaHelper = true;
    job.state = st.state === 'done' ? 'done' : 'downloading';
    job.skipRevalidate(); // yardımcı zaten indiriyor; probe gereksiz
    jobs.set(st.id, job);
    if (st.state !== 'done') job.watchHelperPublic();
  }
  if (list.length) broadcast();
}

/** Slot boşaldığında kuyruktan sıradakileri başlatır. */
function pumpQueue(): void {
  const items = [...jobs.values()].map((j) => ({ id: j.id, state: j.state, seq: j.seq }));
  for (const id of nextToStart(items, queueLimit)) {
    const job = jobs.get(id);
    if (!job) continue;
    void job.start();
  }
}

let broadcastTimer: ReturnType<typeof setTimeout> | null = null;
function broadcast(): void {
  if (broadcastTimer) return;
  broadcastTimer = setTimeout(() => {
    broadcastTimer = null;
    const queued = [...jobs.values()].filter((j) => j.state === 'queued')
      .sort((a, b) => a.seq - b.seq);
    const pos = new Map(queued.map((j, i) => [j.id, i + 1]));
    send({
      target: 'panel', type: 'jobs',
      jobs: [...jobs.values()].map((j) => ({ ...j.snapshot(), queuePos: pos.get(j.id) })),
    });
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
      const job = new Job(raw.url, Math.min(MAX_CONNECTIONS, Math.max(1, raw.connections ?? auto)), raw.filenameHint);
      job.priv = raw.priv ?? false;
      job.origin = raw.origin;
      job.sender = raw.sender;
      jobs.set(job.id, job);
      const items = [...jobs.values()].map((j) => ({ id: j.id, state: j.state, seq: j.seq }));
      if (shouldStartImmediately(items.filter((i) => i.id !== job.id), queueLimit, raw.manual ?? false)) {
        void job.start();
      } else {
        job.state = 'queued';
        broadcast();
      }
      break;
    }
    case 'pause': jobs.get(raw.jobId)?.pause(); break;
    case 'resume': jobs.get(raw.jobId)?.resume(); break;
    case 'cancel': void jobs.get(raw.jobId)?.cancel(); break;
    case 'pause-all': for (const j of jobs.values()) j.pause(); break;
    case 'query': broadcast(); break;
    case 'delivered': void jobs.get(raw.jobId)?.delivered(raw.ok, raw.error, raw.downloadId); break;
    case 'settings': {
      maxRetries = Math.min(10, Math.max(0, raw.maxRetries));
      if (raw.continueAfterClose !== undefined) helperContinueAfterClose = raw.continueAfterClose;
      if (raw.queueLimit !== undefined) {
        queueLimit = Math.max(0, Math.min(20, raw.queueLimit));
        pumpQueue(); // sınır büyüdüyse bekleyenler hemen başlasın
      }
      break;
    }
    case 'renew': void jobs.get(raw.jobId)?.renew(raw.url); break;
    case 'deliver-ack': jobs.get(raw.jobId)?.deliverAck(); break;
    case 'helper': void setHelper(raw.handshake); break;
  }
});
