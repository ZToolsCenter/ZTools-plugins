import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, lstat, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bootPreloadFixture } from "./lib/preload-database-fixture.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const evidenceRoot = path.join(root, "artifacts/pasteboardpro/clipboard-format-g0");
const workRoot = path.join(evidenceRoot, "v032-work");
const usage = "Usage: node scripts/test-preload-history-clear-replay-package.mjs --package-dir <v032-package-dir> --output <v032-output.json>";

function parseArguments(args) {
  const values = new Map();
  if (args.length === 1 && args[0] === "--help") return { help: true };
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if ((key !== "--package-dir" && key !== "--output") ||
        typeof value !== "string" || value.length === 0 || values.has(key)) {
      throw new TypeError("Invalid harness arguments");
    }
    values.set(key, value);
  }
  if (!values.has("--package-dir") || !values.has("--output")) {
    throw new TypeError("Missing harness arguments");
  }
  const resolveOwned = value => path.resolve(root, value);
  const packageDir = resolveOwned(values.get("--package-dir"));
  const output = resolveOwned(values.get("--output"));
  const relativeOutput = path.relative(evidenceRoot, output);
  const outputVersionRoot = relativeOutput.split(path.sep)[0];
  if (!isWithin(evidenceRoot, packageDir) ||
      !isWithin(evidenceRoot, output) ||
      !outputVersionRoot.startsWith("v032-") ||
      outputVersionRoot === "v032-inputs" ||
      isWithin(path.join(workRoot, "tmp"), output) ||
      isWithin(packageDir, output) ||
      path.extname(output) !== ".json") {
    throw new TypeError("Paths must stay in owned v032 artifacts");
  }
  return { help: false, packageDir, output };
}

function isWithin(parent, candidate) {
  return candidate !== parent && candidate.startsWith(parent + path.sep);
}

async function ensureOwnedDirectory(directory) {
  const relative = path.relative(evidenceRoot, directory);
  if (relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) {
    throw new TypeError("Directory is outside owned artifacts");
  }
  const pluginReal = await realpath(root);
  const entry = await lstat(evidenceRoot);
  const rootReal = await realpath(evidenceRoot);
  if (!entry.isDirectory() || entry.isSymbolicLink() || !isWithin(pluginReal, rootReal)) {
    throw new TypeError("Artifact root is outside the plugin");
  }
  let current = evidenceRoot;
  for (const part of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try {
      const entry = await lstat(current);
      if (!entry.isDirectory() || entry.isSymbolicLink()) {
        throw new TypeError("Artifact directory is not owned");
      }
    } catch (error) {
      if (error instanceof TypeError) throw error;
      if (error?.code !== "ENOENT") throw new TypeError("Artifact directory is unavailable");
      await mkdir(current, { mode: 0o700 });
    }
    const currentReal = await realpath(current);
    if (!isWithin(rootReal, currentReal)) {
      throw new TypeError("Artifact directory escaped owned root");
    }
  }
}

function bounded(promise, timeoutMs) {
  let timer;
  return Promise.race([
    promise,
    new Promise(resolve => { timer = setTimeout(() => resolve("timeout"), timeoutMs); }),
  ]).finally(() => clearTimeout(timer));
}

async function safeOutcome(action, timeoutMs = 5_000) {
  try {
    const value = await bounded(Promise.resolve().then(action), timeoutMs);
    if (value === "timeout") return { status: "timeout" };
    if (value !== null && typeof value === "object") {
      return {
        status: "resolved",
        ...(Number.isSafeInteger(value.deleted) ? { deleted: value.deleted } : {}),
        ...(Number.isSafeInteger(value.failed) ? { failed: value.failed } : {}),
        ...(Number.isSafeInteger(value.blobFailures) ? { blobFailures: value.blobFailures } : {}),
      };
    }
    return { status: "resolved" };
  } catch {
    return { status: "rejected" };
  }
}

function countRecords(docs) {
  return [...docs.values()].filter(document => document.type === "pasteboard-pro-record");
}

function hostItemId(document) {
  return document?.record?.origin?.host === "ztools" &&
    typeof document.record.origin.hostItemId === "string"
    ? document.record.origin.hostItemId
    : undefined;
}

