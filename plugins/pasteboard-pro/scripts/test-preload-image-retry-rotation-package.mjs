import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bootPreloadFixture } from "./lib/preload-database-fixture.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const artifactRoot = path.join(root, "artifacts/pasteboardpro/clipboard-format-g0/v030-retry-rotation-package-tests");
const defaultPackageRoot = path.join(root, "artifacts/pasteboardpro/clipboard-format-g0/v030-inputs/plugin-v029/dist/ztools");
const packageRoot = path.resolve(process.argv[3] ?? defaultPackageRoot);
const outputPath = path.resolve(process.argv[2] ?? path.join(artifactRoot, "result.json"));
if (process.argv.length > 4 || !outputPath.startsWith(artifactRoot + path.sep)) {
  process.stderr.write("Usage: node scripts/test-preload-image-retry-rotation-package.mjs <owned-output.json> [package-root]\n");
  process.exitCode = 2;
} else {
  await run();
}

async function run() {
  await mkdir(artifactRoot, { recursive: true, mode: 0o700 });
  const runtimeName = process.versions.electron ? "electron" : "node";
  const temporaryRoot = await mkdtemp(path.join(artifactRoot, "owned-" + runtimeName + "-"));
  const checks = [];
  const phases = {};
  let fixture;
  let ownedTempCleanup = false;
  let fixtureClosed = false;
  let temporaryRemoved = false;
  let scriptBytes;
  let fixtureBytes;
  let preloadBytes;
  const digest = bytes => createHash("sha256").update(bytes).digest("hex");
  const recordCheck = (phase, name, actual, expected) => {
    checks.push({ phase, name, actual, expected, passed: actual === expected });
  };
  const records = () => [...fixture.docs.values()].filter(doc => doc.type === "pasteboard-pro-record");
  const cursorDocument = () => fixture.docs.get("pasteboard-pro:cursor:ztools-history");
  const boundaryDocument = () => fixture.docs.get("pasteboard-pro:mirror-image-retry");
  const imageRecords = () => records().filter(doc => doc.record.item.kind === "image");
  const image17Record = () => imageRecords().find(doc =>
    doc.record.origin.hostItemId === "fixture-rotation-image-17");
  const tailRecord = () => records().find(doc =>
    doc.record.origin.hostItemId === "fixture-rotation-tail-text");
  const safeCallback = async () => {
    try {
      await fixture.calls.clipboard[0]();
      return "resolved";
    } catch (error) {
      const messageDescriptor = error !== null && typeof error === "object"
        ? Object.getOwnPropertyDescriptor(error, "message")
        : undefined;
      const message = typeof messageDescriptor?.value === "string"
        ? messageDescriptor.value
        : "";
      return [
        "Clipboard image retry is pending",
        "Clipboard image persistence failed",
      ].includes(message) ? message : "unexpected-fixed-error";
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
      historyTail: [{
        id: "fixture-rotation-tail-text",
        type: "text",
        content: "public retry rotation tail",
        timestamp: Date.now(),
        appName: "Fixture",
        bundleId: "example.allowed",
      }],
    });
    await fixture.settled();

    const firstTail = tailRecord();
    const initialBoundary = boundaryDocument();
    phases.initial = {
      recordCount: records().length,
      imageCount: imageRecords().length,
      image17Present: image17Record() !== undefined,
      mainCursor: cursorDocument()?.cursor?.id ?? null,
      boundary: initialBoundary?.before?.id ?? null,
      tailRevision: firstTail?._rev ?? null,
      imageFaultCount: fixture.imageFaults.length,
    };
    recordCheck("initial", "healthy-tail-saved", Boolean(firstTail), true);
    recordCheck("initial", "first-16-images-not-yet-saved", phases.initial.imageCount, 0);
    recordCheck("initial", "17th-image-not-yet-saved", phases.initial.image17Present, false);
    recordCheck("initial", "main-cursor-held", phases.initial.mainCursor, null);
    recordCheck("initial", "retry-boundary-marks-oldest-attempted-image",
      phases.initial.boundary, "fixture-rotation-image-16");
    recordCheck("initial", "exactly-16-source-faults", phases.initial.imageFaultCount, 16);

    phases.secondCallbackError = await safeCallback();
    phases.second = {
      recordCount: records().length,
      imageCount: imageRecords().length,
      image17Present: image17Record() !== undefined,
      mainCursor: cursorDocument()?.cursor?.id ?? null,
      boundaryExists: boundaryDocument() !== undefined,
      boundaryClear: boundaryDocument()?.before === null,
      tailRevision: tailRecord()?._rev ?? null,
    };
    recordCheck("second", "deferred-prefix-reports-fixed-pending-error",
      phases.secondCallbackError, "Clipboard image retry is pending");
    recordCheck("second", "17th-image-imported", phases.second.image17Present, true);
    recordCheck("second", "older-suffix-imported-once", phases.second.imageCount, 1);
    recordCheck("second", "main-cursor-still-held", phases.second.mainCursor, null);
    recordCheck("second", "retry-boundary-document-present", phases.second.boundaryExists, true);
    recordCheck("second", "retry-boundary-cleared", phases.second.boundaryClear, true);
    recordCheck("second", "confirmed-tail-revision-unchanged",
      phases.second.tailRevision, phases.initial.tailRevision);

    await fixture.recoverImage();
    phases.thirdCallbackError = await safeCallback();
    phases.third = {
      recordCount: records().length,
      imageCount: imageRecords().length,
      distinctImageHostIds: new Set(imageRecords().map(doc => doc.record.origin.hostItemId)).size,
      image17Present: image17Record() !== undefined,
      mainCursor: cursorDocument()?.cursor?.id ?? null,
      boundaryExists: boundaryDocument() !== undefined,
      boundaryClear: boundaryDocument()?.before === null,
      tailRevision: tailRecord()?._rev ?? null,
      clipboardReadCount: fixture.calls.clipboardReads.length,
      deniedOperations: fixture.denied.length,
      imageFaultMessagesLeaked: fixture.errors.some(message =>
        message.includes("synthetic-sensitive-image-io-error") ||
        message.includes("synthetic-sensitive-host-message")),
      diagnosticsSafe: [...fixture.errors, ...fixture.calls.events
        .filter(event => event.type === "pasteboard-pro:sync-error")
        .map(event => String(event.detail))]
        .every(message => !message.includes(temporaryRoot) &&
          !message.includes("synthetic-sensitive-image-io-error") &&
          !message.includes("synthetic-sensitive-host-message")),
    };
    recordCheck("third", "all-17-images-imported-once", phases.third.imageCount, 17);
    recordCheck("third", "all-image-host-identities-distinct", phases.third.distinctImageHostIds, 17);
    recordCheck("third", "17th-image-remains-imported", phases.third.image17Present, true);
    recordCheck("third", "main-cursor-confirmed", phases.third.mainCursor, "fixture-rotation-image-01");
    recordCheck("third", "retry-boundary-cleared", phases.third.boundaryClear, true);
    recordCheck("third", "confirmed-tail-revision-unchanged",
      phases.third.tailRevision, phases.initial.tailRevision);
    recordCheck("third", "system-clipboard-never-read", phases.third.clipboardReadCount, 0);
    recordCheck("third", "filesystem-or-network-denials", phases.third.deniedOperations, 0);
    recordCheck("third", "private-image-error-diagnostic-not-leaked",
      phases.third.imageFaultMessagesLeaked, false);
    recordCheck("third", "diagnostics-omit-temporary-path-and-private-errors",
      phases.third.diagnosticsSafe, true);

    phases.idempotenceCallbackError = await safeCallback();
    recordCheck("idempotence", "all-record-count-stable", records().length, 18);
    recordCheck("idempotence", "repeat-mirror-resolved", phases.idempotenceCallbackError, "resolved");
  } catch {
    checks.push({ phase: "harness", name: "fixture-execution", actual: "failed", expected: "completed", passed: false });
  } finally {
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
    ownedTempCleanup = fixtureClosed && temporaryRemoved;
  }

  const result = {
    execution: checks.every(check => check.passed) && ownedTempCleanup ? "PASS" : "FAIL",
    runtime: { node: process.versions.node, electron: process.versions.electron ?? null },
    scope: "actual packaged preload CJS graph with synthetic SDK, 17 owned public PNG files, and a bounded filesystem fault seam; not installed host, general clipboard, or Windows validation",
    packageRole: packageRoot === defaultPackageRoot ? "v029-frozen-packaged-preload" : "caller-specified-packaged-preload",
    testScriptSha256: scriptBytes === undefined ? null : digest(scriptBytes),
    fixtureSha256: fixtureBytes === undefined ? null : digest(fixtureBytes),
    preloadSha256: preloadBytes === undefined ? null : digest(preloadBytes),
    phases,
    checks,
    loadedModuleHashes: fixture?.loadedModuleHashes ?? {},
    imageFaultCount: fixture?.imageFaults.length ?? null,
    clipboardReadCount: fixture?.calls.clipboardReads.length ?? null,
    deniedOperationCount: fixture?.denied.length ?? null,
    fixtureClosed,
    temporaryRemoved,
    ownedTempCleanup,
    gateComplete: false,
  };
  await writeFile(outputPath, JSON.stringify(result, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  if (result.execution !== "PASS") process.exitCode = 1;
}
