import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bootPreloadFixture } from "./lib/preload-database-fixture.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const artifactRoot = path.join(root, "artifacts/pasteboardpro/clipboard-format-g0/v030-clear-queue-package-tests");
const defaultPackageRoot = path.join(root, "artifacts/pasteboardpro/clipboard-format-g0/v030-inputs/plugin-v029/dist/ztools");
const packageRoot = path.resolve(process.argv[3] ?? defaultPackageRoot);
const outputPath = path.resolve(process.argv[2] ?? path.join(artifactRoot, "result.json"));
if (process.argv.length > 4 || !outputPath.startsWith(artifactRoot + path.sep)) {
  process.stderr.write("Usage: node scripts/test-preload-history-clear-queue-package.mjs <owned-output.json> [package-root]\n");
  process.exitCode = 2;
} else {
  await run();
}

async function bounded(promise, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise(resolve => { timer = setTimeout(() => resolve("timeout"), timeoutMs); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function run() {
  await mkdir(artifactRoot, { recursive: true, mode: 0o700 });
  const runtimeName = process.versions.electron ? "electron" : "node";
  const temporaryRoot = await mkdtemp(path.join(artifactRoot, "owned-" + runtimeName + "-"));
  const checks = [];
  const phases = {};
  let fixture;
  let fixtureClosed = false;
  let temporaryRemoved = false;
  let scriptBytes;
  let fixtureBytes;
  let preloadBytes;
  const digest = bytes => createHash("sha256").update(bytes).digest("hex");
  const check = (phase, name, actual, expected) => {
    checks.push({ phase, name, actual, expected, passed: actual === expected });
  };
  const records = () => [...fixture.docs.values()].filter(doc => doc.type === "pasteboard-pro-record");
  const boundaryDocument = () => fixture.docs.get("pasteboard-pro:mirror-image-retry");
  const safeClearResult = async promise => {
    try {
      await promise;
      return "resolved";
    } catch {
      return "rejected";
    }
  };

  try {
    [scriptBytes, fixtureBytes, preloadBytes] = await Promise.all([
      readFile(fileURLToPath(import.meta.url)),
      readFile(fileURLToPath(new URL("./lib/preload-database-fixture.mjs", import.meta.url))),
      readFile(path.join(packageRoot, "preload.js")),
    ]);
    fixture = await bootPreloadFixture({
      packageRoot,
      directory: temporaryRoot,
      imageScenario: "retry-rotation",
      holdHistory: true,
      historyTail: [{
        id: "fixture-clear-queue-tail",
        type: "text",
        content: "public clear queue tail",
        timestamp: Date.now(),
        appName: "Fixture",
        bundleId: "example.allowed",
      }],
    });

    const historyEntered = await bounded(fixture.waitForHistoryWait(1), 3_000);
    phases.blocked = {
      historyWaitCount: fixture.historyWaitCount,
      recordCount: records().length,
      retryProgressWrites: fixture.calls.put.filter(id => id === "pasteboard-pro:mirror-image-retry").length,
      recordRemoves: fixture.calls.remove.length,
      clipboardClears: fixture.calls.clipboardClears.length,
      enteredBarrier: historyEntered !== "timeout",
    };
    check("blocked", "mirror-reached-controlled-history-barrier", phases.blocked.enteredBarrier, true);
    check("blocked", "exactly-one-history-read-waiting", phases.blocked.historyWaitCount, 1);
    check("blocked", "no-record-written-before-history-release", phases.blocked.recordCount, 0);

    const priorRecordRemoveCount = fixture.calls.remove.length;
    const priorRetryProgressWriteCount = fixture.calls.put
      .filter(id => id === "pasteboard-pro:mirror-image-retry").length;
    const priorSyncErrorCount = fixture.calls.events
      .filter(event => event.type === "pasteboard-pro:sync-error").length;
    let clearSettled = false;
    const clearPromise = safeClearResult(fixture.bridge.clearClipboardHistory())
      .then(outcome => { clearSettled = true; return outcome; });
    phases.clearOutcomeBeforeRelease = await bounded(clearPromise, 250);
    phases.beforeRelease = {
      clearSettled,
      recordCount: records().length,
      retryProgressWrites: fixture.calls.put
        .filter(id => id === "pasteboard-pro:mirror-image-retry").length - priorRetryProgressWriteCount,
      recordRemoves: fixture.calls.remove.length - priorRecordRemoveCount,
      clipboardClears: fixture.calls.clipboardClears.length,
      mainCursorExists: fixture.docs.has("pasteboard-pro:cursor:ztools-history"),
      retryBoundaryExists: boundaryDocument() !== undefined,
    };
    check("before-release", "clear-remains-pending-behind-mirror",
      phases.beforeRelease.clearSettled, false);
    check("before-release", "clear-promise-did-not-settle",
      phases.clearOutcomeBeforeRelease, "timeout");
    check("before-release", "no-retry-progress-written",
      phases.beforeRelease.retryProgressWrites, 0);
    check("before-release", "no-record-removal-started",
      phases.beforeRelease.recordRemoves, 0);
    check("before-release", "system-clipboard-not-cleared-early",
      phases.beforeRelease.clipboardClears, 0);

    fixture.releaseHistory();
    const mirrorFinished = await bounded(
      fixture.waitForEvent("pasteboard-pro:sync-error", priorSyncErrorCount + 1),
      3_000,
    );
    phases.mirrorOutcomeAfterRelease = mirrorFinished === "timeout" ? "timeout" : "known-image-error";
    phases.clearOutcomeAfterRelease = await bounded(clearPromise, 3_000);
    await fixture.settled();
    const sequence = fixture.calls.sequence;
    const syncErrorIndex = sequence.findIndex((value, index) =>
      index > 0 && value === "event:pasteboard-pro:sync-error");
    const clearIndex = sequence.indexOf("system-clipboard-clear");
    phases.final = {
      recordCount: records().length,
      retryBoundaryExists: boundaryDocument() !== undefined,
      retryBoundaryClear: boundaryDocument()?.before === null,
      mainCursorExists: fixture.docs.has("pasteboard-pro:cursor:ztools-history"),
      clipboardClears: fixture.calls.clipboardClears.length,
      clipboardReads: fixture.calls.clipboardReads.length,
      deniedOperations: fixture.denied.length,
      mirrorErrorBeforeSystemClear: syncErrorIndex >= 0 && clearIndex > syncErrorIndex,
      diagnosticsSafe: [...fixture.errors, ...fixture.calls.events
        .filter(event => event.type === "pasteboard-pro:sync-error")
        .map(event => String(event.detail))]
        .every(message => !message.includes(temporaryRoot) &&
          !message.includes("synthetic-sensitive-image-io-error") &&
          !message.includes("synthetic-sensitive-host-message")),
    };
    check("after-release", "mirror-reached-known-failure",
      phases.mirrorOutcomeAfterRelease, "known-image-error");
    check("after-release", "queued-clear-resolved",
      phases.clearOutcomeAfterRelease, "resolved");
    check("after-release", "all-records-cleared", phases.final.recordCount, 0);
    check("after-release", "retry-boundary-cleared", phases.final.retryBoundaryClear, true);
    check("after-release", "system-clipboard-cleared-once", phases.final.clipboardClears, 1);
    check("after-release", "mirror-settled-before-system-clear",
      phases.final.mirrorErrorBeforeSystemClear, true);
    check("after-release", "system-clipboard-never-read", phases.final.clipboardReads, 0);
    check("after-release", "filesystem-or-network-denials", phases.final.deniedOperations, 0);
    check("after-release", "diagnostics-omit-temp-path-and-private-errors",
      phases.final.diagnosticsSafe, true);
  } catch {
    checks.push({ phase: "harness", name: "fixture-execution", actual: "failed", expected: "completed", passed: false });
  } finally {
    fixture?.releaseHistory();
    try {
      await fixture?.close();
      fixtureClosed = true;
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
    execution: checks.every(item => item.passed) && fixtureClosed && temporaryRemoved ? "PASS" : "FAIL",
    runtime: { node: process.versions.node, electron: process.versions.electron ?? null },
    scope: "actual packaged preload CJS graph with a held synthetic history API and owned database fixtures; not installed host, Windows, or proof that a later host clipboard event cannot re-import cleared content",
    packageRole: packageRoot === defaultPackageRoot ? "v029-frozen-packaged-preload" : "caller-specified-packaged-preload",
    testScriptSha256: scriptBytes === undefined ? null : digest(scriptBytes),
    fixtureSha256: fixtureBytes === undefined ? null : digest(fixtureBytes),
    preloadSha256: preloadBytes === undefined ? null : digest(preloadBytes),
    phases,
    checks,
    loadedModuleHashes: fixture?.loadedModuleHashes ?? {},
    fixtureClosed,
    temporaryRemoved,
    gateComplete: false,
  };
  await writeFile(outputPath, JSON.stringify(result, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  if (result.execution !== "PASS") process.exitCode = 1;
}
