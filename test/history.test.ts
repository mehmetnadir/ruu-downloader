import { describe, expect, it } from 'vitest';
import { addEntry, HISTORY_LIMIT, type HistoryEntry } from '../src/engine/history';

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
