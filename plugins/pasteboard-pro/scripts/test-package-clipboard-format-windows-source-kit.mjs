import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, mkdtemp, mkdir, readdir, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { collectG0Sources } from "./lib/clipboard-format-g0-sources.mjs";
import { revalidateArtifactDirectory, snapshotArtifactLocation } from "./lib/source-kit-files.mjs";
import {
  createDeterministicZip,
  prepareWindowsSourceKit,
  readSourceFile,
} from "./lib/windows-source-kit.mjs";

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactBase = path.join(pluginRoot, "artifacts/pasteboardpro/clipboard-format-g0");
const contractFiles = [
  "scripts/test-clipboard-format-g0.mjs",
  "scripts/test-clipboard-format-windows-receipts.mjs",
  "scripts/test-bounded-process.mjs",
  "scripts/test-clipboard-format-g0-sources.mjs",
  "tests/fixtures/windows-format-receipts.mjs",
  "scripts/package-clipboard-format-windows-source-kit.mjs",
  "scripts/lib/windows-source-kit.mjs",
  "scripts/lib/source-kit-files.mjs",
  "scripts/lib/source-kit-zip.mjs",
];

await test("v0.27 kit captures the current Windows fingerprints and honest NOT-RUN state", async () => {
  const prepared = await prepareWindowsSourceKit(pluginRoot);
  const repeated = await prepareWindowsSourceKit(pluginRoot);
  assert.deepEqual(repeated.archiveBytes, prepared.archiveBytes);
  assert.deepEqual(repeated.manifestBytes, prepared.manifestBytes);
  const manifest = prepared.manifest;
  assert.equal(manifest.phase, "v0.27");
  assert.equal(manifest.version, "0.27.0");
  assert.equal(manifest.windowsSourceInventoryCount, 121);
  assert.equal(manifest.windowsNativeSourceCount, 114);
  assert.equal(manifest.windowsRunnerSourceCount, 7);
  assert.equal(manifest.windowsCMakeCppCount, 63);
  assert.equal(manifest.portableCodecCMakeCppCount, 28);
  assert.equal(manifest.windowsNativeCases.count, 105);
  assert.equal(manifest.windowsNativeCases.execution, "NOT-RUN");
  assert.equal(manifest.windowsBuild, "NOT-RUN");
  assert.equal(manifest.windowsExecution, "NOT-RUN");
  assert.equal(manifest.gateComplete, false);
  assert.equal(manifest.archiveEntryCount, manifest.hashedPayloadFileCount + 1);
  assert.equal(manifest.manifestSelfHash, "excluded");
  assert.ok(manifest.sourceInventory.includes("scripts/clipboard-format-g0.mjs"));
  assert.ok(manifest.sourceInventory.includes("native/clipboard-format/windows/CMakeLists.txt"));
  assert.ok(manifest.files["native/clipboard-format/codec-tests/capture_wire_v2_cases.cpp"]);
  assert.ok(manifest.files["scripts/test-clipboard-format-windows-receipts.mjs"]);
  assert.ok(manifest.files["tests/fixtures/windows-format-receipts.mjs"]);
  assert.ok(manifest.files["scripts/lib/process-rss.mjs"]);
  assert.ok(manifest.files["scripts/verify-windows-source-kit.mjs"]);
  assert.ok(manifest.files["README.md"]);
  assert.ok(manifest.files["package.json"]);
  assert.equal(manifest.files["SOURCE_MANIFEST.json"], undefined);
});

test("ZIP bytes are stable for the same ordered input content", () => {
  const entries = [
    { path: "b/二.txt", bytes: Buffer.from("two") },
    { path: "a.txt", bytes: Buffer.from("one") },
  ];
  assert.deepEqual(createDeterministicZip(entries), createDeterministicZip([...entries].reverse()));
});

