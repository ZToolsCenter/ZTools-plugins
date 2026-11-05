import os from "node:os";
import path from "node:path";
import { collectStorageSources, readOwnedInput, sha256 } from "./windows-storage-sources.mjs";
import { describeStorageProbeReport, parseStorageProbeReport } from "./windows-storage-report.mjs";
import { runBoundedProcess } from "./bounded-process.mjs";

const failure = code => Object.assign(new Error(code), { code });
const safeErrors = new Set(["unsupported-platform", "unsupported-architecture", "input-rejected",
  "binary-hash-mismatch", "binary-architecture-mismatch", "native-process-failed", "native-report-invalid", "process-timeout",
  "process-output-limit", "process-unavailable", "process-terminated", "source-changed"]);

export function parseStorageArguments(args) {
  if (args.length === 1 && args[0] === "--describe") return { mode: "describe" };
  if (args.length === 5 && args[0] === "--self-test" && args[1] === "--binary" &&
      args[3] === "--expected-binary-sha256" && /^[a-f0-9]{64}$/u.test(args[4]) &&
      /^artifacts\/pasteboardpro\/windows-storage-foundation\/(?:[a-zA-Z0-9_-]+\/)*windows-storage-foundation\.exe$/u.test(args[2])) {
    return { mode: "self-test", binary: args[2], expectedBinarySha256: args[4] };
  }
  throw failure("input-rejected");
}

export function requireNativeExecutable(bytes, architecture) {
  const machine = architecture === "x64" ? 0x8664 : architecture === "arm64" ? 0xaa64 : 0;
  if (!Buffer.isBuffer(bytes) || bytes.length < 64 || machine === 0 ||
      bytes.readUInt16LE(0) !== 0x5a4d) throw failure("binary-architecture-mismatch");
  const offset = bytes.readUInt32LE(60);
  if (offset < 64 || offset > bytes.length - 26 || offset > 1024 * 1024 ||
      bytes.readUInt32LE(offset) !== 0x00004550 || bytes.readUInt16LE(offset + 4) !== machine ||
      bytes.readUInt16LE(offset + 20) < 2 || bytes.readUInt16LE(offset + 24) !== 0x20b ||
      (bytes.readUInt16LE(offset + 22) & 0x0002) === 0 ||
      (bytes.readUInt16LE(offset + 22) & 0x2000) !== 0) throw failure("binary-architecture-mismatch");
}

export function validateNativeProcessResult(result) {
  if (result?.resources?.terminationConfirmed !== true || result.signal !== null ||
      result.stderr !== "") throw failure("native-process-failed");
  let report;
  try { report = parseStorageProbeReport(result.stdout); }
  catch { throw failure("native-report-invalid"); }
  const expectedExit = report.execution === "PASS" ? 0 : report.execution === "FAIL" ? 1 : 2;
  if (result.status !== expectedExit) throw failure("native-process-failed");
  return report;
}

// No build invocation: a compiler's process tree is outside this single native
// helper supervisor. Source-to-binary provenance remains explicitly unverified.
export async function runStorageFoundation(root, request) {
  const checked = parseStorageArguments(request.mode === "describe" ? ["--describe"] :
    ["--self-test", "--binary", request.binary, "--expected-binary-sha256", request.expectedBinarySha256]);
  const receipt = {
    schemaVersion: 1, stage: "G1-storage-foundation", mode: checked.mode, execution: "NOT-RUN",
    platform: process.platform, architecture: process.arch,
    runtime: { node: process.versions.node, electron: process.versions.electron ?? null, osRelease: os.release() },
    sourceToBinaryBinding: "UNVERIFIED", namespaceDurability: "NOT-VERIFIED",
    productionStorageEnabled: false, gateComplete: false, sourceHashes: {},
    nativeReport: describeStorageProbeReport(),
  };
  try {
    receipt.sourceHashes = await collectStorageSources(root);
    if (checked.mode === "describe") return receipt;
    if (process.platform !== "win32") throw failure("unsupported-platform");
    if (!["x64", "arm64"].includes(process.arch)) throw failure("unsupported-architecture");
    const binary = await readOwnedInput(root, checked.binary, 64 * 1024 * 1024);
    receipt.binarySha256 = sha256(binary);
    if (receipt.binarySha256 !== checked.expectedBinarySha256) throw failure("binary-hash-mismatch");
    requireNativeExecutable(binary, process.arch);
    // The caller supplies an exact digest for its trusted fixture executable.
    // Hashes record observations; they do not authenticate a build or lock it.
    const result = await runBoundedProcess(path.join(root, ...checked.binary.split("/")),
      ["--self-test"], { cwd: root, timeoutMs: 20_000, maxOutputBytes: 16 * 1024 });
    receipt.process = { status: result.status, signal: result.signal,
      durationMs: result.resources.durationMs, terminationConfirmed: result.resources.terminationConfirmed,
      timeoutMs: 20_000, maxOutputBytes: 16 * 1024, memoryLimitBytes: null };
    receipt.nativeReport = validateNativeProcessResult(result);
    if (sha256(await readOwnedInput(root, checked.binary, 64 * 1024 * 1024)) !== receipt.binarySha256) throw failure("binary-hash-mismatch");
    if (JSON.stringify(await collectStorageSources(root)) !== JSON.stringify(receipt.sourceHashes)) throw failure("source-changed");
    receipt.execution = receipt.nativeReport.execution;
  } catch (error) {
    if (error?.result?.resources) {
      receipt.process = { status: error.result.status, signal: error.result.signal,
        durationMs: error.result.resources.durationMs, terminationConfirmed: error.result.resources.terminationConfirmed,
        timeoutMs: 20_000, maxOutputBytes: 16 * 1024, memoryLimitBytes: null };
    }
    receipt.errorCode = safeErrors.has(error?.code) ? error.code : "input-rejected";
    receipt.execution = ["unsupported-platform", "unsupported-architecture"].includes(receipt.errorCode) ? "NOT-RUN" : "FAIL";
  }
  return receipt;
}
