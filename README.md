# Ruu Downloader

A modern, minimal download manager extension for Chromium browsers (Manifest V3).

Inspired by what people actually love about classic download managers — multi-connection
segmented downloading, bulletproof pause/resume, and seamless browser integration — rebuilt
on modern web platform primitives (OPFS, File System Access, Side Panel).

## Core features (MVP)

- **Dynamic segmented downloads** — parallel connections with work-stealing: when a
  connection frees up, it splits the largest in-flight segment, so a single slow
  connection never drags the whole download.
- **Crash-proof resume** — segment progress is derived from bytes already written to disk,
  with ETag/Last-Modified validation on resume.
- **Browser takeover** — intercepts regular browser downloads and accelerates them.
- **No merge phase** — segments are written directly at their final byte offsets (OPFS
  positioned writes). No "merging segments, please wait".
- **Side Panel UI** — minimal, modern, with a live segment map.
- **Queues & scheduling (roadmap)** — multiple queues with concurrency limits and
  scheduled/recurring download windows.
- **Smart share-link resolution (roadmap)** — one-click downloads for WeTransfer, Dropbox,
  OneDrive links found in your mail.

## What this is not

Ruu is a productivity tool. It does **not** sniff, capture, or rip streaming video
(HLS/DASH). Only direct file links are supported.

## Development

```bash
npm install
npm run build        # bundles to dist/ (esbuild)
npm test             # unit tests (Vitest)
./test/e2e/run.sh    # full E2E: isolated Chrome + throttled test server,
                     # 3 scenarios, byte-level integrity checks
HEADLESS=1 ./test/e2e/run.sh   # CI mode
```

Note: Chrome 137+ removed `--load-extension`; the E2E harness loads the unpacked
extension via CDP `Extensions.loadUnpacked` (requires `--enable-unsafe-extension-debugging`).

## Status

Walking skeleton is live: segmented engine, OPFS positioned writes, Side Panel with
live segment map, pause/resume, native fallback — all verified end-to-end.
See `.claude/docs/` for design docs and roadmap.

## License

MIT (planned).
