/**
 * CommonJS：条目图标纯逻辑（与 lib/quick-open/icon.js 保持一致）
 */

const ICON_MODES = Object.freeze({
  DEFAULT: 'default',
  UPLOAD: 'upload',
  AUTO: 'auto',
});

const DEFAULT_FEATURE_ICON = 'logo.png';
const MAX_ICON_BYTES = 512 * 1024;
const DATA_URL_RE = /^data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=\s]+$/;

function normalizeIconMode(value) {
  const mode = String(value || '').trim().toLowerCase();
  if (mode === ICON_MODES.UPLOAD || mode === ICON_MODES.AUTO) return mode;
  return ICON_MODES.DEFAULT;
}

function normalizeIconDataUrl(value) {
  const text = String(value || '').trim();
  if (!text || !DATA_URL_RE.test(text)) return '';
  const comma = text.indexOf(',');
  const b64 = comma >= 0 ? text.slice(comma + 1).replace(/\s/g, '') : '';
  if (!b64) return '';
  const approxBytes = Math.floor((b64.length * 3) / 4);
  if (approxBytes > MAX_ICON_BYTES) return '';
  return text.replace(/\s/g, '');
}

function resolveIconPageUrl(item) {
  let raw = String(item?.url || '').trim();
  if (!raw) {
    const template = String(item?.urlTemplate || '').trim();
    if (template) raw = template.replace(/\{query\}/gi, 'x');
  }
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    return parsed.href;
  } catch {
    return '';
  }
}

function buildFaviconCandidateUrls(pageUrl) {
  let parsed;
  try {
    parsed = new URL(String(pageUrl || '').trim());
  } catch {
    return [];
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return [];
  const { origin, hostname } = parsed;
  if (!hostname) return [];
  return [
    `${origin}/favicon.ico`,
    `${origin}/apple-touch-icon.png`,
    `${origin}/apple-touch-icon-precomposed.png`,
    `https://icons.duckduckgo.com/ip3/${hostname}.ico`,
  ];
}

function guessImageMime(filePathOrUrl) {
  const lower = String(filePathOrUrl || '').toLowerCase();
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  if (lower.endsWith('.ico')) return 'image/x-icon';
  return 'image/png';
}

function bufferToImageDataUrl(buffer, mime) {
  const type = String(mime || 'image/png').split(';')[0].trim() || 'image/png';
  if (!type.startsWith('image/')) return '';
  if (!Buffer.isBuffer(buffer)) {
    try {
      buffer = Buffer.from(buffer);
    } catch {
      return '';
    }
  }
  if (!buffer.length || buffer.length > MAX_ICON_BYTES) return '';
  return `data:${type};base64,${buffer.toString('base64')}`;
}

module.exports = {
  ICON_MODES,
  DEFAULT_FEATURE_ICON,
  MAX_ICON_BYTES,
  normalizeIconMode,
  normalizeIconDataUrl,
  resolveIconPageUrl,
  buildFaviconCandidateUrls,
  guessImageMime,
  bufferToImageDataUrl,
};
