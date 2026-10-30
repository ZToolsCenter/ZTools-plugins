import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bootPreloadFixture } from "./lib/preload-database-fixture.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const packageRoot = path.resolve(process.argv[3] ?? path.join(root, "dist/ztools"));
const artifactRoot = path.join(root, "artifacts/pasteboardpro/clipboard-format-g0/v028-mirror-package-tests");
await mkdir(artifactRoot, { recursive: true, mode: 0o700 });
const cases = [];
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
for (const scenario of ["missing-path", "read-error", "write-error", "empty-image", "record-error", "excluded-missing-path", "notification-error"]) {
  const directory = await mkdtemp(path.join(artifactRoot, `owned-${process.versions.electron ? "electron" : "node"}-${scenario}-`));
  let fixture;
  const observation = { scenario };
  try {
    fixture = await bootPreloadFixture({
      packageRoot, directory,
      imageScenario: scenario === "notification-error" ? "read-error" : scenario,
      recordConflicts: scenario === "record-error" ? 3 : 0,
      failFirstHistoryNotification: scenario === "notification-error",
      historyTail: [{ id: "fixture-older-text", type: "text", content: "public older fixture record",
        timestamp: Date.now() - 1000, appName: "Fixture", bundleId: "example.allowed" }],
    });
    await fixture.settled();
    const cursorId = "pasteboard-pro:cursor:ztools-history";
    const records = () => [...fixture.docs.values()].filter(doc => doc.type === "pasteboard-pro-record");
    const textRecord = () => records().find(doc => doc.record.item.id === "ztools:fixture-older-text");
    const initialErrors = fixture.calls.events.filter(event => event.type === "pasteboard-pro:sync-error");
    const policySkipped = scenario === "excluded-missing-path";
    observation.loadedModuleHashes = fixture.loadedModuleHashes;
    observation.initialCursorExists = fixture.docs.has(cursorId);
    observation.initialRecordCount = records().length;
    observation.initialErrorDetails = initialErrors.map(event => String(event.detail));
    assert.equal(fixture.docs.has(cursorId), policySkipped,
      "failed image must keep cursor; deliberately excluded image may advance it");
    if (scenario === "record-error") {
      assert.equal(records().length, 0, "database failure must still stop the batch immediately");
      assert.ok(initialErrors.some(event => event.detail === "Database conflict"));
    } else {
      assert.ok(textRecord(), "healthy older text must be confirmed despite the image preparation failure");
      assert.equal(records().length, 1, "unpersisted or excluded image must not be retained");
      assert.ok(fixture.calls.events.some(event => event.type === "pasteboard-pro:history-changed" &&
        Array.isArray(event.detail) && event.detail.includes(textRecord()._id)),
      "confirmed healthy record must be included in a history refresh notification");
    }
    if (!policySkipped) {
      assert.equal(fixture.calls.events.filter(event => event.type === "pasteboard-pro:history-mirrored").length, 0,
        "partial batch must not emit a successful mirror result");
      assert.equal(fixture.calls.events.filter(event => event.type === "pasteboard-pro:vault-synced").length, 0,
        "partial batch must not start vault synchronization");
      const message = scenario === "record-error" ? "Database conflict" : "Clipboard image persistence failed";
      assert.ok(initialErrors.some(event => event.detail === message));
      const firstTextId = textRecord()?._id;
      const firstTextRevision = textRecord()?._rev;
      await fixture.recoverImage();
      await fixture.calls.clipboard[0]();
      assert.equal(fixture.docs.has(cursorId), true, "fully successful retry must advance the cursor");
      assert.equal(records().length, 2, "retry must retain image and healthy text exactly once");
      if (firstTextId) {
        assert.equal(textRecord()._id, firstTextId);
        assert.equal(textRecord()._rev, firstTextRevision, "retry must not rewrite confirmed text");
      }
      const imageRecord = records().find(doc => doc.record.item.kind === "image");
      assert.equal(sha(await readFile(imageRecord.record.origin.imagePath)), fixture.image.sha256);
      await fixture.calls.clipboard[0]();
      assert.equal(records().length, 2);
    } else {
      assert.equal(initialErrors.length, 0);
      assert.equal(fixture.imageFaults.length, 0, "privacy exclusion must precede image I/O");
    }
    assert.deepEqual(fixture.calls.clipboardReads, [], "historical images must not read current clipboard");
    assert.deepEqual(fixture.denied, []);
    const diagnostic = [...fixture.errors, ...fixture.calls.events.filter(event => event.type === "pasteboard-pro:sync-error")
      .map(event => String(event.detail))];
    assert.ok(diagnostic.every(value => !value.includes("synthetic-sensitive-image-io-error") &&
      !value.includes("synthetic-sensitive-host-message") && !value.includes("synthetic-sensitive-notification-error")));
    cases.push({ ...observation, status: "PASS", finalRecordCount: records().length,
      finalCursorExists: fixture.docs.has(cursorId), clipboardReadCount: fixture.calls.clipboardReads.length });
  } catch (error) {
    cases.push({ ...observation, status: "FAIL", error: String(error) });
  } finally {
    await fixture?.close();
    await rm(directory, { recursive: true, force: false });
  }
}
const result = {
  execution: cases.every(value => value.status === "PASS") ? "PASS" : "FAIL",
  runtime: { node: process.versions.node, electron: process.versions.electron ?? null },
  scope: "actual packaged preload CJS graph with synthetic SDK, owned public fixtures and filesystem fault seam; not installed host, general clipboard or Windows validation",
  testScriptSha256: sha(await readFile(fileURLToPath(import.meta.url))),
  fixtureSha256: sha(await readFile(new URL("./lib/preload-database-fixture.mjs", import.meta.url))),
  preloadSha256: sha(await readFile(path.join(packageRoot, "preload.js"))),
  cases, gateComplete: false,
};
await writeFile(process.argv[2] ?? path.join(artifactRoot, "result.json"), JSON.stringify(result, null, 2) + "\n");
if (result.execution !== "PASS") process.exitCode = 1;
