import { constants } from "node:fs";
import { open, lstat, mkdir, opendir, realpath } from "node:fs/promises";
import path from "node:path";
import { validateArchivePath, normalizeSourceKitLimits } from "./source-kit-zip.mjs";

export const CODEC_SOURCE_FILES = Object.freeze([
  "native/clipboard-format/codec-tests/CMakeLists.txt",
  "native/clipboard-format/codec-tests/capture_wire_cases.cpp",
  "native/clipboard-format/codec-tests/capture_wire_cases.h",
  "native/clipboard-format/codec-tests/capture_wire_v2_cases.cpp",
  "native/clipboard-format/codec-tests/capture_wire_v2_cases.h",
  "native/clipboard-format/codec-tests/cf_html_cases.cpp",
  "native/clipboard-format/codec-tests/cf_html_cases.h",
  "native/clipboard-format/codec-tests/main.cpp",
  "native/clipboard-format/codec-tests/png_cases.cpp",
  "native/clipboard-format/codec-tests/png_cases.h",
  "native/clipboard-format/codec-tests/policy_cases.cpp",
  "native/clipboard-format/codec-tests/policy_cases.h",
  "native/clipboard-format/codec-tests/reparse_cases.cpp",
  "native/clipboard-format/codec-tests/reparse_cases.h",
  "native/clipboard-format/codec-tests/rtf_cases.cpp",
  "native/clipboard-format/codec-tests/rtf_cases.h",
  "native/clipboard-format/codec-tests/tiff_case_builder.cpp",
  "native/clipboard-format/codec-tests/tiff_case_builder.h",
  "native/clipboard-format/codec-tests/tiff_cases.cpp",
  "native/clipboard-format/codec-tests/tiff_cases.h",
  "native/clipboard-format/codec-tests/tiff_reference_cases.cpp",
  "native/clipboard-format/codec-tests/url_cases.cpp",
  "native/clipboard-format/codec-tests/url_cases.h",
]);

export async function inspectSourceFile(root, relativePath, maxFileBytes = undefined) {
  const limits = normalizeSourceKitLimits();
  const maximum = maxFileBytes ?? limits.maxFileBytes;
  if (!Number.isSafeInteger(maximum) || maximum < 0 || maximum > limits.maxFileBytes) {
    throw new TypeError("maxFileBytes must be a nonnegative limit within the source-kit cap");
  }
  const safePath = validateArchivePath(relativePath);
  const rootReal = await realpath(root);
  const rootPrefix = `${rootReal}${path.sep}`;
  let cursor = rootReal;
  const parts = safePath.split("/");
  for (let index = 0; index < parts.length; index += 1) {
    cursor = path.join(cursor, parts[index]);
    const info = await lstat(cursor);
    if (info.isSymbolicLink()) throw new TypeError(`Source path contains a symlink: ${safePath}`);
    const canonical = await realpath(cursor);
    if (!canonical.startsWith(rootPrefix)) throw new TypeError(`Source path escapes plugin root: ${safePath}`);
    if (index < parts.length - 1 && !info.isDirectory()) {
      throw new TypeError(`Source path parent is not a directory: ${safePath}`);
    }
    if (index === parts.length - 1 && !info.isFile()) {
      throw new TypeError(`Source path is not a regular file: ${safePath}`);
    }
    if (index === parts.length - 1 && info.size > maximum) {
      throw new TypeError(`Source file exceeds maxFileBytes (${maximum}): ${safePath}`);
    }
  }
  return { path: cursor, size: (await lstat(cursor)).size };
}

export async function readSourceFile(root, relativePath, { maxBytes = undefined } = {}) {
  const safePath = validateArchivePath(relativePath);
  const limits = normalizeSourceKitLimits();
  const maximum = maxBytes ?? limits.maxFileBytes;
  const inspected = await inspectSourceFile(root, safePath, maximum);
  const handle = await open(inspected.path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = await handle.stat();
    if (!opened.isFile()) throw new TypeError(`Source path is not a regular file: ${safePath}`);
    if (opened.size > maximum) throw new TypeError(`Source file exceeds maxFileBytes (${maximum}): ${safePath}`);
    return await readHandleBounded(handle, maximum, safePath);
  } finally {
    await handle.close();
  }
}

