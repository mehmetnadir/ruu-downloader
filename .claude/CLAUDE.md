# Ruu Downloader — Proje Kimliği

**Ne:** Chromium (MV3) için modern minimal indirme yöneticisi eklentisi. Açık kaynak (MIT planlı).
**Stack:** TypeScript (strict, `any` yasak) + Vite + Preact (Side Panel UI). Test: Vitest + yerel throttled Range sunucusu + cdpilot E2E.
**Chrome minimum:** 116 (sidePanel, getContexts).

## Son Oturum
→ Detay: `.claude/session-journal/2026-08-16-1900-helper-takeover-version.md` | Tüm geçmiş: `.claude/session-journal/INDEX.md`
→ Durum: v0.6.3 hazır (136 unit · 20/20 E2E · 22 Go testi); yardımcı uygulama uçtan uca çalışıyor ve yayında (helper-v1.0.1)
→ İlk iş: WeTransfer "Takıldı" vakası — Nadir'in hata detay metnini al, kök nedeni kilitle (tahmin yaması YASAK)

## Hızlı Başlangıç

```
npm run build        # dist/ — geliştirici modunda buradan yükle (sürüm damgalanır)
npx vitest run       # 136 unit
./test/e2e/run.sh    # 20 senaryo, izole Chrome
node scripts/audit.mjs   # teknik borç denetimi (CI kapısı)
cd helper && go test -race ./...   # 22 Go testi
```

## Dosya Haritası

| Yapmak istediğin | Tam yol | Not |
|---|---|---|
| İndirme motoru | src/offscreen/engine.ts | Job sınıfı, rampa, yardımcı devri |
| Servis worker (yönlendirici) | src/sw.ts | devralma, teslim, yardımcı el sıkışma |
| Saf karar mantığı | src/engine/*.ts | ramp, queue, filename, allocator (hepsi unit testli) |
| Panel (izleme) | src/sidepanel/main.ts | aktif işler + geçmiş |
| Ayarlar (tam sayfa) | src/options/main.ts | 11 ayar + 28 servis + Beam |
| Yerel yardımcı | helper/*.go | fırlatıcı/sunucu ayrımı, launcher.go |
| Saha testleri | test/field/*.sh | gerçek host/ikili ile doğrulama |
| Yol haritası + kararlar | .claude/docs/prd-03-roadmap.md | gerekçeleriyle |
| Değişiklik geçmişi | .claude/docs/changelog.md | sürüm bazlı |

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
| WeTransfer "Takıldı" vakası | 🔴 AÇIK — kök neden yok, Nadir'in hata detayı bekleniyor |
| Windows install.ps1 doğrulaması | ⏳ Test ortamı yok |
| v0.6.3 CWS yüklemesi | ⏳ Nadir'in kararı (inceleme sırasını sıfırlar) |
| Faz 4a: Beam rölesi KV → Durable Object | Sırada |
| Faz 4b: WebRTC P2P · toplu indirme · zamanlama | Sırada |

Son Güncelleme: 2026-08-16
