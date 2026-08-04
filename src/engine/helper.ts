/**
 * Ruu Helper istemcisi — isteğe bağlı yerel yardımcının uzantı tarafı.
 *
 * Yardımcı YOKSA hiçbir şey değişmez: uzantı tek başına tam işlevlidir ve
 * bu modülün tüm yolları sessizce "yok" döner. Kurulum dırdırı yapılmaz.
 *
 * El sıkışma neden native-messaging üzerinden?
 * Chrome yardımcıyı yalnızca yüklü manifest'te yazılı eklenti kimliği için
 * başlatır. Port ve token bu kanaldan geldiği için, makinedeki başka bir
 * program portu tahmin etse bile konuşamaz. Veri trafiği sonra HTTP'ye geçer
 * çünkü native-messaging kanalı tarayıcı kapanınca ölür — oysa yardımcının
 * varlık sebeplerinden biri tam olarak tarayıcı kapandıktan sonra da sürmek.
 */

export const HELPER_HOST = 'com.ruu.downloader.helper';

export interface HelperHandshake {
  port: number;
  token: string;
  version: string;
  dir: string;
}

export interface HelperCapabilities {
  version: string;
  dir: string;
  maxConnections: number;
  survivesBrowserClose: boolean;
  resume: boolean;
}

export interface HelperJobSpec {
  id: string;
  url: string;
  dest: string;
  size: number;
  connections: number;
  headers?: Record<string, string>;
  minChunk?: number;
}

export interface HelperJobStatus {
  id: string;
  state: 'running' | 'done' | 'error' | 'cancelled';
  size: number;
  downloaded: number;
  ranges: Array<{ s: number; e: number }>;
  error?: string;
  path?: string;
}

/** Bir el sıkışmanın kullanılabilir olup olmadığını doğrular. */
export function isValidHandshake(v: unknown): v is HelperHandshake {
  if (typeof v !== 'object' || v === null) return false;
  const h = v as Record<string, unknown>;
  return typeof h['port'] === 'number' && h['port'] > 0 && h['port'] < 65536
    && typeof h['token'] === 'string' && h['token'].length >= 32
    && typeof h['version'] === 'string';
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export class HelperClient {
  /**
   * DİKKAT: varsayılan `fetch` BAĞLANMIŞ olmak zorunda.
   * Sınıf alanı olarak saklanan çıplak `fetch`, metot gibi çağrılınca `this`
   * HelperClient olur ve tarayıcı "Illegal invocation" atar — istek hiç gitmez.
   * Sessizce null yeteneğe düşüyordu; saha testi yakaladı.
   */
  constructor(
    private readonly hs: HelperHandshake,
    private readonly doFetch: FetchLike = (url, init) => fetch(url, init),
  ) {}

  /** Yardımcı yalnızca 127.0.0.1'de dinler; adresi burada da sabitliyoruz. */
  private url(path: string): string {
    return `http://127.0.0.1:${this.hs.port}${path}`;
  }

  private async call<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await this.doFetch(this.url(path), {
      ...init,
      headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${this.hs.token}` },
    });
    if (!res.ok) throw new Error(`yardımcı ${res.status}`);
    return (await res.json()) as T;
  }

  health(): Promise<HelperCapabilities> {
    return this.call<HelperCapabilities>('/health');
  }

  start(spec: HelperJobSpec): Promise<HelperJobStatus> {
    return this.call<HelperJobStatus>('/jobs', {
      method: 'POST',
      body: JSON.stringify(spec),
    });
  }

  /** Süren işleri listeler — tarayıcı yeniden açıldığında geri bağlanmak için. */
  list(): Promise<HelperJobStatus[]> {
    return this.call<HelperJobStatus[]>('/jobs');
  }

  status(id: string): Promise<HelperJobStatus> {
    return this.call<HelperJobStatus>(`/jobs/${encodeURIComponent(id)}`);
  }

  cancel(id: string): Promise<HelperJobStatus> {
    return this.call<HelperJobStatus>(`/jobs/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }
}

/**
 * Yardımcının aralık defterini uzantının biçimine çevirir.
 *
 * İkisi aynı "diskte ne var" tanımını paylaşmak ZORUNDA: bir işi yardımcı
 * başlatıp uzantı bitirebilir ya da tersi. Uzantı her zaman doğruluk kaynağıdır.
 */
export function toEngineRanges(rs: Array<{ s: number; e: number }>): Array<[number, number]> {
  return rs.map((r) => [r.s, r.e]);
}

/**
 * Bu iş için yardımcı kullanmak MANTIKLI mı?
 *
 * Yardımcı bir hız hilesi değil, iki somut sınırın çaresidir. İkisi de geçerli
 * değilse tarayıcı motoru zaten daha iyidir: teslim yolu Chrome'un indirme
 * arayüzüne bağlı, iptal/duraklat anında ve fazladan hiçbir bileşen yok.
 */
export function shouldUseHelper(opts: {
  available: boolean;
  wantConnections: number;   // uzantının rampasının istediği
  browserCap: number;        // tarayıcının host başına tavanı (6)
  continueAfterClose: boolean;
  sizeBytes: number;
  minSizeBytes?: number;
}): boolean {
  if (!opts.available) return false;
  // Küçük dosyada yardımcıya gitmek kurulum maliyetine değmez.
  const min = opts.minSizeBytes ?? 64 * 1024 * 1024;
  if (opts.sizeBytes < min && !opts.continueAfterClose) return false;
  if (opts.continueAfterClose) return true;
  return opts.wantConnections > opts.browserCap;
}
