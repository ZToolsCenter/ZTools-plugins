import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, realpath, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { verifyBuiltProbe } from "./lib/clipboard-format-g0-sources.mjs";

const pluginRoot = fileURLToPath(new URL("../", import.meta.url));
const WAIT_TIMEOUT_MS = 100_000;
const BUILD_TIMEOUT_MS = 90_000;
const POLL_INTERVAL_MS = 100;
const preparations = new Map();

export function nativeTestFixturePaths(root = pluginRoot) {
  const resolvedRoot = path.resolve(root);
  const artifactRoot = path.join(resolvedRoot, "artifacts/pasteboardpro/native-test-fixture");
  // The native file-fixture guard requires this canonical suffix. Nest it in
  // the new fixture area rather than weakening the guard or reusing evidence.
  const buildRoot = path.join(artifactRoot,
    "plugins/pasteboard-pro/artifacts/pasteboardpro/clipboard-format-g0/darwin");
  return {
    root: resolvedRoot,
    artifactRoot,
    buildRoot,
    binary: path.join(buildRoot, "clipboard-format-probe"),
    receiptPath: path.join(buildRoot, "receipt.json"),
    temporaryRoot: path.join(artifactRoot, "tmp"),
  };
}

function fixedFailure(code) {
  return Object.assign(new Error("Cannot prepare native clipboard test fixture"), { code });
}

async function ensureOwnedDirectory(root, directory) {
  const relative = path.relative(root, directory);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw fixedFailure("native-test-output-invalid");
  }
  const rootReal = await realpath(root);
  let current = root;
  for (const part of relative.split(path.sep)) {
    current = path.join(current, part);
    try {
      await mkdir(current, { mode: 0o700 });
    } catch (error) {
      if (error?.code !== "EEXIST") throw fixedFailure("native-test-output-unavailable");
    }
    const status = await lstat(current);
    const resolved = await realpath(current);
    if (!status.isDirectory() || status.isSymbolicLink() || !resolved.startsWith(rootReal + path.sep)) {
      throw fixedFailure("native-test-output-invalid");
    }
  }
}

async function verifiedFixture(paths) {
  const [receiptStatus, binaryStatus] = await Promise.all([
    lstat(paths.receiptPath), lstat(paths.binary),
  ]);
  if (!receiptStatus.isFile() || receiptStatus.isSymbolicLink() ||
      !binaryStatus.isFile() || binaryStatus.isSymbolicLink()) {
    throw fixedFailure("native-test-artifact-invalid");
  }
  const [receiptBytes, binaryBytes] = await Promise.all([
    readFile(paths.receiptPath), readFile(paths.binary),
  ]);
  const verified = await verifyBuiltProbe(paths.root, {
    platform: "darwin", architecture: process.arch,
    receiptBytes, binary: paths.binary, binaryBytes,
  });
  return {
    status: "ready",
    ...paths,
    receiptSha256: verified.receiptSha256,
    binarySha256: verified.binarySha256,
    cases: verified.receipt.nativeReport.cases.length,
  };
}

async function tryVerifiedFixture(paths) {
  try { return await verifiedFixture(paths); } catch { return undefined; }
}

