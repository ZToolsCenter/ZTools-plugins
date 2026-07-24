/* uuid-kit core: codecs, generation (v1/v3/v4/v5/v6/v7), inspection,
 * input detection, and command parsing. Pure and stateless apart from the
 * v1/v6 clock sequence; no DOM and no launcher APIs, so the whole file runs
 * under node for tests.
 *
 * Cross-language ground truth: python uuid/hashlib/shortuuid (see selftest
 * vectors at the bottom). Note python-shortuuid sorts its alphabet, so the
 * base62 order is ASCII 0-9A-Za-z.
 */
'use strict';

// ---------------------------------------------------------------- bytes/hex

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function bytesToHex(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, '0');
  return s;
}

function formatUuid(hex32) {
  return (
    hex32.slice(0, 8) + '-' + hex32.slice(8, 12) + '-' + hex32.slice(12, 16) +
    '-' + hex32.slice(16, 20) + '-' + hex32.slice(20)
  );
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX32_RE = /^[0-9a-f]{32}$/i;

// Canonical UUID string or bare hex32 -> lowercase hex32, else null.
function parseUuidLike(s) {
  if (UUID_RE.test(s)) return s.replace(/-/g, '').toLowerCase();
  if (HEX32_RE.test(s)) return s.toLowerCase();
  return null;
}

// ---------------------------------------------------------------- codecs

const MAX_UUID = 1n << 128n;

function encodeAlphabet(hex32, alphabet, fixedLen) {
  let n = BigInt('0x' + hex32);
  const base = BigInt(alphabet.length);
  let out = '';
  while (n > 0n) {
    out = alphabet[Number(n % base)] + out;
    n /= base;
  }
  return fixedLen ? out.padStart(fixedLen, alphabet[0]) : out;
}

function decodeAlphabet(s, alphabet) {
  let n = 0n;
  const base = BigInt(alphabet.length);
  for (const ch of s) {
    const idx = alphabet.indexOf(ch);
    if (idx < 0) return null;
    n = n * base + BigInt(idx);
  }
  if (n >= MAX_UUID) return null;
  return n.toString(16).padStart(32, '0');
}

const B62_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const B57_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const B58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const B64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

// base58 uses bitcoin semantics (leading zero BYTES -> '1' each, no fixed
// width) so results match python `base58.b58encode(uuid.bytes)`.
function encodeB58(hex32) {
  let zeroBytes = 0;
  while (zeroBytes < 16 && hex32.slice(zeroBytes * 2, zeroBytes * 2 + 2) === '00') zeroBytes++;
  const digits = encodeAlphabet(hex32, B58_ALPHABET, 0);
  return '1'.repeat(zeroBytes) + digits;
}

function decodeB58(s) {
  let pad = 0;
  while (pad < s.length && s[pad] === '1') pad++;
  const hex = decodeAlphabet(s, B58_ALPHABET);
  if (hex === null) return null;
  // Bitcoin decode yields pad zero-bytes + minimal int bytes; must total 16.
  const intBytes = Math.ceil(BigInt('0x' + (hex || '0')).toString(2).length / 8);
  const nonZeroLen = BigInt('0x' + hex) === 0n ? 0 : intBytes;
  if (pad + nonZeroLen !== 16 && !(pad === 16 && nonZeroLen === 0)) return null;
  return hex;
}

function encodeB64url(hex32) {
  const bytes = hexToBytes(hex32);
  let out = '';
  for (let i = 0; i < 15; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += B64URL_ALPHABET[(n >> 18) & 63] + B64URL_ALPHABET[(n >> 12) & 63] +
           B64URL_ALPHABET[(n >> 6) & 63] + B64URL_ALPHABET[n & 63];
  }
  // Remaining 16th byte -> 2 chars (4 spare bits are zero).
  const last = bytes[15];
  out += B64URL_ALPHABET[(last >> 2) & 63] + B64URL_ALPHABET[(last & 3) << 4];
  return out;
}

function decodeB64url(s) {
  if (!/^[A-Za-z0-9_-]{22}$/.test(s)) return null;
  let bits = 0n;
  for (const ch of s) bits = (bits << 6n) | BigInt(B64URL_ALPHABET.indexOf(ch));
  // 22 chars = 132 bits; the low 4 padding bits must be zero.
  if (bits & 15n) return null;
  const n = bits >> 4n;
  return n.toString(16).padStart(32, '0');
}

// Ordered registry: detection tries these in order, so base62 (the default
// alphabet) always ranks first among ambiguous decodes.
const CODECS = [
  {
    id: 'base62', label: 'base62',
    encode: (h) => encodeAlphabet(h, B62_ALPHABET, 22),
    decode: (s) => (/^[0-9A-Za-z]{22}$/.test(s) ? decodeAlphabet(s, B62_ALPHABET) : null),
  },
  {
    id: 'base57', label: 'base57·shortuuid',
    encode: (h) => encodeAlphabet(h, B57_ALPHABET, 22),
    decode: (s) => (s.length === 22 ? decodeAlphabet(s, B57_ALPHABET) : null),
  },
  {
    id: 'base58', label: 'base58·bitcoin',
    encode: encodeB58,
    decode: decodeB58,
    // Realism gate for auto-detection only: a uuid encodes to 21-22 chars
    // unless it has leading zero bytes; shorter strings are almost certainly
    // not ids and would decode to noise.
    detect: (s) => (s.length >= 21 && s.length <= 22 ? decodeB58(s) : null),
  },
  {
    id: 'base64url', label: 'base64url',
    encode: encodeB64url,
    decode: decodeB64url,
  },
];

function encodeAll(hex32) {
  const out = { uuid: formatUuid(hex32), hex32: hex32 };
  for (const c of CODECS) out[c.id] = c.encode(hex32);
  return out;
}

// All codecs that accept the string, in registry order. Ambiguity is
// surfaced, never silently resolved: the UI labels each candidate.
function detectShort(s) {
  const hits = [];
  for (const c of CODECS) {
    const hex = (c.detect || c.decode)(s);
    if (hex !== null) hits.push({ codec: c.id, label: c.label, hex32: hex });
  }
  return hits;
}

// ---------------------------------------------------------------- md5/sha1
// Embedded so v3/v5 stay synchronous and independent of crypto.subtle
// availability. Verified against python hashlib in the selftest.

const MD5_K = (() => {
  const k = new Array(64);
  for (let i = 0; i < 64; i++) k[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296);
  return k;
})();
const MD5_S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

function md5Bytes(msg) {
  const len = msg.length;
  const padded = new Uint8Array((((len + 8) >> 6) + 1) << 6);
  padded.set(msg);
  padded[len] = 0x80;
  const bitLen = len * 8;
  // 64-bit little-endian bit length (messages here are far below 2^32 bits).
  for (let i = 0; i < 4; i++) padded[padded.length - 8 + i] = (bitLen >>> (i * 8)) & 0xff;

  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  const m = new Uint32Array(16);
  for (let off = 0; off < padded.length; off += 64) {
    for (let j = 0; j < 16; j++) {
      const o = off + j * 4;
      m[j] = padded[o] | (padded[o + 1] << 8) | (padded[o + 2] << 16) | (padded[o + 3] << 24);
    }
    let a = a0, b = b0, c = c0, d = d0;
    for (let i = 0; i < 64; i++) {
      let f, g;
      if (i < 16) { f = (b & c) | (~b & d); g = i; }
      else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) % 16; }
      else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) % 16; }
      else { f = c ^ (b | ~d); g = (7 * i) % 16; }
      const tmp = d;
      d = c;
      c = b;
      const sum = (a + f + MD5_K[i] + m[g]) >>> 0;
      b = (b + ((sum << MD5_S[i]) | (sum >>> (32 - MD5_S[i])))) >>> 0;
      a = tmp;
    }
    a0 = (a0 + a) >>> 0; b0 = (b0 + b) >>> 0; c0 = (c0 + c) >>> 0; d0 = (d0 + d) >>> 0;
  }
  const out = new Uint8Array(16);
  [a0, b0, c0, d0].forEach((w, i) => {
    for (let j = 0; j < 4; j++) out[i * 4 + j] = (w >>> (j * 8)) & 0xff;
  });
  return out;
}

