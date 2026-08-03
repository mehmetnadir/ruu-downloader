import { describe, expect, it } from 'vitest';
import { isRunning, nextToStart, shouldStartImmediately, type QueueItem } from '../src/engine/queue';
import type { JobState } from '../src/engine/types';

const item = (id: string, state: JobState, seq: number): QueueItem => ({ id, state, seq });

describe('kuyruk politikası', () => {
  it('sınır doluysa yeni iş kuyruğa girer', () => {
    const items = [item('a', 'downloading', 1), item('b', 'downloading', 2)];
    expect(shouldStartImmediately(items, 2, false)).toBe(false);
    expect(shouldStartImmediately(items, 3, false)).toBe(true);
  });

  it('kullanıcı elle başlattıysa sınır uygulanmaz — açık niyet kazanır', () => {
    const items = [item('a', 'downloading', 1), item('b', 'downloading', 2)];
    expect(shouldStartImmediately(items, 2, true)).toBe(true);
  });

  it('slot boşalınca kuyruktan FIFO sırayla alınır', () => {
    const items = [
      item('a', 'done', 1),
      item('c', 'queued', 3),
      item('b', 'queued', 2),
      item('d', 'queued', 4),
    ];
    expect(nextToStart(items, 2)).toEqual(['b', 'c']);
  });

  it('finalizing hâlâ slot tutar — teslim bitmeden yenisi başlamaz', () => {
    const items = [item('a', 'finalizing', 1), item('b', 'queued', 2)];
    expect(nextToStart(items, 1)).toEqual([]);
  });

  it('probing de slot tutar (henüz indirmiyor ama iş başlamış)', () => {
    expect(isRunning('probing')).toBe(true);
    expect(isRunning('queued')).toBe(false);
    expect(isRunning('paused')).toBe(false);
  });

  it('duraklatılmış iş slot TUTMAZ — kullanıcı yerini sıradakine bırakmış olur', () => {
    const items = [item('a', 'paused', 1), item('b', 'queued', 2)];
    expect(nextToStart(items, 1)).toEqual(['b']);
  });

  it('sınır 0 = sınırsız: hepsi başlar', () => {
    const items = [item('a', 'queued', 1), item('b', 'queued', 2), item('c', 'downloading', 3)];
    expect(nextToStart(items, 0)).toEqual(['a', 'b']);
    expect(shouldStartImmediately(items, 0, false)).toBe(true);
  });

  it('boşalan slot sayısından fazlasını başlatmaz', () => {
    const items = [
      item('a', 'downloading', 1),
      item('b', 'queued', 2), item('c', 'queued', 3), item('d', 'queued', 4),
    ];
    expect(nextToStart(items, 3)).toEqual(['b', 'c']);
  });
});
