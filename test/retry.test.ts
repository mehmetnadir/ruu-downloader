import { describe, expect, it } from 'vitest';
import { failThreshold } from '../src/engine/retry';

describe('failThreshold', () => {
  it('varsayılan: 4 bağlantı × (1+1 retry) = 8', () => {
    expect(failThreshold(4, 1)).toBe(8);
  });
  it('retry 0 → her bağlantı tek şans', () => {
    expect(failThreshold(4, 0)).toBe(4);
  });
  it('tek bağlantıda bile en az 2 (anlık tek hıçkırık işi düşürmesin)', () => {
    expect(failThreshold(1, 0)).toBe(2);
  });
  it('kullanıcı artırırsa büyür', () => {
    expect(failThreshold(6, 5)).toBe(36);
  });
});
