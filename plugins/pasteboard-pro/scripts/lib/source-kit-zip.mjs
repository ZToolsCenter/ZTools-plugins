import { deflateRawSync } from "node:zlib";
import path from "node:path";

const CRC_TABLE = makeCrcTable();
export const WINDOWS_SOURCE_KIT_LIMITS = Object.freeze({
  maxFileBytes: 4 * 1024 * 1024,
  maxTotalBytes: 32 * 1024 * 1024,
  maxCompressedBytes: 64 * 1024 * 1024,
  maxArchiveBytes: 64 * 1024 * 1024,
  maxEntries: 512,
  maxEntryNameBytes: 1024,
});

export function normalizeSourceKitLimits(overrides = undefined) {
  if (overrides === undefined) return WINDOWS_SOURCE_KIT_LIMITS;
  if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) {
    throw new TypeError("Source-kit limits must be an object");
  }
  const unknown = Object.keys(overrides).filter(key => !Object.hasOwn(WINDOWS_SOURCE_KIT_LIMITS, key));
  if (unknown.length > 0) throw new TypeError(`Unknown source-kit limit: ${unknown[0]}`);
  const limits = { ...WINDOWS_SOURCE_KIT_LIMITS, ...overrides };
  for (const [name, maximum] of Object.entries(WINDOWS_SOURCE_KIT_LIMITS)) {
    const value = limits[name];
    if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
      throw new TypeError(`${name} must be a positive integer no larger than ${maximum}`);
    }
  }
  return limits;
}

export function createDeterministicZip(entries, { limits: overrides } = {}) {
  const limits = normalizeSourceKitLimits(overrides);
  if (!Array.isArray(entries) || entries.length === 0 || entries.length > limits.maxEntries) {
    throw new TypeError(`ZIP entry count exceeds maxEntries (${limits.maxEntries})`);
  }
  const names = new Set();
  let totalBytes = 0;
  const checked = entries.map(entry => {
    const archivePath = validateArchivePath(entry?.path);
    const nameBytes = Buffer.byteLength(archivePath, "utf8");
    if (nameBytes > limits.maxEntryNameBytes) {
      throw new TypeError(`ZIP entry name exceeds maxEntryNameBytes (${limits.maxEntryNameBytes}): ${archivePath}`);
    }
    const name = Buffer.from(archivePath, "utf8");
    if (name.toString("utf8") !== archivePath) throw new TypeError("ZIP entry path is not valid UTF-8");
    const folded = archivePath.toLowerCase();
    if (names.has(folded)) throw new TypeError(`Duplicate ZIP path (case-insensitive): ${archivePath}`);
    names.add(folded);
    if (!Buffer.isBuffer(entry.bytes) && !(entry.bytes instanceof Uint8Array)) {
      throw new TypeError(`ZIP entry bytes must be a Buffer: ${archivePath}`);
    }
    const byteLength = entry.bytes.byteLength;
    if (!Number.isSafeInteger(byteLength) || byteLength > limits.maxFileBytes) {
      throw new TypeError(`ZIP entry exceeds maxFileBytes (${limits.maxFileBytes}): ${archivePath}`);
    }
    totalBytes += byteLength;
    if (totalBytes > limits.maxTotalBytes) {
      throw new TypeError(`ZIP payload exceeds maxTotalBytes (${limits.maxTotalBytes})`);
    }
    return { path: archivePath, byteLength, bytes: entry.bytes, name };
  });

  let compressedBytes = 0;
  let localBytes = 0;
  let centralBytes = 0;
  const sorted = checked.map(item => {
    const bytes = Buffer.isBuffer(item.bytes) ? item.bytes : Buffer.from(item.bytes);
    const name = item.name;
    const compressed = deflateRawSync(bytes, { level: 9 });
    compressedBytes += compressed.length;
    if (compressedBytes > limits.maxCompressedBytes) {
      throw new TypeError(`ZIP payload exceeds maxCompressedBytes (${limits.maxCompressedBytes})`);
    }
    localBytes += 30 + name.length + compressed.length;
    centralBytes += 46 + name.length;
    if (localBytes > 0xffffffff || centralBytes > 0xffffffff) throw new TypeError("ZIP32 archive exceeds the format limit");
    return { path: item.path, name, bytes, crc: crc32(bytes), compressed };
  }).sort((left, right) => compareStrings(left.path, right.path));
  const expectedArchiveBytes = localBytes + centralBytes + 22;
  if (expectedArchiveBytes > limits.maxArchiveBytes) {
    throw new TypeError(`ZIP archive exceeds maxArchiveBytes (${limits.maxArchiveBytes})`);
  }

  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const entry of sorted) {
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(33, 12);
    local.writeUInt32LE(entry.crc, 14);
    local.writeUInt32LE(entry.compressed.length, 18);
    local.writeUInt32LE(entry.bytes.length, 22);
    local.writeUInt16LE(entry.name.length, 26);
    local.writeUInt16LE(0, 28);
    const localBlock = Buffer.concat([local, entry.name, entry.compressed]);
    localParts.push(localBlock);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(33, 14);
    central.writeUInt32LE(entry.crc, 16);
    central.writeUInt32LE(entry.compressed.length, 20);
    central.writeUInt32LE(entry.bytes.length, 24);
    central.writeUInt16LE(entry.name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE((0o100644 * 0x10000) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(Buffer.concat([central, entry.name]));
    offset += localBlock.length;
    if (offset > 0xffffffff) throw new TypeError("ZIP32 local data exceeds the format limit");
  }

  const centralDirectory = Buffer.concat(centralParts);
  if (centralDirectory.length > 0xffffffff || offset + centralDirectory.length > 0xffffffff) {
    throw new TypeError("ZIP32 archive exceeds the format limit");
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(sorted.length, 8);
  end.writeUInt16LE(sorted.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  const archive = Buffer.concat([...localParts, centralDirectory, end]);
  if (archive.length > limits.maxArchiveBytes) throw new TypeError(`ZIP archive exceeds maxArchiveBytes (${limits.maxArchiveBytes})`);
  return archive;
}


export function validateArchivePath(value) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\\") || value.includes("\0") ||
      value.startsWith("/") || /^[A-Za-z]:/u.test(value) || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new TypeError("Unsafe archive path");
  }
  const parts = value.split("/");
  if (parts.some(part => part.length === 0 || part === "." || part === ".." || part.includes(":"))) {
    throw new TypeError("Unsafe archive path");
  }
  if (path.posix.normalize(value) !== value) throw new TypeError("Archive path must be normalized");
  return value;
}


function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function makeCrcTable() {
  const table = new Uint32Array(256);
  for (let value = 0; value < table.length; value += 1) {
    let crc = value;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    table[value] = crc >>> 0;
  }
  return table;
}



function compareStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}
