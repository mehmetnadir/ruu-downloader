# Ruu Downloader — Privacy Policy

_Last updated: 2026-07-31_

**Short version: Ruu collects nothing. Everything stays on your device.**

## Data collection

Ruu Downloader does **not** collect, transmit, sell, or share any data.
There are no analytics, no telemetry, no remote logging, and no third-party
services. The extension makes network requests **only** to the URLs you
choose to download.

## Local data

The following stays entirely on your device and is never transmitted:

- **Download state** (progress ranges, file metadata) — stored in the
  browser's Origin Private File System while a download is in progress and
  deleted when it completes or is cancelled.
- **Settings** (takeover, thresholds, notification mode, retry count) —
  stored in `chrome.storage.local`.
- **Local statistics** (download count, total bytes, best speed) — stored in
  `chrome.storage.local`, visible only to you, resettable by removing the
  extension.

Private downloads additionally erase their entry from the browser's download
history and are excluded from local statistics.

## Permission rationale

| Permission | Why |
|---|---|
| `downloads`, `downloads.ui`, `downloads.open` | Deliver completed files, take over browser downloads, hide Chrome's download bubble when you opt in, open finished files |
| `host_permissions: *://*/*` | Fetch the file segments you ask Ruu to download (HTTP Range requests) — Ruu never requests any URL you didn't initiate |
| `storage`, `unlimitedStorage` | Settings and in-progress download data |
| `offscreen` | Hosts the download engine so transfers survive service-worker suspension |
| `sidePanel`, `notifications` | UI and completion notices |
| `power` | Keeps the system awake while a download runs |

## Contact

Questions or concerns: open an issue at
https://github.com/mehmetnadir/ruu-downloader/issues
