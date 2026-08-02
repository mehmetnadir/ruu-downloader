/**
 * Paylaşım linki tanıma — servis kataloğu src/content/services.ts'te
 * (popülerliğe göre sıralı). Bu dosya eşleme + buton etiketi normalleştirme.
 */
import { findService, type ServiceKind } from './services';
export interface ShareMatch {
  kind: ServiceKind;
  service: string;   // servis id (log/telemetri değil, yalnız teşhis)
  name: string;      // kullanıcıya gösterilecek ad
  url: string;
  reason?: 'e2ee' | 'login';
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
  // E2E kancası: yerel test sunucusunun sahte paylaşım sayfası (prod'da etkisiz —
  // yalnızca kullanıcının kendi localhost'u eşleşebilir)
  if ((u.hostname === 'localhost' || u.hostname === '127.0.0.1') && u.pathname.startsWith('/share/')) {
    return { kind: 'autoflow', service: 'test', name: 'Test', url: raw };
  }
  if (u.protocol !== 'https:') return null;
  const svc = findService(u);
  if (!svc) return null;
  return {
    kind: svc.kind,
    service: svc.id,
    name: svc.name,
    url: svc.transform ? svc.transform(u) : raw,
    reason: svc.reason,
  };
}
