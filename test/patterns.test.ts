import { describe, expect, it } from 'vitest';
import { isActionLabel, matchShareLink } from '../src/content/patterns';

describe('matchShareLink', () => {
  it('dropbox → direct (dl=1 eklenir)', () => {
    const m = matchShareLink('https://www.dropbox.com/s/abc123/dosya.zip?dl=0');
    expect(m).toMatchObject({ kind: 'direct', service: 'dropbox' });
    expect(m!.url).toContain('dl=1');
    expect(matchShareLink('https://www.dropbox.com/scl/fi/xyz/f.pdf')!.kind).toBe('direct');
  });

  it('lifebox / wetransfer / drive / onedrive → autoflow', () => {
    expect(matchShareLink('https://lifeboxtransfer.com/download/8b892f06-1/tr'))
      .toMatchObject({ kind: 'autoflow', service: 'lifebox' });
    expect(matchShareLink('https://we.tl/t-abc123')!.service).toBe('wetransfer');
    expect(matchShareLink('https://wetransfer.com/downloads/abc/def')!.service).toBe('wetransfer');
    expect(matchShareLink('https://drive.google.com/file/d/FILEID/view')!.service).toBe('gdrive');
    expect(matchShareLink('https://1drv.ms/u/s!abc')!.service).toBe('onedrive');
  });

  it('alakasız ve güvensiz linkler eşleşmez', () => {
    expect(matchShareLink('https://example.com/dosya.zip')).toBeNull();
    expect(matchShareLink('http://we.tl/t-abc')).toBeNull(); // https şart
    expect(matchShareLink('https://dropbox.com/home')).toBeNull();
    expect(matchShareLink('bozuk-url')).toBeNull();
  });
});

describe('isActionLabel (Türkçe büyük-İ tuzağı)', () => {
  it('Türkçe büyük İ ile yazılmış butonları yakalar', () => {
    expect(isActionLabel('İndir')).toBe(true);
    expect(isActionLabel('Tümünü İndir')).toBe(true);
    expect(isActionLabel('İNDİR')).toBe(true);
    expect(isActionLabel('Onaylıyorum')).toBe(true);
  });

  it('naif /indir/i bu metinleri KAÇIRIR — regresyon kanıtı', () => {
    expect(/indir/i.test('İndir')).toBe(false);
  });

  it('diğer diller ve aksanlar', () => {
    expect(isActionLabel('Download all')).toBe(true);
    expect(isActionLabel('Accept')).toBe(true);
    expect(isActionLabel('Continuer'.slice(0, 8))).toBe(true);
  });

  it('alakasız butonlar eşleşmez', () => {
    expect(isActionLabel('Ücretsiz Kaydol')).toBe(false);
    expect(isActionLabel('S.S.S')).toBe(false);
    expect(isActionLabel('Sil')).toBe(false);
  });
});

describe('gerçek servis buton etiketleri', () => {
  it('Drive virüs uyarısı, WeTransfer onayı, OneDrive indir', () => {
    expect(isActionLabel('Yine de indir')).toBe(true);      // Drive TR
    expect(isActionLabel('Download anyway')).toBe(true);    // Drive EN
    expect(isActionLabel('I agree')).toBe(true);            // WeTransfer
    expect(isActionLabel('Accept all')).toBe(true);         // çerez onayı
    expect(isActionLabel('Tümünü kabul et')).toBe(true);
    expect(isActionLabel('Download')).toBe(true);           // OneDrive/WeTransfer
    expect(isActionLabel('Devam et')).toBe(true);
  });

  it('tehlikeli/alakasız butonlar hâlâ eşleşmiyor', () => {
    expect(isActionLabel('Sil')).toBe(false);
    expect(isActionLabel('Hesabı kapat')).toBe(false);
    expect(isActionLabel('Ücretsiz Kaydol')).toBe(false);
    expect(isActionLabel('Reddet')).toBe(false);
  });
});
