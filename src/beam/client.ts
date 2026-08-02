/**
 * Beam istemcisi (uzantı tarafı) — röleyi yoklar, şifreli zarfları çözer,
 * içindeki URL'leri indirme kuyruğuna verir.
 *
 * MV3 notu: yoklama chrome.alarms ile yapılır — service worker uykuya dalsa da
 * alarm onu uyandırır (setTimeout uyandırmaz, sahada öğrenildi).
 * Teslim garantisi röleye değil BURAYA aittir: her zarfın id'si görülenler
 * kümesinde tutulur (KV nihai tutarlı, çift teslim olabiliyor).
 */
import { open, type Envelope, type Pairing } from './crypto';

export const BEAM_ALARM = 'ruu-beam-poll';
const SEEN_LIMIT = 200;

export interface BeamState {
  pairing?: Pairing;
  seen: string[];
  lastPoll?: number;
}

export async function loadState(): Promise<BeamState> {
  const s = await chrome.storage.local.get({ beam: { seen: [] } as BeamState });
  const st = s['beam'] as BeamState;
  return { ...st, seen: st.seen ?? [] };
}

export async function saveState(state: BeamState): Promise<void> {
  await chrome.storage.local.set({ beam: { ...state, seen: state.seen.slice(-SEEN_LIMIT) } });
}

/**
 * Röleyi bir kez yoklar; yeni (görülmemiş) zarflardan çıkan URL'leri döner.
 * Ağ hatası sessizce boş liste döndürür — yoklama döngüsü ölmemeli.
 */
export async function pollOnce(state: BeamState): Promise<string[]> {
  const p = state.pairing;
  if (!p) return [];
  let items: Envelope[] = [];
  try {
    const res = await fetch(`${p.relay}/p/${p.pairId}`, { cache: 'no-store' });
    if (!res.ok) return [];
    items = ((await res.json()) as { items?: Envelope[] }).items ?? [];
  } catch {
    return [];
  }

  const seen = new Set(state.seen);
  const urls: string[] = [];
  for (const env of items) {
    if (!env?.id || seen.has(env.id)) continue;
    seen.add(env.id);
    const plain = await open(p.keyB64, env);
    if (!plain) continue; // yanlış anahtar/bozuk zarf — sessizce atla
    for (const line of plain.split(/\s+/)) {
      if (/^https?:\/\//i.test(line)) urls.push(line);
    }
  }
  state.seen = [...seen];
  state.lastPoll = Date.now();
  return urls;
}
