import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bootPreloadFixture } from "./lib/preload-database-fixture.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const packageRoot = path.join(root, "dist/ztools");
const artifactRoot = path.join(root, "artifacts/pasteboardpro/clipboard-format-g0/v026-image-package-tests");
await mkdir(artifactRoot, { recursive: true, mode: 0o700 });
const cases = [];
const scenarios = ["missing-path", "read-error", "write-error", "corrupt-cache", "success", "excluded-missing-path", "paused-missing-path", "relative-path", "empty-image", "record-error"];
const selected = process.argv[3] ? scenarios.filter(value => value === process.argv[3]) : scenarios;
assert.ok(selected.length > 0);
for (const scenario of selected) {
  const directory = await mkdtemp(path.join(artifactRoot, `owned-${process.versions.electron ? "electron" : "node"}-${scenario}-`));
  let fixture;
  const observation = { scenario };
  try {
    fixture = await bootPreloadFixture({ packageRoot, directory, imageScenario: scenario, recordConflicts: scenario === "record-error" ? 3 : 0 });
    await fixture.settled();
    const cursorId = "pasteboard-pro:cursor:ztools-history";
    const records = () => [...fixture.docs.values()].filter(doc => doc.type === "pasteboard-pro-record");
    observation.initialCursorExists = fixture.docs.has(cursorId);
    observation.initialRecordCount = records().length;
    observation.loadedModuleHashes = fixture.loadedModuleHashes;
    if (["missing-path", "read-error", "write-error", "relative-path", "empty-image", "record-error"].includes(scenario)) {
      assert.equal(fixture.docs.has(cursorId), false, "unpersisted image must not advance mirror cursor");
      assert.equal(records().length, 0, "failed image must not become a retained record");
      const errors = fixture.calls.events.filter(event => event.type === "pasteboard-pro:sync-error");
      assert.ok(errors.length > 0, "capture error must reach existing error event channel");
      const safeMessage = scenario === "record-error" ? "Database conflict" : "Clipboard image persistence failed";
      assert.ok(errors.some(event => event.detail === safeMessage));
      if (scenario === "record-error") {
        assert.equal(createHash("sha256").update(await readFile(fixture.image.blobPath)).digest("hex"), fixture.image.sha256, "unreferenced verified blob must survive DB write failure for retry");
        observation.orphanRetainedForRetry = true;
      }
      await fixture.recoverImage();
      await fixture.calls.clipboard[0]();
    }
    assert.equal(fixture.docs.has(cursorId), true, "successful or deliberately filtered event should advance cursor");
    if (["excluded-missing-path", "paused-missing-path"].includes(scenario)) {
      assert.equal(records().length, 0);
      assert.equal(fixture.imageFaults.length, 0);
    } else {
      assert.equal(records().length, 1);
      const stored = records()[0].record;
      assert.equal(stored.origin.pluginBlobId, "blob-" + fixture.image.sha256);
      assert.equal(stored.origin.imagePath, fixture.image.blobPath);
      assert.equal(stored.origin.blobBytes, fixture.image.bytes);
      assert.equal(createHash("sha256").update(await readFile(stored.origin.imagePath)).digest("hex"), fixture.image.sha256, "retained image bytes must match captured fixture");
      await fixture.calls.clipboard[0]();
      assert.equal(records().length, 1, "retry must not create duplicate image records");
    }
    assert.deepEqual(fixture.calls.clipboardReads, [], "historical image must never read the current clipboard");
    assert.deepEqual(fixture.denied, []);
    const errorMessages = [...fixture.errors, ...fixture.calls.events.filter(event => event.type === "pasteboard-pro:sync-error").map(event => String(event.detail))];
    assert.ok(errorMessages.every(value => !value.includes("synthetic-sensitive-image-io-error") && !value.includes("synthetic-sensitive-host-message")));
    cases.push({ ...observation, status: "PASS", injectedImageFaults: fixture.imageFaults.length });
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
  scope: "actual shipped preload CJS graph in Node VM and synthetic SDK/history; owned PNG and filesystem fault seam; no general clipboard or installed host",
  testScriptSha256: createHash("sha256").update(await readFile(fileURLToPath(import.meta.url))).digest("hex"),
  fixtureSha256: createHash("sha256").update(await readFile(new URL("./lib/preload-database-fixture.mjs", import.meta.url))).digest("hex"),
  preloadSha256: createHash("sha256").update(await readFile(path.join(packageRoot, "preload.js"))).digest("hex"),
  cases, gateComplete: false,
};
await writeFile(process.argv[2] ?? path.join(artifactRoot, "result.json"), JSON.stringify(result, null, 2) + "\n");
if (result.execution !== "PASS") process.exitCode = 1;
