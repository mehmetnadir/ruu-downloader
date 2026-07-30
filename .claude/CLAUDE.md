# Ruu Downloader — Proje Kimliği

**Ne:** Chromium (MV3) için modern minimal indirme yöneticisi eklentisi. Açık kaynak (MIT planlı).
**Stack:** TypeScript (strict, `any` yasak) + Vite + Preact (Side Panel UI). Test: Vitest + yerel throttled Range sunucusu + cdpilot E2E.
**Chrome minimum:** 116 (sidePanel, getContexts).

## Hızlı Başlangıç

Henüz kod yok — mimari fazında. PRD onay akışı: `.claude/docs/prd-01-architecture.md`.

## Dosya Haritası

| Yapmak istediğin | Tam yol | Not |
|---|---|---|
| PRD / mimari oku | .claude/docs/prd-01-architecture.md | Parça 1: mimari+izin+veri modeli |
| Kapsam kararları | ~/.claude/projects/-Users-nadir-01dev-download-manager/memory/ | scope + architecture-findings |

## Dikkat Edilecekler

- **Video/stream yakalama KAPSAM DIŞI** — asla önerme (HLS/DASH sniffing yok; sadece doğrudan dosya linki).
- Motor service worker'da DEĞİL — offscreen document + dedicated disk worker (OPFS sync access handle sadece worker'da çalışır).
- Segmentler OPFS'e positioned write ile yazılır — blob merge fazı YASAK.
- cdpilot runtime bağımlılığı YASAK — sadece E2E testte.
- **TEST ATLAMAK YASAK (Nadir'in açık talimatı):** her parça Vitest unit + throttled Range sunucusuyla entegrasyon + cdpilot E2E ile kapanır. Spike'lar bile çalıştırılabilir doğrulama içerir.
- CWS izin minimalizmi: clipboardRead yok, content script sadece mail domain'leri.

## Aktif Çalışma

| İş | Durum |
|---|---|
| PRD Parça 1 (mimari+izin+veri modeli) | ✅ Onaylandı (2026-07-30) |
| OPFS dayanıklılık spike'ı | Sırada |
| WeTransfer resolver PoC | Sırada |

Son Güncelleme: 2026-07-30
