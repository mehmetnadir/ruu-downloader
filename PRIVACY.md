# Ruu Downloader — Privacy Policy

_Last updated: 2026-07-31_

**Short version: Ruu collects nothing. Everything stays on your device.**

## Data collection

Ruu Downloader does **not** collect, transmit, sell, or share any data.
There are no analytics, no telemetry, no remote logging, and no advertising.

### Network requests Ruu makes

1. **The URLs you choose to download.** Nothing else is fetched by the engine.
2. **Ruu Beam relay — only if you pair a phone.** If (and only if) you scan the
   pairing QR code, the extension polls a relay
   (`https://ruu-beam.nadir-zai-proxy.workers.dev`) once per minute for links
   your phone sent you. What the relay can see: the pairing ID (a random string
   you generated) and an encrypted blob. What it **cannot** see: the links —
   they are encrypted with AES-GCM using a 256-bit key that exists only on your
   two devices. The key travels in the QR code's URL fragment, which browsers
   never transmit to a server. Queued items expire after 15 minutes. Unpair at
   any time and polling stops immediately.

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