function clearBoundary(docs) {
  return [...docs.values()].find(document =>
    document.type === "pasteboard-pro-history-clear-boundary");
}

function diagnosticsSafe(fixture, temporaryRoot) {
  const messages = [
    ...fixture.errors,
    ...fixture.calls.events
      .filter(event => event.type === "pasteboard-pro:sync-error")
      .map(event => String(event.detail)),
  ];
  return messages.every(message =>
    !message.includes(temporaryRoot) &&
    !message.includes("synthetic-sensitive-image-io-error") &&
    !message.includes("synthetic-sensitive-host-message") &&
    !message.includes("synthetic-sensitive-notification-error"));
}

async function run({ packageDir, output }) {
  await ensureOwnedDirectory(workRoot);
  await ensureOwnedDirectory(path.dirname(output));
  const tmpRoot = path.join(workRoot, "tmp");
  await ensureOwnedDirectory(tmpRoot);
  process.env.TMPDIR = tmpRoot;

  const packageReal = await realpath(packageDir);
  const evidenceReal = await realpath(evidenceRoot);
  if (!isWithin(evidenceReal, packageReal)) throw new TypeError("Package graph is outside owned artifacts");

  const runtimeName = process.versions.electron ? "electron" : "node";
  const temporaryRoot = await mkdtemp(path.join(workRoot, "owned-history-clear-replay-" + runtimeName + "-"));
  const checks = [];
  const phases = {};
  const check = (phase, name, actual, expected) => {
    checks.push({ phase, name, actual, expected, passed: actual === expected });
  };
  const digest = bytes => createHash("sha256").update(bytes).digest("hex");
  let fixture;
  let fixtureClosed = false;
  let temporaryRemoved = false;
  let scriptBytes;
  let fixtureBytes;
  let preloadBytes;
  let harnessFailed = false;

  try {
    [scriptBytes, fixtureBytes, preloadBytes] = await Promise.all([
      readFile(fileURLToPath(import.meta.url)),
      readFile(fileURLToPath(new URL("./lib/preload-database-fixture.mjs", import.meta.url))),
      readFile(path.join(packageReal, "preload.js")),
    ]);
    const oldText = {
      id: "fixture-clear-old-text",
      type: "text",
      content: "synthetic pre-clear text",
      timestamp: Date.now() + 60_000,
      appName: "Fixture",
      bundleId: "example.fixture",
    };
    const newText = {
      id: "fixture-clear-after-text",
      type: "text",
      content: "synthetic after-clear text",
      timestamp: oldText.timestamp,
      appName: "Fixture",
      bundleId: "example.fixture",
    };

    const rollbackText = {
      ...newText,
      id: "fixture-clear-clock-rollback",
      content: "synthetic unseen copy before clear max timestamp",
      timestamp: oldText.timestamp - 1,
    };

    fixture = await bootPreloadFixture({
      packageRoot: packageReal,
      directory: temporaryRoot,
      imageScenario: "read-error",
      historyTail: [oldText],
    });
    const initialMirrorEvent = await bounded(
      fixture.waitForEvent("pasteboard-pro:sync-error", 1),
      3_000,
    );
    await fixture.settled();

    const initialRecords = countRecords(fixture.docs);
    const initialOldTextCount = initialRecords.filter(document =>
      hostItemId(document) === oldText.id && document.record.item.kind === "text").length;
    phases.initial = {
      mirrorErrorObserved: initialMirrorEvent !== "timeout",
      historyCallbacks: fixture.calls.clipboard.length,
      oldTextRecords: initialOldTextCount,
      imageRecords: initialRecords.filter(document => document.record.item.kind === "image").length,
      mainCursorExists: fixture.docs.has("pasteboard-pro:cursor:ztools-history"),
      imageReadFailures: fixture.imageFaults.length,
      imageReadAttempts: fixture.imageReads.length,
      clipboardReads: fixture.calls.clipboardReads.length,
    };
    check("initial", "image-failure-observed", phases.initial.mirrorErrorObserved, true);
    check("initial", "one-host-history-callback-installed", phases.initial.historyCallbacks, 1);
    check("initial", "healthy-pre-clear-text-was-saved", phases.initial.oldTextRecords, 1);
    check("initial", "failed-image-was-not-saved", phases.initial.imageRecords, 0);
    check("initial", "main-cursor-held-after-image-failure", phases.initial.mainCursorExists, false);
    check("initial", "one-synthetic-image-read-failed", phases.initial.imageReadFailures, 1);
    check("initial", "system-clipboard-never-read", phases.initial.clipboardReads, 0);

    phases.clearOutcome = await safeOutcome(() => fixture.bridge.clearClipboardHistory());
    await fixture.settled();
    const persistedBoundary = clearBoundary(fixture.docs);
    const afterClearRecords = countRecords(fixture.docs);
    phases.afterClear = {
      records: afterClearRecords.length,
      boundaryDocuments: persistedBoundary === undefined ? 0 : 1,
      boundaryThroughOldText: persistedBoundary?.through?.id ?? null,
      clipboardClears: fixture.calls.clipboardClears.length,
      clipboardReads: fixture.calls.clipboardReads.length,
    };
    check("clear", "clear-bridge-resolved", phases.clearOutcome.status, "resolved");
    check("clear", "one-old-record-deleted", phases.clearOutcome.deleted, 1);
    check("clear", "no-delete-failures", phases.clearOutcome.failed, 0);
    check("clear", "all-plugin-records-cleared", phases.afterClear.records, 0);
    check("clear", "one-persistent-history-boundary-written", phases.afterClear.boundaryDocuments, 1);
    check("clear", "boundary-covers-pre-clear-tail", phases.afterClear.boundaryThroughOldText, oldText.id);
    check("clear", "system-clipboard-cleared-once", phases.afterClear.clipboardClears, 1);
    check("clear", "system-clipboard-never-read", phases.afterClear.clipboardReads, 0);

    // Scan cleared rows before admitting new copies. Excluded rows must not
    // move the main cursor, even after their original image source recovers.
    phases.oldOnlyOutcome = await safeOutcome(() => fixture.notifyHistoryChanged());
    await fixture.settled();
    check("old-only", "cleared-history-remains-empty", countRecords(fixture.docs).length, 0);
    check("old-only", "cleared-rows-do-not-advance-main-cursor",
      fixture.docs.has("pasteboard-pro:cursor:ztools-history"), false);
    await fixture.recoverImage();
    phases.recoveredOldOnlyOutcome = await safeOutcome(() => fixture.notifyHistoryChanged());
    await fixture.settled();
    check("recovered-old-only", "recovered-image-is-still-excluded", countRecords(fixture.docs).length, 0);
    check("recovered-old-only", "cleared-rows-still-do-not-advance-main-cursor",
      fixture.docs.has("pasteboard-pro:cursor:ztools-history"), false);
    check("clear", "exact-cleared-identities-persisted",
      persistedBoundary?.clearedIdentities?.length, 2);

    fixture.appendHistory(newText);
    fixture.appendHistory(rollbackText);
    phases.afterClearMirrorOutcome = await safeOutcome(() => fixture.notifyHistoryChanged());
    await fixture.settled();

    const finalRecords = countRecords(fixture.docs);
    const oldIds = new Set([fixture.image.item.id, oldText.id]);
    const oldReimports = finalRecords.filter(document => oldIds.has(hostItemId(document)));
    const newRecordCount = finalRecords.filter(document => hostItemId(document) === newText.id).length;
    const finalBoundary = clearBoundary(fixture.docs);
    phases.afterClearReplay = {
      mirrorOutcome: phases.afterClearMirrorOutcome.status,
      historyNotifications: fixture.calls.historyNotifications.length,
      appendedIds: fixture.calls.historyAppends.length,
      oldHistoryReimports: oldReimports.length,
      oldTextReimports: oldReimports.filter(document => hostItemId(document) === oldText.id).length,
      newCopyRecords: newRecordCount,
      rollbackCopyRecords: finalRecords.filter(document => hostItemId(document) === rollbackText.id).length,
      totalRecords: finalRecords.length,
      cursorId: fixture.docs.get("pasteboard-pro:cursor:ztools-history")?.cursor?.id ?? null,
      boundaryStillCoversOldTail: finalBoundary?.through?.id === oldText.id,
      imageReadFailures: fixture.imageFaults.length,
      imageReadAttempts: fixture.imageReads.length,
      clipboardReads: fixture.calls.clipboardReads.length,
      clipboardClears: fixture.calls.clipboardClears.length,
      deniedOperations: fixture.denied.length,
      diagnosticsSafe: diagnosticsSafe(fixture, temporaryRoot),
    };
    check("replay", "three-history-changes-notified", phases.afterClearReplay.historyNotifications, 3);
    check("replay", "after-clear-mirror-resolved", phases.afterClearReplay.mirrorOutcome, "resolved");
    check("replay", "two-after-clear-items-appended", phases.afterClearReplay.appendedIds, 2);
    check("replay", "no-pre-clear-item-reimported", phases.afterClearReplay.oldHistoryReimports, 0);
    check("replay", "healthy-pre-clear-text-not-reimported", phases.afterClearReplay.oldTextReimports, 0);
    check("replay", "after-clear-copy-was-saved", phases.afterClearReplay.newCopyRecords, 1);
    check("replay", "unseen-rollback-copy-was-saved", phases.afterClearReplay.rollbackCopyRecords, 1);
    check("replay", "main-cursor-advanced-to-new-copy", phases.afterClearReplay.cursorId, newText.id);
    check("replay", "only-after-clear-copies-remain", phases.afterClearReplay.totalRecords, 2);
    check("replay", "clear-boundary-remains-through-old-tail",
      phases.afterClearReplay.boundaryStillCoversOldTail, true);
    check("replay", "old-image-was-not-read-again", phases.afterClearReplay.imageReadAttempts, 1);
    check("replay", "system-clipboard-never-read", phases.afterClearReplay.clipboardReads, 0);
    check("replay", "system-clipboard-cleared-once", phases.afterClearReplay.clipboardClears, 1);
    check("replay", "filesystem-or-network-denials", phases.afterClearReplay.deniedOperations, 0);
    check("replay", "diagnostics-omit-private-errors-and-temp-path",
      phases.afterClearReplay.diagnosticsSafe, true);

  } catch {
    harnessFailed = true;
    check("harness", "fixture-execution-completed", false, true);
  } finally {
    try {
      if (fixture !== undefined) {
        await fixture.close();
        fixtureClosed = true;
      }
    } catch {
      fixtureClosed = false;
    }
    try {
      await rm(temporaryRoot, { recursive: true, force: false });
      temporaryRemoved = true;
    } catch {
      temporaryRemoved = false;
    }
  }

  const result = {
    execution: !harnessFailed && checks.every(item => item.passed) && fixtureClosed && temporaryRemoved
      ? "PASS"
      : "FAIL",
    runtime: { node: process.versions.node, electron: process.versions.electron ?? null },
    scope: "assembled preload CJS graph with synthetic SDK and owned data; no installed host, real clipboard, or cross-call pagination-stability claim",
    packageRole: path.relative(evidenceReal, packageReal).startsWith(path.join("v032-inputs", "plugin-v031"))
      ? "frozen-v031-graph"
      : "caller-specified-v032-graph",
    scriptSha256: scriptBytes === undefined ? null : digest(scriptBytes),
    fixtureSha256: fixtureBytes === undefined ? null : digest(fixtureBytes),
    preloadSha256: preloadBytes === undefined ? null : digest(preloadBytes),
    phases,
    checks,
    loadedModuleHashes: fixture?.loadedModuleHashes ?? {},
    fixtureClosed,
    temporaryRemoved,
  };
  await writeFile(output, JSON.stringify(result, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  if (result.execution !== "PASS") process.exitCode = 1;
}

let invocation;
try {
  invocation = parseArguments(process.argv.slice(2));
} catch {
  process.stderr.write(usage + "\n");
  process.exitCode = 2;
}
if (invocation?.help) {
  process.stdout.write(usage + "\n");
} else if (invocation !== undefined) {
  try {
    await run(invocation);
  } catch {
    process.stderr.write("Harness setup failed; no private details emitted.\n");
    process.exitCode = 1;
  }
}
