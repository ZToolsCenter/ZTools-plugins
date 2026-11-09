import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, mkdir, mkdtemp, rm, writeFile, realpath, lstat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bootPreloadFixture } from "./lib/preload-database-fixture.mjs";

const root = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const args = process.argv.slice(2);
const options = {};
for (let i = 0; i < args.length; i += 2) {
  if (!["--package-dir", "--output"].includes(args[i]) || !args[i + 1] || options[args[i]]) throw new Error("Invalid package smoke arguments");
  options[args[i]] = args[i + 1];
}
const ownedRoot = path.join(root, "artifacts/pasteboardpro/clipboard-format-g0/v033-owned");
const packageRoot = path.resolve(root, options["--package-dir"] ?? "dist/ztools");
const output = path.resolve(root, options["--output"] ?? path.join(ownedRoot, `image-retry-journal-${process.versions.electron ? "electron" : "node"}.json`));
assert.ok(packageRoot.startsWith(root + path.sep));
assert.ok(output.startsWith(ownedRoot + path.sep));
async function ensureDirectory(directory) {
  let current = root;
  for (const part of path.relative(root, directory).split(path.sep)) {
    if (!part || part === "." || part === "..") throw new Error("Invalid owned directory");
    current = path.join(current, part);
    await mkdir(current, { recursive: false, mode: 0o700 }).catch(error => { if (error.code !== "EEXIST") throw error; });
    assert.ok((await lstat(current)).isDirectory());
    assert.equal(await realpath(current), current);
  }
}
await ensureDirectory(ownedRoot);
await ensureDirectory(path.dirname(output));
const cases = [];
const loadedGraphs = [];
const journalPrefix = "pasteboard-pro:mirror-image-retry-journal:";
const journalOf = fixture => [...fixture.docs.values()].find(doc => doc._id.startsWith(journalPrefix));
const summary = value => ({ pending: value.pending, failed: value.failed, total: value.total, capacity: value.capacity });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function check(name, run) {
  try { await run(); cases.push({ name, status: "PASS" }); return true; }
  catch { cases.push({ name, status: "FAIL", reasonCode: "package-assertion-failed" }); return false; }
}
async function ownedScenario(name, run) {
  const directory = await mkdtemp(path.join(ownedRoot, `journal-${name}-`));
  const fixtures = [];
  const boot = async input => { const fixture = await bootPreloadFixture({ packageRoot, directory, ...input }); fixtures.push(fixture); loadedGraphs.push({ scenario: name, role: input?.role ?? "primary", moduleHashes: fixture.loadedModuleHashes }); return fixture; };
  try { await run(boot, directory); }
  finally {
    for (const fixture of fixtures.reverse()) {
      await fixture.close();
      await check(name + ":no-external-effects-or-sensitive-errors", () => {
        assert.deepEqual(fixture.denied, []); assert.deepEqual(fixture.calls.clipboardReads, []);
        assert.equal(fixture.errors.some(value => /synthetic-sensitive/.test(value)), false);
      });
    }
    await rm(directory, { recursive: true, force: false });
  }
}
const api = bridge => typeof bridge.getImageRetryStatus === "function" && typeof bridge.requestImageRetry === "function";

await ownedScenario("failed-reopen", async (boot, directory) => {
  const f = await boot({ imageScenario: "read-error", historyTail: [{ id: "healthy-after-image-failure", type: "text", timestamp: Date.now() + 120000, content: "public healthy tail" }] });
  await f.settled();
  const hasApi = await check("bridge-exposes-counts-and-request", () => assert.ok(api(f.bridge)));
  await check("failed-task-is-durable-before-cursor", () => {
    const journal = journalOf(f);
    assert.equal(journal.entries.length, 1); assert.equal(journal.entries[0].state, "failed");
    assert.equal(journal.entries[0].reason, "image-read-failed");
    assert.equal(f.docs.has("pasteboard-pro:cursor:ztools-history"), false);
    assert.ok([...f.docs.values()].some(doc => doc.record?.item?.id === "ztools:healthy-after-image-failure"));
    const encoded = JSON.stringify(journal);
    assert.equal(encoded.includes(directory), false); assert.equal(encoded.includes("public healthy tail"), false);
    assert.equal(encoded.includes("synthetic-sensitive"), false);
  });
  if (!hasApi) return;
  await check("status-is-four-counts-only", async () => {
    const value = await f.bridge.getImageRetryStatus();
    assert.deepEqual(Object.keys(value).sort(), ["capacity", "failed", "pending", "total"]);
    assert.deepEqual(summary(value), { pending: 0, failed: 1, total: 1, capacity: 4096 });
  });
  const savedDocs = f.docs, timestamp = f.image.item.timestamp;
  await f.close();
  const reopened = await boot({ imageScenario: "read-error", fixedImageTimestamp: timestamp, sharedDocuments: savedDocs, holdHistory: true });
  await reopened.waitForHistoryWait();
  await check("reopen-retains-failed-task-before-host-response", async () => assert.equal((await reopened.bridge.getImageRetryStatus()).failed, 1));
  await reopened.recoverImage(); reopened.releaseHistory(); await reopened.settled();
  await check("reopen-recovers-and-clears-pending-after-canonical-write", async () => {
    assert.equal((await reopened.bridge.getImageRetryStatus()).total, 0);
    assert.equal([...reopened.docs.values()].filter(doc => doc.record?.item?.id === "ztools:fixture-host-image").length, 1);
    assert.ok(reopened.docs.has("pasteboard-pro:cursor:ztools-history"));
    assert.deepEqual(reopened.calls.clipboardReads, []); assert.deepEqual(reopened.denied, []);
  });
});

