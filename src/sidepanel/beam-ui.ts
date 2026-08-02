/**
 * Panel — Beam eşleştirme arayüzü.
 * QR yalnızca KONTROL kanalıdır (karar 2026-08-02): eşleştirme bilgisi taşır,
 * dosya taşımaz. QR içeriği: relay + pairId + AES-GCM anahtarı — anahtar hiçbir
 * sunucuya gitmez, yalnızca ekrandan telefona geçer.
 */
import qrcode from 'qrcode-generator';
import { createPairing, encodePairing, type Pairing } from '../beam/crypto';

const RELAY = 'https://ruu-beam.nadir-zai-proxy.workers.dev';
const t = (k: string): string => chrome.i18n.getMessage(k) || k;

function drawQr(text: string, size = 168): HTMLCanvasElement {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const count = qr.getModuleCount();
  const scale = Math.max(2, Math.floor(size / count));
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = count * scale;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000';
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (qr.isDark(r, c)) ctx.fillRect(c * scale, r * scale, scale, scale);
    }
  }
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', t('beamPair'));
  return canvas;
}

export function initBeamUi(container: HTMLElement): void {
  const render = (state: { pairing?: Pairing }): void => {
    container.innerHTML = '';
    if (!state.pairing) {
      const btn = document.createElement('button');
      btn.id = 'beam-pair';
      btn.className = 'btn-ghost';
      btn.textContent = t('beamPair');
      btn.addEventListener('click', () => { void startPairing(); });
      container.append(btn);
      return;
    }
    const wrap = document.createElement('div');
    wrap.className = 'beam-qr';
    wrap.append(drawQr(encodePairing(state.pairing)));
    const hint = document.createElement('p');
    hint.className = 'svc-desc';
    hint.style.textAlign = 'center';
    hint.textContent = `${RELAY}/app`; // telefonda elle açmak isteyen için
    wrap.append(hint);
    const row = document.createElement('div');
    row.className = 'beam-state';
    row.innerHTML = `<span class="ok">${t('beamPaired')} · ${t('beamWaiting')}</span>`;
    const un = document.createElement('button');
    un.id = 'beam-unpair';
    un.className = 'btn-ghost';
    un.textContent = t('beamUnpair');
    un.addEventListener('click', () => {
      void chrome.runtime.sendMessage({ target: 'sw', type: 'beam-unpair' });
    });
    row.append(un);
    container.append(wrap, row);
  };

  const startPairing = async (): Promise<void> => {
    const pairing = await createPairing(RELAY);
    await chrome.runtime.sendMessage({ target: 'sw', type: 'beam-pair', pairing });
    render({ pairing });
  };

  void chrome.storage.local.get({ beam: {} }).then((s) => render(s['beam'] as { pairing?: Pairing }));
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area === 'local' && ch['beam']) render((ch['beam'].newValue ?? {}) as { pairing?: Pairing });
  });
}