function sha1Bytes(msg) {
  const len = msg.length;
  const padded = new Uint8Array((((len + 8) >> 6) + 1) << 6);
  padded.set(msg);
  padded[len] = 0x80;
  const bitLen = len * 8;
  // 64-bit big-endian bit length.
  for (let i = 0; i < 4; i++) padded[padded.length - 1 - i] = (bitLen >>> (i * 8)) & 0xff;

  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
  const w = new Uint32Array(80);
  for (let off = 0; off < padded.length; off += 64) {
    for (let j = 0; j < 16; j++) {
      const o = off + j * 4;
      w[j] = (padded[o] << 24) | (padded[o + 1] << 16) | (padded[o + 2] << 8) | padded[o + 3];
    }
    for (let j = 16; j < 80; j++) {
      const x = w[j - 3] ^ w[j - 8] ^ w[j - 14] ^ w[j - 16];
      w[j] = ((x << 1) | (x >>> 31)) >>> 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4;
    for (let i = 0; i < 80; i++) {
      let f, k;
      if (i < 20) { f = (b & c) | (~b & d); k = 0x5a827999; }
      else if (i < 40) { f = b ^ c ^ d; k = 0x6ed9eba1; }
      else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdc; }
      else { f = b ^ c ^ d; k = 0xca62c1d6; }
      const tmp = (((a << 5) | (a >>> 27)) + f + e + k + w[i]) >>> 0;
      e = d; d = c; c = ((b << 30) | (b >>> 2)) >>> 0; b = a; a = tmp;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0;
  }
  const out = new Uint8Array(20);
  [h0, h1, h2, h3, h4].forEach((word, i) => {
    for (let j = 0; j < 4; j++) out[i * 4 + j] = (word >>> ((3 - j) * 8)) & 0xff;
  });
  return out;
}

// ---------------------------------------------------------------- generate

function randomBytes(n) {
  const b = new Uint8Array(n);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(b);
  else for (let i = 0; i < n; i++) b[i] = Math.floor(Math.random() * 256);
  return b;
}

function setVersionVariant(bytes, version) {
  bytes[6] = (bytes[6] & 0x0f) | (version << 4);
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return bytes;
}

// Shared clock state for v1/v6. Node has the multicast bit set per RFC 4122
// (browsers cannot read a MAC address); clock sequence is random per load.
const clockState = {
  node: (() => { const n = randomBytes(6); n[0] |= 0x01; return n; })(),
  clockSeq: ((randomBytes(2)[0] << 8) | randomBytes(1)[0]) & 0x3fff,
  lastMs: -1,
  counter: 0,
};

// 100ns intervals between 1582-10-15 and the unix epoch.
const GREGORIAN_OFFSET = 122192928000000000n;

function timestamp100ns(nowMs) {
  if (nowMs === clockState.lastMs) {
    clockState.counter = (clockState.counter + 1) % 10000;
  } else {
    clockState.lastMs = nowMs;
    clockState.counter = 0;
  }
  return BigInt(nowMs) * 10000n + BigInt(clockState.counter) + GREGORIAN_OFFSET;
}

function genV1(nowMs) {
  const ts = timestamp100ns(nowMs);
  const b = new Uint8Array(16);
  const low = ts & 0xffffffffn;
  const mid = (ts >> 32n) & 0xffffn;
  const high = (ts >> 48n) & 0xfffn;
  b[0] = Number(low >> 24n); b[1] = Number((low >> 16n) & 0xffn);
  b[2] = Number((low >> 8n) & 0xffn); b[3] = Number(low & 0xffn);
  b[4] = Number(mid >> 8n); b[5] = Number(mid & 0xffn);
  b[6] = 0x10 | Number(high >> 8n); b[7] = Number(high & 0xffn);
  b[8] = 0x80 | (clockState.clockSeq >> 8); b[9] = clockState.clockSeq & 0xff;
  b.set(clockState.node, 10);
  return bytesToHex(b);
}

function genV6(nowMs) {
  const ts = timestamp100ns(nowMs);
  const b = new Uint8Array(16);
  const high = (ts >> 28n) & 0xffffffffn; // top 32 of the 60-bit timestamp
  const mid = (ts >> 12n) & 0xffffn;
  const low = ts & 0xfffn;
  b[0] = Number(high >> 24n); b[1] = Number((high >> 16n) & 0xffn);
  b[2] = Number((high >> 8n) & 0xffn); b[3] = Number(high & 0xffn);
  b[4] = Number(mid >> 8n); b[5] = Number(mid & 0xffn);
  b[6] = 0x60 | Number(low >> 8n); b[7] = Number(low & 0xffn);
  b[8] = 0x80 | (clockState.clockSeq >> 8); b[9] = clockState.clockSeq & 0xff;
  b.set(clockState.node, 10);
  return bytesToHex(b);
}

function genV4() {
  return bytesToHex(setVersionVariant(randomBytes(16), 4));
}

function genV7(nowMs) {
  const b = randomBytes(16);
  let ms = BigInt(nowMs);
  for (let i = 5; i >= 0; i--) { b[i] = Number(ms & 0xffn); ms >>= 8n; }
  return bytesToHex(setVersionVariant(b, 7));
}

function genNamed(version, nsHex32, name) {
  const nsBytes = hexToBytes(nsHex32);
  const nameBytes = new TextEncoder().encode(name);
  const msg = new Uint8Array(16 + nameBytes.length);
  msg.set(nsBytes);
  msg.set(nameBytes, 16);
  const digest = version === 3 ? md5Bytes(msg) : sha1Bytes(msg);
  return bytesToHex(setVersionVariant(digest.slice(0, 16), version));
}

const NAMESPACES = {
  dns: '6ba7b8109dad11d180b400c04fd430c8',
  url: '6ba7b8119dad11d180b400c04fd430c8',
  oid: '6ba7b8129dad11d180b400c04fd430c8',
  x500: '6ba7b8149dad11d180b400c04fd430c8',
};

function generate(version, opts) {
  const nowMs = (opts && opts.nowMs) !== undefined ? opts.nowMs : Date.now();
  switch (version) {
    case 1: return genV1(nowMs);
    case 4: return genV4();
    case 6: return genV6(nowMs);
    case 7: return genV7(nowMs);
    case 3:
    case 5: return genNamed(version, opts.namespace, opts.name);
    default: throw new Error('unsupported uuid version: ' + version);
  }
}

// ---------------------------------------------------------------- inspect

const VARIANTS = [
  { test: (b) => (b & 0x80) === 0, label: 'NCS（保留）' },
  { test: (b) => (b & 0xc0) === 0x80, label: 'RFC 4122' },
  { test: (b) => (b & 0xe0) === 0xc0, label: 'Microsoft（保留）' },
  { test: () => true, label: '未来（保留）' },
];

function inspect(hex32) {
  const b = hexToBytes(hex32);
  const version = b[6] >> 4;
  const variant = VARIANTS.find((v) => v.test(b[8])).label;
  const info = { version: version, variant: variant };
  if (variant !== 'RFC 4122') return info;

  if (version === 1 || version === 6) {
    let ts;
    if (version === 1) {
      ts = (BigInt((b[6] & 0x0f)) << 56n) | (BigInt(b[7]) << 48n) |
           (BigInt(b[4]) << 40n) | (BigInt(b[5]) << 32n) |
           (BigInt(b[0]) << 24n) | (BigInt(b[1]) << 16n) | (BigInt(b[2]) << 8n) | BigInt(b[3]);
    } else {
      ts = (BigInt(b[0]) << 52n) | (BigInt(b[1]) << 44n) | (BigInt(b[2]) << 36n) |
           (BigInt(b[3]) << 28n) | (BigInt(b[4]) << 20n) | (BigInt(b[5]) << 12n) |
           (BigInt(b[6] & 0x0f) << 8n) | BigInt(b[7]);
    }
    info.timeMs = Number((ts - GREGORIAN_OFFSET) / 10000n);
    info.clockSeq = ((b[8] & 0x3f) << 8) | b[9];
    info.node = bytesToHex(b.slice(10));
    info.nodeIsRandom = (b[10] & 0x01) === 1;
  } else if (version === 7) {
    let ms = 0n;
    for (let i = 0; i < 6; i++) ms = (ms << 8n) | BigInt(b[i]);
    info.timeMs = Number(ms);
  }
  return info;
}

// ---------------------------------------------------------------- convert

/* Auto-detect direction:
 *   canonical UUID / hex32 (bare or prefixed)  -> encode view
 *   22-char short id (bare or prefixed)        -> decode view, all plausible
 *                                                 alphabets listed, base62 first
 */
function convert(value) {
  const v = String(value).trim();
  let prefix = null;
  let hex = parseUuidLike(v);
  let direction = hex ? 'encode' : null;
  let candidates = null;

  if (!direction) {
    const i = v.indexOf('-');
    if (i > 0 && /^[A-Za-z][A-Za-z0-9_]*$/.test(v.slice(0, i))) {
      const rest = v.slice(i + 1);
      const restHex = parseUuidLike(rest);
      if (restHex) {
        prefix = v.slice(0, i); hex = restHex; direction = 'encode';
      } else {
        const hits = detectShort(rest);
        if (hits.length) { prefix = v.slice(0, i); candidates = hits; direction = 'decode'; }
      }
    }
    if (!direction) {
      const hits = detectShort(v);
      if (hits.length) { candidates = hits; direction = 'decode'; }
    }
  }

  if (!direction) {
    throw new Error('不是 UUID / 32 位 hex / 22 位短 id（可带 scope- 等前缀）');
  }

  if (direction === 'decode') hex = candidates[0].hex32;
  const enc = encodeAll(hex);
  return {
    direction: direction,
    prefix: prefix,
    uuid: enc.uuid,
    hex32: enc.hex32,
    encodings: enc,
    candidates: candidates, // decode only; >1 entry means ambiguous input
    inspect: inspect(hex),
    base62: enc.base62,
    base62Prefixed: prefix ? prefix + '-' + enc.base62 : enc.base62,
    primary: direction === 'decode' ? enc.uuid : (prefix ? prefix + '-' + enc.base62 : enc.base62),
  };
}

// ---------------------------------------------------------------- commands

/* subInput mini-language:
 *   uuid | uuid4 | uuid7 ...        generate (v4 default)
 *   uuid4 x10 | uuid4*10            batch
 *   uuid5 dns example.com           namespaced, ns = dns/url/oid/x500/<uuid>
 *   anything else                   parse as an id
 */
function parseCommand(text) {
  const t = String(text || '').trim();
  // 'uuid62' is the plugin's own keyword, not a command — show the hint view.
  if (!t || /^uuid62$/i.test(t)) return { mode: 'empty' };

  let m = /^uuid([13-7])?(?:\s*[x*]\s*(\d{1,3}))?$/i.exec(t);
  if (m) {
    const version = m[1] ? Number(m[1]) : 4;
    if (version === 3 || version === 5) return { mode: 'gen-needs-args', version: version };
    if (version === 2) return { mode: 'error', message: 'v2（DCE）不支持，几乎无人使用' };
    return { mode: 'gen', version: version, count: Math.max(1, Number(m[2] || 1)) };
  }
  m = /^uuid([35])\s+(\S+)\s+(.+)$/i.exec(t);
  if (m) {
    const nsKey = m[2].toLowerCase();
    const ns = NAMESPACES[nsKey] || parseUuidLike(m[2]);
    if (!ns) return { mode: 'error', message: '命名空间需为 dns/url/oid/x500 或一个 UUID' };
    return { mode: 'gen', version: Number(m[1]), count: 1, namespace: ns, nsLabel: NAMESPACES[nsKey] ? nsKey : m[2], name: m[3] };
  }
  return { mode: 'parse', value: t };
}

// ---------------------------------------------------------------- selftest

// Vectors generated by python (uuid/hashlib/shortuuid + repo identifier.py).
function selftest() {
  const eq = (got, want, what) => {
    if (got !== want) throw new Error(what + ': got ' + got + ', want ' + want);
  };

  // Codec KATs on a fixed uuid.
  const H = '28d463fe1b4345fa8346a08ff924c724';
  const enc = encodeAll(H);
  eq(enc.uuid, '28d463fe-1b43-45fa-8346-a08ff924c724', 'uuid-str');
  eq(enc.base62, '1F2krUyRcqDfa3cNxwq76q', 'base62');
  eq(enc.base57, '9H6Eec99g7BsAVi8QeCwyN', 'base57');
  eq(enc.base58, '63RgTRe1WGZapkFHAUJPmV', 'base58');
  eq(enc.base64url, 'KNRj_htDRfqDRqCP-STHJA', 'base64url');
  for (const c of CODECS) eq(c.decode(enc[c.id]), H, c.id + ' roundtrip');

  // Edge values: zero, 61, all-ones, one leading zero byte (base58 '1' pad).
  eq(encodeAll('0'.repeat(32)).base62, '0'.repeat(22), 'base62 zero');
  eq(encodeAll('0'.repeat(32)).base58, '1'.repeat(16), 'base58 zero');
  eq(encodeAll('0'.repeat(30) + '3d').base62, '0'.repeat(21) + 'z', 'base62 61');
  eq(CODECS[2].decode('1'.repeat(16)), '0'.repeat(32), 'base58 zero roundtrip');
  const oneZeroByte = '00' + '01' + '0'.repeat(28);
  eq(CODECS[2].decode(encodeAll(oneZeroByte).base58), oneZeroByte, 'base58 pad roundtrip');
  eq(encodeAll('f'.repeat(32)).base62, '7n42DGM5Tflk9n8mt7Fhc7', 'base62 max');

  // Hashes vs python hashlib.
  const te = new TextEncoder();
  eq(bytesToHex(md5Bytes(te.encode(''))), 'd41d8cd98f00b204e9800998ecf8427e', 'md5 empty');
  eq(bytesToHex(md5Bytes(te.encode('abc'))), '900150983cd24fb0d6963f7d28e17f72', 'md5 abc');
  eq(bytesToHex(sha1Bytes(te.encode(''))), 'da39a3ee5e6b4b0d3255bfef95601890afd80709', 'sha1 empty');
  eq(bytesToHex(sha1Bytes(te.encode('abc'))), 'a9993e364706816aba3e25717850c26c9cd0d89d', 'sha1 abc');

  // Named generation vs python uuid module.
  eq(formatUuid(genNamed(3, NAMESPACES.dns, 'example.com')), '9073926b-929f-31c2-abc9-fad77ae3e8eb', 'uuid3 dns');
  eq(formatUuid(genNamed(5, NAMESPACES.dns, 'example.com')), 'cfbff0d1-9375-5685-968c-48ce8b15ae17', 'uuid5 dns');

  // Structural checks for time/random versions.
  const fixedMs = 1752825600000; // stable input so inspect() must roundtrip exactly
  for (const v of [1, 4, 6, 7]) {
    const hex = generate(v, { nowMs: fixedMs });
    const info = inspect(hex);
    eq(info.version, v, 'version bits v' + v);
    eq(info.variant, 'RFC 4122', 'variant v' + v);
    if (v !== 4) eq(info.timeMs, fixedMs, 'timestamp roundtrip v' + v);
    for (const c of CODECS) eq(c.decode(c.encode(hex)), hex, 'gen roundtrip ' + c.id);
  }

  // Detection: exclusion chars and honest ambiguity.
  if (detectShort('1F2krUyRcqDfa3cNxwq76q')[0].codec !== 'base62') throw new Error('detect order');
  if (detectShort('KNRj_htDRfqDRqCP-STHJA')[0].codec !== 'base64url') throw new Error('detect b64url');
  if (detectShort('0' + 'A'.repeat(21)).some((h) => h.codec === 'base57' || h.codec === 'base58')) {
    throw new Error("'0' must exclude base57/58");
  }
  if (convert('user-1F2krUyRcqDfa3cNxwq76q').uuid !== '28d463fe-1b43-45fa-8346-a08ff924c724') {
    throw new Error('convert prefixed decode');
  }

  // Command parsing.
  const p1 = parseCommand('uuid7 x10');
  if (p1.mode !== 'gen' || p1.version !== 7 || p1.count !== 10) throw new Error('cmd uuid7 x10');
  const p2 = parseCommand('uuid5 dns example.com');
  if (p2.mode !== 'gen' || p2.namespace !== NAMESPACES.dns || p2.name !== 'example.com') throw new Error('cmd uuid5');
  if (parseCommand('user-1F2krUyRcqDfa3cNxwq76q').mode !== 'parse') throw new Error('cmd parse fallback');
  return true;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    convert, encodeAll, detectShort, inspect, generate,
    parseCommand, formatUuid, parseUuidLike, selftest, CODECS, NAMESPACES,
    md5Bytes, sha1Bytes, // exposed for the node test harness only
  };
}
