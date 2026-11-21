"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { createGunzip, createInflateRaw } = require("node:zlib");
const { finished, pipeline } = require("node:stream/promises");

const ARCHIVE_ENTRY_LIMIT = 4096;
const ARCHIVE_TOTAL_LIMIT = 10 * 1024 * 1024 * 1024;

function safeEntryPath(raw) {
  if (typeof raw !== "string" || !raw || raw.includes("\0") || raw.includes("\\")) {
    throw new Error("Archive contains an invalid path");
  }
  const normalized = raw.replace(/\/$/, "");
  if (!normalized || path.posix.isAbsolute(normalized) || /^[a-zA-Z]:/.test(normalized)) {
    throw new Error("Archive contains an absolute path");
  }
  const parts = normalized.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) {
    throw new Error("Archive path escapes its installation directory");
  }
  return parts.join(path.sep);
}

function manifestFiles(resource) {
  if (!Array.isArray(resource.files) || resource.files.length === 0 || resource.files.length > ARCHIVE_ENTRY_LIMIT) {
    throw new Error("Runtime resource manifest has no valid file list");
  }
  const files = new Map();
  let total = 0;
  for (const file of resource.files) {
    const relative = safeEntryPath(file.path);
    if (files.has(relative) || !/^[a-f\d]{64}$/i.test(file.sha256 || "") ||
        !Number.isSafeInteger(file.size) || file.size <= 0) {
      throw new Error("Runtime resource manifest contains an invalid file entry");
    }
    if (file.linkTarget !== undefined) {
      const target = safeEntryPath(file.linkTarget);
      if (target === relative) throw new Error("Runtime resource link cannot point to itself");
    }
    total += file.size;
    if (total > ARCHIVE_TOTAL_LIMIT) throw new Error("Runtime extracted size exceeds the safety limit");
    files.set(relative, file);
  }
  return files;
}

function containedPath(root, relative) {
  const target = path.resolve(root, relative);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) throw new Error("Archive path escaped its destination");
  return target;
}

function ensureContainedDirectories(root, relativeDirectory) {
  const target = containedPath(root, relativeDirectory || ".");
  const relative = path.relative(root, target);
  let current = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    try {
      const stat = fs.lstatSync(current);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Archive path traverses a symbolic link or non-directory");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      fs.mkdirSync(current, { mode: 0o700 });
    }
  }
  return target;
}

function resolveArchiveLink(relative, rawTarget) {
  if (typeof rawTarget !== "string" || !rawTarget || rawTarget.includes("\0") || rawTarget.includes("\\") ||
      path.posix.isAbsolute(rawTarget) || /^[a-zA-Z]:/.test(rawTarget)) {
    throw new Error("Archive symbolic link target is invalid");
  }
  const relativePosix = relative.split(path.sep).join("/");
  const target = path.posix.normalize(path.posix.join(path.posix.dirname(relativePosix), rawTarget));
  if (!target || target === "." || target === ".." || target.startsWith("../")) {
    throw new Error("Archive symbolic link escapes its installation directory");
  }
  return target.split("/").join(path.sep);
}

async function writeVerifiedStream(input, root, relative, expected, signal) {
  if (signal?.aborted) throw new Error("Installation cancelled");
  const target = containedPath(root, relative);
  ensureContainedDirectories(root, path.dirname(relative));
  const hash = crypto.createHash("sha256");
  let size = 0;
  const inspect = new (require("node:stream").Transform)({
    transform(chunk, _encoding, callback) {
      size += chunk.length;
      if (size > expected.size) return callback(new Error(`Archive member exceeds declared size: ${relative}`));
      hash.update(chunk);
      callback(null, chunk);
    }
  });
  const output = fs.createWriteStream(target, { flags: "wx", mode: expected.executable ? 0o700 : 0o600 });
  try {
    await pipeline(input, inspect, output, { signal });
    if (size !== expected.size || hash.digest("hex").toLowerCase() !== expected.sha256.toLowerCase()) {
      throw new Error(`Extracted runtime file failed manifest verification: ${relative}`);
    }
    if (process.platform !== "win32" && expected.executable) fs.chmodSync(target, 0o700);
  } catch (error) {
    fs.rmSync(target, { force: true });
    throw error;
  }
}

function parseOctal(field, label) {
  const text = field.toString("ascii").replace(/\0.*$/, "").trim();
  if (!text) return 0;
  if (!/^[0-7]+$/.test(text)) throw new Error(`Invalid tar ${label}`);
  const value = parseInt(text, 8);
  if (!Number.isSafeInteger(value)) throw new Error(`Invalid tar ${label}`);
  return value;
}

