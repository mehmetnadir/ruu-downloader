import { describe, expect, it, vi } from 'vitest';
import {
  HelperClient, isValidHandshake, shouldUseHelper, toEngineRanges,
  type HelperHandshake,
} from '../src/engine/helper';

const hs: HelperHandshake = {
  port: 51234, token: 'a'.repeat(64), version: '1.0.0', dir: '/Users/x/Downloads',
};

describe('el sıkışma doğrulaması', () => {
  it('geçerli el sıkışmayı kabul eder', () => {
    expect(isValidHandshake(hs)).toBe(true);
  });

  it('kısa token REDDEDİLİR — zayıf sır kabul etmeyiz', () => {
    expect(isValidHandshake({ ...hs, token: 'kısa' })).toBe(false);
  });

  it('bozuk/eksik alanları reddeder', () => {
    expect(isValidHandshake(null)).toBe(false);
    expect(isValidHandshake({})).toBe(false);
    expect(isValidHandshake({ ...hs, port: 0 })).toBe(false);
    expect(isValidHandshake({ ...hs, port: 99999 })).toBe(false);
  });
});

describe('HelperClient', () => {
  it('varsayılan fetch BAĞLI olmalı — çıplak referans "Illegal invocation" atar', async () => {
    // Gerçek tarayıcı hatasını taklit et: this===undefined/window değilse patlar
    const globalAny = globalThis as unknown as { fetch: unknown };
    const original = globalAny.fetch;
    globalAny.fetch = function boundOnly(this: unknown) {
      if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation');
      return Promise.resolve(new Response('{"version":"1.0.0"}', { status: 200 }));
    };
    try {
      await expect(new HelperClient(hs).health()).resolves.toMatchObject({ version: '1.0.0' });
    } finally {
      globalAny.fetch = original;
    }
  });

  it('her isteğe Bearer token ekler ve 127.0.0.1 kullanır', async () => {
    const doFetch = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(JSON.stringify({ version: '1.0.0' }), { status: 200 }),
    );
    await new HelperClient(hs, doFetch).health();
    expect(doFetch).toHaveBeenCalledWith(
      'http://127.0.0.1:51234/health',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: `Bearer ${hs.token}` }),
      }),
    );
  });

  it('iş kimliğini URL\'e kaçırır (path enjeksiyonu olmasın)', async () => {
    const doFetch = vi.fn(async (_url: string, _init?: RequestInit) => new Response('{}', { status: 200 }));
    await new HelperClient(hs, doFetch).status('../../health');
    expect(doFetch).toHaveBeenCalledWith(
      'http://127.0.0.1:51234/jobs/..%2F..%2Fhealth',
      expect.anything(),
    );
  });

  it('hata durumunu yutmaz', async () => {
    const doFetch = vi.fn(async () => new Response('yetkisiz', { status: 401 }));
    await expect(new HelperClient(hs, doFetch).health()).rejects.toThrow('401');
  });
});

describe('aralık biçimi köprüsü', () => {
  it('yardımcı aralıklarını motorun biçimine çevirir', () => {
    expect(toEngineRanges([{ s: 0, e: 10 }, { s: 20, e: 30 }])).toEqual([[0, 10], [20, 30]]);
  });
});

describe('yardımcı ne zaman kullanılmalı', () => {
  const base = {
    available: true, wantConnections: 6, browserCap: 6,
    continueAfterClose: false, sizeBytes: 500 * 1024 * 1024,
  };

  it('yardımcı yoksa asla', () => {
    expect(shouldUseHelper({ ...base, available: false, continueAfterClose: true })).toBe(false);
  });

  it('tarayıcı tavanı yetiyorsa kullanmaz — fazladan bileşen bedava değil', () => {
    expect(shouldUseHelper(base)).toBe(false);
  });

  it('tavanın üstünde bağlantı isteniyorsa kullanır', () => {
    expect(shouldUseHelper({ ...base, wantConnections: 16 })).toBe(true);
  });

  it('tarayıcı kapandıktan sonra sürmesi isteniyorsa boyuta bakmadan kullanır', () => {
    expect(shouldUseHelper({ ...base, continueAfterClose: true, sizeBytes: 1024 })).toBe(true);
  });

  it('küçük dosyada kullanmaz — kurulum maliyeti kazancı yer', () => {
    expect(shouldUseHelper({ ...base, wantConnections: 16, sizeBytes: 2 * 1024 * 1024 })).toBe(false);
  });
});
