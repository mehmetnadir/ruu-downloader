#!/usr/bin/env bash
# Ruu E2E — tek komut: build → izole Chrome → uzantı yükle → 3 senaryo → bütünlük.
# Kullanım: ./test/e2e/run.sh          (varsayılan: görünür Chrome)
#           HEADLESS=1 ./test/e2e/run.sh
set -euo pipefail
cd "$(dirname "$0")/../.."

# Sabit port çakışması testleri flaky yapıyordu (bağımsız denetimde yakalandı):
# artık boş port aranır ve önceki koşumların artıkları temizlenir.
free_port() {
  node -e "const n=require('net');const s=n.createServer();s.listen(0,()=>{console.log(s.address().port);s.close()})"
}
pkill -f 'ruu-e2e-profile' 2>/dev/null || true
CDP_PORT="${CDP_PORT:-$(free_port)}"
SRV_PORT="${SRV_PORT:-$(free_port)}"
PROFILE="$(mktemp -d /tmp/ruu-e2e-profile.XXXXXX)"
DLDIR="$(mktemp -d /tmp/ruu-e2e-dl.XXXXXX)"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"

cleanup() {
  kill "$SRV_PID" 2>/dev/null || true
  pkill -f "$PROFILE" 2>/dev/null || true
  sleep 1
  rm -rf "$PROFILE" 2>/dev/null || true
  echo "İndirilenler (inceleme için korunur): $DLDIR"
}
trap cleanup EXIT

echo "── build + unit"
npm run build >/dev/null
npx vitest run --reporter=dot 2>&1 | tail -2

echo "── test sunucusu :$SRV_PORT"
node test/server/server.mjs "$SRV_PORT" & SRV_PID=$!
sleep 1

echo "── Chrome (CDP :$CDP_PORT)"
HEADLESS_FLAG=""
[ "${HEADLESS:-0}" = "1" ] && HEADLESS_FLAG="--headless=new"
# shellcheck disable=SC2086 — HEADLESS_FLAG bilinçli olarak sözcük bölünür
"$CHROME" $HEADLESS_FLAG \
  --user-data-dir="$PROFILE" \
  --remote-debugging-port="$CDP_PORT" \
  --enable-unsafe-extension-debugging \
  --no-first-run --no-default-browser-check >/dev/null 2>&1 &

# CDP hazır olana kadar bekle (max 20 sn)
for i in $(seq 1 40); do
  if curl -s -m 1 "http://localhost:$CDP_PORT/json/version" >/dev/null 2>&1; then break; fi
  sleep 0.5
  [ "$i" = "40" ] && { echo "Chrome CDP açılmadı"; exit 1; }
done

EXT_ID="$(node scripts/load-ext.mjs "$CDP_PORT" | sed -n 's/EXTENSION_ID=//p')"
echo "── uzantı: $EXT_ID"

echo "── senaryolar"
export RUU_CHROME="$CHROME" RUU_PROFILE="$PROFILE" RUU_HEADLESS="${HEADLESS:-0}" RUU_DIST="$PWD/dist"
node test/e2e/e2e-drive.mjs "$CDP_PORT" "$EXT_ID" "$SRV_PORT" "$DLDIR"
