/**
 * Ruu ikon üreteci — bağımlılıksız PNG (zlib + el yazımı chunk encoder).
 * Amber yuvarlatılmış zemin + koyu "aşağı ok + çizgi" (logo ile aynı geometri).
 * Kullanım: node scripts/gen-icon.mjs   → public/icons/icon{16,48,128}.png
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';

const AMBER = [0xe8, 0xa3, 0x3d, 255];
const DARK = [0x16, 0x13, 0x0f, 255];

function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, pixels) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function drawIcon(size) {
  const px = Buffer.alloc(size * size * 4);
  const put = (x, y, c) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = c[3];
  };
  const r = size * 0.22; // köşe yarıçapı
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cx = Math.max(r - x, x - (size - 1 - r), 0);
      const cy = Math.max(r - y, y - (size - 1 - r), 0);
      if (cx * cx + cy * cy <= r * r) put(x, y, AMBER);
    }
  }
  const u = size / 24; // logo geometrisi 24'lük grid'de
  const stroke = Math.max(1, Math.round(2.2 * u));
  const fillRect = (x0, y0, x1, y1) => {
    for (let y = Math.round(y0); y < Math.round(y1); y++)
      for (let x = Math.round(x0); x < Math.round(x1); x++) put(x, y, DARK);
  };
  // gövde: dikey şaft (12,4)→(12,14)
  fillRect(12 * u - stroke / 2, 4.5 * u, 12 * u + stroke / 2, 14 * u);
  // ok başı: (12,17) tepe, genişlik ±5
  const tipY = 17 * u;
  for (let dy = 0; dy < 5.5 * u; dy++) {
    const w = (dy / (5.5 * u)) * 5 * u + stroke / 2;
    fillRect(12 * u - w, tipY - dy - stroke / 2, 12 * u + w, tipY - dy + stroke / 2);
  }
  // taban çizgisi (5,20)→(19,20)
  fillRect(5.5 * u, 19.5 * u - stroke / 2, 18.5 * u, 19.5 * u + stroke / 2);
  return px;
}

mkdirSync('public/icons', { recursive: true });
for (const size of [16, 48, 128]) {
  writeFileSync(`public/icons/icon${size}.png`, encodePng(size, drawIcon(size)));
  console.log(`icon${size}.png yazıldı`);
}
