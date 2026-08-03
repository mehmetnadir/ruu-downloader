/**
 * Adaptif bağlantı rampası — saha ölçümüne verilen cevap.
 *
 * ÖLÇÜM (2026-08-03, test/field/bench.mjs):
 *   Catbox (paylaşım hostu)   tek 1,42 → 6 paralel 2,53 MB/s  = ×1,78 KAZANÇ
 *   Hetzner (hızlı CDN, H2)   tek 3,55 → 6 paralel 3,07       = ×0,86 kayıp
 *   ThinkBroadband (hızlı hat) tek 41,6 → 6 paralel 27,5      = ×0,66 KAYIP
 *
 * Yani kör paralellik hızlı hatlarda ZARARLI (6× TCP slow-start + el sıkışma,
 * HTTP/2'de tek transport üzerinde aynı pencereyi bölüşme). Doğru davranış:
 * TEK bağlantıyla başla, hızı ölç, yalnızca EKLEMEK FAYDA ETTİKÇE bağlantı ekle.
 *
 * Bu, sabit bağlantı sayısı kullanan rakiplerin (IDM 8/16/32, Turbo DM 3)
 * yapmadığı şeydir: onlar hızlı hatta da aynı sayıda bağlantı açar.
 */
export interface RampState {
  /** Şu anda açık pompa sayısı */
  active: number;
  /** Son ölçülen hız (bayt/sn) */
  lastSpeed: number;
  /** Bir bağlantı eklendikten sonra ölçülen hız — karşılaştırma tabanı */
  speedBeforeLastAdd: number;
  /** Rampa durdu mu (ekleme fayda etmedi) */
  settled: boolean;
}

export const RAMP_START: RampState = {
  active: 0, lastSpeed: 0, speedBeforeLastAdd: 0, settled: false,
};

/** Ekleme faydalı sayılması için gereken en az iyileşme (%12). */
const MIN_GAIN = 1.12;

/**
 * Bir sonraki adımda bağlantı eklenmeli mi?
 * @param maxConnections cihaz/ağ için hesaplanmış üst sınır (≤6)
 */
export function shouldAddConnection(
  state: RampState,
  currentSpeed: number,
  maxConnections: number,
): boolean {
  if (state.settled) return false;
  if (state.active >= maxConnections) return false;
  if (state.active === 0) return true;              // ilk pompa
  if (currentSpeed <= 0) return false;              // henüz ölçüm yok
  if (state.speedBeforeLastAdd === 0) return true;  // ikinci pompayı dene
  // Son ekleme yeterince iyileştirdiyse devam et, etmediyse dur
  return currentSpeed >= state.speedBeforeLastAdd * MIN_GAIN;
}

/** Ekleme kararından sonra durumu ilerletir. */
export function afterDecision(
  state: RampState,
  currentSpeed: number,
  added: boolean,
): RampState {
  if (added) {
    return {
      active: state.active + 1,
      lastSpeed: currentSpeed,
      speedBeforeLastAdd: currentSpeed,
      settled: false,
    };
  }
  // Eklemedik: eğer sebebi "fayda yok" ise rampayı kapat (üst sınır değilse)
  const settled = state.active > 0 && currentSpeed > 0;
  return { ...state, lastSpeed: currentSpeed, settled };
}