await ownedScenario("completion-fault", async boot => {
  let failCompletion = true;
  const f = await boot({ imageScenario: "valid-image", databaseFault: (operation, id, document) =>
    operation === "put" && id.startsWith(journalPrefix) && document.entries?.length === 0 && failCompletion });
  await f.settled();
  await check("canonical-success-before-ledger-completion-failure-stays-pending", async () => {
    assert.ok(api(f.bridge));
    assert.equal([...f.docs.values()].filter(doc => doc.record?.item?.id === "ztools:fixture-host-image").length, 1);
    assert.equal((await f.bridge.getImageRetryStatus()).total, 1);
    assert.equal(f.docs.has("pasteboard-pro:cursor:ztools-history"), false);
  });
  if (!api(f.bridge)) return;
  await check("manual-request-is-not-a-completion-ack", () => assert.equal(f.bridge.requestImageRetry(), undefined));
  await f.settled();
  const documents = f.docs, timestamp = f.image.item.timestamp;
  await f.close(); failCompletion = false;
  const reopened = await boot({ imageScenario: "valid-image", fixedImageTimestamp: timestamp, sharedDocuments: documents, emptyHistory: true });
  await reopened.settled();
  await check("reopen-reconciles-owned-canonical-without-host-row-or-canonical-rewrite", async () => {
    assert.equal((await reopened.bridge.getImageRetryStatus()).total, 0);
    assert.equal(reopened.calls.put.filter(id => id.startsWith("pasteboard-pro:record:")).length, 0);
    assert.equal(reopened.imageReads.length, 0);
  });
});

await ownedScenario("automatic", async boot => {
  const f = await boot({ imageScenario: "read-error" }); await f.settled();
  await check("automatic-retry-uses-primary-mirror-after-source-recovers", async () => {
    assert.ok(api(f.bridge)); await f.recoverImage();
    let timer;
    try {
      await Promise.race([f.waitForEvent("pasteboard-pro:history-mirrored"), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("automatic retry timeout")), 2500); })]);
    } finally { clearTimeout(timer); }
    assert.equal((await f.bridge.getImageRetryStatus()).total, 0);
    assert.ok(f.calls.timerDelays.includes(1000)); assert.deepEqual(f.calls.clipboardReads, []);
  });
});

await ownedScenario("read-fault", async boot => {
  const f = await boot({ imageScenario: "read-error", databaseFault: (operation, id) => operation === "get" && id.startsWith(journalPrefix) });
  await f.settled();
  await check("journal-read-failure-is-not-zero-and-stops-automatic-session", async () => {
    assert.ok(api(f.bridge)); await assert.rejects(() => f.bridge.getImageRetryStatus(), /Storage operation failed/);
    const reads = f.historyWaitCount; await sleep(1100); assert.equal(f.historyWaitCount, reads);
    assert.equal(f.calls.timerDelays.includes(1000), false); assert.equal(f.docs.has("pasteboard-pro:cursor:ztools-history"), false);
  });
});

await ownedScenario("clear", async boot => {
  const f = await boot({ imageScenario: "read-error" }); await f.settled();
  await check("clear-fences-timer-and-persists-task-identity-before-removal", async () => {
    assert.ok(api(f.bridge)); const identity = journalOf(f).entries[0].identity;
    await f.bridge.clearClipboardHistory();
    const marker = [...f.docs.values()].find(doc => doc.type === "pasteboard-pro-history-clear-boundary");
    assert.ok(marker.clearedIdentities.includes(identity)); assert.equal((await f.bridge.getImageRetryStatus()).total, 0);
    const reads = f.historyWaitCount; await sleep(1100); assert.equal(f.historyWaitCount, reads);
    await f.notifyHistoryChanged(); assert.equal((await f.bridge.getImageRetryStatus()).total, 0);
    assert.equal(f.calls.clipboardClears.length, 1); assert.deepEqual(f.calls.clipboardReads, []);
  });
});

