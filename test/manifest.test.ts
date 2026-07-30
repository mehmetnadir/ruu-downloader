import { describe, expect, it } from 'vitest';
import { mergeRange, parseMeta } from '../src/engine/manifest';

describe('mergeRange', () => {
  it('boş listeye ekler', () => {
    const l: Array<[number, number]> = [];
    mergeRange(l, 10, 20);
    expect(l).toEqual([[10, 20]]);
  });

  it('bitişik aralıkları birleştirir', () => {
    const l: Array<[number, number]> = [[0, 10]];
    mergeRange(l, 10, 20);
    expect(l).toEqual([[0, 20]]);
  });

  it('ayrık aralıklar sıralı durur', () => {
    const l: Array<[number, number]> = [[30, 40]];
    mergeRange(l, 0, 10);
    expect(l).toEqual([[0, 10], [30, 40]]);
  });

  it('birden fazla aralığı köprüler', () => {
    const l: Array<[number, number]> = [[0, 10], [20, 30], [40, 50]];
    mergeRange(l, 5, 45);
    expect(l).toEqual([[0, 50]]);
  });

  it('kapsanan ekleme değişiklik yaratmaz', () => {
    const l: Array<[number, number]> = [[0, 100]];
    mergeRange(l, 10, 20);
    expect(l).toEqual([[0, 100]]);
  });

  it('paralel ack sırası fark etmez', () => {
    const a: Array<[number, number]> = [];
    const b: Array<[number, number]> = [];
    const chunks: Array<[number, number]> = [[0, 5], [50, 60], [5, 50], [60, 100]];
    for (const [s, e] of chunks) mergeRange(a, s, e);
    for (const [s, e] of [...chunks].reverse()) mergeRange(b, s, e);
    expect(a).toEqual([[0, 100]]);
    expect(b).toEqual([[0, 100]]);
  });
});

describe('parseMeta', () => {
  const valid = {
    v: 1, url: 'http://x/f', filename: 'f.bin', size: 100,
    connections: 4, ranges: [[0, 50]], updatedAt: 1,
  };

  it('geçerli meta kabul edilir', () => {
    expect(parseMeta(JSON.stringify(valid))).not.toBeNull();
  });

  it('bozuk JSON / yanlış sürüm / taşan aralık reddedilir', () => {
    expect(parseMeta('{bozuk')).toBeNull();
    expect(parseMeta(JSON.stringify({ ...valid, v: 2 }))).toBeNull();
    expect(parseMeta(JSON.stringify({ ...valid, ranges: [[0, 200]] }))).toBeNull();
    expect(parseMeta(JSON.stringify({ ...valid, ranges: [[50, 10]] }))).toBeNull();
    expect(parseMeta(JSON.stringify({ ...valid, size: 0 }))).toBeNull();
  });
});
