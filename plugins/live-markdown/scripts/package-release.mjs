import fs from "node:fs";
import path from "node:path";
import { deflateRawSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { assertSizeBudget, inspectRelease } from "./release-files.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const result = inspectRelease(dist);
const table = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let i = 0; i < 8; i++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = table[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

const localEntries = [];
const centralEntries = [];
let offset = 0;
for (const relative of result.files) {
  const name = Buffer.from(relative, "utf8");
  const raw = fs.readFileSync(path.join(dist, relative));
  const compressed = deflateRawSync(raw, { level: 9 });
  const crc = crc32(raw);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x800, 6);
  local.writeUInt16LE(8, 8);
  local.writeUInt16LE(33, 12); // 1980-01-01, deterministic archive.
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(raw.length, 22);
  local.writeUInt16LE(name.length, 26);
  localEntries.push(local, name, compressed);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x800, 8);
  central.writeUInt16LE(8, 10);
  central.writeUInt16LE(33, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(raw.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(offset, 42);
  centralEntries.push(central, name);
  offset += local.length + name.length + compressed.length;
}
const central = Buffer.concat(centralEntries);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(result.files.length, 8);
end.writeUInt16LE(result.files.length, 10);
end.writeUInt32LE(central.length, 12);
end.writeUInt32LE(offset, 16);
const archive = Buffer.concat([...localEntries, central, end]);
assertSizeBudget(archive.length, "Packaged release");
const version = JSON.parse(fs.readFileSync(path.join(dist, "plugin.json"), "utf8")).version;
if (!/^[\w.-]+$/.test(version)) throw new Error("Invalid package version");
const output = path.join(root, "release");
fs.mkdirSync(output, { recursive: true });
const name = `live-markdown-${version}.zip`;
fs.writeFileSync(path.join(output, name), archive);
fs.writeFileSync(path.join(output, "size-report.json"), JSON.stringify({
  package: name, packageBytes: archive.length, unpackedBytes: result.bytes,
  files: result.files.length, maximumBytes: 15_000_000, containsRuntimeOrModels: false
}, null, 2) + "\n");
console.log(`[package] ${name}: ${archive.length} packed / ${result.bytes} unpacked bytes`);
