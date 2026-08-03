#!/usr/bin/env bash
# Canlı rampa doğrulaması: izole Chrome → uzantı yükle → gerçek indirme → rampayı izle.
# Kullanım: ./test/field/ramp-live.sh <doğrudan-dosya-url>
set -euo pipefail
cd "$(dirname "$0")/../.."
URL="${1:?kullanım: ramp-live.sh <url>}"
free_port() { node -e "const n=require('net');const s=n.createServer();s.listen(0,()=>{console.log(s.address().port);s.close()})"; }
PORT=$(free_port); PROFILE=$(mktemp -d /tmp/ruu-live.XXXXXX)
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
# E2E dersi: nazik kapanış CDP ile yüklenmiş uzantının OPFS'ini siliyor → SIGKILL
cleanup() { pkill -9 -f "$PROFILE" 2>/dev/null || true; rm -rf "$PROFILE" 2>/dev/null || true; }
trap cleanup EXIT

npm run build >/dev/null
"$CHROME" --user-data-dir="$PROFILE" --remote-debugging-port="$PORT" \
  --enable-unsafe-extension-debugging --no-first-run --no-default-browser-check >/dev/null 2>&1 &
for i in $(seq 1 40); do curl -s -m 1 "http://localhost:$PORT/json/version" >/dev/null 2>&1 && break; sleep 0.5; done
EXT=$(node scripts/load-ext.mjs "$PORT" | sed -n 's/EXTENSION_ID=//p')
echo "uzantı: $EXT · CDP :$PORT"
node test/field/ramp-live.mjs "$PORT" "$EXT" "$URL"
