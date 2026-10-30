import { createHash, randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import { rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { collectG0Sources } from "./clipboard-format-g0-sources.mjs";
import { requiredProbeCases } from "./clipboard-format-g0-cases.mjs";
import { createDeterministicZip, normalizeSourceKitLimits, validateArchivePath } from "./source-kit-zip.mjs";
import {
  CODEC_SOURCE_FILES,
  createPayloadBudget,
  ensureArtifactDirectory,
  inspectSourceFile,
  listExactSourceTree,
  preflightCollectorSources,
  readSourceFile,
  revalidateArtifactDirectory,
  snapshotArtifactLocation,
} from "./source-kit-files.mjs";
export { createDeterministicZip } from "./source-kit-zip.mjs";
export { readSourceFile } from "./source-kit-files.mjs";

const VERSION = "0.27.0";
const PHASE = "v0.27";
const DEFAULT_OUTPUT = "artifacts/pasteboardpro/clipboard-format-g0/v027-windows-source-kit";
const CONTRACT_TESTS = Object.freeze([
  "scripts/test-clipboard-format-g0.mjs",
  "scripts/test-clipboard-format-windows-receipts.mjs",
  "scripts/test-bounded-process.mjs",
  "scripts/test-clipboard-format-g0-sources.mjs",
]);
const RUNNER_FILES = Object.freeze([
  "scripts/clipboard-format-g0.mjs",
  "scripts/lib/clipboard-format-g0-report.mjs",
  "scripts/lib/clipboard-format-g0-cases.mjs",
  "scripts/lib/clipboard-format-g0-sources.mjs",
  "scripts/lib/bounded-process.mjs",
  "scripts/lib/process-rss.mjs",
  "scripts/lib/clipboard-format-g0-windows-receipts.mjs",
]);
const WINDOWS_CMAKE = "native/clipboard-format/windows/CMakeLists.txt";
const CODEC_CMAKE = "native/clipboard-format/codec-tests/CMakeLists.txt";
const INTEGRITY_VERIFIER = "scripts/verify-windows-source-kit.mjs";
const SHA256_RE = /^[0-9a-f]{64}$/u;

export async function prepareWindowsSourceKit(pluginRoot, { limits: overrides } = {}) {
  const root = await realpath(pluginRoot);
  const limits = normalizeSourceKitLimits(overrides);
  await preflightCollectorSources(root, RUNNER_FILES, limits);
  const sourceSet = await collectG0Sources(root, "win32");
  const budget = createPayloadBudget(limits);
  const payload = new Map();
  const addFile = async relativePath => {
    const normalized = validateArchivePath(relativePath);
    if (payload.has(normalized)) return payload.get(normalized);
    const metadata = await inspectSourceFile(root, normalized, limits.maxFileBytes);
    const readLimit = budget.reserve(normalized, metadata.size);
    const bytes = await readSourceFile(root, normalized, { maxBytes: readLimit });
    budget.commit(normalized, bytes.length);
    const expectedHash = sourceSet.sourceHashes[normalized];
    if (expectedHash && sha256(bytes) !== expectedHash) {
      throw new TypeError(`Fingerprint changed while packaging: ${normalized}`);
    }
    payload.set(normalized, bytes);
    return bytes;
  };

  for (const source of Object.keys(sourceSet.sourceHashes).sort(compareStrings)) await addFile(source);
  budget.assertEntryCount(payload.size + 1);
  for (const source of await listExactSourceTree(root, "native/clipboard-format/codec-tests", CODEC_SOURCE_FILES, limits)) {
    await addFile(source);
  }
  for (const source of await collectRelativeImportClosure(root, [...RUNNER_FILES, ...CONTRACT_TESTS], limits.maxEntries)) await addFile(source);

  const nativeSourceCount = Object.keys(sourceSet.sourceHashes)
    .filter(source => source.startsWith("native/clipboard-format/")).length;
  const runnerSourceCount = Object.keys(sourceSet.sourceHashes)
    .filter(source => source.startsWith("scripts/")).length;
  if (Object.keys(sourceSet.sourceHashes).length !== 121 || nativeSourceCount !== 114 ||
      runnerSourceCount !== RUNNER_FILES.length) {
    throw new TypeError("Current Windows G0 fingerprint inventory does not match the v0.27 source-kit contract");
  }
  for (const runner of RUNNER_FILES) {
    if (!sourceSet.sourceHashes[runner]) throw new TypeError(`Missing G0 runner fingerprint: ${runner}`);
  }

  const windowsCMakeBytes = await payload.get(WINDOWS_CMAKE) ?? await addFile(WINDOWS_CMAKE);
  const codecCmakeBytes = payload.get(CODEC_CMAKE);
  if (!codecCmakeBytes) throw new TypeError("Portable codec CMakeLists.txt is missing from the source tree");
  const windowsCMakeCppCount = countCmakeCppSources(windowsCMakeBytes);
  const portableCodecCMakeCppCount = countCmakeCppSources(codecCmakeBytes);
  if (windowsCMakeCppCount !== 63 || portableCodecCMakeCppCount !== 28) {
    throw new TypeError("CMake source inventory changed; review the v0.27 manifest contract before packaging");
  }

  const windowsCaseIds = [...requiredProbeCases.win32];
  if (windowsCaseIds.length !== 105 || new Set(windowsCaseIds).size !== windowsCaseIds.length) {
    throw new TypeError("Windows native case inventory changed; review the v0.27 manifest contract before packaging");
  }

  const addGenerated = (relativePath, contents) => {
    budget.addGenerated(relativePath, contents);
    payload.set(relativePath, contents);
  };
  addGenerated(INTEGRITY_VERIFIER, Buffer.from(renderIntegrityVerifier(), "utf8"));
  addGenerated("README.md", Buffer.from(renderReadme({
    sourceCount: Object.keys(sourceSet.sourceHashes).length,
    caseCount: windowsCaseIds.length,
    windowsCMakeCppCount,
    portableCodecCMakeCppCount,
  }), "utf8"));
  addGenerated("package.json", Buffer.from(renderPackageJson(), "utf8"));
  budget.assertEntryCount(payload.size + 1);
  const payloadEntries = [...payload.entries()].map(([archivePath, bytes]) => ({ path: archivePath, bytes }));
  const files = Object.fromEntries(payloadEntries
    .sort((left, right) => compareStrings(left.path, right.path))
    .map(({ path: archivePath, bytes }) => [archivePath, { bytes: bytes.length, sha256: sha256(bytes) }]));
  const manifest = {
    schemaVersion: 1,
    phase: PHASE,
    version: VERSION,
    sourceOnly: true,
    gateComplete: false,
    windowsBuild: "NOT-RUN",
    windowsExecution: "NOT-RUN",
    windowsNativeCases: { count: windowsCaseIds.length, execution: "NOT-RUN", ids: windowsCaseIds },
    windowsSourceInventoryCount: Object.keys(sourceSet.sourceHashes).length,
    windowsNativeSourceCount: nativeSourceCount,
    windowsRunnerSourceCount: runnerSourceCount,
    windowsCMakeCppCount,
    portableCodecCMakeCppCount,
    sourceInventory: Object.keys(sourceSet.sourceHashes).sort(compareStrings),
    hashedPayloadFileCount: payloadEntries.length,
    archiveEntryCount: payloadEntries.length + 1,
    manifestSelfHash: "excluded",
    files,
  };
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const entries = [...payloadEntries, { path: "SOURCE_MANIFEST.json", bytes: manifestBytes }];
  const archiveBytes = createDeterministicZip(entries, { limits });
  return { archiveBytes, manifest, manifestBytes, entryCount: entries.length };
}


export async function writeWindowsSourceKit(pluginRoot, requestedOutputDirectory = undefined) {
  const root = await realpath(pluginRoot);
  const priorOutput = await snapshotArtifactLocation(root, requestedOutputDirectory, DEFAULT_OUTPUT);
  const prepared = await prepareWindowsSourceKit(root);
  const outputLocation = await ensureArtifactDirectory(priorOutput);
  const outputDirectory = outputLocation.directory;
  const producerSourcePaths = [
    "scripts/package-clipboard-format-windows-source-kit.mjs",
    "scripts/lib/windows-source-kit.mjs",
    "scripts/lib/source-kit-files.mjs",
    "scripts/lib/source-kit-zip.mjs",
  ];
  const producerSources = [];
  for (const source of producerSourcePaths) {
    const bytes = await readSourceFile(root, source);
    producerSources.push({ path: source, sha256: sha256(bytes) });
  }
  const archiveName = "pasteboardpro-windows-source-kit-v0.27.zip";
  const manifestName = "SOURCE_MANIFEST.json";
  const receiptName = "producer-receipt.json";
  const receipt = {
    schemaVersion: 1,
    phase: PHASE,
    version: VERSION,
    sourceOnly: true,
    gateComplete: false,
    generatedAt: new Date().toISOString(),
    producer: "scripts/package-clipboard-format-windows-source-kit.mjs",
    producerSources,
    nodeVersion: process.version,
    archive: { file: archiveName, bytes: prepared.archiveBytes.length, sha256: sha256(prepared.archiveBytes) },
    manifest: { file: manifestName, bytes: prepared.manifestBytes.length, sha256: sha256(prepared.manifestBytes) },
    windowsSourceInventoryCount: prepared.manifest.windowsSourceInventoryCount,
    windowsNativeCases: { count: prepared.manifest.windowsNativeCases.count, execution: "NOT-RUN" },
    zipEntryCount: prepared.entryCount,
    archiveByteReproducibility: "deterministic for identical source bytes and Node/zlib implementation",
  };
  await replaceFile(path.join(outputDirectory, archiveName), prepared.archiveBytes, outputLocation);
  await replaceFile(path.join(outputDirectory, manifestName), prepared.manifestBytes, outputLocation);
  await replaceFile(path.join(outputDirectory, receiptName), Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, "utf8"), outputLocation);
  return { outputDirectory, archiveName, manifestName, receiptName, receipt };
}

function renderPackageJson() {
  return `${JSON.stringify({
    name: "pasteboard-pro-clipboard-format-g0-windows-source-kit",
    private: true,
    version: VERSION,
    type: "module",
    engines: { node: ">=24.15.0 <25" },
    scripts: {
      "verify:source-kit": "node scripts/verify-windows-source-kit.mjs",
      "test:contracts": "node --test scripts/test-clipboard-format-g0.mjs scripts/test-clipboard-format-windows-receipts.mjs scripts/test-bounded-process.mjs scripts/test-clipboard-format-g0-sources.mjs",
      "configure:portable-codec": "cmake -S native/clipboard-format/codec-tests -B build/codec-tests",
      "build:portable-codec": "cmake --build build/codec-tests --config Release",
      "test:portable-codec": "ctest --test-dir build/codec-tests -C Release --output-on-failure",
      "configure:windows:x64": "cmake -S native/clipboard-format/windows -B build/windows-x64 -A x64",
      "configure:windows:arm64": "cmake -S native/clipboard-format/windows -B build/windows-arm64 -A ARM64",
      "g0:build-only": "node scripts/clipboard-format-g0.mjs --build-only",
      "g0:self-test": "node scripts/clipboard-format-g0.mjs --self-test",
    },
  }, null, 2)}\n`;
}

function renderReadme({ sourceCount, caseCount, windowsCMakeCppCount, portableCodecCMakeCppCount }) {
  return `# PasteboardPro Windows clipboard format G0 source kit v0.27\n\n` +
`This archive is a source-only validation kit. It is not an installable ZTools plugin, does not install or publish anything, and does not grant G0 approval. The included Windows native sources and all ${caseCount} expected native case IDs remain \`NOT-RUN\` until a real Windows run produces a separately reviewed receipt.\n\n` +
`## Host requirements\n\n` +
`- Windows 10 and Windows 11 must be validated separately on real target systems.\n` +
`- Node.js 24.15.0 (the current verification baseline), CMake 3.24 or newer, Visual Studio with the C++ workload, and a Windows SDK are required for native builds.\n` +
`- The kit producer and contract tests were verified with Node.js 24.15.0; other Node versions need separate verification.\n` +
`- Use a Visual Studio CMake generator that supports the -A architecture option; the documented x64/ARM64 commands do not work with the Ninja generator.\n` +
`- Configure and accept x64 and ARM64 as separate targets. The included G0 CLI selects architecture from the running Node process; use a matching native Node/Windows host for each G0 receipt.\n` +
`- Keep the complete checkout/extraction path representable in the current Windows ANSI code page for the ANSI file-list fixture. An ASCII-only checkout path is a practical fixture prerequisite; it is not a product ASCII-only claim. If the path cannot round-trip losslessly, that ANSI fixture stays \`NOT-RUN\`.\n\n` +
`## Portable checks\n\n` +
`Verify the extracted payload against its included manifest on Windows, macOS, or Linux. A verifier PASS means the listed bytes match that manifest; it is not a signature, native test result, or G0 approval:\n\n` +
`~~~powershell\nnpm run verify:source-kit\n~~~\n\n` +
`Run the source-only JavaScript contract suite (it does not execute the Mac-only native watchdog):\n\n` +
`~~~powershell\nnpm run test:contracts\n~~~\n\n` +
`Build and run the portable codec suite from a clean extraction:\n\n` +
`~~~powershell\nnpm run configure:portable-codec\nnpm run build:portable-codec\nnpm run test:portable-codec\n~~~\n\n` +
`The portable codec CMake target currently lists ${portableCodecCMakeCppCount} C++ translation units. Its result checks portable codec behavior only; it is not Windows clipboard API, application, OS, or release evidence.\n\n` +
`## Windows build and G0 execution\n\n` +
`The native Windows CMake target currently lists ${windowsCMakeCppCount} C++ translation units. Configure each architecture in a distinct build directory:\n\n` +
`~~~powershell\nnpm run configure:windows:x64\nnpm run configure:windows:arm64\n~~~\n\n` +
`Those commands configure the respective CMake trees. Build each configured target with \`cmake --build build/windows-x64 --config Release\` or \`cmake --build build/windows-arm64 --config Release\`. The runner's \`--build-only\` command is an explicit \`NOT-RUN\` execution result, even after compilation succeeds:\n\n` +
`~~~powershell\nnpm run g0:build-only\n~~~\n\n` +
`Only run \`npm run g0:self-test\` in a controlled Windows test environment after reviewing the test plan. The probe uses a private window station and private clipboard. If private-station isolation cannot be created, do not fall back to \`WinSta0\` and do not elevate to bypass that failure; record the case as not run or failed according to its evidence.\n\n` +
`## Packaging limits\n\n` +
`Each source or payload file is capped at 4 MiB, total uncompressed payload at 32 MiB, compressed data and final ZIP at 64 MiB, archive entries at 512, and each UTF-8 archive name at 1024 bytes. These package bounds reject unexpectedly large inputs before they are retained or compressed.\n\n` +
`## Evidence limits\n\n` +
`- The current G0 source fingerprint inventory contains ${sourceCount} paths. Source presence, JavaScript contract PASS, portable codec PASS, and a successful helper run are separate evidence layers.\n` +
`- A helper PASS does not prove behavior in target applications, Windows 10 and Windows 11 compatibility, production readiness, or release approval. Validate the agreed application/format matrix and preserve native receipts independently.\n` +
`- The G0 receipt keeps \`gateComplete: false\`; this archive's manifest never changes the ${caseCount} Windows native cases from \`NOT-RUN\`.\n` +
`- Build from a trusted, quiescent local source tree. Reads and archives are size-bounded and output paths are revalidated, but generation is not a filesystem transaction and does not guarantee consistency under concurrent source/output replacement.\n` +
`- No external npm dependencies are required. The package is private and has no dependency installation step.\n`;
}

function renderIntegrityVerifier() {
  return String.raw`import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const digestPattern = /^[0-9a-f]{64}$/u;
const maxFileBytes = 4 * 1024 * 1024;
const maxTotalBytes = 32 * 1024 * 1024;

function fail(message) {
  throw new TypeError(message);
}

function validatePath(value) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\\") || value.includes("\0") ||
      value.startsWith("/") || /^[A-Za-z]:/u.test(value) || /[\u0000-\u001f\u007f]/u.test(value)) fail("Unsafe manifest path");
  const parts = value.split("/");
  if (parts.some(part => part.length === 0 || part === "." || part === ".." || part.includes(":")) ||
      path.posix.normalize(value) !== value) fail("Unsafe manifest path");
  return parts;
}

async function main() {
  const rootReal = await realpath(root);
  const manifestPath = path.join(rootReal, "SOURCE_MANIFEST.json");
  const manifestInfo = await lstat(manifestPath);
  if (!manifestInfo.isFile() || manifestInfo.isSymbolicLink() || manifestInfo.size > maxFileBytes) fail("Manifest exceeds maxFileBytes");
  const manifestBytes = await readFile(manifestPath);
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  if (manifest.schemaVersion !== 1 || manifest.phase !== "v0.27" || manifest.version !== "0.27.0" ||
      manifest.sourceOnly !== true || manifest.gateComplete !== false || manifest.manifestSelfHash !== "excluded") {
    fail("Manifest metadata is not an unelevated v0.27 source-only record");
  }
  if (manifest.windowsBuild !== "NOT-RUN" || manifest.windowsExecution !== "NOT-RUN" ||
      manifest.windowsNativeCases?.execution !== "NOT-RUN" || manifest.windowsNativeCases?.count !== 105) {
    fail("Manifest must keep all Windows native cases NOT-RUN");
  }
  const entries = Object.entries(manifest.files ?? {});
  if (entries.length !== manifest.hashedPayloadFileCount || manifest.archiveEntryCount !== entries.length + 1) {
    fail("Manifest payload counts do not match");
  }
  const seen = new Set();
  let totalExpectedBytes = 0;
  const rootPrefix = rootReal.endsWith(path.sep) ? rootReal : rootReal + path.sep;
  for (const [relativePath, record] of entries) {
    const parts = validatePath(relativePath);
    const folded = relativePath.toLowerCase();
    if (seen.has(folded)) fail("Manifest contains a case-fold duplicate path");
    seen.add(folded);
    if (!Number.isSafeInteger(record?.bytes) || record.bytes < 0 || record.bytes > maxFileBytes ||
        !digestPattern.test(record?.sha256 ?? "")) fail("Manifest contains an invalid file record or maxFileBytes overflow");
    totalExpectedBytes += record.bytes;
    if (totalExpectedBytes > maxTotalBytes) fail("Manifest payload exceeds maxTotalBytes");
    let cursor = rootReal;
    for (const part of parts) {
      cursor = path.join(cursor, part);
      const info = await lstat(cursor);
      if (info.isSymbolicLink()) fail("Payload contains a symlink");
      const canonical = await realpath(cursor);
      if (!canonical.startsWith(rootPrefix)) fail("Payload path escapes the extracted kit");
    }
    const info = await lstat(cursor);
    if (!info.isFile() || info.size !== record.bytes || info.size > maxFileBytes) {
      fail("Payload entry size or type does not match its bounded manifest record");
    }
    const bytes = await readFile(cursor);
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (bytes.length !== record.bytes || digest !== record.sha256) fail("Payload bytes do not match the manifest");
  }
  const inventory = manifest.sourceInventory;
  if (!Array.isArray(inventory) || inventory.length !== manifest.windowsSourceInventoryCount ||
      new Set(inventory).size !== inventory.length || inventory.some(file => !seen.has(file.toLowerCase()))) {
    fail("Windows source inventory does not match the manifested files");
  }
  process.stdout.write(JSON.stringify({
    phase: manifest.phase,
    integrity: "PASS",
    payloadFilesVerified: entries.length,
    windowsNativeCases: { count: manifest.windowsNativeCases.count, execution: "NOT-RUN" },
    gateComplete: false,
    meaning: "Manifest-listed payload bytes match; no Windows native or target-application validation was run.",
  }, null, 2) + "\n");
}

main().catch(error => {
  process.stderr.write((error?.stack ?? String(error)) + "\n");
  process.exitCode = 1;
});
`;
}

async function collectRelativeImportClosure(root, entryPoints, maxModules = 512) {
  const pending = [...entryPoints];
  const visited = new Set();
  while (pending.length > 0) {
    const relativePath = validateArchivePath(pending.pop());
    if (visited.has(relativePath)) continue;
    if (visited.size + 1 > maxModules) throw new TypeError(`Module closure exceeds maxEntries (${maxModules})`);
    visited.add(relativePath);
    const bytes = await readSourceFile(root, relativePath);
    const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    for (const match of source.matchAll(/\b(?:from\s*|import\s*)["']([^"']+)["']/gu)) {
      const specifier = match[1];
      if (!specifier.startsWith(".")) continue;
      const base = path.posix.normalize(path.posix.join(path.posix.dirname(relativePath), specifier));
      const candidates = path.posix.extname(base)
        ? [base]
        : [base, `${base}.mjs`, `${base}.js`, `${base}.cjs`, `${base}/index.mjs`, `${base}/index.js`];
      let resolved;
      for (const candidate of candidates) {
        const normalized = validateArchivePath(candidate);
        try {
          await readSourceFile(root, normalized);
          resolved = normalized;
          break;
        } catch (error) {
          if (error?.code !== "ENOENT") throw error;
        }
      }
      if (!resolved) throw new TypeError(`Unresolved relative module import: ${relativePath} -> ${specifier}`);
      pending.push(resolved);
    }
  }
  return [...visited].sort(compareStrings);
}

async function replaceFile(target, bytes, outputLocation) {
  await revalidateArtifactDirectory(outputLocation);
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, bytes, { flag: "wx", mode: 0o600 });
    await revalidateArtifactDirectory(outputLocation);
    await rename(temporary, target);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
}


function countCmakeCppSources(bytes) {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/#[^\r\n]*/gu, "");
  const sources = [...text.matchAll(/(?<![A-Za-z0-9_./-])([A-Za-z0-9_./-]+\.cpp)\b/gu)].map(match => match[1]);
  if (new Set(sources).size !== sources.length) throw new TypeError("CMake contains duplicate C++ source entries");
  return sources.length;
}

function validateSha256(value) {
  if (!SHA256_RE.test(value)) throw new TypeError("Invalid SHA-256 digest");
}

function sha256(bytes) {
  const digest = createHash("sha256").update(bytes).digest("hex");
  validateSha256(digest);
  return digest;
}


function compareStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}