export async function preflightCollectorSources(root, runnerFiles, limits = undefined) {
  const caps = normalizeSourceKitLimits(limits);
  const candidates = new Map();
  for (const [directory, maximum] of [
    ["native/clipboard-format/windows", 96],
    ["native/clipboard-format/common", 48],
  ]) {
    const absoluteDirectory = path.join(root, ...directory.split("/"));
    const directoryHandle = await opendir(absoluteDirectory);
    const files = [];
    let scanned = 0;
    for await (const entry of directoryHandle) {
      scanned += 1;
      if (scanned > caps.maxEntries) throw new TypeError(`G0 source directory exceeds maxEntries (${caps.maxEntries}): ${directory}`);
      if (entry.name !== "CMakeLists.txt" && !/\.(?:h|hpp|cpp|mm)$/u.test(entry.name)) continue;
      if (entry.isSymbolicLink()) throw new TypeError(`G0 source directory contains a symlink: ${directory}/${entry.name}`);
      if (entry.isFile()) files.push(entry.name);
    }
    files.sort(compareStrings);
    if (files.length === 0 || files.length > maximum) throw new TypeError(`Invalid bounded G0 source set: ${directory}`);
    for (const file of files) candidates.set(`${directory}/${file}`, true);
  }
  for (const runner of runnerFiles) candidates.set(validateArchivePath(runner), true);

  let totalBytes = 0;
  for (const source of [...candidates.keys()].sort(compareStrings)) {
    const inspected = await inspectSourceFile(root, source, caps.maxFileBytes);
    totalBytes += inspected.size;
    if (totalBytes > caps.maxTotalBytes) {
      throw new TypeError(`G0 sources exceed maxTotalBytes (${caps.maxTotalBytes}) before collector reads`);
    }
  }
  return { sourceCount: candidates.size, totalBytes };
}

export async function listExactSourceTree(root, relativeDirectory, expectedFiles = CODEC_SOURCE_FILES, limitsOverride = undefined) {
  const limits = normalizeSourceKitLimits(limitsOverride);
  const safeDirectory = validateArchivePath(relativeDirectory);
  const expected = new Set(expectedFiles.map(file => validateArchivePath(file)));
  const directoryPrefix = `${safeDirectory}/`;
  if ([...expected].some(file => !file.startsWith(directoryPrefix))) {
    throw new TypeError("Exact source inventory contains a path outside its tree");
  }
  const allowedDirectories = new Set([safeDirectory]);
  for (const file of expected) {
    let parent = path.posix.dirname(file);
    while (parent.startsWith(directoryPrefix)) {
      allowedDirectories.add(parent);
      parent = path.posix.dirname(parent);
    }
  }
  const absoluteRoot = path.resolve(root, ...safeDirectory.split("/"));
  const rootInfo = await lstat(absoluteRoot);
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) {
    throw new TypeError(`Source tree root is not a regular directory: ${safeDirectory}`);
  }
  const seen = new Set();
  let visitedEntries = 0;
  const walk = async (absolute, relative) => {
    const directoryHandle = await opendir(absolute);
    for await (const entry of directoryHandle) {
      visitedEntries += 1;
      if (visitedEntries > limits.maxEntries) throw new TypeError(`Source tree exceeds maxEntries (${limits.maxEntries})`);
      const child = `${relative}/${entry.name}`;
      if (entry.isSymbolicLink()) throw new TypeError(`Source tree contains a symlink: ${child}`);
      if (entry.isDirectory()) {
        if (!allowedDirectories.has(child)) throw new TypeError(`Unexpected source directory: ${child}`);
        await walk(path.join(absolute, entry.name), child);
      } else if (entry.isFile()) {
        if (!expected.has(child)) throw new TypeError(`Unexpected source file: ${child}`);
        seen.add(child);
      } else {
        throw new TypeError(`Source tree contains a non-regular entry: ${child}`);
      }
    }
  };
  await walk(absoluteRoot, safeDirectory);
  const missing = [...expected].filter(file => !seen.has(file));
  if (missing.length > 0) throw new TypeError(`Missing exact source inventory entry: ${missing[0]}`);
  return [...expected].sort(compareStrings);
}

export function createPayloadBudget(limits = undefined) {
  const caps = normalizeSourceKitLimits(limits);
  const entries = new Map();
  let totalBytes = 0;
  return {
    reserve(relativePath, expectedBytes) {
      const existing = entries.get(relativePath);
      if (existing) return existing.maxBytes;
      if (entries.size >= caps.maxEntries - 1) {
        throw new TypeError(`Payload exceeds maxEntries (${caps.maxEntries}) before reading: ${relativePath}`);
      }
      if (!Number.isSafeInteger(expectedBytes) || expectedBytes < 0 || expectedBytes > caps.maxFileBytes) {
        throw new TypeError(`Source file exceeds maxFileBytes (${caps.maxFileBytes}): ${relativePath}`);
      }
      const maxBytes = Math.min(caps.maxFileBytes, caps.maxTotalBytes - totalBytes);
      if (expectedBytes > maxBytes) {
        throw new TypeError(`Payload exceeds maxTotalBytes (${caps.maxTotalBytes}) before reading: ${relativePath}`);
      }
      entries.set(relativePath, { expectedBytes, maxBytes });
      totalBytes += expectedBytes;
      return maxBytes;
    },
    commit(relativePath, actualBytes) {
      const item = entries.get(relativePath);
      if (!item || !Number.isSafeInteger(actualBytes) || actualBytes < 0 || actualBytes > item.maxBytes) {
        throw new TypeError(`Source file exceeded its bounded payload read: ${relativePath}`);
      }
      totalBytes += actualBytes - item.expectedBytes;
      item.expectedBytes = actualBytes;
      item.maxBytes = actualBytes;
    },
    addGenerated(relativePath, bytes) {
      this.reserve(relativePath, bytes.byteLength);
      this.commit(relativePath, bytes.byteLength);
    },
      assertEntryCount(count) {
      if (!Number.isSafeInteger(count) || count > caps.maxEntries) {
        throw new TypeError(`Payload exceeds maxEntries (${caps.maxEntries})`);
      }
    },
    get totalBytes() { return totalBytes; },
  };
}

