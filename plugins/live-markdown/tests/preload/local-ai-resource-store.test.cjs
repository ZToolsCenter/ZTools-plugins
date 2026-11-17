"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { ensurePrivateDirectory, isSafeDirectory } = require("../../preload/local-ai/resource-store.cjs");

const root = path.join(__dirname, ".tmp", `local-ai-store-${process.pid}`);

test("managed data directory creation refuses symlink ancestors before creating children", (t) => {
  fs.rmSync(root, { recursive: true, force: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const target = path.join(root, "target");
  const link = path.join(root, "link");
  fs.mkdirSync(target, { recursive: true });
  fs.symlinkSync(target, link, "dir");
  assert.equal(isSafeDirectory(link), false);
  assert.throws(() => ensurePrivateDirectory(path.join(link, "would-be-child")), /symbolic links/);
  assert.equal(fs.existsSync(path.join(target, "would-be-child")), false);
});
