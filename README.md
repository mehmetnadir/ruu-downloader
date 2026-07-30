# Ruu Downloader

A modern, minimal download manager extension for Chromium browsers (Manifest V3).

Inspired by what people actually love about classic download managers — multi-connection
segmented downloading, bulletproof pause/resume, and seamless browser integration — rebuilt
on modern web platform primitives (OPFS, File System Access, Side Panel).

## Features

- **Dynamic segmented downloads** — parallel connections with work-stealing: when a
  connection frees up, it splits the largest in-flight segment, so a single slow
  connection never drags the whole download.
- **Crash-proof resume** — even a hard browser crash: acknowledged byte ranges are
  journaled to a sidecar, jobs come back paused and continue where they left off,
  with ETag/Last-Modified validation.
- **Browser takeover** — one-time opt-in makes Ruu the default download experience:
  Chrome's download bubble is hidden and downloads above a threshold are accelerated.
- **No merge phase** — segments are written directly at their final byte offsets
  (OPFS positioned writes). No "merging segments, please wait".
- **Side Panel UI** — minimal, warm-dark, with a live segment map, heartbeat pulse,
  one-word status verbs, and full reduced-motion support.
- **Device-aware tuning** — connection count adapts to network speed and hardware.
- **Type-based sorting** — images/video/music/archives/documents/apps each land in
  their own folder (optional).
- **Private downloads** — file lands on disk, zero trace in browser history or stats.
- **Finish modes** — silent, notification with Open button, or "party mode" that
  opens a video of your choice. Plus download-and-open.
- **11 languages** — including RTL (Arabic); icon-first, minimal-text UI.
- **Local-only stats** — no telemetry, ever. See [PRIVACY.md](PRIVACY.md).

Roadmap: queues & scheduling, smart share-link resolution (WeTransfer/Dropbox/OneDrive),
phone-to-PC "Beam", in-panel previews. See `.claude/docs/prd-03-roadmap.md`.

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

v0.1.0 — feature-complete core, verified by 37 unit tests and a 6-scenario E2E
suite (segmented integrity, connection drops, native fallback, browser takeover,
private downloads, hard-crash resume) running headful and headless.

Release packaging: `npm run package` → `out/ruu-downloader-v<version>.zip`.

## License

[MIT](LICENSE).
