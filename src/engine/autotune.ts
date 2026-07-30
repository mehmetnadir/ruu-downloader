/**
 * Cihaza otomatik ayar (PRD-3 #5): bağlantı sayısını ağ + donanım ipuçlarından türetir.
 * Saf fonksiyon — unit test edilir; ipuçları çağıran tarafta toplanır.
 */
export interface DeviceHints {
  cores?: number;         // navigator.hardwareConcurrency
  downlinkMbps?: number;  // navigator.connection.downlink
  effectiveType?: string; // navigator.connection.effectiveType
  deviceMemoryGB?: number; // navigator.deviceMemory
}

export function autoTuneConnections(h: DeviceHints): number {
  if (h.effectiveType === 'slow-2g' || h.effectiveType === '2g') return 1;
  if (h.effectiveType === '3g') return 2;
  let n = 4;
  if ((h.downlinkMbps ?? 10) >= 50 && (h.cores ?? 4) >= 8) n = 6;
  if ((h.deviceMemoryGB ?? 8) <= 4) n = Math.min(n, 3);
  return Math.max(1, Math.min(8, n));
}

export function collectHints(): DeviceHints {
  const nav = navigator as Navigator & {
    connection?: { downlink?: number; effectiveType?: string };
    deviceMemory?: number;
  };
  return {
    cores: nav.hardwareConcurrency,
    downlinkMbps: nav.connection?.downlink,
    effectiveType: nav.connection?.effectiveType,
    deviceMemoryGB: nav.deviceMemory,
  };
}
