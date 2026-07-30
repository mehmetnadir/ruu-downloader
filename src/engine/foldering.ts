/**
 * Tür bazlı klasörleme (PRD-3 #6): dosya uzantısına göre Downloads altında
 * Ruu/<kategori>/ alt klasörü. Saf fonksiyon — unit test edilir.
 * Kategori adları i18n dalgasında yerelleşecek.
 */
const CATEGORY_BY_EXT: Record<string, string> = {
  jpg: 'Görseller', jpeg: 'Görseller', png: 'Görseller', gif: 'Görseller',
  webp: 'Görseller', svg: 'Görseller', heic: 'Görseller', avif: 'Görseller',
  mp4: 'Video', mkv: 'Video', webm: 'Video', mov: 'Video', avi: 'Video',
  mp3: 'Müzik', m4a: 'Müzik', flac: 'Müzik', wav: 'Müzik', ogg: 'Müzik',
  zip: 'Arşiv', rar: 'Arşiv', '7z': 'Arşiv', tar: 'Arşiv', gz: 'Arşiv',
  pdf: 'Belgeler', doc: 'Belgeler', docx: 'Belgeler', xls: 'Belgeler',
  xlsx: 'Belgeler', ppt: 'Belgeler', pptx: 'Belgeler', epub: 'Belgeler',
  dmg: 'Uygulamalar', pkg: 'Uygulamalar', exe: 'Uygulamalar', msi: 'Uygulamalar',
  deb: 'Uygulamalar', appimage: 'Uygulamalar', apk: 'Uygulamalar',
};

/** Kategorili göreli yol döner; kategori yoksa veya kapalıysa dosya adı aynen kalır. */
export function routeByType(filename: string, enabled: boolean): string {
  if (!enabled) return filename;
  const dot = filename.lastIndexOf('.');
  if (dot <= 0) return filename;
  const category = CATEGORY_BY_EXT[filename.slice(dot + 1).toLowerCase()];
  return category ? `Ruu/${category}/${filename}` : filename;
}
