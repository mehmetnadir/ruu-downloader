/**
 * İş manifesti (crash-resume sidecar'ı) — OPFS'te jobs/<id>.meta olarak yaşar.
 * ranges YALNIZCA disk worker'ın ack'lediği yazımlardan türetilir: renderer
 * çökse bile OS page cache'e inmiş byte'lardır. (Elektrik kesintisi riski
 * flush periyoduyla sınırlanır — bilinçli takas, PRD F3.)
 */
export interface JobMeta {
  v: 1;
  url: string;
  filename: string;
  size: number;
  connections: number;
  etag?: string;
  lastModified?: string;
  ranges: Array<[number, number]>; // ack'lenmiş, birleştirilmiş [start, end)
  updatedAt: number;
}

/**
 * Savunma katmanı: meta'daki aralıkları diskteki GERÇEK dosya boyutuyla
 * uzlaştırır. Meta yazımı ile veri yazımı asla atomik değildir (CheezyPizza'nın
 * opfsWriter'ında da aynı sınıf koruma var) — meta ileride kalırsa indirilmemiş
 * bölge "indi" sayılır ve dosya sessizce bozulur. Kural: kayıtlı ilerleme
 * gerçek dosya boyunu ASLA aşamaz.
 */
export function reconcileRanges(
  ranges: Array<[number, number]>,
  fileSize: number,
): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const [s, e] of ranges) {
    if (s >= fileSize) continue;          // tamamen dosyanın dışında
    out.push([s, Math.min(e, fileSize)]); // taşan kuyruk kırpılır
  }
  return out;
}

export function parseMeta(json: string): JobMeta | null {
  try {
    const m = JSON.parse(json) as JobMeta;
    if (m.v !== 1) return null;
    if (typeof m.url !== 'string' || typeof m.filename !== 'string') return null;
    if (!Number.isFinite(m.size) || m.size <= 0) return null;
    if (!Array.isArray(m.ranges)) return null;
    for (const r of m.ranges) {
      if (!Array.isArray(r) || r.length !== 2) return null;
      if (!Number.isFinite(r[0]) || !Number.isFinite(r[1])) return null;
      if (r[0] < 0 || r[1] > m.size || r[0] >= r[1]) return null;
    }
    return m;
  } catch {
    return null;
  }
}

/**
 * Sıralı-birleşik aralık listesine [start, end) ekler (yerinde, O(n)).
 * Ack'ler keyfi sırada gelebilir (paralel bağlantılar) — komşularla birleştirir.
 */
export function mergeRange(list: Array<[number, number]>, start: number, end: number): void {
  if (end <= start) return;
  let i = 0;
  while (i < list.length && list[i]![1] < start) i++;
  let s = start;
  let e = end;
  let removed = 0;
  let j = i;
  while (j < list.length && list[j]![0] <= e) {
    s = Math.min(s, list[j]![0]);
    e = Math.max(e, list[j]![1]);
    removed++;
    j++;
  }
  list.splice(i, removed, [s, e]);
}
