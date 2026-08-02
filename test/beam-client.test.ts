import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createPairing, seal } from '../src/beam/crypto';
import { pollOnce, type BeamState } from '../src/beam/client';

beforeAll(async () => {
  if (!globalThis.crypto?.subtle) {
    const { webcrypto } = await import('node:' + 'crypto');
    Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
  }
});

const mockRelay = (items: unknown[]): void => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ items }) })));
};

describe('Beam istemcisi — yoklama', () => {
  it('şifreli zarftan URL çıkarır', async () => {
    const p = await createPairing('https://r');
    const env = await seal(p.keyB64, 'https://ornek.com/f.zip');
    mockRelay([env]);
    const state: BeamState = { pairing: p, seen: [] };
    expect(await pollOnce(state)).toEqual(['https://ornek.com/f.zip']);
  });

  it('AYNI zarf iki kez gelirse tek kez işlenir (KV çift teslimi)', async () => {
    const p = await createPairing('https://r');
    const env = await seal(p.keyB64, 'https://ornek.com/f.zip');
    const state: BeamState = { pairing: p, seen: [] };
    mockRelay([env]);
    expect(await pollOnce(state)).toHaveLength(1);
    mockRelay([env]); // röle aynı zarfı tekrar verdi
    expect(await pollOnce(state)).toHaveLength(0);
  });

  it('yanlış anahtarla şifrelenmiş zarf sessizce atlanır', async () => {
    const mine = await createPairing('https://r');
    const other = await createPairing('https://r');
    mockRelay([await seal(other.keyB64, 'https://kotu.com/x')]);
    const state: BeamState = { pairing: mine, seen: [] };
    expect(await pollOnce(state)).toEqual([]);
  });

  it('URL olmayan içerik ve ağ hatası işi düşürmez', async () => {
    const p = await createPairing('https://r');
    mockRelay([await seal(p.keyB64, 'sadece metin')]);
    const s1: BeamState = { pairing: p, seen: [] };
    expect(await pollOnce(s1)).toEqual([]);

    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ağ yok'); }));
    expect(await pollOnce({ pairing: p, seen: [] })).toEqual([]);
  });

  it('eşleştirme yoksa ağa hiç çıkmaz', async () => {
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);
    expect(await pollOnce({ seen: [] })).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });
});
