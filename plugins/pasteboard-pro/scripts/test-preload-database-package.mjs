import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bootPreloadFixture } from "./lib/preload-database-fixture.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const packageRoot = path.join(root, "dist/ztools");
const artifactRoot = path.join(root, "artifacts/pasteboardpro/clipboard-format-g0/v026-preload-package-tests");
await mkdir(artifactRoot, { recursive: true, mode: 0o700 });
const cases = [];
const expectedPrimaryIpcChannels = [
  "pasteboard-pro:clear-history-request",
  "pasteboard-pro:open-panel", "pasteboard-pro:set-screen-protection",
  "pasteboard-pro:set-shelf-edge", "pasteboard-pro:history-query",
  "pasteboard-pro:history-changed", "pasteboard-pro:window-preferences-changed",
  "pasteboard-pro:request-history-mirror", "pasteboard-pro:sync-settings-changed",
  "pasteboard-pro:paste-stack-changed",
].sort();
const expectedBridgeMethods = [
  "assignItemsToPinboard",
  "captureScreenshot",
  "clearClipboardHistory",
  "copyItem",
  "createPinboard",
  "createTextItem",
  "deletePinboard",
  "getHistoryItem",
  "getHostCompatibility",
  "getItemPreview",
  "getItemThumbnails",
  "getListOrders",
  "getPasteStack",
  "getPlatformCapabilities",
  "getPrivacySettings",
  "getSourceAppIcon",
  "getSyncSettings",
  "getWindowPreferences",
  "listApplications",
  "listPinboards",
  "movePinboard",
  "openPanel",
  "pasteContent",
  "pasteHostItem",
  "pasteItem",
  "prepareNativeFileDrag",
  "quickLookItem",
  "recognizeItem",
  "renamePinboard",
  "reorderHistory",
  "retrySync",
  "rotateImage",
  "saveListOrder",
  "savePasteStack",
  "savePrivacySettings",
  "saveSyncSettings",
  "saveWindowPreferences",
  "searchHistory",
  "searchHistoryPage",
  "selectThemeBackgroundImage",
  "setCapturePause",
  "startNativeFileDrag",
  "updateItemTitle",
  "updatePinboardColor",
  "updateTextItem"
];
for (const role of ["primary", "shelf", "panel", "unsupported", "primary-migration", "primary-masked-migration"]) {
  const directory = await mkdtemp(path.join(artifactRoot, `owned-${process.versions.electron ? "electron" : "node"}-${role}-`));
  let fixture;
  try {
    fixture = await bootPreloadFixture({ packageRoot, directory, role, supported: role !== "unsupported", recordConflicts: role === "primary" ? 3 : 0, seedLegacy: role.includes("migration"), maskMigrationRead: role === "primary-masked-migration" });
    const { bridge, calls, docs, errors, denied } = fixture;
    await fixture.settled();
    const expectedChannels = role.startsWith("primary") ? expectedPrimaryIpcChannels : [];
    assert.deepEqual(calls.ipc.map(([channel]) => channel).sort(), expectedChannels, "role IPC registration must match once per channel");
    if (role === "unsupported") {
      assert.deepEqual(Object.keys(bridge).sort(), ["getHostCompatibility", "getPlatformCapabilities"]);
      assert.equal(calls.get.length + calls.put.length + calls.allDocs.length, 0);
    } else {
      assert.deepEqual(Object.keys(bridge).sort(), expectedBridgeMethods);
      assert.equal(calls.enter.length, role.startsWith("primary") ? 1 : 0);
      assert.equal(calls.clipboard.length, role === "panel" ? 0 : 1);
      assert.equal(calls.tools.length, role.startsWith("primary") ? 1 : 0);
      if (fixture.legacy) {
        const { oldPath, copyPath, id, sha256 } = fixture.legacy;
        for (const filename of [oldPath, copyPath]) assert.equal(createHash("sha256").update(await readFile(filename)).digest("hex"), sha256);
        const marker = JSON.parse(await readFile(path.join(directory, "pluginData/.pasteboard-pro-plugin-data-migration-v1.json"), "utf8"));
        assert.equal(marker.legacyRetained, true); assert.equal(marker.hostEnumerationCompleteness, "unverified"); assert.equal("completedAt" in marker, false);
        assert.equal(docs.get(id).record.origin.imagePath, role === "primary-masked-migration" ? oldPath : copyPath);
      }
      await bridge.listPinboards();
      assert.ok(calls.allDocs.includes("pasteboard-pro:pinboard:"));
      if (role === "primary") {
        assert.equal(docs.has("pasteboard-pro:cursor:ztools-history"), false, "failed initial record write must not advance cursor");
        await calls.clipboard[0]();
        assert.equal(docs.has("pasteboard-pro:cursor:ztools-history"), true);
      }
      fixture.failWrites(true);
      await assert.rejects(() => bridge.createTextItem("public fixture created text"), /Storage operation failed/);
      await assert.rejects(() => bridge.createPinboard("public fixture group", "#112233"), /Storage operation failed/);
      fixture.failWrites(false);
      const created = await bridge.createTextItem("public fixture created text");
      assert.ok(created);
      assert.ok(calls.put.some(id => id.startsWith("pasteboard-pro:record:")));
      assert.ok(calls.allDocs.every(key => typeof key === "string" || Array.isArray(key)));
      assert.ok(errors.every(value => !value.includes("synthetic-sensitive-host-message")));
    }
    assert.deepEqual(denied, [], "SDK fixture attempted external effects");
    cases.push({ role, status: "PASS", bridgeMethods: Object.keys(bridge).length,
      ipcChannels: calls.ipc.map(([channel]) => channel).sort(), sdkReads: calls.get.length, sdkWrites: calls.put.length, nativePrefixQueries: calls.allDocs.length,
      forbiddenExternalEffectAttempts: denied.length, readOnlyAncestorMetadataProbes: fixture.ancestorMetadataProbes.length, loadedModuleHashes: fixture.loadedModuleHashes });
  } finally {
    await fixture?.close();
    await rm(directory, { recursive: true, force: false });
  }
}
const hashes = {};
for (const filename of ["preload.js", "history-worker.cjs", "content-scan-worker.cjs"]) hashes[filename] = createHash("sha256").update(await readFile(path.join(packageRoot, filename))).digest("hex");
const result = { testScriptSha256: createHash("sha256").update(await readFile(fileURLToPath(import.meta.url))).digest("hex"),
  fixtureSha256: createHash("sha256").update(await readFile(new URL("./lib/preload-database-fixture.mjs", import.meta.url))).digest("hex"),
  execution: "PASS", runtime: { node: process.versions.node, electron: process.versions.electron ?? null },
  scope: "shipped preload evaluated in Node VM with synthetic SDK/clipboard and guarded owned filesystem plus read-only lstat of its path ancestors; simulated linux disables native hooks, not installed host or OS validation",
  cases, packageHashes: hashes, generalClipboardAccess: false, installedHostExecution: "NOT-RUN", hostFilesWritten: false, gateComplete: false };
const output = process.argv[2] ?? path.join(artifactRoot, process.versions.electron ? "electron.json" : "node.json");
await writeFile(output, JSON.stringify(result, null, 2) + "\n");
