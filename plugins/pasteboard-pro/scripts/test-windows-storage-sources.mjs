import assert from "node:assert/strict";
import test from "node:test";
import { copyFile, link, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NATIVE_STORAGE_FILES, STORAGE_SOURCE_FILES, collectStorageSources, readOwnedInput, sha256 } from "./lib/windows-storage-sources.mjs";
import { FOUNDATION_CASE_IDS, describeStorageProbeReport } from "./lib/windows-storage-report.mjs";
import { parseStorageArguments, requireNativeExecutable, runStorageFoundation, validateNativeProcessResult } from "./lib/windows-storage-probe.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const nativePrefix = "native/clipboard-storage/windows/";
async function fixture(t) {
  const parent = path.join(root, "artifacts/pasteboardpro/windows-storage-foundation");
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(path.join(parent, "contract-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const name of STORAGE_SOURCE_FILES) {
    const target = path.join(directory, name);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(path.join(root, name), target);
  }
  return directory;
}

test("current source inventory closes 7 CMake units and all local headers; native cases agree with JS", async () => {
  const hashes = await collectStorageSources(root);
  assert.equal(Object.keys(hashes).length, 20);
  assert.equal(NATIVE_STORAGE_FILES.filter(name => name.endsWith(".cpp")).length, 7);
  for (const name of STORAGE_SOURCE_FILES) assert.equal(hashes[name], sha256(await readFile(path.join(root, name))));
  const header = await readFile(path.join(root, nativePrefix, "storage_probe_cases.h"), "utf8");
  assert.deepEqual([...header.matchAll(/"([a-z-]+)"/gu)].map(match => match[1]), FOUNDATION_CASE_IDS);
});

test("unknown, missing, or changed source closure is rejected rather than silently omitted", async t => {
  const directory = await fixture(t);
  const unknown = path.join(directory, nativePrefix, "unexpected.cpp");
  await writeFile(unknown, "// unexpected\n");
  await assert.rejects(collectStorageSources(directory));
  await rm(unknown);
  const header = path.join(directory, nativePrefix, "private_storage.h");
  const body = await readFile(header);
  await rm(header);
  await assert.rejects(collectStorageSources(directory));
  await writeFile(header, body);
  const cmake = path.join(directory, nativePrefix, "CMakeLists.txt");
  await writeFile(cmake, (await readFile(cmake, "utf8")).replace("  private_handles.cpp\n", ""));
  await assert.rejects(collectStorageSources(directory), { code: "input-rejected" });
});

test("a local include outside the recorded native set is rejected", async t => {
  const directory = await fixture(t);
  const source = path.join(directory, nativePrefix, "storage_probe.cpp");
  await writeFile(source, (await readFile(source, "utf8")) + '#include "unrecorded.h"\n');
  await assert.rejects(collectStorageSources(directory), { code: "input-rejected" });
});

test("bounded owned-input reads reject traversal, symlinks, hardlinks, oversized and empty files", async t => {
  const directory = await fixture(t);
  const source = path.join(directory, "input.bin");
  await writeFile(source, "public");
  assert.equal((await readOwnedInput(directory, "input.bin", 6)).toString(), "public");
  for (const name of ["../input.bin", "/input.bin", "a//b", "a\\b", "./input.bin"]) {
    await assert.rejects(readOwnedInput(directory, name, 6), { code: "input-rejected" });
  }
  await assert.rejects(readOwnedInput(directory, "input.bin", 5), { code: "input-rejected" });
  await writeFile(path.join(directory, "empty.bin"), "");
  await assert.rejects(readOwnedInput(directory, "empty.bin", 6), { code: "input-rejected" });
  await symlink(source, path.join(directory, "symbolic.bin"));
  await assert.rejects(readOwnedInput(directory, "symbolic.bin", 6), { code: "input-rejected" });
  await link(source, path.join(directory, "hard.bin"));
  await assert.rejects(readOwnedInput(directory, "input.bin", 6), { code: "input-rejected" });
});

test("CLI accepts only description or an exact scoped executable and expected digest", () => {
  const binary = "artifacts/pasteboardpro/windows-storage-foundation/build/Release/windows-storage-foundation.exe";
  const digest = "a".repeat(64);
  assert.deepEqual(parseStorageArguments(["--describe"]), { mode: "describe" });
  assert.deepEqual(parseStorageArguments(["--self-test", "--binary", binary, "--expected-binary-sha256", digest]),
    { mode: "self-test", binary, expectedBinarySha256: digest });
  for (const args of [[], ["--describe", "extra"], ["--self-test"],
    ["--self-test", "--binary", "C:\\unknown.exe", "--expected-binary-sha256", digest],
    ["--self-test", "--binary", binary.replace("build/", "../"), "--expected-binary-sha256", digest],
    ["--self-test", "--binary", binary, "--expected-binary-sha256", "a"],
    ["--self-test", "--binary", binary, "--expected-binary-sha256", digest, "extra"]]) {
    assert.throws(() => parseStorageArguments(args), { code: "input-rejected" });
  }
});

test("portable description never fabricates native success or binary provenance", async () => {
  const receipt = await runStorageFoundation(root, { mode: "describe" });
  assert.equal(receipt.execution, "NOT-RUN");
  assert.equal(receipt.nativeReport.cases.length, 15);
  assert.ok(receipt.nativeReport.cases.every(item => item.status === "NOT-RUN"));
  assert.equal(receipt.platform, process.platform);
  assert.equal(receipt.sourceToBinaryBinding, "UNVERIFIED");
  assert.equal(receipt.namespaceDurability, "NOT-VERIFIED");
  assert.equal(receipt.productionStorageEnabled, false);
  assert.equal(receipt.gateComplete, false);
  assert.equal(receipt.process, undefined);
  assert.equal(receipt.binarySha256, undefined);
  assert.equal(receipt.errorCode, undefined);
});

test("non-Windows self-test stays NOT-RUN without opening or running an executable", { skip: process.platform === "win32" }, async () => {
  const receipt = await runStorageFoundation(root, { mode: "self-test",
    binary: "artifacts/pasteboardpro/windows-storage-foundation/missing/windows-storage-foundation.exe",
    expectedBinarySha256: "0".repeat(64) });
  assert.equal(receipt.execution, "NOT-RUN");
  assert.equal(receipt.errorCode, "unsupported-platform");
  assert.equal(receipt.process, undefined);
  assert.equal(receipt.binarySha256, undefined);
});

test("missing source cannot produce a successful describe receipt", async t => {
  const directory = await fixture(t);
  await rm(path.join(directory, nativePrefix, "private_storage.h"));
  const receipt = await runStorageFoundation(directory, { mode: "describe" });
  assert.equal(receipt.execution, "FAIL");
  assert.equal(receipt.errorCode, "input-rejected");
  assert.equal(receipt.gateComplete, false);
  assert.equal(receipt.process, undefined);
});

test("PE machine checks reject x64 emulation as ARM64 and reject malformed executable headers", () => {
  const pe = Buffer.alloc(128);
  pe.writeUInt16LE(0x5a4d, 0); pe.writeUInt32LE(64, 60);
  pe.writeUInt32LE(0x00004550, 64); pe.writeUInt16LE(0x8664, 68);
  pe.writeUInt16LE(2, 84); pe.writeUInt16LE(0x0002, 86); pe.writeUInt16LE(0x20b, 88);
  requireNativeExecutable(pe, "x64");
  assert.throws(() => requireNativeExecutable(pe, "arm64"), { code: "binary-architecture-mismatch" });
  pe.writeUInt16LE(0xaa64, 68); requireNativeExecutable(pe, "arm64");
  for (const corrupt of [bytes => bytes.writeUInt32LE(0xffffffff, 60),
    bytes => bytes.writeUInt32LE(0, 64), bytes => bytes.writeUInt16LE(0x2002, 86),
    bytes => bytes.writeUInt16LE(0, 86), bytes => bytes.writeUInt16LE(0x10b, 88)]) {
    const changed = Buffer.from(pe); corrupt(changed);
    assert.throws(() => requireNativeExecutable(changed, "arm64"), { code: "binary-architecture-mismatch" });
  }
  assert.throws(() => requireNativeExecutable(Buffer.alloc(63), "x64"), { code: "binary-architecture-mismatch" });
});

test("unrecorded static JS dependency is rejected by source collection", async t => {
  const directory = await fixture(t);
  const source = path.join(directory, "scripts/clipboard-storage-g1.mjs");
  await writeFile(source, (await readFile(source, "utf8")) + 'import "./unrecorded.mjs";\n');
  await assert.rejects(collectStorageSources(directory), { code: "input-rejected" });
});

test("native wire explicitly fixes Windows CRT translation before any report output", async () => {
  const source = await readFile(path.join(root, nativePrefix, "storage_probe.cpp"), "utf8");
  const main = source.slice(source.indexOf("int wmain("));
  assert.ok(main.indexOf("_setmode(_fileno(stdout), _O_BINARY) == -1") < main.indexOf("report.Write()"));
  assert.ok(main.includes("if (_setmode(_fileno(stdout), _O_BINARY) == -1) return 2;"));
  // This is a source contract, not execution of the Windows CRT.
});

test("native process receipts require confirmed termination, empty stderr and matching report exit", () => {
  const result = { status: 2, signal: null, stderr: "", resources: { terminationConfirmed: true },
    stdout: JSON.stringify(describeStorageProbeReport()) + "\n" };
  assert.equal(validateNativeProcessResult(result).execution, "NOT-RUN");
  for (const patch of [{ status: 0 }, { signal: "SIGKILL" }, { stderr: "raw private diagnostic" },
    { resources: { terminationConfirmed: false } }, { resources: {} }]) {
    assert.throws(() => validateNativeProcessResult({ ...result, ...patch }), { code: "native-process-failed" });
  }
  assert.throws(() => validateNativeProcessResult({ ...result, stdout: "private invalid report" }),
    { code: "native-report-invalid" });
  const failed = describeStorageProbeReport();
  failed.execution = "FAIL";
  failed.cases[0] = { ...failed.cases[0], status: "FAIL", reason: "create-failed" };
  assert.equal(validateNativeProcessResult({ ...result, status: 1, stdout: JSON.stringify(failed) + "\n" }).execution, "FAIL");
});

test("additional CMake directives cannot silently add unrecorded build inputs", async t => {
  const directory = await fixture(t);
  const cmake = path.join(directory, nativePrefix, "CMakeLists.txt");
  const original = await readFile(cmake, "utf8");
  for (const extra of [
    "target_sources(windows-storage-foundation PRIVATE ../../outside/extra.cpp)",
    "add_subdirectory(../../outside)",
    "include(../../outside/recipe.cmake)",
    "add_library(hidden STATIC ../../outside/extra.cpp)",
    "set(CMAKE_CXX_FLAGS ${CMAKE_CXX_FLAGS} -include ../../outside/extra.h)",
  ]) {
    await writeFile(cmake, original + extra + "\n");
    await assert.rejects(collectStorageSources(directory), { code: "input-rejected" });
  }
});
