"use strict";

// 回归：不同工作区的同名文件共用一个 WebDAV 远端目录时，同步不得静默覆盖任何一侧。

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const webdavApi = require("../../preload/webdav-sync.cjs");
const {
  LEDGER_STORAGE_KEY,
  createWebdavSyncLedger,
  createMemoryStorage,
  decidePullWrite,
  decidePushWrite,
  hashContent
} = require("../../preload/webdav-sync-ledger.cjs");
const { createE2EMockWebdavServer } = require("../e2e/mock-webdav.cjs");

const REMOTE_NOTE = "/dav/TyporaNotes/notes.md";

async function withServer(run) {
  const { server, files } = createE2EMockWebdavServer();
  files.clear();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const config = {
    enabled: true,
    serverUrl: `http://127.0.0.1:${server.address().port}/dav/`,
    username: "typora_e2e",
    password: "pass_123",
    remotePath: "/TyporaNotes/",
    autoSyncOnSave: true,
    syncDirection: "bidirectional"
  };
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lm-webdav-conflict-"));
  const wsA = path.join(root, "workspace-a");
  const wsB = path.join(root, "workspace-b");
  fs.mkdirSync(wsA);
  fs.mkdirSync(wsB);
  const ledger = createWebdavSyncLedger(createMemoryStorage());
  try {
    await run({ config, files, wsA, wsB, ledger });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function setRemote(files, content) {
  files.set(REMOTE_NOTE, { content, mtimeMs: Date.now() + 60_000, etag: `etag-${Date.now()}` });
}

test("pulling into another workspace never overwrites its same-named file", async () => {
  await withServer(async ({ config, files, wsA, wsB, ledger }) => {
    fs.writeFileSync(path.join(wsA, "notes.md"), "# A\n", "utf8");
    fs.writeFileSync(path.join(wsB, "notes.md"), "# B\n", "utf8");

    const syncA = await webdavApi.syncWorkspaceWithWebdav(config, { localDir: wsA, direction: "push", ledger });
    assert.deepEqual(syncA.uploaded, ["notes.md"]);
    assert.equal(files.get(REMOTE_NOTE).content, "# A\n");

    const syncB = await webdavApi.syncWorkspaceWithWebdav(config, { localDir: wsB, direction: "pull", ledger });
    assert.equal(syncB.ok, true);
    assert.deepEqual(syncB.downloaded, []);
    assert.equal(syncB.conflicts.length, 1);
    assert.equal(syncB.conflicts[0].reason, "bound-elsewhere");
    assert.equal(fs.readFileSync(path.join(wsB, "notes.md"), "utf8"), "# B\n");

    const pulled = await webdavApi.pullWebdavDocument(config, "notes.md", wsB, { ledger });
    assert.equal(pulled.ok, false);
    assert.equal(pulled.conflict, true);
    assert.equal(pulled.path, null);
    assert.equal(fs.readFileSync(path.join(wsB, "notes.md"), "utf8"), "# B\n");
  });
});

test("pushing from another workspace never overwrites the remote copy", async () => {
  await withServer(async ({ config, files, wsA, wsB, ledger }) => {
    fs.writeFileSync(path.join(wsA, "notes.md"), "# A\n", "utf8");
    fs.writeFileSync(path.join(wsB, "notes.md"), "# B\n", "utf8");
    await webdavApi.syncWorkspaceWithWebdav(config, { localDir: wsA, direction: "push", ledger });

    const syncB = await webdavApi.syncWorkspaceWithWebdav(config, { localDir: wsB, direction: "push", ledger });
    assert.deepEqual(syncB.uploaded, []);
    assert.equal(syncB.conflicts[0].reason, "bound-elsewhere");
    assert.equal(files.get(REMOTE_NOTE).content, "# A\n");

    // 未保存的同名新文档（没有本地路径）同样不能覆盖已绑定的云端文件。
    const unsaved = await webdavApi.pushWebdavDocument(config, "notes.md", "# draft\n", { ledger });
    assert.equal(unsaved.ok, false);
    assert.equal(unsaved.reason, "bound-elsewhere");
    assert.equal(files.get(REMOTE_NOTE).content, "# A\n");
  });
});

test("the bound workspace still syncs normally in both directions", async () => {
  await withServer(async ({ config, files, wsA, ledger }) => {
    const noteA = path.join(wsA, "notes.md");
    fs.writeFileSync(noteA, "# A\n", "utf8");
    await webdavApi.syncWorkspaceWithWebdav(config, { localDir: wsA, direction: "push", ledger });

    // 其他设备修改了云端，本地未改：允许拉取覆盖。
    setRemote(files, "# A from phone\n");
    const pulled = await webdavApi.syncWorkspaceWithWebdav(config, { localDir: wsA, direction: "pull", ledger });
    assert.deepEqual(pulled.downloaded, ["notes.md"]);
    assert.equal(fs.readFileSync(noteA, "utf8"), "# A from phone\n");

    // 本地修改、云端未改：允许上传覆盖。
    fs.writeFileSync(noteA, "# A edited\n", "utf8");
    const pushed = await webdavApi.pushWebdavDocument(config, "notes.md", "# A edited\n", { ledger, localPath: noteA });
    assert.equal(pushed.ok, true);
    assert.equal(files.get(REMOTE_NOTE).content, "# A edited\n");
  });
});

test("both sides changed since the last sync is a conflict in either direction", async () => {
  await withServer(async ({ config, files, wsA, ledger }) => {
    const noteA = path.join(wsA, "notes.md");
    fs.writeFileSync(noteA, "# base\n", "utf8");
    await webdavApi.syncWorkspaceWithWebdav(config, { localDir: wsA, direction: "push", ledger });

    fs.writeFileSync(noteA, "# local edit\n", "utf8");
    setRemote(files, "# remote edit\n");

    const pulled = await webdavApi.pullWebdavDocument(config, "notes.md", wsA, { ledger });
    assert.equal(pulled.reason, "local-modified");
    assert.equal(fs.readFileSync(noteA, "utf8"), "# local edit\n");

    const pushed = await webdavApi.pushWebdavDocument(config, "notes.md", "# local edit\n", { ledger, localPath: noteA });
    assert.equal(pushed.reason, "remote-changed");
    assert.equal(files.get(REMOTE_NOTE).content, "# remote edit\n");
  });
});

test("without a ledger entry, differing content on either side is never overwritten", async () => {
  await withServer(async ({ config, files, wsB, ledger }) => {
    const noteB = path.join(wsB, "notes.md");
    fs.writeFileSync(noteB, "# legacy local\n", "utf8");
    setRemote(files, "# legacy remote\n");

    const pulled = await webdavApi.pullWebdavDocument(config, "notes.md", wsB, { ledger });
    assert.equal(pulled.reason, "local-unknown");
    assert.equal(fs.readFileSync(noteB, "utf8"), "# legacy local\n");

    const pushed = await webdavApi.pushWebdavDocument(config, "notes.md", "# legacy local\n", { ledger, localPath: noteB });
    assert.equal(pushed.reason, "unknown-remote");
    assert.equal(files.get(REMOTE_NOTE).content, "# legacy remote\n");

    // 内容一致时直接建立绑定，不视为冲突。
    fs.writeFileSync(noteB, "# legacy remote\n", "utf8");
    const adopted = await webdavApi.pullWebdavDocument(config, "notes.md", wsB, { ledger });
    assert.equal(adopted.ok, true);
    assert.equal(adopted.path, noteB);
  });
});

test("a corrupt ledger fails closed", () => {
  const storage = createMemoryStorage();
  storage.setItem(LEDGER_STORAGE_KEY, "{not json");
  const ledger = createWebdavSyncLedger(storage);
  const config = { serverUrl: "https://dav.example", remotePath: "/TyporaNotes/" };
  assert.equal(ledger.get(config, "notes.md"), null);
  const decision = decidePullWrite({
    binding: null,
    localPath: "/tmp/notes.md",
    localHash: hashContent("local"),
    remoteHash: hashContent("remote")
  });
  assert.equal(decision.allowed, false);
  assert.equal(
    decidePushWrite({ binding: null, localPath: "/tmp/notes.md", localHash: hashContent("a"), remoteHash: hashContent("b") }).allowed,
    false
  );
});
