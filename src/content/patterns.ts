/**
 * Paylaşım servisi link tanıma (PRD-3 mail entegrasyonu) — saf modül.
 * kind:
 *  - 'direct'   → URL dönüşümüyle doğrudan motor (Tier 1)
 *  - 'autoflow' → paylaşım sayfası arka planda açılır, onay/indir tıklanır,
 *                 başlayan indirmeyi devralma yakalar (Tier 3)
 */
export interface ShareMatch {
  kind: 'direct' | 'autoflow';
  service: string;
  url: string;
}

/**
 * Buton metni normalleştirici — aksan/nokta işaretlerini soyar.
 * ZORUNLU: JS'te /indir/i, Türkçe "İndir"i EŞLEŞTİRMEZ (U+0130'un küçüğü
 * "i" + U+0307 birleşik noktasıdır). Aynı tuzak Almanca/Fransızca aksanlarda da var.
 * Bu yüzden kalıplar sadeleştirilmiş biçimde yazılır: "indir", "tumunu indir"…
 */
export function normalizeLabel(text: string): string {
  return text
    .replace(/ı/g, 'i') // NFKD noktasız ı'yı çözmez — elle eşle
    .replace(/İ/g, 'I')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/** Onay/indir butonu kalıpları (normalleştirilmiş metinle eşleşir). */
export const ACTION_PATTERN =
  /(tumunu indir|hepsini indir|yine de indir|indirmeyi baslat|indir|download all|download anyway|download all files|get your files|download|onayliyorum|onayla|kabul ediyorum|tumunu kabul et|kabul et|kabul|accept all|accept|i agree|agree|continue|devam et|devam)/;

export function isActionLabel(text: string): boolean {
  return ACTION_PATTERN.test(normalizeLabel(text));
}

export function matchShareLink(raw: string): ShareMatch | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  const h = u.hostname;
  // E2E kancası: yerel test sunucusunun sahte paylaşım sayfası (prod'da etkisiz —
  // yalnızca kullanıcının kendi localhost'u eşleşebilir)
  if ((h === 'localhost' || h === '127.0.0.1') && u.pathname.startsWith('/share/')) {
    return { kind: 'autoflow', service: 'test', url: raw };
  }
  if (u.protocol !== 'https:') return null;

  // Tier 1 — Dropbox: dl=1 hâlâ çalışıyor (araştırma 2026-07)
  if (h === 'www.dropbox.com' || h === 'dropbox.com') {
    if (/^\/(s|scl\/fi)\//.test(u.pathname)) {
      u.searchParams.set('dl', '1');
      return { kind: 'direct', service: 'dropbox', url: u.toString() };
    }
    return null;
  }

  // Tier 3 — onay akışlı paylaşım sayfaları
  if (h === 'lifeboxtransfer.com' && u.pathname.startsWith('/download/')) {
    return { kind: 'autoflow', service: 'lifebox', url: raw };
  }
  if (h === 'we.tl') return { kind: 'autoflow', service: 'wetransfer', url: raw };
  if (h === 'wetransfer.com' && /^\/downloads\//.test(u.pathname)) {
    return { kind: 'autoflow', service: 'wetransfer', url: raw };
  }
  if (h === 'drive.google.com' && /^\/(file\/d\/|open)/.test(u.pathname + u.search)) {
    return { kind: 'autoflow', service: 'gdrive', url: raw };
  }
  if (h === '1drv.ms' || h === 'onedrive.live.com') {
    return { kind: 'autoflow', service: 'onedrive', url: raw };
  }
  return null;
}
