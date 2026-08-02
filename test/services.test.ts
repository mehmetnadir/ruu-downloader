import { describe, expect, it } from 'vitest';
import { matchShareLink } from '../src/content/patterns';
import { SERVICES } from '../src/content/services';

const m = (url: string) => matchShareLink(url);

describe('servis kataloğu — popüler servisler tanınıyor', () => {
  it('en popüler 8 servis (Similarweb sırası)', () => {
    expect(m('https://www.mediafire.com/file/abc/dosya.zip/file')).toMatchObject({ service: 'mediafire', kind: 'autoflow' });
    expect(m('https://www.dropbox.com/s/abc/f.zip?dl=0')).toMatchObject({ service: 'dropbox', kind: 'direct' });
    expect(m('https://app.box.com/s/abc123')).toMatchObject({ service: 'box' });
    expect(m('https://mega.nz/file/AbC#key')).toMatchObject({ service: 'mega', kind: 'unaccel', reason: 'e2ee' });
    expect(m('https://gofile.io/d/abc123')).toMatchObject({ service: 'gofile' });
    expect(m('https://we.tl/t-abc')).toMatchObject({ service: 'wetransfer' });
    expect(m('https://www.terabox.com/s/1abc')).toMatchObject({ service: 'terabox' });
  });

  it('büyük bulutlar', () => {
    expect(m('https://drive.google.com/file/d/ID/view')).toMatchObject({ service: 'gdrive' });
    expect(m('https://1drv.ms/u/s!abc')).toMatchObject({ service: 'onedrive' });
    expect(m('https://firma.sharepoint.com/:b:/g/personal/x/abc')).toMatchObject({ service: 'onedrive' });
    expect(m('https://www.icloud.com/iclouddrive/abc')).toMatchObject({ service: 'icloud' });
    expect(m('https://u.pcloud.link/publink/show?code=XYZ')).toMatchObject({ service: 'pcloud' });
    expect(m('https://drive.proton.me/urls/ABC')).toMatchObject({ kind: 'unaccel', reason: 'e2ee' });
  });

  it('transfer servisleri (TR dahil)', () => {
    expect(m('https://www.swisstransfer.com/d/uuid')).toMatchObject({ service: 'swisstransfer' });
    expect(m('https://fromsmash.com/abc')).toMatchObject({ service: 'smash' });
    expect(m('https://www.transfernow.net/dl/abc')).toMatchObject({ service: 'transfernow' });
    expect(m('https://www.filemail.com/d/abc')).toMatchObject({ service: 'filemail' });
    expect(m('https://lifeboxtransfer.com/download/uuid/tr')).toMatchObject({ service: 'lifebox' });
    expect(m('https://dosya.tc/abc')).toMatchObject({ service: 'dosyatc' });
    expect(m('https://disk.yandex.com.tr/d/abc')).toMatchObject({ service: 'yandexdisk' });
    expect(m('https://cloud.mail.ru/public/abc/def')).toMatchObject({ service: 'mailru' });
  });

  it('doğrudan link dönüşümleri', () => {
    const px = m('https://pixeldrain.com/u/AbC123');
    expect(px).toMatchObject({ kind: 'direct' });
    expect(px!.url).toBe('https://pixeldrain.com/api/file/AbC123?download');
    const db = m('https://www.dropbox.com/scl/fi/xyz/f.pdf?rlkey=k&dl=0');
    expect(db!.url).toContain('dl=1');
    expect(db!.url).toContain('rlkey=k'); // diğer parametreler korunur
  });

  it('doğru site ama yanlış sayfa eşleşmez (ana sayfa, ayarlar…)', () => {
    expect(m('https://www.dropbox.com/home')).toBeNull();
    expect(m('https://gofile.io/')).toBeNull();
    expect(m('https://drive.google.com/drive/my-drive')).toBeNull();
    expect(m('https://www.mediafire.com/upgrade')).toBeNull();
  });

  it('kapsam dışı siteler tanınmaz (torrent, video-ripper, rastgele)', () => {
    expect(m('https://thepiratebay.org/description.php?id=1')).toBeNull();
    expect(m('https://savefrom.net/#url=x')).toBeNull();
    expect(m('https://example.com/f.zip')).toBeNull();
    expect(m('http://we.tl/t-abc')).toBeNull(); // https şart
  });

  it('katalog tutarlı: benzersiz id, direct→transform, unaccel→reason', () => {
    const ids = SERVICES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of SERVICES) {
      if (s.kind === 'direct') expect(s.transform, `${s.id} transform`).toBeTypeOf('function');
      if (s.kind === 'unaccel') expect(s.reason, `${s.id} reason`).toBeTruthy();
      expect(s.hosts.length).toBeGreaterThan(0);
    }
  });
});
