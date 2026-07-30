/**
 * İndirilen dosyanın bütünlük doğrulaması: byte[i] === i % 251 olmalı.
 * Kullanım: node test/server/verify.mjs <dosya>
 */
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';

const path = process.argv[2];
if (!path) {
  console.error('kullanım: node verify.mjs <dosya>');
  process.exit(2);
}

const { size } = await stat(path);
let offset = 0;
let bad = -1;

for await (const chunk of createReadStream(path)) {
  for (let i = 0; i < chunk.length; i++) {
    if (chunk[i] !== (offset + i) % 251) {
      bad = offset + i;
      break;
    }
  }
  if (bad >= 0) break;
  offset += chunk.length;
}

if (bad >= 0) {
  console.error(`BOZUK: byte ${bad} beklenen ${bad % 251}`);
  process.exit(1);
}
console.log(`OK: ${size} byte, bütünlük tam (pattern i%251)`);
