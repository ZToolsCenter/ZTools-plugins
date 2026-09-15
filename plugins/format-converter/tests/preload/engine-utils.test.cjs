"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { publishStaged } = require("../../preload/engine-utils.cjs");

const root = path.join(__dirname, "..", ".tmp-engine-utils");
test.beforeEach(async () => { await fs.rm(root, { recursive: true, force: true }); await fs.mkdir(root, { recursive: true }); });
test.after(async () => { await fs.rm(root, { recursive: true, force: true }); });

test("serializes concurrent same-name publication without overwriting", async () => {
  const first = path.join(root, ".first.partial");
  const second = path.join(root, ".second.partial");
  const desired = path.join(root, "report.txt");
  await Promise.all([fs.writeFile(first, "first"), fs.writeFile(second, "second")]);
  const outputs = await Promise.all([
    publishStaged(first, desired, "txt", "rename"),
    publishStaged(second, desired, "txt", "rename")
  ]);
  assert.deepEqual(outputs.map(value => path.basename(value)).sort(), ["report-2.txt", "report.txt"]);
  assert.deepEqual((await Promise.all(outputs.map(value => fs.readFile(value, "utf8")))).sort(), ["first", "second"]);
});
