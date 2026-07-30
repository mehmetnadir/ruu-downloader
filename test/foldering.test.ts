import { describe, expect, it } from 'vitest';
import { routeByType } from '../src/engine/foldering';

describe('routeByType', () => {
  it('bilinen türleri kategorisine yönlendirir (varsayılan adlar İngilizce)', () => {
    expect(routeByType('tatil.jpg', true)).toBe('Ruu/Images/tatil.jpg');
    expect(routeByType('film.MKV', true)).toBe('Ruu/Video/film.MKV');
    expect(routeByType('arsiv.tar', true)).toBe('Ruu/Archives/arsiv.tar');
    expect(routeByType('rapor.pdf', true)).toBe('Ruu/Documents/rapor.pdf');
    expect(routeByType('kurulum.dmg', true)).toBe('Ruu/Apps/kurulum.dmg');
  });

  it('yerelleştirilmiş kategori adları enjekte edilebilir', () => {
    const tr = { catImg: 'Görseller' };
    expect(routeByType('tatil.jpg', true, tr)).toBe('Ruu/Görseller/tatil.jpg');
  });

  it('bilinmeyen uzantı ve uzantısız dosya kök Downloads\'ta kalır', () => {
    expect(routeByType('veri.bin', true)).toBe('veri.bin');
    expect(routeByType('README', true)).toBe('README');
    expect(routeByType('.gizli', true)).toBe('.gizli');
  });

  it('kapalıyken hiç dokunmaz', () => {
    expect(routeByType('tatil.jpg', false)).toBe('tatil.jpg');
  });
});
