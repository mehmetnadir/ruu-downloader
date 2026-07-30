import { describe, expect, it } from 'vitest';
import { autoTuneConnections } from '../src/engine/autotune';

describe('autoTuneConnections', () => {
  it('yavaş şebekede tek bağlantı (2g)', () => {
    expect(autoTuneConnections({ effectiveType: '2g' })).toBe(1);
    expect(autoTuneConnections({ effectiveType: 'slow-2g' })).toBe(1);
  });

  it('3g\'de iki bağlantı', () => {
    expect(autoTuneConnections({ effectiveType: '3g', cores: 16, downlinkMbps: 100 })).toBe(2);
  });

  it('varsayılan cihazda 4', () => {
    expect(autoTuneConnections({})).toBe(4);
    expect(autoTuneConnections({ cores: 4, downlinkMbps: 20 })).toBe(4);
  });

  it('güçlü cihaz + hızlı hat → 6', () => {
    expect(autoTuneConnections({ cores: 10, downlinkMbps: 100, effectiveType: '4g' })).toBe(6);
  });

  it('düşük bellek bağlantıyı kısar', () => {
    expect(autoTuneConnections({ cores: 10, downlinkMbps: 100, deviceMemoryGB: 4 })).toBe(3);
  });

  it('sınırlar: asla 1 altı veya 8 üstü değil', () => {
    expect(autoTuneConnections({ cores: 64, downlinkMbps: 1000 })).toBeLessThanOrEqual(8);
    expect(autoTuneConnections({ deviceMemoryGB: 1, effectiveType: '2g' })).toBeGreaterThanOrEqual(1);
  });
});
