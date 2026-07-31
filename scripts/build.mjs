import { build, context } from 'esbuild';
import { cpSync, mkdirSync } from 'node:fs';

const watch = process.argv.includes('--watch');

const options = {
  entryPoints: {
    'sw': 'src/sw.ts',
    'offscreen': 'src/offscreen/engine.ts',
    'disk-worker': 'src/offscreen/disk-worker.ts',
    'sidepanel': 'src/sidepanel/main.ts',
    'mail': 'src/content/mail.ts',
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

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
} else {
  await build(options);
}
