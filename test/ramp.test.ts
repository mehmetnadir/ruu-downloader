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
  it('HIZLI HAT: ekleme fayda etmiyorsa tek bağlantıda kalır (ThinkBroadband profili)', () => {
    // 1→41, 2→40, 3→38 … eklemek kötüleştiriyor
    expect(simulate((n) => 41 - (n - 1) * 2)).toBeLessThanOrEqual(2);
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
    const settled: RampState = { active: 3, lastSpeed: 10, speedBeforeLastAdd: 10, settled: true };
    expect(shouldAddConnection(settled, 10, 6)).toBe(false);
  });
});