test("ZIP writer rejects traversal, absolute paths, separators, and case-fold duplicates", () => {
  for (const unsafe of ["../escape", "/absolute", "C:/drive", "a\\b", "a/./b", "a//b", "\ud800"]) {
    assert.throws(() => createDeterministicZip([{ path: unsafe, bytes: Buffer.alloc(0) }]), TypeError);
  }
  assert.throws(() => createDeterministicZip([
    { path: "Readme.txt", bytes: Buffer.from("a") },
    { path: "README.TXT", bytes: Buffer.from("b") },
  ]), /Duplicate ZIP path/u);
});

test("unexpected codec files are rejected before any v0.27 artifact is produced", async () => {
  const clone = await createPluginClone({ artifactsRoot: true });
  const codecDirectory = path.join(clone.root, "native/clipboard-format/codec-tests");
  const output = path.join(clone.root, "artifacts/pasteboardpro/clipboard-format-g0/v027-windows-source-kit");
  try {
    await writeFile(path.join(codecDirectory, ".env"), "SECRET=do-not-package\n");
    await writeFile(path.join(codecDirectory, "private-notes.md"), "local notes\n");
    await writeFile(path.join(codecDirectory, "unlisted.cpp"), "// not in reviewed inventory\n");
    const result = runSourceKitCli(clone.root);
    assert.notEqual(result.status, 0, `unexpected codec files were accepted: ${result.stdout}`);
    assert.match(result.stderr, /unexpected|unlisted|inventory/iu);
    assert.equal(await pathExists(output), false, "rejected source tree must not leave a kit artifact");
    await rm(path.join(codecDirectory, ".env"));
    await rm(path.join(codecDirectory, "private-notes.md"));
    await rm(path.join(codecDirectory, "unlisted.cpp"));
    await mkdir(path.join(codecDirectory, "empty-private-directory"));
    const directoryResult = runSourceKitCli(clone.root);
    assert.notEqual(directoryResult.status, 0, `unexpected codec directory was accepted: ${directoryResult.stdout}`);
    assert.match(directoryResult.stderr, /Unexpected source directory/iu);
    assert.equal(await pathExists(output), false);
  } finally {
    await clone.cleanup();
  }
});

test("default CLI creates artifacts in a cold checkout without an artifacts directory", async () => {
  const clone = await createPluginClone({ artifactsRoot: false });
  const output = path.join(clone.root, "artifacts/pasteboardpro/clipboard-format-g0/v027-windows-source-kit");
  try {
    assert.equal(await pathExists(path.join(clone.root, "artifacts")), false);
    const result = runSourceKitCli(clone.root);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(await pathExists(path.join(output, "pasteboardpro-windows-source-kit-v0.27.zip")), true);
    assert.equal(await pathExists(path.join(output, "SOURCE_MANIFEST.json")), true);
    const receipt = JSON.parse(await readFile(path.join(output, "producer-receipt.json"), "utf8"));
    assert.equal(receipt.phase, "v0.27");
    assert.equal(receipt.version, "0.27.0");
  } finally {
    await clone.cleanup();
  }
});

test("output identity is revalidated after a directory is replaced", async () => {
  const clone = await createPluginClone({ artifactsRoot: true });
  const output = path.join(clone.root, "artifacts/pasteboardpro/clipboard-format-g0/v027-windows-source-kit");
  const moved = `${output}.moved`;
  try {
    await mkdir(output, { recursive: true });
    const snapshot = await snapshotArtifactLocation(clone.root, undefined, "artifacts/pasteboardpro/clipboard-format-g0/v027-windows-source-kit");
    await rename(output, moved);
    await mkdir(output);
    await assert.rejects(revalidateArtifactDirectory(snapshot), /identity changed/iu);
  } finally {
    await clone.cleanup();
  }
});

