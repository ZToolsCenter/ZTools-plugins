"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { getDiskFreeBytes, parseDfAvailable, parseWindowsFreeBytes } = require("../../preload/local-ai/disk-info.cjs");

test("df and Windows volume output parsers return byte counts", () => {
  assert.equal(parseDfAvailable("Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/disk1 1000 200 800 20% /System/Volumes/Data\n"), 819_200);
  assert.equal(parseDfAvailable("bad output"), null);
  assert.equal(parseWindowsFreeBytes("123456789\r\n"), 123_456_789);
  assert.equal(parseWindowsFreeBytes("not a number"), null);
});

test("Node 16 fallback checks an existing parent without creating the model directory", (t) => {
  const parent = path.join(__dirname, ".tmp", `disk-info-${process.pid}`);
  fs.mkdirSync(parent, { recursive: true });
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const target = path.join(parent, "not-created", "local-ai");
  let requestedPath;
  const available = getDiskFreeBytes(target, {
    platform: "linux",
    fs: { statfsSync: undefined, statSync: fs.statSync.bind(fs) },
    execFileSync: (_binary, args) => {
      requestedPath = args[1];
      return "Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/disk1 1000 200 800 20% /\n";
    }
  });
  assert.equal(available, 819_200);
  assert.equal(requestedPath, parent);
  assert.equal(fs.existsSync(target), false);
});
