/**
 * Saha testi — 1. adım: deterministik test dosyasını ANONİM yükleme destekleyen
 * gerçek servislere yükler ve paylaşım linklerini üretir.
 *
 * İçerik byte[i] = i % 251 → indirilen dosya birebir doğrulanabilir.
 * Küçük dosya (varsayılan 3 MB) kullanılır: servislere yük bindirmemek için.
 *
 * Kullanım: node test/field/upload.mjs [MB] > test/field/links.json
 */
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const MB = Number(process.argv[2] ?? 3);
const SIZE = MB * 1024 * 1024;
const buf = Buffer.allocUnsafe(SIZE);
for (let i = 0; i < SIZE; i++) buf[i] = i % 251;
const dir = mkdtempSync(join(tmpdir(), 'ruu-field-'));
const filePath = join(dir, `ruu-test-${MB}mb.bin`);
writeFileSync(filePath, buf);

const log = (...a) => console.error(...a); // rapor stderr'e, JSON stdout'a

const file = () => new File([buf], `ruu-test-${MB}mb.bin`, { type: 'application/octet-stream' });

/** Her yükleyici {service, page} döner; page = kullanıcıya gelen paylaşım linki. */
const UPLOADERS = {
  async gofile() {
    const srv = await (await fetch('https://api.gofile.io/servers')).json();
    const server = srv?.data?.servers?.[0]?.name ?? 'store1';
    const fd = new FormData();
    fd.append('file', file());
    const r = await (await fetch(`https://${server}.gofile.io/contents/uploadfile`, {
      method: 'POST', body: fd,
    })).json();
    if (r?.status !== 'ok') throw new Error(JSON.stringify(r).slice(0, 120));
    return r.data.downloadPage;
  },

  async fileio() {
    const fd = new FormData();
    fd.append('file', file());
    const r = await (await fetch('https://file.io/?expires=1d', { method: 'POST', body: fd })).json();
    if (!r?.link) throw new Error(JSON.stringify(r).slice(0, 120));
    return r.link;
  },

  async catbox() {
    const fd = new FormData();
    fd.append('reqtype', 'fileupload');
    fd.append('fileToUpload', file());
    const text = (await (await fetch('https://catbox.moe/user/api.php', {
      method: 'POST', body: fd,
    })).text()).trim();
    if (!text.startsWith('https://')) throw new Error(text.slice(0, 120));
    return text;
  },

  async pixeldrain() {
    const r = await (await fetch(`https://pixeldrain.com/api/file/ruu-test-${MB}mb.bin`, {
      method: 'PUT', body: buf,
    })).json();
    if (!r?.id) throw new Error(JSON.stringify(r).slice(0, 120));
    return `https://pixeldrain.com/u/${r.id}`;
  },

  async filebin() {
    const bin = `ruu${Date.now().toString(36)}`;
    const r = await fetch(`https://filebin.net/${bin}/ruu-test-${MB}mb.bin`, {
      method: 'POST', body: buf, headers: { 'content-type': 'application/octet-stream' },
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return `https://filebin.net/${bin}`;
  },
};

const results = [];
for (const [service, fn] of Object.entries(UPLOADERS)) {
  try {
    const page = await fn();
    log(`✓ ${service}: ${page}`);
    results.push({ service, page, size: SIZE });
  } catch (err) {
    log(`✗ ${service}: ${err.message}`);
    results.push({ service, error: String(err.message).slice(0, 160) });
  }
}

log(`\nyerel kopya: ${filePath}`);
console.log(JSON.stringify({ size: SIZE, file: filePath, links: results }, null, 2));
