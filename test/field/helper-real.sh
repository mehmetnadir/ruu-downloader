#!/usr/bin/env bash
# GERÇEK ZİNCİR testi: Chrome connectNative ile GERÇEK kurulu ikiliyi başlatır,
# el sıkışma native-messaging'den gelir (enjeksiyon YOK), iş devredilir ve dosya
# GERÇEK ~/Downloads dizinine yazılır.
#
# İzin penceresi CDP ile tıklanamadığı için (belgeli kapsam sınırı) test
# kopyasında nativeMessaging ZORUNLU izne alınır — pencere hiç çıkmaz, kalan
# her halka gerçektir. Kurulu NM manifest'ine test kimliği GEÇİCİ eklenir ve
# script çıkarken GERİ DÖNDÜRÜLÜR.
set -euo pipefail
cd "$(dirname "$0")/../.."
free_port(){ node -e "const n=require('net');const s=n.createServer();s.listen(0,()=>{console.log(s.address().port);s.close()})"; }
P=$(free_port); SRV=$(free_port)
PROF=$(mktemp -d /tmp/ruu-real.XXXXXX)
EXTDIR=$(mktemp -d /tmp/ruu-real-ext.XXXXXX)
# ÖNEMLİ SAHA BULGUSU: Mac'te Chrome NM manifest'lerini --user-data-dir'in
# ALTINDA arar (<profil>/NativeMessagingHosts). Yani izole test Chrome'u,
# ~/Library/.../Chrome/NativeMessagingHosts'a kurulu gerçek manifest'i
# GÖREMEZ — "Specified native messaging host not found" bunun sonucuydu.
# Gerçek Chrome (Default konum) kurulu manifest'i bulur; test için manifest'in
# bir kopyası izole profile yazılır ve GERÇEK kurulu ikiliye işaret eder.
# Gerçek manifest'e dokunulmaz.
BIN="$HOME/.local/bin/ruu-helper"
cleanup(){
  kill "$SRV_PID" 2>/dev/null || true
  pkill -9 -f "$PROF" 2>/dev/null || true
  rm -rf "$PROF" "$EXTDIR" 2>/dev/null || true
}
trap cleanup EXIT

[ -x "$BIN" ] || { echo "kurulu ikili yok: $BIN — önce helper/install.sh"; exit 1; }

npm run build >/dev/null
cp -R dist/ "$EXTDIR/"
# test kopyası: nativeMessaging zorunlu izin (pencere çıkmasın — tek fark bu)
python3 - "$EXTDIR/manifest.json" <<'PY'
import json,sys
p=sys.argv[1]; d=json.load(open(p))
d['permissions']=list(dict.fromkeys([*d.get('permissions',[]),'nativeMessaging']))
d['optional_permissions']=[x for x in d.get('optional_permissions',[]) if x!='nativeMessaging']
json.dump(d,open(p,'w'),indent=2)
PY

node test/server/server.mjs "$SRV" & SRV_PID=$!
sleep 1
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --user-data-dir="$PROF" \
  --remote-debugging-port="$P" --enable-unsafe-extension-debugging \
  --no-first-run --no-default-browser-check >/dev/null 2>&1 &
for i in $(seq 1 40); do curl -s -m 1 "http://localhost:$P/json/version" >/dev/null 2>&1 && break; sleep 0.5; done
EXT=$(RUU_DIST="$EXTDIR" node scripts/load-ext.mjs "$P" "$EXTDIR" | sed -n 's/EXTENSION_ID=//p')
echo "── test eklentisi: $EXT"

# izole profile, GERÇEK ikiliye işaret eden manifest yaz
mkdir -p "$PROF/NativeMessagingHosts"
cat > "$PROF/NativeMessagingHosts/com.ruu.downloader.helper.json" <<JSON
{
  "name": "com.ruu.downloader.helper",
  "description": "Ruu helper (gercek ikili, test manifesti)",
  "path": "$BIN",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$EXT/"]
}
JSON

node test/field/helper-real.mjs "$P" "$EXT" "$SRV"
