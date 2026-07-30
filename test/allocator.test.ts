import { describe, expect, it } from 'vitest';
import { RangeAllocator } from '../src/engine/allocator';

const MB = 1 << 20;

describe('RangeAllocator.allocate', () => {
  it('ilk claim 0\'dan başlar ve maxSeg ile sınırlanır', () => {
    const a = new RangeAllocator(100 * MB);
    const c = a.allocate(25 * MB)!;
    expect(c.start).toBe(0);
    expect(c.end).toBe(25 * MB);
  });

  it('ardışık claim\'ler bitişik boşluklardan verilir', () => {
    const a = new RangeAllocator(100 * MB);
    a.allocate(25 * MB);
    const c2 = a.allocate(25 * MB)!;
    expect(c2.start).toBe(25 * MB);
    expect(c2.end).toBe(50 * MB);
  });

  it('boşluk maxSeg\'den küçükse tamamını verir', () => {
    const a = new RangeAllocator(10 * MB);
    a.allocate(8 * MB);
    const c = a.allocate(8 * MB)!;
    expect(c.start).toBe(8 * MB);
    expect(c.end).toBe(10 * MB);
  });

  it('yer kalmayınca null döner', () => {
    const a = new RangeAllocator(10 * MB);
    a.allocate(10 * MB);
    expect(a.allocate(MB)).toBeNull();
  });

  it('settle ile iade edilen boşluk yeniden tahsis edilir (TDM fix pattern)', () => {
    const a = new RangeAllocator(30 * MB);
    const c1 = a.allocate(10 * MB)!;
    a.allocate(10 * MB);
    c1.written = 4 * MB; // bağlantı 4 MB indirdi ve öldü
    a.settle(c1);
    const c3 = a.allocate(10 * MB)!;
    expect(c3.start).toBe(4 * MB); // delik tam kaldığı yerden başlar
    expect(c3.end).toBe(10 * MB);
  });

  it('hiç veri gelmeden ölen claim tamamen iade edilir', () => {
    const a = new RangeAllocator(30 * MB);
    const c1 = a.allocate(10 * MB)!;
    a.settle(c1);
    expect(a.claims.length).toBe(0);
    const c2 = a.allocate(10 * MB)!;
    expect(c2.start).toBe(0);
  });
});

describe('RangeAllocator.steal (work-stealing)', () => {
  it('boşluk yokken en büyük in-flight kalanı ortadan böler', () => {
    const a = new RangeAllocator(100 * MB, MB);
    const c1 = a.allocate(100 * MB)!; // tek bağlantı her şeyi almış
    c1.written = 20 * MB;
    const stolen = a.steal()!;
    // kalan 80 MB → ortası: 20 + 40 = 60 MB
    expect(c1.end).toBe(60 * MB);
    expect(stolen.start).toBe(60 * MB);
    expect(stolen.end).toBe(100 * MB);
  });

  it('en büyük kalana sahip claim kurban seçilir', () => {
    const a = new RangeAllocator(100 * MB, MB);
    const c1 = a.allocate(30 * MB)!;
    const c2 = a.allocate(70 * MB)!;
    c1.written = 5 * MB;  // kalan 25
    c2.written = 10 * MB; // kalan 60 → kurban
    const stolen = a.steal()!;
    expect(stolen.start).toBe(30 * MB + 10 * MB + 30 * MB); // done(40) + 60/2
    expect(c2.end).toBe(stolen.start);
  });

  it('kalan 2×minSplit altındaysa çalmaz (aşırı parçalanma koruması)', () => {
    const a = new RangeAllocator(4 * MB, MB);
    const c = a.allocate(4 * MB)!;
    c.written = 3 * MB; // kalan 1 MB < 2 MB
    expect(a.steal()).toBeNull();
  });

  it('sıralama değişmezi korunur', () => {
    const a = new RangeAllocator(100 * MB, MB);
    const c1 = a.allocate(50 * MB)!;
    a.allocate(50 * MB);
    c1.written = 10 * MB;
    a.steal();
    const starts = a.claims.map((c) => c.start);
    expect([...starts].sort((x, y) => x - y)).toEqual(starts);
  });
});

describe('RangeAllocator tamamlanma takibi', () => {
  it('bitişik yazımlar tek aralığa birleşir', () => {
    const a = new RangeAllocator(20 * MB);
    const c1 = a.allocate(10 * MB)!;
    const c2 = a.allocate(10 * MB)!;
    c1.written = 10 * MB;
    c2.written = 10 * MB;
    expect(a.completed()).toEqual([[0, 20 * MB]]);
    expect(a.isComplete()).toBe(true);
  });

  it('delikli durumda complete değildir', () => {
    const a = new RangeAllocator(20 * MB);
    const c1 = a.allocate(10 * MB)!;
    const c2 = a.allocate(10 * MB)!;
    c1.written = 10 * MB;
    c2.written = 5 * MB;
    expect(a.isComplete()).toBe(false);
    expect(a.downloadedBytes()).toBe(15 * MB);
  });

  it('restore edilen aralıklardan kaldığı yerden devam eder', () => {
    const a = RangeAllocator.restore(30 * MB, [[0, 10 * MB], [20 * MB, 30 * MB]]);
    expect(a.downloadedBytes()).toBe(20 * MB);
    const c = a.allocate(100 * MB)!;
    expect(c.start).toBe(10 * MB); // tek delik
    expect(c.end).toBe(20 * MB);
    c.written = 10 * MB;
    expect(a.isComplete()).toBe(true);
  });
});
