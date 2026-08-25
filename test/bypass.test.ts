import { describe, expect, it } from 'vitest';
import { BYPASS_TTL_MS, isBypassClick, shouldBypass, type BypassMark } from '../src/engine/bypass';

const NOW = 1_000_000;
const mark = (url: string, at = NOW): BypassMark => ({ url, at });

describe('değiştirici tuşla tarayıcıya devretme — tıklama', () => {
  const click = (p: Partial<Parameters<typeof isBypassClick>[0]> = {}) =>
    isBypassClick({ button: 0, altKey: false, ctrlKey: false, metaKey: false, ...p });

  it('Cmd / Ctrl / Alt sol tık devretme sayılır', () => {
    expect(click({ metaKey: true })).toBe(true);
    expect(click({ ctrlKey: true })).toBe(true);
    expect(click({ altKey: true })).toBe(true);
  });

  it('düz sol tık devretmez — normal akış Ruu\'da kalır', () => {
    expect(click()).toBe(false);
  });

  it('sağ ve orta tuş sayılmaz (bağlam menüsü / sekme davranışı)', () => {
    expect(click({ button: 2, metaKey: true })).toBe(false);
    expect(click({ button: 1, ctrlKey: true })).toBe(false);
  });
});

describe('değiştirici tuşla tarayıcıya devretme — eşleme', () => {
  it('işaret yoksa devralma normal işler', () => {
    expect(shouldBypass(undefined, { url: 'https://a.test/f.zip' }, NOW)).toBe(false);
  });

  it('adres birebir eşleşince devreder', () => {
    expect(shouldBypass(mark('https://a.test/f.zip'), { url: 'https://a.test/f.zip' }, NOW))
      .toBe(true);
  });

  it('finalUrl üzerinden de eşleşir (sunucu yönlendirdi)', () => {
    expect(shouldBypass(
      mark('https://a.test/f.zip'),
      { url: 'https://kisa.test/x', finalUrl: 'https://a.test/f.zip' }, NOW,
    )).toBe(true);
  });

  it('aynı köken, farklı yol → devreder (JS imzalı adrese yönlendirdi)', () => {
    expect(shouldBypass(
      mark('https://wetransfer.test/downloads/abc'),
      { url: 'https://wetransfer.test/eugv/abc?token=imza' }, NOW,
    )).toBe(true);
  });

  it('FARKLI köken ASLA eşleşmez — alakasız indirme kaçmaz', () => {
    expect(shouldBypass(
      mark('https://haber.test/makale'),
      { url: 'https://baska.test/kurulum.dmg' }, NOW,
    )).toBe(false);
  });

  it('pencere dolunca işaret ölür', () => {
    const m = mark('https://a.test/f.zip', NOW - BYPASS_TTL_MS - 1);
    expect(shouldBypass(m, { url: 'https://a.test/f.zip' }, NOW)).toBe(false);
  });

  it('pencerenin son anı hâlâ geçerli (sınır)', () => {
    const m = mark('https://a.test/f.zip', NOW - BYPASS_TTL_MS);
    expect(shouldBypass(m, { url: 'https://a.test/f.zip' }, NOW)).toBe(true);
  });

  it('gelecekten gelen işaret (saat kayması) reddedilir', () => {
    expect(shouldBypass(mark('https://a.test/f.zip', NOW + 5000), { url: 'https://a.test/f.zip' }, NOW))
      .toBe(false);
  });

  it('ayrıştırılamayan adres patlatmaz', () => {
    expect(shouldBypass(mark('bu bir url değil'), { url: 'https://a.test/f.zip' }, NOW)).toBe(false);
    expect(shouldBypass(mark('https://a.test/f.zip'), { url: 'blob:bozuk' }, NOW)).toBe(false);
  });

  it('şema/port farkı ayrı kökendir', () => {
    expect(shouldBypass(mark('http://a.test/f.zip'), { url: 'https://a.test/g.zip' }, NOW))
      .toBe(false);
    expect(shouldBypass(mark('https://a.test:8443/f.zip'), { url: 'https://a.test/g.zip' }, NOW))
      .toBe(false);
  });
});
