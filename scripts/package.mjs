/**
 * CWS yayın paketi: build → sürümü package.json'dan manifest'e yaz → zip.
 * Kullanım: node scripts/package.mjs   → out/ruu-downloader-v<version>.zip
 */
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';

const version = JSON.parse(readFileSync('package.json', 'utf8')).version;

execSync('node scripts/build.mjs', { stdio: 'inherit', env: { ...process.env, RUU_RELEASE: '1' } });

const manifestPath = 'dist/manifest.json';
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
manifest.version = version;
// E2E için eklenen localhost eşleşmesi YAYIN paketinde bulunmamalı:
// gereksiz izin yüzeyi = mağaza inceleme riski.
for (const cs of manifest.content_scripts ?? []) {
  cs.matches = cs.matches.filter((m) => !/localhost|127\.0\.0\.1/.test(m));
}
manifest.name = 'Ruu Downloader';
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

mkdirSync('out', { recursive: true });
const zipName = `ruu-downloader-v${version}.zip`;
rmSync(`out/${zipName}`, { force: true });
execSync(`cd dist && zip -qr "../out/${zipName}" . -x "*.map"`, { stdio: 'inherit' });
console.log(`out/${zipName} hazır (v${version})`);
