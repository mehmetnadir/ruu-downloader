/**
 * Beam uçtan uca şifreleme — telefon ile PC arasındaki zarflar AES-GCM ile
 * korunur. Röle (Cloudflare Worker) anahtarı ASLA görmez: eşleştirme QR'ı
 * pairId + anahtarı taşır, ikisi de yalnızca iki cihazda bulunur.
 *
 * Zarf: { id, iv(base64url), data(base64url) }
 */
export interface Envelope {
  id: string;
  iv: string;
  data: string;
}

export interface Pairing {
  relay: string;
  pairId: string;
  keyB64: string;
}

const b64u = {
  enc(buf: ArrayBuffer | Uint8Array): string {
    const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  dec(str: string): Uint8Array {
    const s = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  },
};

export function randomId(bytes = 16): string {
  return b64u.enc(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function createPairing(relay: string): Promise<Pairing> {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  return { relay, pairId: randomId(16), keyB64: b64u.enc(raw) };
}

async function importKey(keyB64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', b64u.dec(keyB64) as BufferSource, 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ]);
}

export async function seal(keyB64: string, plain: string): Promise<Envelope> {
  const key = await importKey(keyB64);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plain),
  );
  return { id: randomId(12), iv: b64u.enc(iv), data: b64u.enc(data) };
}

/** Çözülemeyen zarf null döner — yanlış anahtar/bozuk veri işi düşürmemeli. */
export async function open(keyB64: string, env: Envelope): Promise<string | null> {
  try {
    const key = await importKey(keyB64);
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: b64u.dec(env.iv) as BufferSource },
      key,
      b64u.dec(env.data) as BufferSource,
    );
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}

/**
 * QR içeriği. Telefonun kamera uygulaması bunu okuyunca doğrudan PWA'yı açsın
 * diye TAM URL kullanılır; eşleştirme yükü fragment'te (#) taşınır — fragment
 * sunucuya GÖNDERİLMEZ, yani anahtar röleye asla ulaşmaz.
 */
export function encodePairing(p: Pairing): string {
  const payload = btoa(JSON.stringify(p)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${p.relay}/app/#ruu:${payload}`;
}

export function decodePairing(s: string): Pairing | null {
  const at = s.indexOf('ruu:');
  if (at < 0) return null; // hem 'ruu:...' hem 'https://…/app/#ruu:...' kabul edilir
  try {
    const json = new TextDecoder().decode(b64u.dec(s.slice(at + 4)) as BufferSource);
    const p = JSON.parse(json) as Pairing;
    if (!p.relay || !p.pairId || !p.keyB64) return null;
    return p;
  } catch {
    return null;
  }
}
