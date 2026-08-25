import { describe, expect, it } from 'vitest';
import { decideTakeover, preflightVerdict } from '../src/engine/takeover';

const S = { takeover: true, takeoverMinMB: 10 };
const notOwn = () => false;

describe('decideTakeover', () => {
  it('büyük http(s) indirmeyi devralır', () => {
    expect(decideTakeover(
      { url: 'https://x.com/f.zip', state: 'in_progress', totalBytes: 50 << 20 }, S, notOwn,
    )).toEqual({ action: 'take', url: 'https://x.com/f.zip' });
  });

  it('boyutu bilinmeyeni de devralır (totalBytes 0/-1)', () => {
    expect(decideTakeover(
      { url: 'https://x.com/f', state: 'in_progress', totalBytes: 0 }, S, notOwn,
    ).action).toBe('take');
  });

  it('eşik altı native kalır; eşik 0 ise her boyut devralınır', () => {
    expect(decideTakeover(
      { url: 'https://x.com/s.zip', state: 'in_progress', totalBytes: 1 << 20 }, S, notOwn,
    )).toMatchObject({ action: 'skip', reason: 'small' });
    expect(decideTakeover(
      { url: 'https://x.com/s.zip', state: 'in_progress', totalBytes: 1 << 20 },
      { takeover: true, takeoverMinMB: 0 }, notOwn,
    ).action).toBe('take');
  });

  it('blob/data şemaları devralınamaz (yeniden fetch edilemez)', () => {
    expect(decideTakeover(
      { url: 'blob:https://x.com/abc', state: 'in_progress', totalBytes: 99 << 20 }, S, notOwn,
    )).toMatchObject({ action: 'skip', reason: 'scheme' });
  });

  it('kapalıysa ve kendi indirmemizse atlar', () => {
    expect(decideTakeover(
      { url: 'https://x.com/f.zip', state: 'in_progress' },
      { takeover: false, takeoverMinMB: 10 }, notOwn,
    )).toMatchObject({ action: 'skip', reason: 'disabled' });
    expect(decideTakeover(
      { url: 'https://x.com/f.zip', state: 'in_progress' }, S, () => true,
    )).toMatchObject({ action: 'skip', reason: 'own' });
  });

  it('finalUrl önceliklidir', () => {
    const d = decideTakeover(
      { url: 'https://kisa.lt/a', finalUrl: 'https://cdn.x.com/f.zip', state: 'in_progress', totalBytes: 20 << 20 },
      S, notOwn,
    );
    expect(d).toEqual({ action: 'take', url: 'https://cdn.x.com/f.zip' });
  });
});

describe('forced (paylaşım akışı) devralma', () => {
  it('kullanıcı "Ruu ile indir" dediyse eşik uygulanmaz — 2.6KB bile devralınır', () => {
    const tiny = { url: 'https://x.com/f.zip', state: 'in_progress', totalBytes: 2662 };
    expect(decideTakeover(tiny, S, notOwn)).toMatchObject({ action: 'skip', reason: 'small' });
    expect(decideTakeover(tiny, S, notOwn, true)).toMatchObject({ action: 'take' });
  });

  it('forced olsa bile blob/kendi indirmemiz atlanır', () => {
    expect(decideTakeover({ url: 'blob:https://x/1', state: 'in_progress' }, S, notOwn, true))
      .toMatchObject({ action: 'skip', reason: 'scheme' });
    expect(decideTakeover({ url: 'https://x.com/f', state: 'in_progress' }, S, () => true, true))
      .toMatchObject({ action: 'skip', reason: 'own' });
  });
});

describe('decideTakeover — değiştirici tuşla tarayıcıya devretme', () => {
  const big = { url: 'https://x.com/f.zip', state: 'in_progress', totalBytes: 50 << 20 };

  it('tuş basılı tıklamada devralmaz, sebebi kayda geçer', () => {
    expect(decideTakeover(big, S, notOwn, false, true))
      .toEqual({ action: 'skip', reason: 'bypass', url: 'https://x.com/f.zip' });
  });

  it('paylaşım akışı açık olsa BİLE tuş kazanır — o an verilmiş karar', () => {
    expect(decideTakeover(big, S, notOwn, true, true).action).toBe('skip');
  });

  it('bayrak yoksa davranış değişmez (geriye uyum)', () => {
    expect(decideTakeover(big, S, notOwn).action).toBe('take');
    expect(decideTakeover(big, S, notOwn, false, false).action).toBe('take');
  });
});

describe('devralma ön-uçuşu (WeTransfer vakası)', () => {
  it('206 → tam hız devralma', () => {
    expect(preflightVerdict(206)).toBe('range');
  });

  it('200 → devral ama böleme (adres yeniden istenebilir olduğu KANITLANDI)', () => {
    expect(preflightVerdict(200)).toBe('plain');
  });

  it('KÖK NEDEN: 404/403 → Chrome\'un çalışan indirmesine DOKUNMA', () => {
    for (const s of [400, 401, 403, 404, 410, 429, 500, 502, 503]) {
      expect(preflightVerdict(s)).toBe('abort');
    }
  });

  it('yönlendirme/beklenmedik durumlar da güvenli tarafa düşer', () => {
    for (const s of [0, 204, 301, 302, 307, 416]) {
      expect(preflightVerdict(s)).toBe('abort');
    }
  });
});
