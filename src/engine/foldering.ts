/**
 * Tür bazlı klasörleme (PRD-3 #6): dosya uzantısına göre Downloads altında
 * Ruu/<kategori>/ alt klasörü. Saf fonksiyon — unit test edilir.
 * Kategori adları çağıran tarafça yerelleştirilir (SW chrome.i18n kullanır).
 */
const KEY_BY_EXT: Record<string, string> = {
  jpg: 'catImg', jpeg: 'catImg', png: 'catImg', gif: 'catImg',
  webp: 'catImg', svg: 'catImg', heic: 'catImg', avif: 'catImg',
  mp4: 'catVid', mkv: 'catVid', webm: 'catVid', mov: 'catVid', avi: 'catVid',
  mp3: 'catMus', m4a: 'catMus', flac: 'catMus', wav: 'catMus', ogg: 'catMus',
  zip: 'catArc', rar: 'catArc', '7z': 'catArc', tar: 'catArc', gz: 'catArc',
  pdf: 'catDoc', doc: 'catDoc', docx: 'catDoc', xls: 'catDoc',
  xlsx: 'catDoc', ppt: 'catDoc', pptx: 'catDoc', epub: 'catDoc',
  dmg: 'catApp', pkg: 'catApp', exe: 'catApp', msi: 'catApp',
  deb: 'catApp', appimage: 'catApp', apk: 'catApp',
};

export const DEFAULT_CATEGORY_NAMES: Record<string, string> = {
  catImg: 'Images', catVid: 'Video', catMus: 'Music',
  catArc: 'Archives', catDoc: 'Documents', catApp: 'Apps',
};

/** Kategorili göreli yol döner; kategori yoksa veya kapalıysa dosya adı aynen kalır. */
export function routeByType(
  filename: string,
  enabled: boolean,
  names: Record<string, string> = DEFAULT_CATEGORY_NAMES,
): string {
  if (!enabled) return filename;
  const dot = filename.lastIndexOf('.');
  if (dot <= 0) return filename;
  const key = KEY_BY_EXT[filename.slice(dot + 1).toLowerCase()];
  const category = key ? names[key] : undefined;
  return category ? `Ruu/${category}/${filename}` : filename;
}