async function withPreparationLock(paths) {
  const lockPath = path.join(paths.artifactRoot, ".prepare.lock");
  const token = randomUUID();
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  let lock;
  while (Date.now() < deadline) {
    try {
      lock = await open(lockPath, "wx", 0o600);
      try { await lock.writeFile(token, "utf8"); }
      catch {
        await lock.close();
        throw fixedFailure("native-test-lock-initialization-failed");
      }
      break;
    } catch (error) {
      if (error?.code !== "EEXIST") throw fixedFailure("native-test-lock-unavailable");
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  }
  if (lock === undefined) throw fixedFailure("native-test-lock-timeout");
  let releaseLock = true;
  try {
    const existing = await tryVerifiedFixture(paths);
    if (existing !== undefined) return { ...existing, reused: true };
    const env = {
      ...process.env,
      TMPDIR: paths.temporaryRoot,
      CLANG_MODULE_CACHE_PATH: path.join(paths.buildRoot, "module-cache"),
    };
    await runPreparationProcess(paths, env);
    return { ...(await verifiedFixture(paths)), reused: false };
  } catch (error) {
    releaseLock = error?.retainLock !== true;
    throw fixedFailure("native-test-preparation-failed");
  } finally {
    await lock.close();
    // Never remove another process's lock or silently reclaim a stale lock.
    try {
      if (releaseLock && await readFile(lockPath, "utf8") === token) await rm(lockPath);
    } catch (error) {
      if (error?.code !== "ENOENT") throw fixedFailure("native-test-lock-release-failed");
    }
  }
}

async function runPreparationProcess(paths, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      path.join(paths.root, "scripts/clipboard-format-g0.mjs"),
      "--self-test", "--output-dir", paths.buildRoot,
    ], { cwd: paths.root, env, stdio: ["ignore", "pipe", "pipe"], detached: true });
    let failed = false;
    let finished = false;
    let bytes = 0;
    let drainTimer;
    const groupAlive = () => {
      if (child.pid === undefined) return false;
      try { process.kill(-child.pid, 0); return true; }
      catch (error) { return error?.code !== "ESRCH"; }
    };
    const stop = () => {
      failed = true;
      if (child.pid !== undefined) {
        // The runner owns compiler/native children. Terminate its complete
        // process group rather than orphaning them when preparation expires.
        try { process.kill(-child.pid, "SIGKILL"); }
        catch (error) { if (error?.code !== "ESRCH") failed = true; }
      }
      drainTimer ??= setTimeout(() => {
        child.stdout.destroy(); child.stderr.destroy();
        finish(null, "SIGKILL");
      }, 1500);
    };
    const finish = (code, signal) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer); clearTimeout(drainTimer);
      const remainingGroup = groupAlive();
      if (remainingGroup) {
        try { process.kill(-child.pid, "SIGKILL"); } catch { /* Keep the lock below. */ }
      }
      if (failed || code !== 0 || signal !== null || remainingGroup) {
        reject(Object.assign(fixedFailure("native-test-build-failed"), { retainLock: remainingGroup }));
      } else resolve();
    };
    const timer = setTimeout(stop, BUILD_TIMEOUT_MS);
    const capture = chunk => {
      bytes += chunk.length;
      if (bytes > 256 * 1024) stop();
    };
    child.stdout.on("data", capture); child.stderr.on("data", capture);
    child.stdout.once("error", stop); child.stderr.once("error", stop);
    child.once("error", stop);
    child.once("close", finish);
  });
}

async function prepare(root) {
  if (path.resolve(root) !== path.resolve(pluginRoot)) throw fixedFailure("native-test-root-invalid");
  const paths = nativeTestFixturePaths(root);
  if (process.platform !== "darwin") return { status: "not-applicable", ...paths };
  await ensureOwnedDirectory(paths.root, paths.buildRoot);
  await ensureOwnedDirectory(paths.root, paths.temporaryRoot);
  // Every invocation verifies source inventory and binary, including cache hits.
  return withPreparationLock(paths);
}

export async function prepareNativeTestFixture(root = pluginRoot) {
  const key = path.resolve(root);
  let pending = preparations.get(key);
  if (pending === undefined) {
    pending = prepare(key);
    preparations.set(key, pending);
  }
  try { return await pending; }
  finally { if (preparations.get(key) === pending) preparations.delete(key); }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    const result = await prepareNativeTestFixture();
    process.stdout.write(result.status === "ready"
      ? `Native clipboard test fixture ready (${result.cases} private-board checks; ${result.reused ? "reused" : "built"}).\n`
      : "Native clipboard test fixture not applicable on this platform.\n");
  } catch (error) {
    process.stderr.write(`Cannot prepare native clipboard test fixture (${error?.code ?? "native-test-preparation-failed"}).\n`);
    process.exitCode = 1;
  }
}
