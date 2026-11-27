"use strict";

// 作者：木子
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { Store } = require("../lib/store");

test("Store supports CRUD and settings", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbx-store-test-"));
  const store = new Store(dir);

  const doc = { _id: "server:1", createdAt: 1, name: "alpha" };
  store.add(doc);
  assert.deepEqual(store.detail("server:1"), doc);
  assert.deepEqual(store.list("server:"), [doc]);

  const edited = { ...doc, name: "beta" };
  store.edit(edited);
  assert.equal(store.detail("server:1").name, "beta");

  store.add({ _id: "cmd:1", createdAt: 2, name: "git pull" });
  assert.deepEqual(
    store.list("cmd:").map((item) => item._id),
    ["cmd:1"],
  );

  assert.equal(store.del("server:1"), true);
  assert.equal(store.del("server:1"), false);
  assert.equal(store.detail("server:1"), null);

  assert.equal(store.getSetting("logRetention", 10), 10);
  store.setSetting("logRetention", 20);
  assert.equal(store.getSetting("logRetention", 10), 20);
  assert.ok(fs.existsSync(path.join(dir, "store.json")));
});

test("Store persists data across instances", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbx-store-persist-"));
  const first = new Store(dir);
  first.add({ _id: "task:1", createdAt: 1, name: "deploy" });
  const second = new Store(dir);
  assert.equal(second.detail("task:1").name, "deploy");
});