function verifyTarChecksum(header) {
  const expected = parseOctal(header.subarray(148, 156), "checksum");
  let sum = 0;
  for (let i = 0; i < header.length; i++) sum += i >= 148 && i < 156 ? 32 : header[i];
  if (sum !== expected) throw new Error("Tar header checksum is invalid");
}

async function extractTarGz(archivePath, targetDirectory, resource, options = {}) {
  const files = manifestFiles(resource);
  fs.mkdirSync(targetDirectory, { recursive: true, mode: 0o700 });
  const root = fs.realpathSync(targetDirectory);
  const seen = new Set();
  const links = new Map();
  const gunzip = fs.createReadStream(archivePath).pipe(createGunzip());
  const cancel = () => gunzip.destroy(new Error("Installation cancelled"));
  options.signal?.addEventListener("abort", cancel, { once: true });
  if (options.signal?.aborted) cancel();
  let pending = Buffer.alloc(0);
  let entry = null;
  let zeroBlocks = 0;
  let archiveEntries = 0;
  let extractedBytes = 0;
  try {
    for await (const chunk of gunzip) {
      pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
      let offset = 0;
      while (pending.length - offset >= 512) {
        if (entry && entry.remaining > 0) {
          if (entry.writeError) throw entry.writeError;
          const amount = Math.min(entry.remaining, pending.length - offset);
          if (entry.output) {
            const slice = pending.subarray(offset, offset + amount);
            if (!entry.output.write(slice)) await require("node:events").once(entry.output, "drain");
            entry.hash.update(slice);
          }
          entry.remaining -= amount;
          entry.written += amount;
          extractedBytes += amount;
          if (extractedBytes > ARCHIVE_TOTAL_LIMIT) throw new Error("Tar extraction exceeds the safety limit");
          offset += amount;
          if (entry.remaining === 0) {
            const padding = (512 - (entry.size % 512)) % 512;
            if (pending.length - offset < padding) break;
            offset += padding;
            if (entry.output) {
              entry.output.end();
              await entry.outputFinished;
              if (entry.writeError) throw entry.writeError;
              if (entry.written !== entry.expected.size ||
                  entry.hash.digest("hex").toLowerCase() !== entry.expected.sha256.toLowerCase()) {
                throw new Error(`Extracted runtime file failed manifest verification: ${entry.relative}`);
              }
            }
            entry = null;
          }
          continue;
        }
        if (entry) {
          const padding = (512 - (entry.size % 512)) % 512;
          if (pending.length - offset < padding) break;
          offset += padding;
          entry = null;
          continue;
        }
        const header = pending.subarray(offset, offset + 512);
        if (header.every((byte) => byte === 0)) {
          zeroBlocks++;
          offset += 512;
          if (zeroBlocks >= 2) break;
          continue;
        }
        zeroBlocks = 0;
        verifyTarChecksum(header);
        archiveEntries++;
        if (archiveEntries > ARCHIVE_ENTRY_LIMIT) throw new Error("Tar contains too many entries");
        const name = header.subarray(0, 100).toString("utf8").replace(/\0.*$/, "");
        const prefix = header.subarray(345, 500).toString("utf8").replace(/\0.*$/, "");
        const relative = safeEntryPath(prefix ? `${prefix}/${name}` : name);
        const size = parseOctal(header.subarray(124, 136), "member size");
        const type = String.fromCharCode(header[156] || 48);
        offset += 512;
        if (type === "5") continue;
        const expected = files.get(relative);
        if (!expected || seen.has(relative)) {
          throw new Error(`Tar contains an unexpected or duplicate file: ${relative}`);
        }
        seen.add(relative);
        if (type === "2") {
          const rawTarget = header.subarray(157, 257).toString("utf8").replace(/\0.*$/, "");
          if (!expected.linkTarget || size !== 0 || !rawTarget) {
            throw new Error(`Tar contains an unapproved symbolic link: ${relative}`);
          }
          const resolvedTarget = resolveArchiveLink(relative, rawTarget);
          const declaredTarget = resolveArchiveLink(relative, expected.linkTarget);
          if (resolvedTarget !== declaredTarget) {
            throw new Error(`Tar symbolic link target differs from its manifest: ${relative}`);
          }
          links.set(relative, { expected, target: resolvedTarget });
          continue;
        }
        if ((type !== "0" && type !== "\0") || expected.linkTarget || size !== expected.size) {
          throw new Error(`Tar contains a special file or unexpected member: ${relative}`);
        }
        const target = containedPath(root, relative);
        ensureContainedDirectories(root, path.dirname(relative));
        entry = {
          relative, remaining: size, size, written: 0, expected,
          hash: crypto.createHash("sha256"),
          output: (options.createWriteStream || fs.createWriteStream)(target, { flags: "wx", mode: expected.executable ? 0o700 : 0o600 })
        };
        const currentEntry = entry;
        currentEntry.output.on("error", (error) => {
          currentEntry.writeError = error;
          if (!gunzip.destroyed) gunzip.destroy(error);
        });
        currentEntry.outputFinished = finished(currentEntry.output);
        currentEntry.outputFinished.catch((error) => {
          currentEntry.writeError = error;
          if (!gunzip.destroyed) gunzip.destroy(error);
        });
      }
      pending = pending.subarray(offset);
    }
    if (entry || seen.size !== files.size || zeroBlocks < 2) throw new Error("Tar archive ended before all declared files were verified");
    for (const [relative, link] of links) {
      let target = link.target;
      const visited = new Set([relative]);
      for (let depth = 0; ; depth++) {
        if (depth >= 32 || visited.has(target)) throw new Error(`Tar symbolic link chain is cyclic or too deep: ${relative}`);
        visited.add(target);
        const targetEntry = files.get(target);
        if (!targetEntry || !seen.has(target)) throw new Error(`Tar symbolic link must reference a declared archive member: ${relative}`);
        if (!targetEntry.linkTarget) break;
        target = resolveArchiveLink(target, targetEntry.linkTarget);
      }
      const source = files.get(target);
      const sourcePath = containedPath(root, target);
      const destination = containedPath(root, relative);
      ensureContainedDirectories(root, path.dirname(relative));
      fs.copyFileSync(sourcePath, destination, fs.constants.COPYFILE_EXCL);
      const copied = fs.statSync(destination);
      if (copied.size !== link.expected.size || copied.size !== source.size ||
          (await hashPath(destination)) !== link.expected.sha256.toLowerCase()) {
        throw new Error(`Tar symbolic link copy failed manifest verification: ${relative}`);
      }
      if (link.expected.executable) fs.chmodSync(destination, 0o700);
    }
    return { files: seen.size, bytes: extractedBytes };
  } catch (error) {
    gunzip.destroy();
    for (const relative of seen) fs.rmSync(containedPath(root, relative), { force: true });
    throw error;
  } finally {
    options.signal?.removeEventListener("abort", cancel);
  }
}

