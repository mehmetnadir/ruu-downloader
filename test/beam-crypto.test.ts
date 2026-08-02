import { beforeAll, describe, expect, it } from 'vitest';
import {
  createPairing, decodePairing, encodePairing, open, seal,
} from '../src/beam/crypto';

beforeAll(async () => {
  if (!globalThis.crypto?.subtle) {
    const { webcrypto } = await import('node:' + 'crypto');
    Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
  }
});

describe('Beam kripto', () => {
  it('mühürle → çöz turu metni korur', async () => {
    const p = await createPairing('https://relay.test');
    const env = await seal(p.keyB64, 'https://ornek.com/dosya.zip');
    expect(env.data).not.toContain('ornek.com'); // gerçekten şifreli
    expect(await open(p.keyB64, env)).toBe('https://ornek.com/dosya.zip');
  });

  it('yanlış anahtar null döner (patlamaz)', async () => {
    const a = await createPairing('https://r');
    const b = await createPairing('https://r');
    const env = await seal(a.keyB64, 'gizli');
    expect(await open(b.keyB64, env)).toBeNull();
  });

  it('bozuk zarf null döner', async () => {
    const p = await createPairing('https://r');
    expect(await open(p.keyB64, { id: 'x', iv: 'AAAA', data: 'bozuk' })).toBeNull();
  });

  it('her zarf benzersiz id ve iv taşır (KV tekilleştirmesi için)', async () => {
    const p = await createPairing('https://r');
    const e1 = await seal(p.keyB64, 'aynı metin');
    const e2 = await seal(p.keyB64, 'aynı metin');
    expect(e1.id).not.toBe(e2.id);
    expect(e1.iv).not.toBe(e2.iv);
    expect(e1.data).not.toBe(e2.data); // aynı düz metin, farklı şifreli çıktı
  });

  it('eşleştirme dizesi kodla/çöz turu', async () => {
    const p = await createPairing('https://relay.test');
    const s = encodePairing(p);
    expect(s.startsWith('ruu:')).toBe(true);
    expect(decodePairing(s)).toEqual(p);
    expect(decodePairing('başka-şey')).toBeNull();
    expect(decodePairing('ruu:bozuk!!')).toBeNull();
  });

  it('pairId tahmin edilemez uzunlukta', async () => {
    const p = await createPairing('https://r');
    expect(p.pairId.length).toBeGreaterThanOrEqual(16);
  });
});
