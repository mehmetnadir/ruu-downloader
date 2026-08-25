import { describe, expect, it } from 'vitest';
import {
  addEntry, DEFAULT_SORT, HISTORY_LIMIT, isSortMode, sortEntries,
  type HistoryEntry, type SortMode,
} from '../src/engine/history';

const mk = (id: number): HistoryEntry => ({ id, name: `f${id}.bin`, size: 100, at: id });

describe('indirme geçmişi', () => {
  it('en yeni başa eklenir', () => {
    const l = addEntry(addEntry([], mk(1)), mk(2));
    expect(l.map((e) => e.id)).toEqual([2, 1]);
  });

  it('aynı indirme iki kez yazılmaz (SW yeniden başlaması)', () => {
    const l = addEntry(addEntry([], mk(7)), mk(7));
    expect(l).toHaveLength(1);
  });

  it('sınır aşılmaz — en eski düşer', () => {
    let l: HistoryEntry[] = [];
    for (let i = 0; i < HISTORY_LIMIT + 20; i++) l = addEntry(l, mk(i));
    expect(l).toHaveLength(HISTORY_LIMIT);
    expect(l[0]!.id).toBe(HISTORY_LIMIT + 19); // en yeni
  });
});

describe('geçmiş sıralaması', () => {
  const e = (name: string, size: number, at: number): HistoryEntry =>
    ({ id: at, name, size, at });

  // Karışık gelen dizi — panelin diziye güvenmemesinin sebebi tam olarak bu.
  const jumbled: HistoryEntry[] = [
    e('keysil (2).js', 7_000, 300),
    e('TYT Türkçe Soru Bankası.zip', 0, 500),
    e('keysil (10).js', 10_000, 100),
    e('Çankaya.pdf', 2_000, 400),
    e('ayak.pdf', 5_000, 200),
  ];

  it('varsayılan sıra en yeni → en eski', () => {
    expect(sortEntries(jumbled, DEFAULT_SORT).map((x) => x.at)).toEqual([500, 400, 300, 200, 100]);
  });

  it('date-asc ters çevirir', () => {
    expect(sortEntries(jumbled, 'date-asc').map((x) => x.at)).toEqual([100, 200, 300, 400, 500]);
  });

  it('boyut sıralaması 0 B kayıtlarını sona atar', () => {
    expect(sortEntries(jumbled, 'size-desc').map((x) => x.size))
      .toEqual([10_000, 7_000, 5_000, 2_000, 0]);
    expect(sortEntries(jumbled, 'size-asc')[0]!.size).toBe(0);
  });

  it('ad sıralaması Türkçe harmanlar — Ç, Z ile arasında değil sonrasında değil', () => {
    const names = sortEntries(jumbled, 'name-asc').map((x) => x.name);
    // 'ayak' < 'Çankaya' < 'keysil…' < 'TYT…' — ham kod noktasında Ç (U+00C7)
    // küçük harflerin ARDINDAN gelir ve 'ayak' ile 'keysil' arasına düşmezdi.
    expect(names.indexOf('ayak.pdf')).toBeLessThan(names.indexOf('Çankaya.pdf'));
    expect(names.indexOf('Çankaya.pdf')).toBeLessThan(names.indexOf('keysil (2).js'));
  });

  it('ad sıralaması sayıları insan gibi okur — (2) < (10)', () => {
    const names = sortEntries(jumbled, 'name-asc').map((x) => x.name);
    expect(names.indexOf('keysil (2).js')).toBeLessThan(names.indexOf('keysil (10).js'));
  });

  it('name-desc, name-asc\'in tersidir', () => {
    expect(sortEntries(jumbled, 'name-desc').map((x) => x.name))
      .toEqual(sortEntries(jumbled, 'name-asc').map((x) => x.name).reverse());
  });

  it('girdi dizisi DEĞİŞTİRİLMEZ (storage nesnesi paylaşılıyor)', () => {
    const before = jumbled.map((x) => x.at);
    sortEntries(jumbled, 'name-asc');
    expect(jumbled.map((x) => x.at)).toEqual(before);
  });

  it('bilinmeyen mod varsayılana düşer, patlamaz', () => {
    expect(isSortMode('date-desc')).toBe(true);
    expect(isSortMode('sihirli')).toBe(false);
    expect(isSortMode(undefined)).toBe(false);
    // eski storage'dan gelen çöp değer render'ı kırmamalı
    expect(sortEntries(jumbled, 'çöp' as SortMode).map((x) => x.at))
      .toEqual([500, 400, 300, 200, 100]);
  });
});
