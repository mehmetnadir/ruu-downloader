import { describe, expect, it } from 'vitest';
import { applyDownload, EMPTY_STATS } from '../src/engine/stats';

describe('applyDownload', () => {
  it('sayaç, toplam byte ve rekor hızı günceller', () => {
    const s1 = applyDownload(EMPTY_STATS, 100, 50);
    expect(s1).toEqual({ count: 1, bytes: 100, bestSpeed: 50 });
    const s2 = applyDownload(s1, 200, 30);
    expect(s2).toEqual({ count: 2, bytes: 300, bestSpeed: 50 });
  });

  it('negatif değerlere karşı korumalı', () => {
    const s = applyDownload(EMPTY_STATS, -5, -1);
    expect(s).toEqual({ count: 1, bytes: 0, bestSpeed: 0 });
  });
});
