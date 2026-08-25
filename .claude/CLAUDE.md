# Ruu Downloader — Proje Kimliği

**Ne:** Chromium (MV3) için modern minimal indirme yöneticisi eklentisi. Açık kaynak (MIT planlı).
**Stack:** TypeScript (strict, `any` yasak) + Vite + Preact (Side Panel UI). Test: Vitest + yerel throttled Range sunucusu + cdpilot E2E.
**Chrome minimum:** 116 (sidePanel, getContexts).

## Son Oturum
→ Detay: `.claude/session-journal/2026-08-24-1700-wetransfer-preflight-sorting.md` | Tüm geçmiş: `.claude/session-journal/INDEX.md`
→ Durum: v0.6.4 paketlendi, gate'ler yeşil (181 unit · 24/24 E2E · 22 Go testi); WeTransfer kök nedeni KANITLANDI ve kapandı
→ İlk iş: Nadir'in kararı — WeTransfer'i Ruu ile hızlandırmak (direct_link yakalama; 206×3 doğrulandı) + v0.6.4'ü gerçek tarayıcıda doğrulaması

## Hızlı Başlangıç

```
npm run build        # dist/ — geliştirici modunda buradan yükle (sürüm damgalanır)
npx vitest run       # 181 unit
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
| WeTransfer "Takıldı" vakası | ✅ KAPANDI v0.6.4 — POST ile doğan indirme, GET ile yeniden istenemiyor; ön-uçuş eklendi |
| WeTransfer'i Ruu ile hızlandırma (direct_link yakalama) | ⏳ Nadir'in kararı — API'nin verdiği link Range destekliyor (206 doğrulandı) |
| Windows install.ps1 doğrulaması | ⏳ Test ortamı yok |
| v0.6.4 CWS yüklemesi | ⏳ Nadir'in kararı (inceleme sırasını sıfırlar) |
| Faz 4a: Beam rölesi KV → Durable Object | Sırada |
| Faz 4b: WebRTC P2P · toplu indirme · zamanlama | Sırada |

Son Güncelleme: 2026-08-25