await ownedScenario("auxiliary-screenshot", async boot => {
  const primary = await boot({ imageScenario: "valid-image", emptyHistory: true }); await primary.settled();
  const auxiliary = await boot({ role: "shelf", screenCaptureEnabled: true, onSendToParent: (channel, ...args) => {
    const handler = primary.calls.ipc.find(([name]) => name === channel)?.[1];
    assert.equal(typeof handler, "function"); handler(undefined, ...args);
  } });
  await check("auxiliary-screenshot-keeps-fast-polling-for-delayed-host-image", async () => {
    await auxiliary.bridge.captureScreenshot();
    await sleep(100); primary.appendHistory(primary.image.item);
    let timer;
    try {
      await Promise.race([primary.waitForEvent("pasteboard-pro:history-mirrored", 3), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("delayed history timeout")), 1500); })]);
    } finally { clearTimeout(timer); }
    assert.ok([...primary.docs.values()].some(doc => doc.record?.item?.id === "ztools:fixture-host-image"));
    assert.equal(auxiliary.historyWaitCount, 0); assert.equal(auxiliary.calls.screenshotWrites.length, 1);
    assert.deepEqual(auxiliary.calls.parent.at(-1), ["pasteboard-pro:request-history-mirror"]);
    assert.ok(primary.calls.timerDelays.includes(250));
  });
});

await ownedScenario("clear-boundary-fault", async boot => {
  const f = await boot({ imageScenario: "read-error", databaseFault: (operation, id) => operation === "put" && id === "pasteboard-pro:mirror-image-retry" });
  await f.settled();
  await check("clear-late-boundary-failure-refreshes-already-cleared-journal", async () => {
    assert.ok(api(f.bridge)); assert.equal((await f.bridge.getImageRetryStatus()).total, 1);
    const before = f.calls.events.filter(event => event.type === "pasteboard-pro:history-changed").length;
    await assert.rejects(() => f.bridge.clearClipboardHistory(), /Storage operation failed/);
    assert.equal((await f.bridge.getImageRetryStatus()).total, 0);
    assert.ok(f.calls.events.filter(event => event.type === "pasteboard-pro:history-changed").length > before);
    assert.equal(f.calls.clipboardClears.length, 0);
  });
});

for (const parentAvailable of [true, false]) await ownedScenario("auxiliary-" + parentAvailable, async boot => {
  const f = await boot({ role: "shelf", parentAvailable }); await f.settled();
  await check(parentAvailable ? "auxiliary-request-only-forwards-to-primary" : "auxiliary-without-parent-rejects-no-second-owner", async () => {
    assert.ok(api(f.bridge));
    if (parentAvailable) {
      assert.equal(f.bridge.requestImageRetry(), undefined);
      assert.deepEqual(f.calls.parent.at(-1), ["pasteboard-pro:request-history-mirror", "image-retry"]);
    } else assert.throws(() => f.bridge.requestImageRetry(), /当前窗口无法请求图片重试/);
    assert.equal(f.historyWaitCount, 0); assert.equal((await f.bridge.getImageRetryStatus()).total, 0);
    assert.equal(f.calls.ipc.some(([channel]) => channel === "pasteboard-pro:request-history-mirror"), false);
  });
});

const execution = cases.every(item => item.status === "PASS") ? "PASS" : "FAIL";
const result = { execution, runtime: { node: process.versions.node, electron: process.versions.electron ?? null },
  packageRoot: path.relative(root, packageRoot), preloadSha256: createHash("sha256").update(await readFile(path.join(packageRoot, "preload.js"))).digest("hex"),
  testScriptSha256: createHash("sha256").update(await readFile(fileURLToPath(import.meta.url))).digest("hex"),
  fixtureSha256: createHash("sha256").update(await readFile(new URL("./lib/preload-database-fixture.mjs", import.meta.url))).digest("hex"),
  loadedGraphs, cases, passed: cases.filter(item => item.status === "PASS").length, failed: cases.filter(item => item.status === "FAIL").length,
  scope: "Actual packaged preload graph, synthetic SDK and guarded owned filesystem. Shared metadata documents simulate reopen; no installed host, general clipboard, Windows, or hardware durability acceptance.",
  hostFilesWritten: false, generalClipboardAccess: false, gateComplete: false };
await writeFile(output, JSON.stringify(result, null, 2) + "\n", { flag: "wx", mode: 0o600 });
console.log(JSON.stringify({ execution, passed: result.passed, failed: result.failed, output }));
process.exitCode = execution === "PASS" ? 0 : 1;
