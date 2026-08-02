import { describe, expect, it } from 'vitest';
import { autoKey, modeFor } from '../src/content/modes';

describe('servis modu', () => {
  it('varsayılan "sor"; global otomatik açıksa "auto"', () => {
    expect(modeFor('wetransfer', undefined, false)).toBe('ask');
    expect(modeFor('wetransfer', {}, true)).toBe('auto');
  });

  it('servis bazlı ayar global ayarı EZER (her iki yönde)', () => {
    expect(modeFor('mega', { mega: 'off' }, true)).toBe('off');
    expect(modeFor('lifebox', { lifebox: 'auto' }, false)).toBe('auto');
  });
});

describe('autoKey', () => {
  it('izleme parametreleri yok sayılır — aynı transfer iki kez inmez', () => {
    const a = autoKey('https://wetransfer.com/downloads/abc/def?t_exp=1&utm_source=x');
    const b = autoKey('https://wetransfer.com/downloads/abc/def?t_exp=999&trk=y');
    expect(a).toBe(b);
  });

  it('farklı transferler farklı anahtar', () => {
    expect(autoKey('https://we.tl/t-AAA')).not.toBe(autoKey('https://we.tl/t-BBB'));
  });

  it('bozuk URL çökmez', () => {
    expect(autoKey('bozuk')).toBe('bozuk');
  });
});
