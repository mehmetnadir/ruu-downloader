import { describe, expect, it } from 'vitest';
import { safeFallbackName, sanitizeFilename } from '../src/engine/filename';

describe('sanitizeFilename', () => {
  it('SAHA HATASI: Türkçe İ ayrışmış gelirse NFC ile birleştirir', () => {
    // sendgb 1,5 GB TESLİM.zip — teslim "Invalid filename" ile düşmüştü
    const nfd = 'TESLI\u0307M.zip';           // I + birleşen nokta
    const out = sanitizeFilename(nfd);
    expect(out).toBe('TESL\u0130M.zip');       // tek kod noktası İ
    expect(out.normalize('NFC')).toBe(out);
  });

  it('görünmez biçim karakterlerini (Cf) SİLER — kullanıcının gördüğü ad korunur', () => {
    // LRM ekranda hiçbir şey göstermez; "_" koymak olmayan bir ayraç uydurur
    expect(sanitizeFilename('rapor\u200elistesi.pdf')).toBe('raporlistesi.pdf');
    expect(sanitizeFilename('\ufeffdosya.zip')).toBe('dosya.zip');
    // ama GÖRÜNÜR yasak karakter alt çizgi olur — kelimeler yapışmasın
    expect(sanitizeFilename('rapor:listesi.pdf')).toBe('rapor_listesi.pdf');
  });

  it('Windows yasak karakterlerini değiştirir', () => {
    expect(sanitizeFilename('a:b*c?d.txt')).toBe('a_b_c_d.txt');
    expect(sanitizeFilename('q"w<e>r|t.zip')).toBe('q_w_e_r_t.zip');
  });

  it('yol ayırıcıları asla geçmez (dizin kaçışı)', () => {
    expect(sanitizeFilename('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFilename('C:\\Windows\\evil.exe')).toBe('evil.exe');
  });

  it('GÖVDE sonundaki boşluğu da atar — "rapor .zip" Windows\'ta sorunlu', () => {
    expect(sanitizeFilename('rapor .zip')).toBe('rapor.zip');
    expect(sanitizeFilename('TESLI\u0307M\u200e:rapor .zip')).toBe('TESL\u0130M_rapor.zip');
  });

  it('sondaki nokta ve boşluğu atar (Windows reddeder)', () => {
    expect(sanitizeFilename('dosya.zip   ')).toBe('dosya.zip');
    expect(sanitizeFilename('  dosya.zip')).toBe('dosya.zip');
    expect(sanitizeFilename('dosya...')).toBe('dosya');
  });

  it('Windows ayrılmış adlarını kurtarır', () => {
    expect(sanitizeFilename('CON.txt')).toBe('_CON.txt');
    expect(sanitizeFilename('lpt3.zip')).toBe('_lpt3.zip');
    expect(sanitizeFilename('console.txt')).toBe('console.txt'); // yanlış pozitif yok
  });

  it('çok uzun adı uzantıyı KORUYARAK kırpar', () => {
    const out = sanitizeFilename(`${'a'.repeat(500)}.zip`);
    expect(out.length).toBeLessThanOrEqual(200);
    expect(out.endsWith('.zip')).toBe(true);
  });

  it('tamamen geçersiz girdide yedeğe düşer', () => {
    expect(sanitizeFilename('...')).toBe('download');
    expect(sanitizeFilename('   ')).toBe('download');
    expect(sanitizeFilename('\u0000\u0001')).toBe('download');
  });

  it('normal Türkçe adları BOZMAZ', () => {
    expect(sanitizeFilename('TESLİM.zip')).toBe('TESLİM.zip');
    expect(sanitizeFilename('Öğrenci Çalışması.pdf')).toBe('Öğrenci Çalışması.pdf');
    expect(sanitizeFilename('şğüıöç.txt')).toBe('şğüıöç.txt');
  });
});

describe('safeFallbackName (son çare)', () => {
  it('uzantıyı korur, gövdeyi ASCII\'ye indirir', () => {
    expect(safeFallbackName('TESLİM.zip')).toBe('TESLIM.zip');
    expect(safeFallbackName('Öğrenci Çalışması.pdf')).toBe('Ogrenci_Calismasi.pdf');
  });

  it('her koşulda boş olmayan bir ad döner', () => {
    expect(safeFallbackName('...')).toBe('download');
    expect(safeFallbackName('日本語')).toBe('download');
  });
});
