export type JobState =
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
}

export type Msg =
  // panel/sw → engine
  | { target: 'engine'; type: 'add'; url: string; connections?: number; filenameHint?: string; priv?: boolean }
  | { target: 'engine'; type: 'pause'; jobId: string }
  | { target: 'engine'; type: 'resume'; jobId: string }
  | { target: 'engine'; type: 'cancel'; jobId: string }
  | { target: 'engine'; type: 'pause-all' }
  | { target: 'engine'; type: 'query' }
  | { target: 'engine'; type: 'delivered'; jobId: string; ok: boolean; error?: string; downloadId?: number }
  | { target: 'engine'; type: 'settings'; maxRetries: number }
  | { target: 'engine'; type: 'renew'; jobId: string; url: string }
  // engine/panel → sw
  | { target: 'sw'; type: 'add'; url: string; connections?: number; filenameHint?: string; priv?: boolean }
  | { target: 'sw'; type: 'pause'; jobId: string }
  | { target: 'sw'; type: 'resume'; jobId: string }
  | { target: 'sw'; type: 'cancel'; jobId: string }
  | { target: 'sw'; type: 'pause-all' }
  | { target: 'sw'; type: 'renew'; jobId: string; url: string }
  | { target: 'sw'; type: 'hello-panel' }
  | { target: 'sw'; type: 'deliver'; jobId: string; blobUrl: string; filename: string; size: number; topSpeed: number; priv?: boolean }
  | { target: 'sw'; type: 'native-fallback'; jobId: string; url: string }
  | { target: 'sw'; type: 'keepawake'; on: boolean }
  // engine → panel
  | { target: 'panel'; type: 'jobs'; jobs: JobSnapshot[] };

export const MIN_SPLIT = 1 << 20; // 1 MiB — work-stealing alt sınırı
export const SEG_MIN = 1 << 20;
export const SEG_MAX = 128 << 20;