async function hashPath(filePath) {
  const hash = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

async function extractZip(archivePath, targetDirectory, resource, options = {}) {
  const files = manifestFiles(resource);
  const archiveSize = fs.statSync(archivePath).size;
  const searchSize = Math.min(archiveSize, 65_557);
  const tail = Buffer.alloc(searchSize);
  const fd = fs.openSync(archivePath, "r");
  try { fs.readSync(fd, tail, 0, tail.length, archiveSize - tail.length); } finally { fs.closeSync(fd); }
  let eocd = -1;
  for (let i = tail.length - 22; i >= Math.max(0, tail.length - 65_557); i--) {
    if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0 || tail.readUInt16LE(eocd + 4) !== 0 || tail.readUInt16LE(eocd + 6) !== 0) {
    throw new Error("Unsupported or invalid zip archive");
  }
  const entries = tail.readUInt16LE(eocd + 10);
  const centralSize = tail.readUInt32LE(eocd + 12);
  const centralOffset = tail.readUInt32LE(eocd + 16);
  const commentLength = tail.readUInt16LE(eocd + 20);
  if (entries > ARCHIVE_ENTRY_LIMIT || centralOffset + centralSize > archiveSize || eocd + 22 + commentLength !== tail.length) {
    throw new Error("Zip directory is outside the archive or exceeds its limit");
  }
  const central = Buffer.alloc(centralSize);
  const centralFd = fs.openSync(archivePath, "r");
  try { fs.readSync(centralFd, central, 0, central.length, centralOffset); } finally { fs.closeSync(centralFd); }
  fs.mkdirSync(targetDirectory, { recursive: true, mode: 0o700 });
  const root = fs.realpathSync(targetDirectory);
  const seen = new Set();
  const byPath = new Map([...files.keys()].map((relative) => [relative.split(path.sep).join("/"), relative]));
  let cursor = 0;
  let extractedBytes = 0;
  try {
    for (let index = 0; index < entries; index++) {
      if (options.signal?.aborted) throw new Error("Installation cancelled");
      if (cursor + 46 > central.length || central.readUInt32LE(cursor) !== 0x02014b50) throw new Error("Zip central directory is malformed");
      const flags = central.readUInt16LE(cursor + 8);
      const method = central.readUInt16LE(cursor + 10);
      const compressedSize = central.readUInt32LE(cursor + 20);
      const uncompressedSize = central.readUInt32LE(cursor + 24);
      const nameLength = central.readUInt16LE(cursor + 28);
      const extraLength = central.readUInt16LE(cursor + 30);
      const commentLengthEntry = central.readUInt16LE(cursor + 32);
      const externalAttributes = central.readUInt32LE(cursor + 38);
      const localOffset = central.readUInt32LE(cursor + 42);
      const end = cursor + 46 + nameLength + extraLength + commentLengthEntry;
      if (end > central.length || (flags & 1) || (method !== 0 && method !== 8)) throw new Error("Zip member is encrypted or uses an unsupported compression method");
      const name = central.subarray(cursor + 46, cursor + 46 + nameLength).toString((flags & 0x800) ? "utf8" : "ascii");
      cursor = end;
      if (name.endsWith("/")) continue;
      const relative = byPath.get(safeEntryPath(name).split(path.sep).join("/"));
      const expected = relative ? files.get(relative) : null;
      const unixMode = (externalAttributes >>> 16) & 0xffff;
      if (!expected || seen.has(relative) || uncompressedSize !== expected.size || (unixMode & 0xf000) === 0xa000) {
        throw new Error(`Zip contains an unexpected, duplicate, or unsafe file: ${name}`);
      }
      if (localOffset + 30 > archiveSize) throw new Error("Zip local file header is out of bounds");
      const localFd = fs.openSync(archivePath, "r");
      const local = Buffer.alloc(30);
      try { fs.readSync(localFd, local, 0, 30, localOffset); } finally { fs.closeSync(localFd); }
      if (local.readUInt32LE(0) !== 0x04034b50) throw new Error("Zip local file header is invalid");
      const localNameLength = local.readUInt16LE(26);
      const localExtraLength = local.readUInt16LE(28);
      const localName = Buffer.alloc(localNameLength);
      const nameFd = fs.openSync(archivePath, "r");
      try { fs.readSync(nameFd, localName, 0, localName.length, localOffset + 30); } finally { fs.closeSync(nameFd); }
      if (!localName.equals(central.subarray(end - nameLength - extraLength - commentLengthEntry, end - extraLength - commentLengthEntry))) {
        throw new Error("Zip local and central paths do not match");
      }
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      const dataEnd = dataStart + compressedSize;
      if (dataEnd > centralOffset) throw new Error("Zip member data overlaps the central directory");
      const source = fs.createReadStream(archivePath, { start: dataStart, end: dataEnd - 1 });
      const decoded = method === 8 ? source.pipe(createInflateRaw()) : source;
      await writeVerifiedStream(decoded, root, relative, expected, options.signal);
      extractedBytes += uncompressedSize;
      seen.add(relative);
    }
    if (cursor !== central.length || seen.size !== files.size) throw new Error("Zip ended before all declared runtime files were verified");
    return { files: seen.size, bytes: extractedBytes };
  } catch (error) {
    for (const relative of seen) fs.rmSync(containedPath(root, relative), { force: true });
    throw error;
  }
}

async function extractResource(archivePath, destination, resource, options = {}) {
  if (resource.archive === "tar.gz") return extractTarGz(archivePath, destination, resource, options);
  if (resource.archive === "zip") return extractZip(archivePath, destination, resource, options);
  if (resource.archive === "file") {
    const files = manifestFiles(resource);
    if (files.size !== 1) throw new Error("Single-file resources must declare exactly one file");
    fs.mkdirSync(destination, { recursive: true, mode: 0o700 });
    const [relative, expected] = files.entries().next().value;
    const input = fs.createReadStream(archivePath);
    await writeVerifiedStream(input, fs.realpathSync(destination), relative, expected, options.signal);
    return { files: 1, bytes: expected.size };
  }
  throw new Error("Unsupported local AI resource archive format");
}

module.exports = { safeEntryPath, manifestFiles, ensureContainedDirectories, resolveArchiveLink, extractResource, extractTarGz, extractZip };
