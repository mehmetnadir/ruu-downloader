/**
 * İkonlar: Lucide (lucide.dev, ISC lisansı) inline path'leri — bağımlılıksız.
 * 24×24 viewBox, stroke tabanlı; renk currentColor ile temadan gelir.
 */
const svg = (paths: string, size = 16): string =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" ` +
  `stroke="currentColor" stroke-width="2" stroke-linecap="round" ` +
  `stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

export const icons = {
  logo: svg('<path d="M12 17V3"/><path d="m6 11 6 6 6-6"/><path d="M19 21H5"/>', 20),
  pause: svg('<rect x="14" y="4" width="4" height="16" rx="1"/><rect x="6" y="4" width="4" height="16" rx="1"/>'),
  play: svg('<polygon points="6 3 20 12 6 21 6 3"/>'),
  x: svg('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'),
  check: svg('<path d="M21.8 10A10 10 0 1 1 17 3.34"/><path d="m9 11 3 3L22 4"/>'),
  alert: svg('<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>'),
  chevron: svg('<path d="m6 9 6 6 6-6"/>'),
  browser: svg('<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>'),
};
