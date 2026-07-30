import { describe, expect, it } from 'vitest';
import { routeByType } from '../src/engine/foldering';

describe('routeByType', () => {
  it('bilinen türleri kategorisine yönlendirir', () => {
    expect(routeByType('tatil.jpg', true)).toBe('Ruu/Görseller/tatil.jpg');
    expect(routeByType('film.MKV', true)).toBe('Ruu/Video/film.MKV');
    expect(routeByType('arsiv.tar', true)).toBe('Ruu/Arşiv/arsiv.tar');
    expect(routeByType('rapor.pdf', true)).toBe('Ruu/Belgeler/rapor.pdf');
    expect(routeByType('kurulum.dmg', true)).toBe('Ruu/Uygulamalar/kurulum.dmg');
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
