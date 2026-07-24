/**
 * preload 使用的 CommonJS 副本（Node 环境，与 lib/char-transform.js 逻辑一致）
 */
const { createHash } = require('node:crypto');

const MODES = [
  'capitalize',
  'camelCase',
  'pascalCase',
  'snake_case',
  'constant_case',
  'kebab-case',
  'uppercase',
  'lowercase',
  'base64',
  'base64decode',
  'md5',
  'urlEncode',
  'urlDecode',
];

function splitIntoWords(text) {
  const value = String(text).trim();
  if (!value) return [];

  return value
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z\d])/g, '$1 $2')
    .split(/[\s_\-./]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase());
}

function toCapitalize(text) {
  const value = String(text);
  if (!value) return '';
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

function toCamelCase(text) {
  const words = splitIntoWords(text);
  if (!words.length) return '';
  return words[0] + words.slice(1).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('');
}

function toPascalCase(text) {
  const words = splitIntoWords(text);
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('');
}

function toSnakeCase(text) {
  return splitIntoWords(text).join('_');
}

function toConstantCase(text) {
  return splitIntoWords(text).join('_').toUpperCase();
}

function toKebabCase(text) {
  return splitIntoWords(text).join('-');
}

function toUpperCase(text) {
  return String(text).toUpperCase();
}

function toLowerCase(text) {
  return String(text).toLowerCase();
}

function toBase64(text) {
  return Buffer.from(String(text), 'utf8').toString('base64');
}

function fromBase64(text) {
  const value = String(text);
  if (!value || !/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 === 1) {
    throw new Error('无效的 Base64 字符串');
  }

  try {
    const decoded = Buffer.from(value, 'base64').toString('utf8');
    if (Buffer.from(decoded, 'utf8').toString('base64').replace(/=+$/, '') !== value.replace(/=+$/, '')) {
      throw new Error('无效的 Base64 字符串');
    }
    return decoded;
  } catch {
    throw new Error('无效的 Base64 字符串');
  }
}

function toUrlEncode(text) {
  return encodeURIComponent(String(text));
}

function fromUrlDecode(text) {
  try {
    return decodeURIComponent(String(text));
  } catch {
    throw new Error('无效的 URL 编码字符串');
  }
}

function toMd5(text) {
  return createHash('md5').update(String(text), 'utf8').digest('hex');
}

function transform(text, mode) {
  const handlers = {
    capitalize: toCapitalize,
    camelCase: toCamelCase,
    pascalCase: toPascalCase,
    snake_case: toSnakeCase,
    constant_case: toConstantCase,
    'kebab-case': toKebabCase,
    uppercase: toUpperCase,
    lowercase: toLowerCase,
    base64: toBase64,
    base64decode: fromBase64,
    md5: toMd5,
    urlEncode: toUrlEncode,
    urlDecode: fromUrlDecode,
  };

  if (!handlers[mode]) {
    throw new Error(`不支持的模式: ${mode}，可选: ${MODES.join(', ')}`);
  }

  return handlers[mode](text);
}

module.exports = {
  MODES,
  transform,
};
