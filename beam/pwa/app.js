/**
 * Ruu Beam PWA — telefon tarafı.
 * QR ile eşleşir, bağlantıyı AES-GCM ile şifreleyip röleye bırakır.
 * Android'de "Paylaş → Ruu Beam" ile de çalışır (Web Share Target, manifest).
 * Anahtar cihazda kalır; röle yalnızca şifreli zarfı görür.
 */
const $ = (s) => document.querySelector(s);
const KEY = 'ruu-beam-pairing';

// ── kripto (uzantıdaki src/beam/crypto.ts ile birebir aynı zarf biçimi) ─────
const b64u = {
  enc(buf) {
    const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    let s = ''; for (const x of b) s += String.fromCharCode(x);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  dec(str) {
    const s = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
    const o = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) o[i] = s.charCodeAt(i);
    return o;
  },
};
const randomId = (n = 12) => b64u.enc(crypto.getRandomValues(new Uint8Array(n)));

async function seal(keyB64, plain) {
  const key = await crypto.subtle.importKey('raw', b64u.dec(keyB64), 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plain));
  return { id: randomId(), iv: b64u.enc(iv), data: b64u.enc(data) };
}

function decodePairing(s) {
  if (!s?.startsWith('ruu:')) return null;
  try {
    const p = JSON.parse(new TextDecoder().decode(b64u.dec(s.slice(4))));
    return p.relay && p.pairId && p.keyB64 ? p : null;
  } catch { return null; }
}

// ── durum ───────────────────────────────────────────────────────────────────
let pairing = null;
try { pairing = JSON.parse(localStorage.getItem(KEY) ?? 'null'); } catch { /* bozuksa yok say */ }

const status = (el, text, ok) => {
  el.innerHTML = text ? `<div class="status ${ok ? 'ok' : 'err'}">${text}</div>` : '';
};

function render() {
  const paired = Boolean(pairing);
  $('#pair-card').classList.toggle('hide', paired);
  $('#send-card').classList.toggle('hide', !paired);
  if (paired) $('#paired-info').textContent = `Eşleşti · ${new URL(pairing.relay).hostname}`;
}

function setPairing(p) {
  if (!p) { status($('#pair-status'), 'Eşleştirme metni okunamadı', false); return; }
  pairing = p;
  localStorage.setItem(KEY, JSON.stringify(p));
  stopCamera();
  render();
  // Paylaş menüsünden gelen bağlantı varsa kutuya koy
  const shared = new URLSearchParams(location.search).get('url')
    ?? new URLSearchParams(location.search).get('text');
  if (shared) $('#url').value = shared;
}

// ── QR okuma (BarcodeDetector varsa; yoksa elle yapıştırma) ────────────────
let stream = null;
function stopCamera() {
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  $('#cam').classList.add('hide');
}

$('#scan').addEventListener('click', async () => {
  if (!('BarcodeDetector' in window)) {
    status($('#pair-status'), 'Bu tarayıcıda QR okuyucu yok — metni yapıştır', false);
    return;
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
  } catch {
    status($('#pair-status'), 'Kamera izni verilmedi', false);
    return;
  }
  const video = $('#cam');
  video.classList.remove('hide');
  video.srcObject = stream;
  await video.play();
  const detector = new BarcodeDetector({ formats: ['qr_code'] });
  const tick = async () => {
    if (!stream) return;
    try {
      const codes = await detector.detect(video);
      const hit = codes.map((c) => c.rawValue).find((v) => v?.startsWith('ruu:'));
      if (hit) { setPairing(decodePairing(hit)); return; }
    } catch { /* kare atlandı */ }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});

$('#paste').addEventListener('click', () => setPairing(decodePairing($('#manual').value.trim())));
$('#unpair').addEventListener('click', () => {
  pairing = null; localStorage.removeItem(KEY); render();
});

// ── gönderme ────────────────────────────────────────────────────────────────
async function send(url) {
  if (!pairing || !/^https?:\/\//i.test(url)) {
    status($('#send-status'), 'Geçerli bir bağlantı gir', false);
    return;
  }
  status($('#send-status'), 'Gönderiliyor…', true);
  try {
    const env = await seal(pairing.keyB64, url);
    const r = await fetch(`${pairing.relay}/p/${pairing.pairId}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(env),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    status($('#send-status'), 'Gönderildi — bilgisayarında birazdan inmeye başlar', true);
    $('#url').value = '';
  } catch (e) {
    status($('#send-status'), `Gönderilemedi: ${e.message}`, false);
  }
}
$('#send').addEventListener('click', () => send($('#url').value.trim()));

// Paylaş menüsünden gelen bağlantı (Web Share Target → GET ?url=/?text=)
const q = new URLSearchParams(location.search);
const shared = q.get('url') ?? q.get('text');
if (shared) {
  $('#url').value = shared;
  if (pairing) void send(shared); // eşleşmişse doğrudan yolla
}

render();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/app/sw.js').catch(() => undefined);
