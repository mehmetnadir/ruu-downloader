#!/bin/bash
# cws-publish.sh — Ruu Downloader'ı Chrome Web Store'a yükler.
# İlk çalıştırma: yeni öğe OLUŞTURUR (POST /items) → item id scripts/.cws-item'a yazılır.
# Sonrakiler: mevcut öğeye yeni sürüm (PUT /items/<id>) + publish (review'a düşer).
#
# Sırlar: yayincilik-ext ile AYNI Google hesabı — oradaki .cws-secrets kullanılır
# (CWS_CLIENT_ID, CWS_CLIENT_SECRET, CWS_REFRESH_TOKEN). Yereldeki scripts/.cws-secrets
# varsa o öncelikli. Sır dosyaları gitignore'dadır, repo'ya asla girmez.
#
# Kullanım: ./scripts/cws-publish.sh [zip]   (zip verilmezse npm run package çıktısı)
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
ITEM_FILE="$HERE/.cws-item"

# --- sırlar ---
for f in "$HERE/.cws-secrets" "$HOME/01dev/yayincilik-ext/scripts/.cws-secrets"; do
  if [ -f "$f" ]; then . "$f"; break; fi
done
: "${CWS_CLIENT_ID:?CWS_CLIENT_ID yok (.cws-secrets bulunamadı)}"
: "${CWS_CLIENT_SECRET:?CWS_CLIENT_SECRET yok}"
: "${CWS_REFRESH_TOKEN:?CWS_REFRESH_TOKEN yok}"

# --- zip ---
ZIP="${1:-}"
if [ -z "$ZIP" ]; then
  VER=$(python3 -c "import json;print(json.load(open('$ROOT/package.json'))['version'])")
  ZIP="$ROOT/out/ruu-downloader-v${VER}.zip"
  [ -f "$ZIP" ] || ( cd "$ROOT" && node scripts/package.mjs )
fi
[ -f "$ZIP" ] || { echo "zip bulunamadı: $ZIP"; exit 1; }
echo "paket: $ZIP"

# --- access token ---
echo "→ access token alınıyor…"
ACCESS=$(curl -s "https://oauth2.googleapis.com/token" \
  -d "client_id=${CWS_CLIENT_ID}" -d "client_secret=${CWS_CLIENT_SECRET}" \
  -d "refresh_token=${CWS_REFRESH_TOKEN}" -d "grant_type=refresh_token" \
  | python3 -c "import sys,json;print(json.load(sys.stdin).get('access_token',''))")
[ -n "$ACCESS" ] || { echo "access token alınamadı — refresh_token geçersiz olabilir"; exit 1; }

if [ ! -f "$ITEM_FILE" ]; then
  # --- İLK YAYIN: yeni öğe oluştur ---
  echo "→ YENİ öğe oluşturuluyor (ilk yükleme)…"
  RES=$(curl -s -X POST -H "Authorization: Bearer $ACCESS" -H "x-goog-api-version: 2" \
    -T "$ZIP" "https://www.googleapis.com/upload/chromewebstore/v1.1/items")
  echo "$RES" | python3 -c "
import sys,json
d=json.load(sys.stdin)
iid=d.get('id',''); st=d.get('uploadState','')
print('  uploadState:', st, '| id:', iid or '—')
if not iid:
    print('  HATA:', json.dumps(d.get('itemError') or d, ensure_ascii=False)); raise SystemExit(1)
open('$ITEM_FILE','w').write(iid)
"
  echo "✓ Öğe oluşturuldu: $(cat "$ITEM_FILE")"
  echo "  NOT: İlk yayın öncesi dashboard'da tamamlanması gerekenler (tek seferlik):"
  echo "  ekran görüntüleri + kategori + Privacy sekmesi (PRIVACY.md hazır)."
  echo "  https://chrome.google.com/webstore/devconsole → öğe: $(cat "$ITEM_FILE")"
  exit 0
fi

ITEM_ID="$(cat "$ITEM_FILE")"
echo "öğe: $ITEM_ID"

# --- güncelleme yükle ---
echo "→ yeni sürüm yükleniyor…"
UP=$(curl -s -X PUT -H "Authorization: Bearer $ACCESS" -H "x-goog-api-version: 2" \
  -T "$ZIP" "https://www.googleapis.com/upload/chromewebstore/v1.1/items/${ITEM_ID}")
echo "$UP" | python3 -c "
import sys,json
d=json.load(sys.stdin)
st=d.get('uploadState')
print('  uploadState:', st)
if st in ('SUCCESS','IN_PROGRESS'): raise SystemExit(0)
err=d.get('itemError',[]) or []
code=(err[0].get('error_code','') if err else '')
if code=='ITEM_NOT_UPDATABLE':
    print('  GATE: önceki sürüm hâlâ incelemede — şu an gönderilmedi (CWS kuralı).')
    raise SystemExit(2)
print('  HATA:', json.dumps(err or d, ensure_ascii=False)); raise SystemExit(1)
" || { rc=$?; [ "$rc" = "2" ] && exit 2 || exit 1; }

# --- publish ---
echo "→ yayına gönderiliyor…"
curl -s -X POST -H "Authorization: Bearer $ACCESS" -H "x-goog-api-version: 2" \
  -H "Content-Length: 0" "https://www.googleapis.com/chromewebstore/v1.1/items/${ITEM_ID}/publish" \
  | python3 -c "
import sys,json
d=json.load(sys.stdin)
print('  status:', d.get('status'))
if d.get('statusDetail'): print('  detay:', d['statusDetail'])
"
echo "✓ Sürüm review'a düştü."
