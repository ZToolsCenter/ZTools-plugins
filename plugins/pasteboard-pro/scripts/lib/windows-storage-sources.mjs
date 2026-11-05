import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import path from "node:path";

export const NATIVE_STORAGE_FILES = Object.freeze([
  "CMakeLists.txt", "private_creation.cpp", "private_handles.cpp", "private_security.cpp",
  "private_security_internal.h", "private_storage.h", "storage_probe.cpp", "storage_probe_acl_cases.cpp",
  "storage_probe_acl_cases.h", "storage_probe_cases.h", "storage_probe_link_cases.cpp",
  "storage_probe_link_cases.h", "storage_probe_report.cpp", "storage_probe_report.h",
]);
export const STORAGE_SOURCE_FILES = Object.freeze([
  ...NATIVE_STORAGE_FILES.map(name => `native/clipboard-storage/windows/${name}`),
  "scripts/clipboard-storage-g1.mjs", "scripts/lib/windows-storage-sources.mjs",
  "scripts/lib/windows-storage-report.mjs", "scripts/lib/windows-storage-probe.mjs",
  "scripts/lib/bounded-process.mjs", "scripts/lib/process-rss.mjs",
].sort());
export const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const failure = () => Object.assign(new Error("Storage probe input rejected"), { code: "input-rejected" });
const same = (a, b) => a.dev === b.dev && a.ino === b.ino && a.size === b.size &&
  a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;

// Tooling for an owner-controlled, quiescent checkout. This is not the Windows
// private-store adapter or a transactional protection against concurrent mutation.
export async function readOwnedInput(root, relative, maximumBytes) {
  if (typeof relative !== "string" || !relative || relative.includes("\\") ||
      relative.split("/").some(part => !part || part === "." || part === "..") ||
      path.isAbsolute(relative) || !Number.isSafeInteger(maximumBytes) || maximumBytes < 1) throw failure();
  const base = await realpath(root);
  const target = path.join(base, ...relative.split("/"));
  if (await realpath(target) !== target) throw failure();
  const before = await lstat(target, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n ||
      before.size < 1n || before.size > BigInt(maximumBytes)) throw failure();
  const handle = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = await handle.stat({ bigint: true });
    if (!opened.isFile() || !same(before, opened)) throw failure();
    const bytes = Buffer.alloc(Number(opened.size));
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, Math.min(65536, bytes.length - offset), offset);
      if (bytesRead === 0) throw failure();
      offset += bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    const named = await lstat(target, { bigint: true });
    if (!same(opened, after) || !same(after, named) || !named.isFile() ||
        named.isSymbolicLink() || named.nlink !== 1n || await realpath(target) !== target) throw failure();
    return bytes;
  } finally { await handle.close(); }
}

// This is an intentionally frozen build-recipe contract, not a CMake parser.
// A new directive, source, subproject, generated source or include requires an
// explicit inventory/contract review; it cannot silently expand the source set.
const SUPPORTED_CMAKE_RECIPE = `cmake_minimum_required(VERSION 3.24)
project(pasteboard_windows_storage_foundation LANGUAGES CXX)
if(NOT WIN32)
  message(FATAL_ERROR "Windows SDK is required; this is not a portable or simulated native test")
endif()
add_executable(windows-storage-foundation
  private_security.cpp
  private_creation.cpp
  private_handles.cpp
  storage_probe.cpp
  storage_probe_report.cpp
  storage_probe_acl_cases.cpp
  storage_probe_link_cases.cpp
)
target_compile_features(windows-storage-foundation PRIVATE cxx_std_17)
target_compile_definitions(windows-storage-foundation PRIVATE
  UNICODE _UNICODE WIN32_LEAN_AND_MEAN NOMINMAX _WIN32_WINNT=0x0A00)
if(NOT MSVC)
  message(FATAL_ERROR "This foundation probe currently requires the MSVC toolchain")
endif()
target_compile_options(windows-storage-foundation PRIVATE /W4 /utf-8 /EHsc)
target_link_libraries(windows-storage-foundation PRIVATE Advapi32 Bcrypt)
`;
function requireSupportedBuildRecipe(body) {
  const canonical = value => value.replace(/\s+/gu, " ").trim();
  if (canonical(body) !== canonical(SUPPORTED_CMAKE_RECIPE)) throw failure();
}

export async function collectStorageSources(root) {
  const native = path.join(root, "native/clipboard-storage/windows");
  const entries = await readdir(native, { withFileTypes: true });
  if (entries.some(entry => !entry.isFile()) ||
      JSON.stringify(entries.map(entry => entry.name).sort()) !== JSON.stringify(NATIVE_STORAGE_FILES)) throw failure();
  const sourceHashes = {};
  const bodies = {};
  for (const name of STORAGE_SOURCE_FILES) {
    const bytes = await readOwnedInput(root, name, 2 * 1024 * 1024);
    sourceHashes[name] = sha256(bytes);
    const body = bytes.toString("utf8");
    if (name.startsWith("native/")) bodies[path.basename(name)] = body;
    else {
      for (const match of body.matchAll(/(?:from |import )["'](\.[^"']+)["']/gu)) {
        const dependency = path.posix.normalize(path.posix.join(path.posix.dirname(name), match[1]));
        if (!STORAGE_SOURCE_FILES.includes(dependency)) throw failure();
      }
    }
  }
  requireSupportedBuildRecipe(bodies["CMakeLists.txt"]);
  for (const body of Object.values(bodies)) {
    for (const match of body.matchAll(/^#include "([^"]+)"/gmu)) {
      if (!Object.hasOwn(bodies, match[1])) throw failure();
    }
  }
  return sourceHashes;
}
