// Simple MIME type utilities

export const ALLOWED_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/pdf',
  'application/zip',
  'text/plain',
]);

const MIME_TO_EXT = new Map([
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/webp', 'webp'],
  ['application/pdf', 'pdf'],
  ['application/zip', 'zip'],
  ['text/plain', 'txt'],
]);

export function extFromMime(mime) {
  if (!mime) return 'bin';
  return MIME_TO_EXT.get(mime) || 'bin';
}

export function normalizeFilename(name, fallbackBase = 'artifact') {
  if (!name) return `${fallbackBase}`;
  const base = name.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return base || fallbackBase;
}
