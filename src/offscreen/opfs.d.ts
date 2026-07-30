/**
 * OPFS sync access handle tipleri — TS DOM lib'i bunları yalnızca WebWorker
 * lib'inde tanımlar; tek tsconfig kullandığımız için burada ambient tanımlanır.
 */
interface FileSystemSyncAccessHandle {
  read(buffer: ArrayBufferView, options?: { at?: number }): number;
  write(buffer: ArrayBufferView, options?: { at?: number }): number;
  truncate(size: number): void;
  getSize(): number;
  flush(): void;
  close(): void;
}

interface FileSystemFileHandle {
  createSyncAccessHandle(): Promise<FileSystemSyncAccessHandle>;
}
