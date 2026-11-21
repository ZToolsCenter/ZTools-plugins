"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { createStatusWriter } = require("../../preload/local-ai/status-store.cjs");

const root = path.join(__dirname, ".tmp", `local-ai-status-${process.pid}`);

test("status writes are asynchronous, throttled, and flush the final progress state", async (t) => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let writes = 0;
  const promises = {
    writeFile: async (...args) => { writes++; return fs.promises.writeFile(...args); },
    rename: (...args) => fs.promises.rename(...args),
    rm: (...args) => fs.promises.rm(...args)
  };
  const writer = createStatusWriter({ root, ownerId: "d".repeat(32), fsApi: { promises }, intervalMs: 200 });
  for (let index = 0; index < 500; index++) {
    writer.set({ phase: "downloading", completedBytes: index, totalBytes: 500, message: "progress" });
  }
  await writer.flush();
  const persisted = JSON.parse(fs.readFileSync(path.join(root, "deployment-status.json"), "utf8"));
  assert.equal(persisted.completedBytes, 499);
  assert.ok(writes <= 2, `expected throttled writes, received ${writes}`);
});
