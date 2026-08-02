import { describe, expect, it } from 'vitest';
import { digestMatches, parseDigestHeader } from '../src/engine/digest';

const H = (o: Record<string, string>) => new Headers(o);

describe('parseDigestHeader', () => {
  it('RFC 9530 sözlük biçimini okur', () => {
    expect(parseDigestHeader(H({ 'repr-digest': 'sha-256=:4REjxQ4yrqUVicfSKYNO/cF9zNj5ANbzgDZt3/h3Qxo=:' })))
      .toEqual({ algo: 'SHA-256', b64: '4REjxQ4yrqUVicfSKYNO/cF9zNj5ANbzgDZt3/h3Qxo=' });
  });

  it('eski Digest başlığını okur', () => {
    const d = parseDigestHeader(H({ digest: 'sha-256=X48E9qOokqqrvdts8nOJRJN3OWDUoyWxBf7kbu9DBPE=' }));
    expect(d).toEqual({ algo: 'SHA-256', b64: 'X48E9qOokqqrvdts8nOJRJN3OWDUoyWxBf7kbu9DBPE=' });
  });

  it('başlık yoksa ya da algoritma desteklenmiyorsa null', () => {
    expect(parseDigestHeader(H({}))).toBeNull();
    expect(parseDigestHeader(H({ digest: 'md5=abc' }))).toBeNull();
    expect(parseDigestHeader(H({ 'repr-digest': 'unixsum=30637' }))).toBeNull();
  });
});

describe('digestMatches', () => {
  const exp = { algo: 'SHA-256' as const, b64: 'X48E9qOokqqrvdts8nOJRJN3OWDUoyWxBf7kbu9DBPE=' };

  it('aynı özet eşleşir (padding ve base64url farkına rağmen)', () => {
    expect(digestMatches(exp, 'X48E9qOokqqrvdts8nOJRJN3OWDUoyWxBf7kbu9DBPE=')).toBe(true);
    expect(digestMatches(exp, 'X48E9qOokqqrvdts8nOJRJN3OWDUoyWxBf7kbu9DBPE')).toBe(true);
    expect(digestMatches({ ...exp, b64: 'X48E9qOokqqrvdts8nOJRJN3OWDUoyWxBf7kbu9DBPE' },
      'X48E9qOokqqrvdts8nOJRJN3OWDUoyWxBf7kbu9DBPE=')).toBe(true);
  });

  it('farklı özet eşleşmez', () => {
    expect(digestMatches(exp, 'AAAA9qOokqqrvdts8nOJRJN3OWDUoyWxBf7kbu9DBPE=')).toBe(false);
  });
});
