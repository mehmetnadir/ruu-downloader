/**
 * Throttled Range test sunucusu (TDM server/ pattern'i).
 * Deterministik içerik: byte[i] = i % 251 → istemci tarafında bütünlük doğrulanabilir.
 *
 *   GET /f/:mb                     → :mb MiB'lik sahte dosya
 *   ?rate=8                        → MB/s hız limiti (bağlantı başına)
 *   ?noRange=1                     → Range desteğini kapat (native fallback testi)
 *   ?extra=N                       → istenen aralıktan N byte FAZLA gönder (quirk testi)
 *   ?dropAfter=0.5                 → aralığın %50'sinden sonra bağlantıyı kes (retry testi)
 *
 * Kullanım: node test/server/server.mjs [port]   (varsayılan 8917)
 */
import http from 'node:http';
import { createHash } from 'node:crypto';

const PORT = Number(process.argv[2] ?? process.env.PORT ?? 8917);
const CHUNK = 64 * 1024;
const reqCounts = new Map(); // key → istek sayısı (süresi-dolan-link simülasyonu)

function patternChunk(start, len) {
  const buf = Buffer.allocUnsafe(len);
  for (let i = 0; i < len; i++) buf[i] = (start + i) % 251;
  return buf;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  // Sahte paylaşım sayfası: onay → indir butonu → dosya (mail entegrasyonu E2E'si)
  // Sahte mail sayfası: içinde paylaşım linki olan bir e-posta (auto mod testi)
  const mm = url.pathname.match(/^\/mail\/(\d+)$/);
  if (mm) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(`<!doctype html>
<html><body><h2>Dosya paylaşıldı</h2>
<p>İndirme bağlantısı:
<a href="http://localhost:${PORT}/share/${mm[1]}">http://localhost:${PORT}/share/${mm[1]}</a></p>
</body></html>`);
    return;
  }

  // Süresi dolmuş paylaşım sayfası (uyarı akışı testi)
  if (url.pathname === '/share-expired') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(
      '<!doctype html><html><body><h1>Bu transferin süresi doldu</h1>' +
      '<p>Dosyalar artık kullanılamaz.</p><button>Tümünü İndir</button></body></html>');
    return;
  }

  const sm = url.pathname.match(/^\/share\/(\d+)$/);
  if (sm) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(`<!doctype html>
<html><body>
<h1>Paylaşılan dosya: test-${sm[1]}mb.bin</h1>
<button id="c">Onaylıyorum</button>
<script>
  document.getElementById('c').addEventListener('click', () => {
    document.getElementById('c').remove();
    const b = document.createElement('button');
    b.textContent = 'Tümünü İndir';
    b.addEventListener('click', () => { location.href = '/f/${sm[1]}?rate=30&share=1'; });
    document.body.appendChild(b);
  });
</script>
</body></html>`);
    return;
  }

  const m = url.pathname.match(/^\/f\/(\d+)$/);
  if (!m) {
    res.writeHead(404).end('yok');
    return;
  }
  const size = Number(m[1]) * 1024 * 1024;
  const rate = Number(url.searchParams.get('rate') ?? 0) * 1024 * 1024; // B/s
  // ?probeDelay=ms → ilk baytı geciktirir. İptal-sırasında-probe yarışını
  // deterministik biçimde tetiklemek için (S13).
  const probeDelay = Number(url.searchParams.get('probeDelay') ?? 0);

  // ?key=X&failAfterReq=N → aynı key'e N istekten sonra 403 HTML (imzalı URL süresi doldu)
  const key = url.searchParams.get('key');
  const failAfterReq = Number(url.searchParams.get('failAfterReq') ?? 0);
  if (key && failAfterReq > 0) {
    const c = (reqCounts.get(key) ?? 0) + 1;
    reqCounts.set(key, c);
    if (c > failAfterReq) {
      res.writeHead(403, { 'Content-Type': 'text/html' }).end('<html>link expired</html>');
      return;
    }
  }
  // ?cd=<ad> → Content-Disposition ile ad dayat (bozuk/Türkçe adları sınamak için)
  const cdName = url.searchParams.get('cd');
  if (probeDelay > 0) {
    await new Promise((r) => setTimeout(r, probeDelay));
  }
  // ?digest=1 → doğru sha-256, ?digest=bad → kasten yanlış (RFC 9530)
  const digestMode = url.searchParams.get('digest');
  let digestHeader;
  if (digestMode) {
    if (digestMode === 'bad') {
      digestHeader = 'sha-256=:' + Buffer.alloc(32, 7).toString('base64') + ':';
    } else {
      const h = createHash('sha256');
      for (let off = 0; off < size; off += CHUNK) {
        h.update(patternChunk(off, Math.min(CHUNK, size - off)));
      }
      digestHeader = 'sha-256=:' + h.digest('base64') + ':';
    }
  }

  const noRange = url.searchParams.get('noRange') === '1';
  const extra = Number(url.searchParams.get('extra') ?? 0);
  const dropAfter = Number(url.searchParams.get('dropAfter') ?? 0);

  let start = 0;
  let end = size - 1;
  const range = req.headers.range;

  if (range && !noRange) {
    const rm = range.match(/bytes=(\d*)-(\d*)/);
    if (rm) {
      if (rm[1] !== '') start = Number(rm[1]);
      if (rm[2] !== '') end = Math.min(Number(rm[2]), size - 1);
      if (start > end || start >= size) {
        res.writeHead(416, { 'Content-Range': `bytes */${size}` }).end();
        return;
      }
    }
    res.writeHead(206, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(end - start + 1 + extra),
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Accept-Ranges': 'bytes',
      'Content-Disposition': cdName
        ? `attachment; filename*=UTF-8''${encodeURIComponent(cdName)}`
        : `attachment; filename="test-${m[1]}mb.bin"`,
      ...(digestHeader ? { 'Repr-Digest': digestHeader } : {}),
    });
  } else {
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(size),
      ...(noRange ? {} : { 'Accept-Ranges': 'bytes' }),
      'Content-Disposition': cdName
        ? `attachment; filename*=UTF-8''${encodeURIComponent(cdName)}`
        : `attachment; filename="test-${m[1]}mb.bin"`,
    });
  }

  const totalToSend = end - start + 1 + extra;
  // Kesinti sadece büyük isteklerde — probe (Range: 0-0) etkilenmesin
  const dropAt = dropAfter > 0 && totalToSend > 2 * 1024 * 1024
    ? Math.floor(totalToSend * dropAfter)
    : Infinity;
  let sent = 0;
  const t0 = Date.now();

  while (sent < totalToSend) {
    if (sent >= dropAt) {
      res.destroy(); // kasıtlı kesinti
      return;
    }
    const len = Math.min(CHUNK, totalToSend - sent);
    const ok = res.write(patternChunk(start + sent, len));
    sent += len;
    if (!ok) await new Promise((r) => res.once('drain', r));
    if (rate > 0) {
      const expectedMs = (sent / rate) * 1000;
      const aheadMs = expectedMs - (Date.now() - t0);
      if (aheadMs > 5) await new Promise((r) => setTimeout(r, aheadMs));
    }
  }
  res.end();
});

server.listen(PORT, () => {
  console.log(`Ruu test sunucusu: http://localhost:${PORT}/f/100?rate=8`);
});
