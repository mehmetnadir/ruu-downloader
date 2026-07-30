/**
 * Disk Worker — OPFS positioned write + meta sidecar.
 * createSyncAccessHandle SADECE dedicated worker'da çalışır; motorun ayrı
 * worker'da olmasının tek sebebi bu. Segmentler nihai byte konumuna yazılır,
 * merge fazı yoktur. Meta (jobs/<id>.meta) crash-resume aralık günlüğüdür.
 */

interface InitMsg { type: 'init'; jobId: string; size: number; fresh: boolean }
interface WriteMsg { type: 'write'; offset: number; buf: Uint8Array }
interface MetaMsg { type: 'meta'; json: string }
interface FinalizeMsg { type: 'finalize' }
interface AbortMsg { type: 'abort' }
type InMsg = InitMsg | WriteMsg | MetaMsg | FinalizeMsg | AbortMsg;

const FLUSH_EVERY_BYTES = 32 << 20; // 32 MiB'de bir flush — crash penceresini sınırlar

let handle: FileSystemSyncAccessHandle | null = null;
let metaHandle: FileSystemSyncAccessHandle | null = null;
let jobId = '';
let unflushed = 0;
const textEncoder = new TextEncoder();

const post = (msg: Record<string, unknown>) => (self as unknown as Worker).postMessage(msg);

async function getJobsDir(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle('jobs', { create: true });
}

self.onmessage = async (ev: MessageEvent<InMsg>) => {
  const msg = ev.data;
  try {
    switch (msg.type) {
      case 'init': {
        jobId = msg.jobId;
        const dir = await getJobsDir();
        const fh = await dir.getFileHandle(jobId, { create: msg.fresh });
        handle = await fh.createSyncAccessHandle();
        if (msg.fresh) {
          handle.truncate(msg.size);
        } else if (handle.getSize() !== msg.size) {
          // yarım truncate/uyumsuz dosya → güvenli yol: sıfırdan başla
          handle.truncate(msg.size);
          post({ type: 'size-mismatch' });
          const mfh = await dir.getFileHandle(`${jobId}.meta`, { create: true });
          metaHandle = await mfh.createSyncAccessHandle();
          break;
        }
        const mfh = await dir.getFileHandle(`${jobId}.meta`, { create: true });
        metaHandle = await mfh.createSyncAccessHandle();
        post({ type: 'ready' });
        break;
      }
      case 'write': {
        if (!handle) throw new Error('write before init');
        handle.write(msg.buf, { at: msg.offset });
        unflushed += msg.buf.byteLength;
        if (unflushed >= FLUSH_EVERY_BYTES) {
          handle.flush();
          unflushed = 0;
        }
        post({ type: 'wrote', offset: msg.offset, bytes: msg.buf.byteLength });
        break;
      }
      case 'meta': {
        if (!metaHandle) break;
        const buf = textEncoder.encode(msg.json);
        metaHandle.truncate(0);
        metaHandle.write(buf, { at: 0 });
        metaHandle.flush();
        break;
      }
      case 'finalize': {
        if (!handle) throw new Error('finalize before init');
        handle.flush();
        handle.close();
        handle = null;
        metaHandle?.close();
        metaHandle = null;
        post({ type: 'finalized' });
        break;
      }
      case 'abort': {
        try {
          handle?.close();
          metaHandle?.close();
        } catch { /* kapanmışsa sorun değil */ }
        handle = null;
        metaHandle = null;
        if (jobId) {
          const dir = await getJobsDir();
          await dir.removeEntry(jobId).catch(() => undefined);
          await dir.removeEntry(`${jobId}.meta`).catch(() => undefined);
        }
        post({ type: 'aborted' });
        break;
      }
    }
  } catch (err) {
    post({ type: 'disk-error', error: err instanceof Error ? err.message : String(err) });
  }
};
