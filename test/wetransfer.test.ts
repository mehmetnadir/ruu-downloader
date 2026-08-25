import { describe, expect, it } from 'vitest';
import {
  apiBody, apiUrl, parseWetransfer, pickDirectLink, readCsrfToken,
} from '../src/engine/wetransfer';

const DL = 'https://wetransfer.com/downloads';

describe('parseWetransfer', () => {
  it('iki parçalı indirme adresi → transferId + securityHash', () => {
    expect(parseWetransfer(`${DL}/abc123/hash456`)).toEqual({
      origin: 'https://wetransfer.com', transferId: 'abc123', securityHash: 'hash456',
    });
  });

  it('üç parçalı adreste ortadaki alıcı kimliğidir (hash SONDA)', () => {
    expect(parseWetransfer(`${DL}/tid/rid/shash`)).toEqual({
      origin: 'https://wetransfer.com',
      transferId: 'tid', recipientId: 'rid', securityHash: 'shash',
    });
  });

  it('www kabul edilir ve köken korunur', () => {
    expect(parseWetransfer(`https://www.wetransfer.com/downloads/a/b`)?.origin)
      .toBe('https://www.wetransfer.com');
  });

  it('we.tl KISA linki reddedilir — hash yok, önce yönlendirme izlenmeli', () => {
    expect(parseWetransfer('https://we.tl/t-abc123')).toBeNull();
  });

  it('yabancı host, http ve yanlış yol reddedilir', () => {
    expect(parseWetransfer('https://wetransfer.evil.com/downloads/a/b')).toBeNull();
    expect(parseWetransfer('http://wetransfer.com/downloads/a/b')).toBeNull();
    expect(parseWetransfer(`${DL}/a`)).toBeNull();                 // eksik parça
    expect(parseWetransfer(`${DL}/a/b/c/d`)).toBeNull();           // fazla parça
    expect(parseWetransfer('https://wetransfer.com/uploads/a/b')).toBeNull();
    expect(parseWetransfer('bozuk')).toBeNull();
  });

  /**
   * Kimlik parçaları API adresine enterpole ediliyor: yol kaçışına izin
   * verirsek POST başka bir uca gidebilir. Bu test o sınırı kilitler.
   */
  it('yol kaçışı ve sorgu eki içeren kimlik reddedilir', () => {
    expect(parseWetransfer(`${DL}/..%2f..%2fadmin/b`)).toBeNull();
    expect(parseWetransfer(`${DL}/a.b/c`)).toBeNull();
    expect(parseWetransfer(`${DL}/${'x'.repeat(65)}/b`)).toBeNull();
    expect(parseWetransfer(`${DL}//b`)).toBeNull();
  });

  it('E2E kancası: localhost /wt/ yolu — prod hostlarında etkisiz', () => {
    expect(parseWetransfer('http://localhost:9/wt/tid/hash')).toEqual({
      origin: 'http://localhost:9', transferId: 'tid', securityHash: 'hash',
    });
    expect(parseWetransfer('http://localhost:9/downloads/tid/hash')).toBeNull();
    expect(parseWetransfer('https://wetransfer.com/wt/tid/hash')).toBeNull();
  });
});

describe('apiUrl / apiBody', () => {
  it('adres kökenden türetilir, sabit yazılmaz', () => {
    expect(apiUrl(parseWetransfer(`${DL}/tid/h`)!))
      .toBe('https://wetransfer.com/api/v4/transfers/tid/download');
    expect(apiUrl(parseWetransfer('http://127.0.0.1:1/wt/tid/h')!))
      .toBe('http://127.0.0.1:1/api/v4/transfers/tid/download');
  });

  it('gövde entire_transfer + security_hash; alıcı yoksa alan HİÇ konmaz', () => {
    expect(JSON.parse(apiBody(parseWetransfer(`${DL}/tid/h`)!)))
      .toEqual({ intent: 'entire_transfer', security_hash: 'h' });
    expect(JSON.parse(apiBody(parseWetransfer(`${DL}/tid/rid/h`)!)))
      .toEqual({ intent: 'entire_transfer', security_hash: 'h', recipient_id: 'rid' });
  });
});

describe('readCsrfToken', () => {
  it('öznitelik sırası ne olursa olsun bulunur', () => {
    expect(readCsrfToken('<meta name="csrf-token" content="tok-1">')).toBe('tok-1');
    expect(readCsrfToken('<meta content="tok-2" name="csrf-token">')).toBe('tok-2');
  });

  it('yoksa null — jetonsuz denemek çağıranın kararı', () => {
    expect(readCsrfToken('<html><head></head></html>')).toBeNull();
    expect(readCsrfToken('<meta name="csrf-token" content="">')).toBeNull();
  });
});

describe('pickDirectLink', () => {
  it('https adres geçer — host serbest (CDN değişebilir)', () => {
    expect(pickDirectLink({ direct_link: 'https://storage.googleapis.com/x/y?sig=1' }))
      .toBe('https://storage.googleapis.com/x/y?sig=1');
  });

  /** Cevap gövdesinden gelen bir şema motora giremez. */
  it('https olmayan şemalar reddedilir', () => {
    expect(pickDirectLink({ direct_link: 'javascript:alert(1)' })).toBeNull();
    expect(pickDirectLink({ direct_link: 'data:text/plain,x' })).toBeNull();
    expect(pickDirectLink({ direct_link: 'blob:https://a/b' })).toBeNull();
    expect(pickDirectLink({ direct_link: 'http://example.com/f' })).toBeNull();
  });

  it('localhost http yalnız E2E fixture için kabul edilir', () => {
    expect(pickDirectLink({ direct_link: 'http://localhost:9/f/8' }))
      .toBe('http://localhost:9/f/8');
  });

  it('biçimsiz cevap null döner, patlamaz', () => {
    expect(pickDirectLink(null)).toBeNull();
    expect(pickDirectLink('x')).toBeNull();
    expect(pickDirectLink({})).toBeNull();
    expect(pickDirectLink({ direct_link: 42 })).toBeNull();
    expect(pickDirectLink({ direct_link: '' })).toBeNull();
    expect(pickDirectLink({ direct_link: 'bozuk-url' })).toBeNull();
  });
});
