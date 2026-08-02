/**
 * Paylaşım servisi kataloğu — popülerlik sırasına göre (Similarweb "file sharing
 * and hosting" kategorisi + genel pazar payı araştırması, 2026-08).
 *
 * KAPSAM DIŞI (bilinçli): torrent siteleri, video-ripper'lar (savefrom, ytdown),
 * warez odaklı hostlar. Ruu bir verimlilik aracıdır.
 *
 * kind:
 *   'direct'      → URL dönüşümüyle doğrudan motora (sayfa açılmaz, en hızlı yol)
 *   'autoflow'    → paylaşım sayfası arka planda açılır, onay/indir tıklanır
 *   'unaccel'     → link tanınır ama HIZLANDIRILAMAZ; dürüstçe söylenir
 *                   (uçtan uca şifreli servisler dosyayı tarayıcıda çözüp blob
 *                   üretir — blob tek kullanımlıktır, yeniden çekilemez)
 */
export type ServiceKind = 'direct' | 'autoflow' | 'unaccel';

export interface ServiceDef {
  id: string;
  name: string;
  /** Tam eşleşme ya da '.' ile başlayan alan adı soneki */
  hosts: string[];
  kind: ServiceKind;
  /** Yol filtresi — paylaşım linki olmayan sayfalar (ana sayfa vb.) elensin */
  path?: RegExp;
  /** 'direct' için URL dönüşümü */
  transform?: (u: URL) => string;
  /** 'unaccel' için kullanıcıya gösterilecek sebep anahtarı */
  reason?: 'e2ee' | 'login';
}

