/**
 * Kuyruk politikası — hangi iş şimdi başlar, hangisi bekler.
 *
 * Saf fonksiyon: motordan, chrome API'lerinden ve zamandan bağımsız.
 * Kuyruk için yerel bir yardımcı programa GEREK YOKTUR — eşzamanlılık sınırı
 * tamamen eklenti içinde uygulanır. Yerel program yalnızca "tarayıcı kapalıyken
 * de devam etsin" senaryosunu açar; sıraya alma bunun bir parçası değildir.
 */
import type { JobState } from './types';

export interface QueueItem {
  id: string;
  state: JobState;
  /** Kuyruğa giriş sırası — küçük olan önce başlar (FIFO). */
  seq: number;
  /** Kullanıcı bu işi elle başlattıysa sınırdan MUAF (açık niyet kazanır). */
  manual?: boolean;
}

/** Bir slot işgal eden durumlar. 'queued' beklerken slot tutmaz. */
const RUNNING: ReadonlySet<JobState> = new Set<JobState>([
  'probing', 'downloading', 'finalizing',
]);

export const isRunning = (s: JobState): boolean => RUNNING.has(s);

/**
 * Sınır dolduğunda serbest kalan slotlara hangi işlerin alınacağını döner.
 *
 * @param limit aynı anda çalışacak en fazla iş (0 = sınırsız)
 * @returns başlatılacak iş kimlikleri, kuyruk sırasına göre
 */
export function nextToStart(items: readonly QueueItem[], limit: number): string[] {
  if (limit <= 0) return items.filter((i) => i.state === 'queued').map((i) => i.id);
  // Elle başlatılanlar sınırın ÜSTÜNDE sayılır ama slot tüketirler:
  // kullanıcı açıkça "şimdi indir" dediyse onu bekletmek yanlış olur, ancak
  // arka planda sıraya alınmışları da onun üstüne yığmamak gerekir.
  const busy = items.filter((i) => isRunning(i.state)).length;
  const free = Math.max(0, limit - busy);
  if (free === 0) return [];
  return items
    .filter((i) => i.state === 'queued')
    .sort((a, b) => a.seq - b.seq)
    .slice(0, free)
    .map((i) => i.id);
}

/**
 * Yeni eklenen bir iş hemen başlamalı mı, kuyruğa mı girmeli?
 * Elle eklenen (kullanıcı panelde "indir" dedi) her zaman başlar.
 */
export function shouldStartImmediately(
  items: readonly QueueItem[],
  limit: number,
  manual: boolean,
): boolean {
  if (manual || limit <= 0) return true;
  return items.filter((i) => isRunning(i.state)).length < limit;
}
