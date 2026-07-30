# Project Switch — Ruu Downloader

[STATE: ARCHITECTURE_PHASE] — PRD part 1 APPROVED (2026-07-30); next: PRD part 2 + OPFS spike. Testing mandate: nothing ships untested (Vitest + throttled range server + cdpilot E2E).

## Departments

- Engine (segmented fetch, work-stealing, OPFS disk worker) — not started
- Extension shell (service worker router, offscreen host, manifest) — not started
- UI (Side Panel, options) — not started
- Resolvers (share-service link resolution, tiered) — not started
- Docs & research — `.claude/docs/INDEX.md`

## Pointers

- Product/scope decisions + architecture research: `~/.claude/projects/-Users-nadir-01dev-download-manager/memory/`
- PRD: `.claude/docs/prd-01-architecture.md`
- Prior-art analysis (Turbo Download Manager v2, full Explore report): summarized in
  memory `architecture-findings`; clone lives in session scratchpad (re-clone from
  github.com/inbasic/turbo-download-manager-v2 if needed).
