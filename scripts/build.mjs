import { build, context } from 'esbuild';
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const watch = process.argv.includes('--watch');

/**
 * Gerçek sürümü HER build'de manifest'e yaz.
 *
 * Eskiden bunu yalnız release paketleyicisi (package.mjs) yapıyordu:
 * geliştirici modunda dist'ten yüklenen eklenti hep public/manifest.json'daki
 * "0.0.1" placeholder'ını gösteriyordu — Nadir hangi sürümü çalıştırdığını
 * chrome://extensions'tan göremedi. Sürümün tek kaynağı package.json'dır ve
 * her build çıktısı onu taşımalıdır.
 */
function stampVersion() {
  const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
  const manifestPath = 'dist/manifest.json';
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.version = version;
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`manifest sürümü: ${version}`);
}

const options = {
  entryPoints: {
    'sw': 'src/sw.ts',
    'offscreen': 'src/offscreen/engine.ts',
    'disk-worker': 'src/offscreen/disk-worker.ts',
    'sidepanel': 'src/sidepanel/main.ts',
    'mail': 'src/content/mail.ts',
    'done': 'src/sidepanel/done.ts',
    'options': 'src/options/main.ts',
  },
  outdir: 'dist',
  bundle: true,
  format: 'esm',
  target: 'chrome116',
  sourcemap: process.env['RUU_RELEASE'] ? false : 'inline',
  logLevel: 'info',
};

mkdirSync('dist', { recursive: true });
cpSync('public', 'dist', { recursive: true });
stampVersion();

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
} else {
  await build(options);
}
