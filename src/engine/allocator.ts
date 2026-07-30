/**
 * Byte-aralığı tahsisçisi. TDM'in first-fit hole modelinden türedi; üstüne
 * IDM-tarzı work-stealing (in-flight en büyük segmentin ortadan bölünmesi) eklendi.
 *
 * Değişmezler:
 *  - claims her zaman start'a göre sıralı ve çakışmasız
 *  - [start, start+written) diske yazılmış kesin bölgedir; start sabittir
 *  - end steal/settle ile küçülebilir, asla büyümez
 */
export interface Claim {
  start: number;
  end: number; // exclusive
  written: number;
  active: boolean;
}

export class RangeAllocator {
  readonly claims: Claim[] = [];

  constructor(
    readonly size: number,
    readonly minSplit = 1 << 20,
  ) {}

  /** İlk boşluğu bul, en fazla maxSeg byte'lık dilim rezerve et. Boşluk yoksa null. */
  allocate(maxSeg: number): Claim | null {
    let cursor = 0;
    for (let i = 0; i <= this.claims.length; i++) {
      const next = i < this.claims.length ? this.claims[i]! : null;
      const holeEnd = next ? next.start : this.size;
      if (holeEnd > cursor) {
        const claim: Claim = {
          start: cursor,
          end: Math.min(holeEnd, cursor + maxSeg),
          written: 0,
          active: true,
        };
        this.claims.splice(i, 0, claim);
        return claim;
      }
      if (next) cursor = Math.max(cursor, next.end);
    }
    return null;
  }

  /**
   * Bağlantı kapandı (başarı, hata ya da iptal): claim fiilen gelen boyuta
   * küçültülür; hiç veri gelmediyse rezervasyon tamamen iade edilir (TDM fix()).
   */
  settle(claim: Claim): void {
    claim.active = false;
    if (claim.written === 0) {
      const i = this.claims.indexOf(claim);
      if (i >= 0) this.claims.splice(i, 1);
    } else {
      claim.end = claim.start + claim.written;
    }
  }

  /**
   * Boşluk kalmadıysa: kalan payı en büyük aktif claim'i ortadan böl (work-stealing).
   * Kurbanın end'i mid'e çekilir; pompa döngüsü bunu görüp mid'de durur.
   */
  steal(): Claim | null {
    let victim: Claim | null = null;
    let best = 0;
    for (const c of this.claims) {
      if (!c.active) continue;
      const remaining = c.end - c.start - c.written;
      if (remaining > best) {
        best = remaining;
        victim = c;
      }
    }
    if (!victim || best < this.minSplit * 2) return null;
    const doneUpTo = victim.start + victim.written;
    const mid = doneUpTo + Math.floor(best / 2);
    const claim: Claim = { start: mid, end: victim.end, written: 0, active: true };
    victim.end = mid;
    // claims start-sıralı ve mid < eski victim.end <= sonraki.start
    // olduğundan doğru konum victim'ın hemen arkasıdır.
    this.claims.splice(this.claims.indexOf(victim) + 1, 0, claim);
    return claim;
  }

  /** Diske inmiş bitişik aralıklar (birleştirilmiş). */
  completed(): Array<[number, number]> {
    const runs: Array<[number, number]> = [];
    for (const c of this.claims) {
      if (c.written <= 0) continue;
      const s = c.start;
      const e = c.start + c.written;
      const last = runs[runs.length - 1];
      if (last && s <= last[1]) last[1] = Math.max(last[1], e);
      else runs.push([s, e]);
    }
    return runs;
  }

  downloadedBytes(): number {
    return this.completed().reduce((acc, [s, e]) => acc + (e - s), 0);
  }

  isComplete(): boolean {
    const r = this.completed();
    return r.length === 1 && r[0]![0] === 0 && r[0]![1] === this.size;
  }

  /** Kalıcı aralık listesinden geri yükleme (resume). */
  static restore(size: number, ranges: Array<[number, number]>, minSplit?: number): RangeAllocator {
    const a = new RangeAllocator(size, minSplit);
    for (const [s, e] of ranges) {
      a.claims.push({ start: s, end: e, written: e - s, active: false });
    }
    a.claims.sort((x, y) => x.start - y.start);
    return a;
  }
}
