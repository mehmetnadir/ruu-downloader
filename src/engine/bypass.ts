/**
 * Değiştirici tuşla tarayıcıya devretme — "bu linki Ruu ALMASIN".
 *
 * Nadir'in isteği (2026-08-24): bağlantıya Cmd / Ctrl (ya da Alt) basılı
 * tıklarken indirme eklentiyle değil tarayıcının kendi aracıyla yapılmalı.
 *
 * NEDEN AYRI BİR İŞARET: `chrome.downloads.onCreated` klavye durumunu TAŞIMAZ.
 * Tuşu yalnız sayfa bağlamı görebilir; içerik betiği tıklamayı işaretler, SW
 * kısa bir pencere içinde o işareti indirmeyle eşler.
 *
 * Saf modül: zaman ve Chrome API'si dışarıdan verilir, test edilebilir.
 */
export interface BypassMark {
  /** Tıklanan bağlantının adresi (varsa) — eşleşmenin birincil dayanağı. */
  url: string;
  /** İşaretin konduğu an (epoch ms). */
  at: number;
}

/**
 * Pencere kısa TUTULUR. Yanlış pozitifin bedeli: kullanıcı Cmd+tık ile sekme
 * açarken alakasız bir indirme başlarsa o indirme tarayıcıya gider. 4 sn,
 * "tıkladım → indirme doğdu" gecikmesini karşılar ama gün boyu sekme açan
 * kullanıcının indirmelerini kaçırmaz.
 */
export const BYPASS_TTL_MS = 4000;

function originOf(raw: string): string | null {
  try { return new URL(raw).origin; } catch { return null; }
}

export interface BypassTarget {
  url: string;
  finalUrl?: string;
}

/**
 * İşaret bu indirmeye mi ait?
 *
 * İki kademe:
 *  1. Adres birebir aynı → kesin (Alt+tık ile doğrudan inen dosya).
 *  2. Adres farklı ama AYNI KÖKEN → kabul (sayfa JS ile imzalı bir adrese
 *     yönlendirdi; WeTransfer/Drive gibi akışlar böyle çalışır). Farklı
 *     kökenli bir indirme ASLA eşleşmez — alakasız indirme kaçırılmasın.
 */
export function shouldBypass(
  mark: BypassMark | undefined,
  item: BypassTarget,
  now: number,
  ttl: number = BYPASS_TTL_MS,
): boolean {
  if (!mark) return false;
  const age = now - mark.at;
  if (age < 0 || age > ttl) return false;
  const urls = [item.url, item.finalUrl].filter((u): u is string => Boolean(u));
  if (urls.includes(mark.url)) return true;
  const markOrigin = originOf(mark.url);
  if (!markOrigin) return false;
  return urls.some((u) => originOf(u) === markOrigin);
}

/**
 * Tıklama devretme sayılır mı?
 *
 * Sol tuş dışındaki düğmeler hariç: sağ tuş bağlam menüsü açar, orta tuş
 * yapıştırma/sekme davranışıdır — ikisi de "indir" niyeti değildir.
 */
export interface ClickSignal {
  button: number;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}

export function isBypassClick(e: ClickSignal): boolean {
  if (e.button !== 0) return false;
  return e.altKey || e.ctrlKey || e.metaKey;
}
