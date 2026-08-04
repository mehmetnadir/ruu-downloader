#!/usr/bin/env bash
# Yardımcı uygulama GERÇEKTEN devreye giriyor mu?
#
# Derlenmesi çalıştığı anlamına gelmez. Bu script gerçek ikiliyi izole bir
# Chrome profiline kurar (kullanıcının asıl Chrome'una DOKUNMAZ — özel
# --user-data-dir kullanıldığında Chrome native-messaging manifest'ini o
# dizinin içinde arar) ve indirmenin yardımcı üzerinden indiğini doğrular.
set -euo pipefail
cd "$(dirname "$0")/../.."
free_port() { node -e "const n=require('net');const s=n.createServer();s.listen(0,()=>{console.log(s.address().port);s.close()})"; }
PORT=$(free_port); SRV=$(free_port)
PROFILE=$(mktemp -d /tmp/ruu-helper-e2e.XXXXXX)
DL=$(mktemp -d /tmp/ruu-helper-dl.XXXXXX)
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
cleanup() {
  kill "$SRV_PID" 2>/dev/null || true
  pkill -9 -f "$PROFILE" 2>/dev/null || true
  pkill -9 -f "ruu-helper-test" 2>/dev/null || true
  rm -rf "$PROFILE" 2>/dev/null || true
  echo "indirilenler: $DL"
}
trap cleanup EXIT

echo "── yardımcı derleniyor"
BIN="$PROFILE/ruu-helper-test"
(cd helper && CGO_ENABLED=0 go build -trimpath -o "$BIN" .)

echo "── uzantı derleniyor"
npm run build >/dev/null
node test/server/server.mjs "$SRV" & SRV_PID=$!
sleep 1

"$CHROME" --user-data-dir="$PROFILE" --remote-debugging-port="$PORT" \
  --enable-unsafe-extension-debugging --no-first-run --no-default-browser-check >/dev/null 2>&1 &
for i in $(seq 1 40); do curl -s -m 1 "http://localhost:$PORT/json/version" >/dev/null 2>&1 && break; sleep 0.5; done
EXT=$(node scripts/load-ext.mjs "$PORT" | sed -n 's/EXTENSION_ID=//p')
echo "── uzantı: $EXT"

# NOT: izin penceresi otomasyonla tıklanamadığı için native-messaging
# el sıkışması bu koşumda SÜRÜLMEZ (bkz. helper-live.mjs kapsam sınırı);
# yardımcı doğrudan başlatılır. Manifest yine de yazılır ki elle deneyebilesin.
NM="$PROFILE/NativeMessagingHosts"
mkdir -p "$NM"
cat > "$NM/com.ruu.downloader.helper.json" <<JSON
{
  "name": "com.ruu.downloader.helper",
  "description": "Ruu Downloader helper (test)",
  "path": "$BIN",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$EXT/"]
}
JSON
# Yardımcı indirmeleri buraya yazsın
cat > "$PROFILE/helper-wrapper.sh" <<WRAP
#!/bin/sh
exec "$BIN" -handshake -dir "$DL"
WRAP
chmod +x "$PROFILE/helper-wrapper.sh"
python3 - "$NM/com.ruu.downloader.helper.json" "$PROFILE/helper-wrapper.sh" <<'PY'
import json,sys
p,wrapper=sys.argv[1],sys.argv[2]
d=json.load(open(p)); d['path']=wrapper
json.dump(d,open(p,'w'),indent=2)
PY
echo "── native-messaging manifest yazıldı (izole profil)"

node test/field/helper-live.mjs "$PORT" "$EXT" "$SRV" "$DL" "$BIN"
