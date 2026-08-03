import { describe, expect, it } from 'vitest';
import { afterDecision, RAMP_START, shouldAddConnection, type RampState } from '../src/engine/ramp';

/** Rampayı simüle et: speedFor(n) = n bağlantıyla ölçülen hız. */
function simulate(speedFor: (n: number) => number, max = 6): number {
  let s: RampState = { ...RAMP_START };
  for (let step = 0; step < 20; step++) {
    const speed = s.active === 0 ? 0 : speedFor(s.active);
    const add = shouldAddConnection(s, speed, max);
    s = afterDecision(s, speed, add);
    if (s.settled) break;
  }
  return s.active;
}

describe('adaptif bağlantı rampası', () => {
  it('HIZLI HAT: ekleme kötüleştiriyorsa TEK bağlantıya geri çekilir (ThinkBroadband profili)', () => {
    // 1→41, 2→39, 3→37 … her ekleme zarar; en iyi n=1, oraya dönmeli
    expect(simulate((n) => 41 - (n - 1) * 2)).toBe(1);
  });

  it('GÜRÜLTÜLÜ EĞRİ: ara çukuru yoklayıp geçer (gerçek Catbox ölçümü 2026-08-03)', () => {
    // n=3'teki düşüş gerçek tavan değil, ölçüm gürültüsü
    const measured = [0, 1.52, 2.03, 1.64, 2.55, 2.86, 2.17];
    const n = simulate((k) => measured[k] ?? 0);
    // en iyi 2,85 — %95'inden fazlasını yakalamalı
    expect((measured[n] ?? 0) / 2.86).toBeGreaterThan(0.95);
  });

  it('geri çekilme: 4. bağlantı zarar verirse 3\'e döner', () => {
    // 1→2, 2→4, 3→6, 4→3 (çöküş)
    expect(simulate((n) => (n <= 3 ? n * 2 : 3))).toBe(3);
  });

  it('PAYLAŞIM HOSTU: bağlantı başına kısıtlıysa tavana çıkar (Catbox profili)', () => {
    // her bağlantı ~1,4 MB/s ekliyor → lineer büyüme
    expect(simulate((n) => 1.4 * n)).toBe(6);
  });

  it('KISMİ: 3 bağlantıdan sonra doyuyorsa orada durur', () => {
    expect(simulate((n) => Math.min(n, 3) * 2)).toBeLessThanOrEqual(4);
  });

  it('üst sınır asla aşılmaz', () => {
    expect(simulate((n) => 1.4 * n, 2)).toBe(2);
  });

  it('doyduktan sonra bir daha eklemez', () => {
    const settled: RampState = { ...RAMP_START, active: 3, lastSpeed: 10, speedBeforeLastAdd: 10, settled: true };
    expect(shouldAddConnection(settled, 10, 6)).toBe(false);
  });
});