export const SERVICES: ServiceDef[] = [
  // ── En popüler genel amaçlı (Similarweb sıralaması) ───────────────────────
  {
    id: 'mediafire', name: 'MediaFire',
    hosts: ['mediafire.com', '.mediafire.com'],
    kind: 'autoflow', path: /^\/(file|folder|download)\//,
  },
  {
    id: 'dropbox', name: 'Dropbox',
    hosts: ['dropbox.com', 'www.dropbox.com'],
    kind: 'direct', path: /^\/(s|scl\/fi)\//,
    transform: (u) => { u.searchParams.set('dl', '1'); return u.toString(); },
  },
  {
    id: 'box', name: 'Box',
    hosts: ['box.com', 'app.box.com', '.box.com'],
    kind: 'autoflow', path: /^\/(s|shared)\//,
  },
  {
    id: 'mega', name: 'MEGA',
    hosts: ['mega.nz', 'mega.io', 'mega.co.nz'],
    kind: 'unaccel', reason: 'e2ee',
  },
  {
    id: 'gofile', name: 'Gofile',
    hosts: ['gofile.io'],
    kind: 'autoflow', path: /^\/d\//,
  },
  {
    id: 'wetransfer', name: 'WeTransfer',
    hosts: ['we.tl', 'wetransfer.com', 'www.wetransfer.com'],
    kind: 'autoflow',
  },
  {
    id: 'terabox', name: 'TeraBox',
    hosts: ['1024tera.com', 'terabox.com', 'www.terabox.com', '4funbox.com'],
    kind: 'autoflow', path: /^\/(s|sharing)\//,
  },

  // ── Büyük bulut sağlayıcıları ─────────────────────────────────────────────
  {
    id: 'gdrive', name: 'Google Drive',
    hosts: ['drive.google.com', 'docs.google.com'],
    kind: 'autoflow', path: /^\/(file\/d\/|open|uc|drive\/folders\/)/,
  },
  {
    id: 'onedrive', name: 'OneDrive',
    hosts: ['1drv.ms', 'onedrive.live.com', '.sharepoint.com'],
    kind: 'autoflow',
  },
  {
    id: 'icloud', name: 'iCloud Drive',
    hosts: ['icloud.com', 'www.icloud.com'],
    kind: 'autoflow', path: /^\/iclouddrive\//,
  },
  {
    id: 'pcloud', name: 'pCloud',
    hosts: ['pcloud.link', 'u.pcloud.link', 'my.pcloud.com', 'e.pcloud.link'],
    kind: 'autoflow',
  },
  {
    id: 'protondrive', name: 'Proton Drive',
    hosts: ['drive.proton.me', 'drive.protonapp.com'],
    kind: 'unaccel', reason: 'e2ee',
  },

  // ── Büyük dosya transfer servisleri ───────────────────────────────────────
  {
    id: 'swisstransfer', name: 'SwissTransfer',
    hosts: ['swisstransfer.com', 'www.swisstransfer.com'],
    kind: 'autoflow', path: /^\/d\//,
  },
  {
    id: 'smash', name: 'Smash',
    hosts: ['fromsmash.com', 'www.fromsmash.com'],
    kind: 'autoflow',
  },
  {
    id: 'transfernow', name: 'TransferNow',
    hosts: ['transfernow.net', 'www.transfernow.net'],
    kind: 'autoflow', path: /^\/(dl|d)\//,
  },
  {
    id: 'filemail', name: 'Filemail',
    hosts: ['filemail.com', 'www.filemail.com'],
    kind: 'autoflow', path: /^\/d\//,
  },
  {
    id: 'sendanywhere', name: 'Send Anywhere',
    hosts: ['send-anywhere.com', 'www.send-anywhere.com'],
    kind: 'autoflow',
  },
  {
    id: 'lifebox', name: 'Lifebox Transfer',
    hosts: ['lifeboxtransfer.com', 'www.lifeboxtransfer.com'],
    kind: 'autoflow', path: /^\/download\//,
  },
  {
    id: 'dosyatc', name: 'Dosya.tc',
    hosts: ['dosya.tc', 'www.dosya.tc'],
    kind: 'autoflow',
  },
  {
    id: 'yandexdisk', name: 'Yandex Disk',
    hosts: ['disk.yandex.com', 'disk.yandex.ru', 'disk.yandex.com.tr', 'yadi.sk'],
    kind: 'autoflow', path: /^\/(d|i)\//,
  },
  {
    id: 'mailru', name: 'Mail.ru Cloud',
    hosts: ['cloud.mail.ru'],
    kind: 'autoflow', path: /^\/public\//,
  },

  // ── Doğrudan link veren küçük servisler (en hızlı yol) ────────────────────
  {
    id: 'pixeldrain', name: 'Pixeldrain',
    hosts: ['pixeldrain.com'],
    kind: 'direct', path: /^\/u\//,
    transform: (u) => `https://pixeldrain.com/api/file/${u.pathname.split('/')[2]}?download`,
  },
  {
    id: 'catbox', name: 'Catbox',
    hosts: ['catbox.moe', 'files.catbox.moe'],
    kind: 'direct', transform: (u) => u.toString(),
  },
  {
    id: 'filebin', name: 'Filebin',
    hosts: ['filebin.net'],
    kind: 'autoflow',
  },
  {
    id: 'fileio', name: 'file.io',
    hosts: ['file.io', 'www.file.io'],
    kind: 'direct', transform: (u) => u.toString(),
  },
  {
    id: 'wormhole', name: 'Wormhole',
    hosts: ['wormhole.app'],
    kind: 'unaccel', reason: 'e2ee',
  },
  {
    id: '4shared', name: '4shared',
    hosts: ['4shared.com', 'www.4shared.com'],
    kind: 'autoflow',
  },
  {
    id: 'krakenfiles', name: 'KrakenFiles',
    hosts: ['krakenfiles.com', 'www.krakenfiles.com'],
    kind: 'autoflow', path: /^\/view\//,
  },
];

function hostMatches(hostname: string, patterns: string[]): boolean {
  return patterns.some((p) => (p.startsWith('.') ? hostname.endsWith(p) : hostname === p));
}

export function findService(u: URL): ServiceDef | null {
  for (const svc of SERVICES) {
    if (!hostMatches(u.hostname, svc.hosts)) continue;
    if (svc.path && !svc.path.test(u.pathname)) return null; // doğru site, yanlış sayfa
    return svc;
  }
  return null;
}
