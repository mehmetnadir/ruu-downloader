/**
 * Yerel istatistikler (PRD-3 analytics kararı: uzak telemetri YOK, her şey yerel).
 * Saf fonksiyon — SW teslim tamamlandığında uygular, panel gösterir.
 */
export interface Stats {
  count: number;
  bytes: number;
  bestSpeed: number; // bytes/sn
}

export const EMPTY_STATS: Stats = { count: 0, bytes: 0, bestSpeed: 0 };

export function applyDownload(prev: Stats, size: number, topSpeed: number): Stats {
  return {
    count: prev.count + 1,
    bytes: prev.bytes + Math.max(0, size),
    bestSpeed: Math.max(prev.bestSpeed, Math.max(0, topSpeed)),
  };
}
