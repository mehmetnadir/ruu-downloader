import { describe, expect, it } from 'vitest';
import { decideTakeover } from '../src/engine/takeover';

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
