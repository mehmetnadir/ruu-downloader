# Project Switch — Ruu Downloader

[STATE: SHIPPING] — v0.6.4 built and gate-green (181 unit · 24/24 E2E · 22 Go tests
· audit clean). Chrome Web Store item `kcbcgiflgolgekfpgijpjeonjfjpcdid` is still in
review with v0.5.0; uploading a new package RESETS the review clock — that call is
Nadir's, not automatic.

[TEMPORAL_STATE: WETRANSFER_HANDED_TO_BROWSER] — Since v0.6.4 a takeover pre-flight
runs before Chrome's download is cancelled. WeTransfer downloads are born from a
POST and cannot be re-requested with GET (verified live: API GET → 404), so Ruu
deliberately steps aside and Chrome downloads them. This is intended behaviour, not
a regression. Accelerating WeTransfer would need direct_link capture — open decision.

[MAINTENANCE: ROOT_PRIVACY_MD_IS_INTENTIONAL] — `PRIVACY.md` must stay at the repo
root. Rationale: it is the published privacy-policy URL submitted to the Chrome Web
Store (`.../blob/main/PRIVACY.md`, see `.claude/docs/store-listing.md`). Moving it
into `.claude/docs/` would break a live store listing link. Do not "fix" this.

## Departments

- Engine (segmented fetch, work-stealing, OPFS disk worker) — live · `src/offscreen/engine.ts`
- Extension shell (service worker router, offscreen host, manifest) — live · `src/sw.ts`
- UI (Side Panel monitoring, full-page options) — live · `src/sidepanel/`, `src/options/`
- Resolvers (share-service link resolution, 28 services) — live · `src/content/services.ts`
- Native helper (Go, launcher/server split) — live and released as `helper-v1.0.1`
- Beam relay (Cloudflare Worker + PWA) — live, untouched this session
- Docs & research — `.claude/docs/INDEX.md`

## Pointers

- Session history: `.claude/session-journal/INDEX.md` (newest first)
- Project identity + file map: `.claude/CLAUDE.md`
- Roadmap and decisions with rationale: `.claude/docs/prd-03-roadmap.md`
- Changelog: `.claude/docs/changelog.md`
- Store listing copy + checklist: `.claude/docs/store-listing.md`
- Memory (scope decisions, testing mandate, open tasks):
  `~/.claude/projects/-Users-nadir-01dev-download-manager/memory/`

Last updated: 2026-08-25
