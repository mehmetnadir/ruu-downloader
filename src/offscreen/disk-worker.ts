/**
 * Disk Worker — OPFS positioned write.
 * createSyncAccessHandle SADECE dedicated worker'da çalışır; motorun ayrı
 * worker'da olmasının tek sebebi bu. Segmentler nihai byte konumuna yazılır,
 * merge fazı yoktur.
 */

interface InitMsg { type: 'init'; jobId: string; size: number }
interface WriteMsg { type: 'write'; offset: number; buf: Uint8Array }
interface FinalizeMsg { type: 'finalize' }
interface AbortMsg { type: 'abort' }
type InMsg = InitMsg | WriteMsg | FinalizeMsg | AbortMsg;

const FLUSH_EVERY_BYTES = 32 << 20; // 32 MiB'de bir flush — crash penceresini sınırlar

let handle: FileSystemSyncAccessHandle | null = null;
let jobId = '';
let unflushed = 0;

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
        const fh = await dir.getFileHandle(jobId, { create: true });
        handle = await fh.createSyncAccessHandle();
        handle.truncate(msg.size);
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
        post({ type: 'wrote', bytes: msg.buf.byteLength });
        break;
      }
      case 'finalize': {
        if (!handle) throw new Error('finalize before init');
        handle.flush();
        handle.close();
        handle = null;
        post({ type: 'finalized' });
        break;
      }
      case 'abort': {
        try {
          handle?.flush();
          handle?.close();
        } catch { /* kapanmışsa sorun değil */ }
        handle = null;
        if (jobId) {
          const dir = await getJobsDir();
          await dir.removeEntry(jobId).catch(() => undefined);
        }
        post({ type: 'aborted' });
        break;
      }
    }
  } catch (err) {
    post({ type: 'disk-error', error: err instanceof Error ? err.message : String(err) });
  }
};
