(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  // Electron renderers can expose CommonJS and window at the same time.
  if (typeof window !== 'undefined') root.Base64Codec = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const MAX_BYTES = 20 * 1024 * 1024;
  const extensions = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/bmp': 'bmp', 'image/x-icon': 'ico', 'image/avif': 'avif', 'image/svg+xml': 'svg' };
  function checkSize(size) {
    if (size > MAX_BYTES) throw new Error('内容超过 20 MB，请使用更小的文件或文本。');
  }
  function encodeBytes(bytes) {
    checkSize(bytes.length);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(binary);
  }
  function encodeText(text) { return encodeBytes(new TextEncoder().encode(text)); }
  function parse(input) {
    if (input.length > Math.ceil(MAX_BYTES / 3) * 4 + 1024 * 1024) throw new Error('Base64 输入过长，最多支持 20 MB 内容。');
    let value = input.trim();
    let declaredMime = '';
    if (/^data:/i.test(value)) {
      const comma = value.indexOf(',');
      const header = value.slice(0, comma);
      if (comma < 0 || !/;base64$/i.test(header)) throw new Error('Data URL 必须包含 ;base64, 标记。');
      declaredMime = header.slice(5).split(';')[0].toLowerCase();
      value = value.slice(comma + 1);
    }
    value = value.replace(/\s/g, '');
    if (!value) throw new Error('请输入需要解码的 Base64。');
    if (!/^[A-Za-z0-9+/_-]*={0,2}$/.test(value)) throw new Error('Base64 包含非法字符或错误的填充符。');
    if (/[+\/]/.test(value) && /[-_]/.test(value)) throw new Error('请勿混用标准 Base64 与 URL-safe 字符。');
    if (value.includes('=') && value.length % 4 !== 0) throw new Error('Base64 填充不完整，请检查末尾的 =。');
    const raw = value.replace(/=+$/, '').replace(/-/g, '+').replace(/_/g, '/');
    if (raw.length % 4 === 1) throw new Error('Base64 长度不正确，内容可能已被截断。');
    const normalized = raw + '='.repeat((4 - raw.length % 4) % 4);
    checkSize(Math.floor(raw.length * 6 / 8));
    const binary = atob(normalized);
    if (btoa(binary) !== normalized) throw new Error('Base64 末尾数据不正确，请检查是否复制完整。');
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
    return { bytes, base64: normalized, declaredMime };
  }
  function imageMime(bytes) {
    const starts = values => values.every((n, i) => bytes[i] === n);
    const ascii = (start, end) => String.fromCharCode(...bytes.subarray(start, end));
    if (starts([137, 80, 78, 71, 13, 10, 26, 10])) return 'image/png';
    if (starts([255, 216, 255])) return 'image/jpeg';
    if (/^GIF8[79]a$/.test(ascii(0, 6))) return 'image/gif';
    if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
    if (ascii(0, 2) === 'BM') return 'image/bmp';
    if (starts([0, 0, 1, 0])) return 'image/x-icon';
    if (ascii(4, 8) === 'ftyp' && /avif|avis/.test(ascii(8, 64))) return 'image/avif';
    const head = new TextDecoder().decode(bytes.subarray(0, 65536)).replace(/^\uFEFF/, '').trimStart();
    if (/^(?:<\?xml[\s\S]*?\?>\s*)?(?:<!--[\s\S]*?-->\s*)*(?:<!DOCTYPE\s+svg[^>]*>\s*)?<svg(?:\s|>)/i.test(head)) return 'image/svg+xml';
    return '';
  }
  function decode(input) {
    const result = parse(input);
    const mime = imageMime(result.bytes);
    if (mime) return { ...result, kind: 'image', mime, extension: extensions[mime] };
    try {
      const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(result.bytes);
      if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(text)) throw new Error('binary');
      return { ...result, kind: 'text', text };
    } catch {
      throw new Error('已解码，但内容不是有效的 UTF-8 文本，也不是支持的图片格式。');
    }
  }
  return { MAX_BYTES, extensions, checkSize, encodeBytes, encodeText, parse, imageMime, decode };
});
