export type JobState =
  | 'queued'    // kuyrukta bekliyor — eşzamanlılık sınırı dolu
  | 'probing'
  | 'downloading'
  | 'paused'
  | 'finalizing'
  | 'done'
  | 'error';

export interface ClaimSnapshot {
  s: number; // start
  e: number; // end (exclusive)
  w: number; // written
  a: boolean; // active connection
}

export interface JobSnapshot {
  id: string;
  url: string;
  filename: string;
  size: number | null;
  state: JobState;
  downloaded: number;
  speed: number; // bytes/sec
  connections: number;
  claims: ClaimSnapshot[];
  ranges: Array<[number, number]>; // birleştirilmiş tamamlanan aralıklar (segment haritası)
  error?: string;
  native?: boolean;
  downloadId?: number; // teslim sonrası chrome.downloads kimliği (Aç / Göster için)
  priv?: boolean; // gizli indirme: geçmişte iz bırakmaz
  completedAt?: number;   // teslim zamanı (epoch ms)
  digestOk?: boolean;     // sunucu özeti doğrulandıysa true
  digestSkipped?: boolean; // özet vardı ama doğrulanamadı (çok büyük / hata)
  origin?: string;        // kaynak: servis adı ya da host
  sender?: string;        // maildeki gönderen (yalnız yerelde tutulur)
  queuePos?: number;      // 'queued' ise kuyruktaki sıra (1 tabanlı)
  viaHelper?: boolean;    // iş yerel yardımcıya devredildi
}

export interface HelperHandshakeMsg {
  port: number; token: string; version: string; dir: string;
}

export type Msg =
  // panel/sw → engine
  | { target: 'engine'; type: 'add'; url: string; connections?: number; filenameHint?: string; priv?: boolean; origin?: string; sender?: string; manual?: boolean }
  | { target: 'engine'; type: 'pause'; jobId: string }
  | { target: 'engine'; type: 'resume'; jobId: string }
  | { target: 'engine'; type: 'cancel'; jobId: string }
  | { target: 'engine'; type: 'pause-all' }
  | { target: 'engine'; type: 'query' }
  | { target: 'engine'; type: 'delivered'; jobId: string; ok: boolean; error?: string; downloadId?: number }
  | { target: 'engine'; type: 'settings'; maxRetries: number; queueLimit?: number; continueAfterClose?: boolean }
  | { target: 'engine'; type: 'deliver-ack'; jobId: string }
  | { target: 'engine'; type: 'helper'; handshake: HelperHandshakeMsg | null }
  | { target: 'sw'; type: 'enable-helper' }
  | { target: 'sw'; type: 'helper-query' }
  | { target: 'sw'; type: 'helper-status'; up: boolean }
  | { target: 'panel'; type: 'helper-result'; ok: boolean; needsInstall?: boolean }
  | { target: 'panel'; type: 'helper-state'; enabled: boolean; up: boolean; version?: string }
  | { target: 'engine'; type: 'renew'; jobId: string; url: string }
  // engine/panel → sw
  | { target: 'sw'; type: 'add'; url: string; connections?: number; filenameHint?: string; priv?: boolean; origin?: string; sender?: string }
  | { target: 'sw'; type: 'pause'; jobId: string }
  | { target: 'sw'; type: 'resume'; jobId: string }
  | { target: 'sw'; type: 'cancel'; jobId: string }
  | { target: 'sw'; type: 'pause-all' }
  | { target: 'sw'; type: 'renew'; jobId: string; url: string }
  | { target: 'sw'; type: 'share-fetch'; url: string; reqId?: string; sender?: string }
  | { target: 'sw'; type: 'share-clicked'; label: string }
  | { target: 'sw'; type: 'share-expired' }
  | { target: 'mail'; type: 'share-status'; reqId: string; state: 'working' | 'started' | 'expired' | 'noaction' }
  | { target: 'sw'; type: 'beam-pair'; pairing: { relay: string; pairId: string; keyB64: string } }
  | { target: 'sw'; type: 'beam-unpair' }
  | { target: 'sw'; type: 'hello-panel' }
  | { target: 'sw'; type: 'deliver'; jobId: string; blobUrl: string; filename: string; size: number; topSpeed: number; priv?: boolean; origin?: string; sender?: string }
  | { target: 'sw'; type: 'native-fallback'; jobId: string; url: string }
  | { target: 'sw'; type: 'keepawake'; on: boolean }
  // engine → panel
  | { target: 'panel'; type: 'jobs'; jobs: JobSnapshot[] };

export const MIN_SPLIT = 1 << 20; // 1 MiB — work-stealing alt sınırı
export const SEG_MIN = 1 << 20;
export const SEG_MAX = 128 << 20;
