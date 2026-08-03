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
  /** Üst üste kaç ekleme fayda etmedi (gürültü toleransı) */
  misses: number;
  /** Şimdiye kadarki en iyi hız ve o hızı veren bağlantı sayısı */
  bestSpeed: number;
  bestN: number;
}

export const RAMP_START: RampState = {
  active: 0, lastSpeed: 0, speedBeforeLastAdd: 0, settled: false, misses: 0, bestSpeed: 0, bestN: 0,
};

/**
 * Ekleme faydalı sayılması için gereken en az iyileşme (%5).
 *
 * Neden bu kadar düşük? Gerçek eğri ölçüldüğünde (Catbox, n=1..6) azalan ama
 * HÂLÂ GERÇEK getiri görüldü: 1,65 → 2,17 → 2,36 → 2,85 MB/s. %12'lik eşik
 * 2→3 adımını (%8,8) reddedip n=3'te duruyordu — tavanın %83'ü.
 * Eşiği düşürmek tek başına riskli olurdu (hızlı hatta gereksiz bağlantı),
 * ama aşağıdaki GERİ ÇEKİLME bunu güvenli kılıyor: fazla gidilirse en iyi
 * noktaya dönülür. Yani "yanılmak ucuz" olduğu için cesur davranabiliyoruz.
 */
const MIN_GAIN = 1.05;

/**
 * Kaç başarısız denemeden sonra rampa kapanır.
 *
 * Neden 1 değil? Gerçek eğri ÖLÇÜLDÜĞÜNDE gürültülü çıktı (Catbox, aynı dosya,
 * dakikalar arayla): 1,52 → 2,03 → **1,64** → 2,55 → 2,86 → 2,17 MB/s.
 * n=3'teki çukur gerçek bir tavan değil, ölçüm gürültüsü — açgözlü bir tırmanış
 * orada durup tavanın %57'sinde kalıyordu. Bir çukuru "yoklama" ile geçmek,
 * geri çekilme zaten güvenlik ağı olduğu için bedavaya yakın.
 */
const PATIENCE = 2;

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
  if (currentSpeed >= state.speedBeforeLastAdd * MIN_GAIN) return true;
  // İyileşme yok — ama sabır bitmediyse bir kez daha yokla (gürültü olabilir)
  return state.misses + 1 < PATIENCE;
}

/** Ekleme kararından sonra durumu ilerletir. */
export function afterDecision(
  state: RampState,
  currentSpeed: number,
  added: boolean,
  maxActive = Number.POSITIVE_INFINITY,
): RampState {
  // Her ölçümde en iyi noktayı hatırla — geri çekilmenin dayanağı bu.
  const better = currentSpeed > state.bestSpeed;
  const bestSpeed = better ? currentSpeed : state.bestSpeed;
  const bestN = better ? state.active : state.bestN;

  const improved = state.speedBeforeLastAdd === 0
    || currentSpeed >= state.speedBeforeLastAdd * MIN_GAIN;

  if (added) {
    return {
      // Üst sınır burada da uygulanır: shouldAddConnection çağrılmadan
      // doğrudan afterDecision(_, _, true) çağıran yollar var (motorun ilk
      // pompası, devam et, yenile) — sınır orada da tutmalı.
      active: Math.min(maxActive, state.active + 1),
      lastSpeed: currentSpeed,
      speedBeforeLastAdd: currentSpeed,
      settled: false,
      misses: improved ? 0 : state.misses + 1,
      bestSpeed,
      bestN,
    };
  }

  const settled = state.active > 0 && currentSpeed > 0;
  // GERİ ÇEKİLME: son eklemeler zarar verdiyse en iyi bilinen sayıya dön.
  // Uçuştaki bağlantılar iptal EDİLMEZ — sadece yenisi doğurulmaz, sayı
  // segmentler bittikçe kendiliğinden düşer. Böylece hiçbir bayt boşa gitmez.
  const active = settled && bestN > 0 && bestN < state.active ? bestN : state.active;
  return { ...state, active, lastSpeed: currentSpeed, settled, bestSpeed, bestN };
}
