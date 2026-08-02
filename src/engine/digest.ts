/**
 * Sunucu tarafı bütünlük doğrulaması (denetim bulgusu C2).
 *
 * HTTP'de hash zorunlu değil, ama bazı sunucular verir:
 *   RFC 9530:  Repr-Digest: sha-256=:BASE64:
 *   Eski:      Digest: sha-256=BASE64
 * Verilmişse indirme sonunda dosyayı hash'leyip karşılaştırırız — bozuk proxy
 * ya da yanlış birleştirme sessizce geçemez. Verilmemişse hash HESAPLANMAZ
 * (karşılaştıracak referans yokken tam dosya okumak boşa I/O'dur).
 */
export interface ExpectedDigest {
  algo: 'SHA-256';
  b64: string;
}

/** Header değerinden sha-256 özeti çıkarır; yoksa/desteklenmiyorsa null. */
export function parseDigestHeader(headers: Headers): ExpectedDigest | null {
  const raw = headers.get('repr-digest') ?? headers.get('digest');
  if (!raw) return null;
  // "sha-256=:BASE64:" (RFC 9530 sözlük biçimi) ya da "sha-256=BASE64"
  const m = raw.match(/sha-256\s*=\s*:?([A-Za-z0-9+/=]+):?/i);
  if (!m?.[1]) return null;
  return { algo: 'SHA-256', b64: m[1] };
}

export function bytesToBase64(buf: ArrayBuffer): string {
  const b = new Uint8Array(buf);
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s);
}

/**
 * Beklenen özetle karşılaştırır. Karşılaştırma sabit zamanlı olmak zorunda
 * değil (gizli değer değil), ama biçim farklarına dayanıklı olmalı.
 */
export function digestMatches(expected: ExpectedDigest, actualB64: string): boolean {
  const norm = (s: string): string => s.replace(/=+$/, '').replace(/-/g, '+').replace(/_/g, '/');
  return norm(expected.b64) === norm(actualB64);
}
