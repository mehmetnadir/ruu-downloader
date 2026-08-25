/**
 * WeTransfer çözücü — saf çekirdek (PRD "Tier 2: provider modülü").
 *
 * NEDEN VAR: WeTransfer indirmeyi `POST /api/v4/transfers/<id>/download` ile
 * DOĞURUR. Chrome'un `DownloadItem`'ı adresi taşır ama YÖNTEMİ taşımaz; aynı
 * adrese GET atınca 404 gelir (2026-08-24 canlı kanıt). Bu yüzden v0.6.4'te
 * ön-uçuş eklendi ve WeTransfer'de kenara çekiliyoruz: dosya iniyor ama
 * TARAYICI ile, tek bağlantıda, hızlandırmasız.
 *
 * Bu modül o POST'u BİZ atalım diye var. API'nin döndürdüğü `direct_link`
 * Range destekliyor (206×3 canlı doğrulandı) — yani segmentlenebilir.
 *
 * SAF: burada ağ yok, `chrome.*` yok. Tüm I/O `sw.ts`'te. Böylece ayrıştırma
 * ve doğrulama kuralları canlı link olmadan unit testlenebilir.
 *
 * Sözleşme kaynağı: iamleot/transferwee (GPL değil, referans olarak okundu) —
 * `intent: entire_transfer`, `security_hash`, opsiyonel `recipient_id`,
 * `x-csrf-token` sayfa HTML'indeki `<meta name="csrf-token">`'dan.
 */

export interface WtTransfer {
  /** API çağrısının atılacağı köken — `https://wetransfer.com` (E2E'de localhost). */
  origin: string;
  transferId: string;
  securityHash: string;
  /** Kişiye özel transferlerde bulunur; yoksa gövdeye hiç konmaz. */
  recipientId?: string;
}

/**
 * Kimlik parçaları API adresine ENTERPOLE EDİLİYOR. Serbest bırakırsak
 * `../` ya da sorgu eki içeren bir yol bizi başka bir uca yönlendirebilir.
 * Bu yüzden alfanumerik + `-_` dışına çıkan hiçbir şey kabul edilmez.
 */
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

function isLocalHook(u: URL): boolean {
  // E2E kancası — `src/content/patterns.ts`'teki `/share/` kancasıyla aynı
  // gerekçe: prod'da etkisiz, yalnızca kullanıcının KENDİ localhost'u eşleşir.
  return u.hostname === 'localhost' || u.hostname === '127.0.0.1';
}

/**
 * İndirme sayfası adresinden transfer kimliğini çıkarır.
 *
 * Biçimler (transferwee ile aynı):
 *   /downloads/<transferId>/<securityHash>
 *   /downloads/<transferId>/<recipientId>/<securityHash>
 *
 * `we.tl/t-xxxx` KISA linki buraya GELMEZ — önce yönlendirme izlenip nihai
 * adres alınmalıdır (kısa linkte hash yoktur). Çağıran taraf `response.url`
 * verir.
 */
export function parseWetransfer(rawUrl: string): WtTransfer | null {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return null;
  }
  const local = isLocalHook(u);
  if (!local) {
    if (u.protocol !== 'https:') return null;
    if (u.hostname !== 'wetransfer.com' && u.hostname !== 'www.wetransfer.com') return null;
  }
  // E2E fixture'ı `/wt/...` altında durur; gerçek servis `/downloads/...`.
  const segs = u.pathname.split('/').filter(Boolean);
  const head = segs.shift();
  if (head !== (local ? 'wt' : 'downloads')) return null;
  if (segs.length < 2 || segs.length > 3) return null;
  if (!segs.every((s) => ID_RE.test(s))) return null;

  const transferId = segs[0]!;
  return segs.length === 2
    ? { origin: u.origin, transferId, securityHash: segs[1]! }
    : { origin: u.origin, transferId, recipientId: segs[1]!, securityHash: segs[2]! };
}

/** `POST` edilecek adres. Köken `parseWetransfer`'den gelir — sabit yazılmaz. */
export function apiUrl(t: WtTransfer): string {
  return `${t.origin}/api/v4/transfers/${t.transferId}/download`;
}

/**
 * İstek gövdesi. `intent: 'entire_transfer'` = transferin TAMAMI tek dosyada
 * (çok dosyalıysa sunucu zip üretir). Tek dosya seçimi (`single_file`)
 * bilinçli olarak KAPSAM DIŞI: kullanıcı maildeki linke tıkladı, seçim yapmadı.
 */
export function apiBody(t: WtTransfer): string {
  const body: Record<string, string> = {
    intent: 'entire_transfer',
    security_hash: t.securityHash,
  };
  if (t.recipientId) body['recipient_id'] = t.recipientId;
  return JSON.stringify(body);
}

/**
 * Sayfa HTML'indeki CSRF jetonu. Öznitelik SIRASI garanti değil — iki yönlü
 * bakılır. Bulunamazsa `null`: jeton zorunlu olmayabilir, çağıran taraf
 * jetonsuz da dener (başarısızlıkta zaten eski akışa düşülür).
 */
export function readCsrfToken(html: string): string | null {
  const m = /name="csrf-token"\s+content="([^"]+)"/.exec(html)
    ?? /content="([^"]+)"\s+name="csrf-token"/.exec(html);
  return m?.[1] ?? null;
}

/**
 * API cevabından indirilebilir adresi çıkarır.
 *
 * GÜVENLİK SINIRI: cevabı WeTransfer'in KENDİ kökeni verdi; hangi CDN'e
 * yönlendirdiği onun bileceği iş (bugün Google Cloud Storage, yarın başkası) —
 * host beyaz listesi yazmak servis CDN değiştirince özelliği sessizce bozardı.
 * Bu yüzden host serbest, ama ŞEMA değil: yalnız `https` kabul edilir
 * (localhost E2E fixture'ı hariç). `javascript:`/`data:`/`blob:` bir cevap
 * gövdesinden gelip motora giremez.
 */
export function pickDirectLink(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const link = (raw as { direct_link?: unknown }).direct_link;
  if (typeof link !== 'string' || link.length === 0) return null;
  let u: URL;
  try {
    u = new URL(link);
  } catch {
    return null;
  }
  if (u.protocol === 'https:') return u.toString();
  if (u.protocol === 'http:' && isLocalHook(u)) return u.toString();
  return null;
}
