import { describe, expect, it } from 'vitest';
import {
  NATIVE_NAME_TTL_MS, nativeDownloadAttempts, pickNativeName, pruneNativeNames,
  type NativeNameMark,
} from '../src/engine/native';

describe('native fallback indirme seçenekleri', () => {
  const URL = 'https://ornek.test/dosya?imza=abc';

  it('ad seçilmediyse Chrome karar verir — saveAs GEÇİLMEZ', () => {
    const [first, ...rest] = nativeDownloadAttempts(URL);
    expect(first).toEqual({ url: URL });
    // saveAs geçmek kullanıcının "her dosya için sor" ayarını ezerdi
    expect(first).not.toHaveProperty('saveAs');
    expect(rest).toHaveLength(0);
  });

  it('KÖK NEDEN: kullanıcının seçtiği ad ilk denemede geçer', () => {
    const [first] = nativeDownloadAttempts(URL, 'benim-adım.zip');
    expect(first).toEqual({
      url: URL, filename: 'benim-adım.zip', conflictAction: 'uniquify', saveAs: false,
    });
  });

  it('kullanıcının seçtiği ALT KLASÖR korunur', () => {
    expect(nativeDownloadAttempts(URL, 'Okul/ödev.pdf')[0]!.filename).toBe('Okul/ödev.pdf');
  });

  it('dizin kaçışı ve yol ayıraçları temizlenir', () => {
    const f = nativeDownloadAttempts(URL, '../../etc/passwd')[0]!.filename;
    expect(f).toBe('etc/passwd');
    expect(f).not.toContain('..');
  });

  it('Chrome yasaklı karakterleri reddetmesin — ad temizlenir', () => {
    expect(nativeDownloadAttempts(URL, 'a:b?c.zip')[0]!.filename).toBe('a_b_c.zip');
  });

  it('geri çekilme zinciri: seçilen ad → saf ASCII → adsız', () => {
    const a = nativeDownloadAttempts(URL, 'TESLİM ŞÇĞ.zip');
    expect(a).toHaveLength(3);
    expect(a[0]!.filename).toBe('TESLİM ŞÇĞ.zip');
    expect(a[1]!.filename).toBe('TESLIM_SCG.zip'); // ı/İ NFD ile çözülmez, açık eşleme
    expect(a[2]).toEqual({ url: URL }); // son çare adsız — dosya asla kaybolmaz
  });

  it('ASCII adı zaten aynıysa tekrarlanmaz', () => {
    const a = nativeDownloadAttempts(URL, 'report.pdf');
    expect(a.map((o) => o.filename)).toEqual(['report.pdf', undefined]);
  });

  it('tamamen geçersiz ad Chrome kararına düşer, patlamaz', () => {
    expect(nativeDownloadAttempts(URL, '../..')).toEqual([{ url: URL }]);
    expect(nativeDownloadAttempts(URL, '   ')).toEqual([{ url: URL }]);
  });

  it('son deneme HER ZAMAN adsızdır', () => {
    for (const name of ['x.zip', 'Ş/Ç.bin', 'con.txt', undefined]) {
      const a = nativeDownloadAttempts(URL, name);
      expect(a.at(-1)).toEqual({ url: URL });
    }
  });
});

describe('native indirmede ad dayatma — işaret eşlemesi', () => {
  const NOW = 5_000_000;
  const mark = (name: string, at = NOW): NativeNameMark => ({ name, at });

  it('adres birebir eşleşince adı verir ve işareti TÜKETİR', () => {
    const marks = { 'https://a.test/f': mark('benim.zip') };
    const r = pickNativeName(marks, { url: 'https://a.test/f' }, NOW);
    expect(r.name).toBe('benim.zip');
    expect(r.rest).toEqual({}); // tek kullanımlık
  });

  it('finalUrl üzerinden de eşleşir (sunucu yönlendirdi)', () => {
    const marks = { 'https://a.test/f': mark('benim.zip') };
    expect(pickNativeName(marks, { url: 'https://cdn.test/x', finalUrl: 'https://a.test/f' }, NOW).name)
      .toBe('benim.zip');
  });

  it('alakasız indirmeye YAPIŞMAZ', () => {
    const marks = { 'https://a.test/f': mark('benim.zip') };
    const r = pickNativeName(marks, { url: 'https://baska.test/g' }, NOW);
    expect(r.name).toBeNull();
    expect(r.rest).toEqual(marks); // başkasının işareti tüketilmez
  });

  it('süresi geçmiş işaret ölür ve temizlenir', () => {
    const marks = { 'https://a.test/f': mark('benim.zip', NOW - NATIVE_NAME_TTL_MS - 1) };
    const r = pickNativeName(marks, { url: 'https://a.test/f' }, NOW);
    expect(r.name).toBeNull();
    expect(r.rest).toEqual({});
  });

  it('sınırdaki işaret hâlâ geçerli', () => {
    const marks = { 'https://a.test/f': mark('benim.zip', NOW - NATIVE_NAME_TTL_MS) };
    expect(pickNativeName(marks, { url: 'https://a.test/f' }, NOW).name).toBe('benim.zip');
  });

  it('adressiz DownloadItem patlatmaz', () => {
    expect(pickNativeName({ 'https://a.test/f': mark('x.zip') }, {}, NOW).name).toBeNull();
  });

  it('birden çok işaret arasından doğrusunu seçer, ötekini bırakır', () => {
    const marks = {
      'https://a.test/1': mark('bir.zip'),
      'https://a.test/2': mark('iki.zip'),
    };
    const r = pickNativeName(marks, { url: 'https://a.test/2' }, NOW);
    expect(r.name).toBe('iki.zip');
    expect(Object.keys(r.rest)).toEqual(['https://a.test/1']);
  });

  it('prune yalnız süresi geçenleri atar', () => {
    const marks = {
      taze: mark('a.zip'),
      bayat: mark('b.zip', NOW - NATIVE_NAME_TTL_MS - 1),
    };
    expect(Object.keys(pruneNativeNames(marks, NOW))).toEqual(['taze']);
  });
});