test("source and ZIP byte budgets reject small oversize fixtures before packaging", async () => {
  assert.throws(() => createDeterministicZip(
    [{ path: "small.bin", bytes: Buffer.from("123") }],
    { limits: { maxFileBytes: 2 } },
  ), /maxFileBytes/iu);
  assert.throws(() => createDeterministicZip(
    [{ path: "a", bytes: Buffer.alloc(1) }, { path: "b", bytes: Buffer.alloc(1) }],
    { limits: { maxTotalBytes: 1 } },
  ), /maxTotalBytes/iu);
  assert.throws(() => createDeterministicZip(
    [{ path: "too-long", bytes: Buffer.alloc(0) }],
    { limits: { maxEntryNameBytes: 4 } },
  ), /maxEntryNameBytes/iu);
  assert.throws(() => createDeterministicZip(
    [{ path: "a", bytes: Buffer.from("small but not compressible") }],
    { limits: { maxCompressedBytes: 1 } },
  ), /maxCompressedBytes/iu);
  assert.throws(() => createDeterministicZip(
    [{ path: "a", bytes: Buffer.alloc(0) }],
    { limits: { maxArchiveBytes: 1 } },
  ), /maxArchiveBytes/iu);
  assert.throws(() => createDeterministicZip(
    [{ path: "a", bytes: Buffer.alloc(0) }, { path: "b", bytes: Buffer.alloc(0) }],
    { limits: { maxEntries: 1 } },
  ), /maxEntries/iu);
  const temporaryRoot = await mkdtemp(path.join(artifactBase, ".v027-size-fixture-"));
  try {
    await writeFile(path.join(temporaryRoot, "oversize.bin"), "123");
    await assert.rejects(readSourceFile(temporaryRoot, "oversize.bin", { maxBytes: 2 }), /maxFileBytes/iu);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
  await assert.rejects(
    prepareWindowsSourceKit(pluginRoot, { limits: { maxFileBytes: 1 } }),
    /maxFileBytes/iu,
  );
});

async function createPluginClone({ artifactsRoot }) {
  const root = await mkdtemp(path.join(artifactBase, ".v027-source-kit-clone-"));
  const sourceSet = await collectG0Sources(pluginRoot, "win32");
  const paths = new Set([...Object.keys(sourceSet.sourceHashes), ...contractFiles]);
  for (const relative of await listTreeFiles(path.join(pluginRoot, "native/clipboard-format/codec-tests"))) {
    paths.add(`native/clipboard-format/codec-tests/${relative}`);
  }
  for (const relative of paths) {
    const source = path.join(pluginRoot, ...relative.split("/"));
    const target = path.join(root, ...relative.split("/"));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, await readFile(source));
  }
  if (artifactsRoot) await mkdir(path.join(root, "artifacts"));
  return { root, cleanup: () => rm(root, { recursive: true, force: true }) };
}

async function listTreeFiles(directory, prefix = "") {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...await listTreeFiles(path.join(directory, entry.name), relative));
    else if (entry.isFile()) files.push(relative);
    else throw new TypeError(`Unexpected codec fixture entry: ${relative}`);
  }
  return files;
}

function runSourceKitCli(root) {
  const script = path.join(root, "scripts/package-clipboard-format-windows-source-kit.mjs");
  return spawnSync(process.execPath, [script], { cwd: root, encoding: "utf8", timeout: 30000, maxBuffer: 1024 * 1024 });
}

async function pathExists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

test("source reader rejects symlink paths and root escapes", async () => {
  const base = path.join(pluginRoot, "artifacts/pasteboardpro/clipboard-format-g0");
  const temporaryRoot = await mkdtemp(path.join(base, ".windows-source-kit-test-"));
  const outsideRoot = await mkdtemp(path.join(base, ".windows-source-kit-outside-"));
  try {
    await mkdir(path.join(temporaryRoot, "nested"));
    await writeFile(path.join(outsideRoot, "secret.txt"), "outside");
    await symlink(path.join(outsideRoot, "secret.txt"), path.join(temporaryRoot, "nested/link.txt"));
    await assert.rejects(readSourceFile(temporaryRoot, "nested/link.txt"), /symlink/u);
    await assert.rejects(readSourceFile(temporaryRoot, "../.windows-source-kit-outside-/secret.txt"), /Unsafe archive path/u);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
    await rm(outsideRoot, { recursive: true, force: true });
  }
});
