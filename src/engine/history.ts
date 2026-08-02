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