export async function snapshotArtifactLocation(pluginRoot, requestedOutputDirectory, defaultOutputDirectory) {
  const root = await realpath(pluginRoot);
  const rootInfo = await lstat(root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new TypeError("Plugin root must be a real directory");
  const artifacts = path.join(root, "artifacts");
  const directory = path.resolve(root, requestedOutputDirectory ?? defaultOutputDirectory);
  assertInsideArtifacts(root, artifacts, directory);
  const chain = [{ path: root, identity: directoryIdentity(rootInfo) }];
  let missingFrom;
  for (const target of [artifacts, ...outputSegments(artifacts, directory)]) {
    try {
      const info = await lstat(target);
      if (info.isSymbolicLink() || !info.isDirectory()) throw new TypeError("Output path contains a symlink or non-directory");
      if (await realpath(target) !== target) throw new TypeError("Output path resolves through a symlink");
      chain.push({ path: target, identity: directoryIdentity(info) });
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      missingFrom = target;
      break;
    }
  }
  return { root, directory, artifacts, chain, missingFrom };
}

export async function ensureArtifactDirectory(snapshot) {
  await verifyDirectoryChain(snapshot, { allowMissing: true });
  const existing = new Map(snapshot.chain.map(item => [item.path, item.identity]));
  const targets = [snapshot.artifacts, ...outputSegments(snapshot.artifacts, snapshot.directory)];
  const chain = [...snapshot.chain];
  for (const target of targets) {
    if (existing.has(target)) continue;
    try {
      await mkdir(target);
    } catch (error) {
      if (error?.code === "EEXIST") throw new TypeError("Output directory appeared during source preparation");
      if (error?.code !== "ENOENT") throw error;
      throw new TypeError("Output parent disappeared during source preparation");
    }
    const info = await lstat(target);
    if (info.isSymbolicLink() || !info.isDirectory() || await realpath(target) !== target) {
      throw new TypeError("Created output path is not a regular directory");
    }
    chain.push({ path: target, identity: directoryIdentity(info) });
  }
  return { ...snapshot, chain, missingFrom: undefined };
}

export async function revalidateArtifactDirectory(snapshot) {
  await verifyDirectoryChain(snapshot, { allowMissing: false });
}

async function verifyDirectoryChain(snapshot, { allowMissing }) {
  const currentRoot = await realpath(snapshot.root);
  if (currentRoot !== snapshot.root) throw new TypeError("Plugin root changed during source preparation");
  for (const item of snapshot.chain) {
    const info = await lstat(item.path);
    if (info.isSymbolicLink() || !info.isDirectory() || await realpath(item.path) !== item.path ||
        directoryIdentity(info) !== item.identity) {
      throw new TypeError("Output directory identity changed during source preparation");
    }
  }
  if (!allowMissing && snapshot.missingFrom) throw new TypeError("Output directory chain is incomplete");
}

async function readHandleBounded(handle, maxBytes, relativePath) {
  const chunks = [];
  let total = 0;
  while (true) {
    const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, maxBytes - total + 1));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
    if (bytesRead === 0) break;
    total += bytesRead;
    if (total > maxBytes) throw new TypeError(`Source grew beyond maxFileBytes (${maxBytes}) while reading: ${relativePath}`);
    chunks.push(buffer.subarray(0, bytesRead));
  }
  return Buffer.concat(chunks, total);
}

function assertInsideArtifacts(root, artifacts, directory) {
  const relative = path.relative(artifacts, directory);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new TypeError("Output directory must remain inside the plugin artifacts directory");
  }
  if (path.relative(root, artifacts) !== "artifacts") throw new TypeError("Plugin artifacts root must be beneath the plugin root");
}

function outputSegments(artifacts, directory) {
  const relative = path.relative(artifacts, directory);
  return relative.split(path.sep).filter(Boolean).map((_, index, parts) => path.join(artifacts, ...parts.slice(0, index + 1)));
}

function directoryIdentity(info) {
  return `${String(info.dev)}:${String(info.ino)}:${String(info.birthtimeMs)}`;
}

function compareStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}
