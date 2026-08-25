/**
 * Kalıcı indirme geçmişi (denetim bulgusu C5).
 * Panel "tamamlananlar" listesi yalnızca offscreen belleğindeydi — tarayıcı
 * kapanınca kayboluyordu. Chrome'un indirme balonunu gizlemeyi önerirken
 * kendi geçmişimizi tutmamak kabul edilemez.
 *
 * Gizli indirmeler BURAYA YAZILMAZ (izsizlik sözü).
 */
export interface HistoryEntry {
  id: number;          // chrome.downloads kimliği (Aç / Göster için)
  name: string;
  size: number;
  at: number;          // tamamlanma zamanı
  origin?: string;     // servis adı ya da host
  sender?: string;     // maildeki gönderen (yerel)
}

export const HISTORY_LIMIT = 100;

export function addEntry(list: HistoryEntry[], entry: HistoryEntry): HistoryEntry[] {
  // Aynı indirme iki kez yazılmasın (SW yeniden başlarsa olay tekrarlanabilir)
  const deduped = list.filter((e) => e.id !== entry.id);
  return [entry, ...deduped].slice(0, HISTORY_LIMIT);
}

/**
 * Geçmiş sıralaması.
 *
 * NEDEN: `addEntry` yeni kaydı başa koyar, yani dizi normalde zaten
 * yeniden→eskiye sıralıdır. Ama "normalde" yetmez: eski sürümlerden kalan
 * diziler, yardımcı üzerinden gelen gecikmeli kayıtlar ve aynı işin yeniden
 * teslimi sırayı bozabiliyor. Panel artık diziye GÜVENMİYOR — her render'da
 * açıkça sıralıyor. Sıra kullanıcının seçimidir, tesadüf değil.
 */
export type SortMode =
  | 'date-desc' | 'date-asc'
  | 'name-asc' | 'name-desc'
  | 'size-desc' | 'size-asc';

export const SORT_MODES: readonly SortMode[] = [
  'date-desc', 'date-asc', 'name-asc', 'name-desc', 'size-desc', 'size-asc',
];

export const DEFAULT_SORT: SortMode = 'date-desc';

export function isSortMode(v: unknown): v is SortMode {
  return typeof v === 'string' && (SORT_MODES as readonly string[]).includes(v);
}

/**
 * Ada göre sıralamada `localeCompare` ZORUNLU: "Çankaya" < "Dolmabahçe" ancak
 * Türkçe harmanlamayla doğrudur, ham kod noktası karşılaştırması Ç'yi Z'den
 * sonraya atar. `numeric` ise "keysil (2)" < "keysil (10)" sırasını verir —
 * kullanıcı dosyalarını böyle numaralandırır.
 */
const byName = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** Saf ve kararlı: eşit anahtarlarda giriş sırası korunur (Array.sort stabil). */
export function sortEntries(list: readonly HistoryEntry[], mode: SortMode): HistoryEntry[] {
  const out = [...list];
  switch (mode) {
    case 'date-asc': return out.sort((a, b) => a.at - b.at);
    case 'name-asc': return out.sort((a, b) => byName.compare(a.name, b.name));
    case 'name-desc': return out.sort((a, b) => byName.compare(b.name, a.name));
    case 'size-desc': return out.sort((a, b) => b.size - a.size);
    case 'size-asc': return out.sort((a, b) => a.size - b.size);
    case 'date-desc':
    default: return out.sort((a, b) => b.at - a.at);
  }
}
