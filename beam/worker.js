/**
 * Ruu Beam relay — Cloudflare Worker.
 *
 * Görevi SADECE kısa mesaj taşımak: telefon şifreli bir "zarf" bırakır, PC alır.
 * Worker içeriği ÇÖZEMEZ (AES-GCM anahtarı yalnız eşleşmiş cihazlarda).
 * Kalıcı depo yok — kuyruk KV'de 15 dakika TTL ile yaşar.
 *
 * POST /p/:pairId   {id, iv, data}  → kuyruğa ekle (en fazla 20 öğe)
 * GET  /p/:pairId                  → kuyruğu döndür ve boşaltmayı DENE
 *
 * DİKKAT — KV nihai tutarlıdır: yeni yazım anında görünmeyebilir, silme de
 * hemen yayılmaz (sahada ölçüldü: bir okuma boş, bir okuma çift teslim).
 * Bu yüzden "tam bir kez teslim" GARANTİSİ VERİLMEZ; istemci her zarfı `id`
 * ile tekilleştirir ve yoklamaya devam eder. Bu, ücretsiz tier'da doğru ödünç.
 * GET  /health                 → {ok:true}
 *
 * pairId: istemcide üretilen 22+ karakterlik rastgele kimlik (tahmin edilemez).
 */
const MAX_ITEMS = 20;
const TTL_SECONDS = 900;
const MAX_BODY = 4096;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'content-type',
};

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json', ...cors },
  });

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

    const url = new URL(request.url);
    if (url.pathname === '/health') return json({ ok: true });

    const m = url.pathname.match(/^\/p\/([A-Za-z0-9_-]{16,64})$/);
    if (!m) return json({ error: 'not found' }, 404);
    const key = `q:${m[1]}`;

    if (request.method === 'POST') {
      const raw = await request.text();
      if (raw.length > MAX_BODY) return json({ error: 'too large' }, 413);
      let env0;
      try {
        env0 = JSON.parse(raw);
      } catch {
        return json({ error: 'bad json' }, 400);
      }
      if (typeof env0?.iv !== 'string' || typeof env0?.data !== 'string'
        || typeof env0?.id !== 'string' || env0.id.length > 64) {
        return json({ error: 'bad envelope' }, 400);
      }
      const existing = (await env.BEAM.get(key, 'json')) ?? [];
      if (!existing.some((e) => e.id === env0.id)) {
        existing.push({ id: env0.id, iv: env0.iv, data: env0.data, t: Date.now() });
      }
      await env.BEAM.put(key, JSON.stringify(existing.slice(-MAX_ITEMS)), {
        expirationTtl: TTL_SECONDS,
      });
      return json({ ok: true, queued: existing.length });
    }

    if (request.method === 'GET') {
      const items = (await env.BEAM.get(key, 'json')) ?? [];
      if (items.length) await env.BEAM.delete(key); // tek teslim
      return json({ items });
    }

    return json({ error: 'method' }, 405);
  },
};
