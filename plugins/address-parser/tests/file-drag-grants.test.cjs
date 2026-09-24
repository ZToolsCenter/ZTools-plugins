"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createFileDragGrantStore } = require("../core/file-drag-grants.cjs");

test("only a freshly exported CSV can be dragged and the grant is single-use", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "address-parser-drag-"));
  const output = path.join(root, "result.csv");
  const arbitrary = path.join(root, "arbitrary.csv");
  fs.writeFileSync(arbitrary, "untrusted");
  const dragged = [];
  const previousWindow = global.window;
  global.window = {
    ztools: {
      getPath: () => root,
      showSaveDialog: () => output,
      startDrag: value => dragged.push(value)
    }
  };
  delete require.cache[require.resolve("../preload.js")];

  try {
    require("../preload.js");
    await assert.rejects(global.window.addressParserBridge.startDrag(arbitrary), /刚刚由插件导出/);

    const result = await global.window.addressParserBridge.saveCsv("name,address\nA,B", "result.csv");
    assert.equal(result.canceled, false);
    await global.window.addressParserBridge.startDrag(result.path);
    assert.deepEqual(dragged, [fs.realpathSync(output)]);

    await assert.rejects(global.window.addressParserBridge.startDrag(result.path), /刚刚由插件导出/);
  } finally {
    delete require.cache[require.resolve("../preload.js")];
    global.window = previousWindow;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("CSV drag grants expire", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "address-parser-drag-expiry-"));
  const output = path.join(root, "result.csv");
  fs.writeFileSync(output, "ok");
  let currentTime = 100;
  const grants = createFileDragGrantStore({
    fs,
    path,
    now: () => currentTime,
    ttlMs: 50,
    requiredExtension: ".csv"
  });

  try {
    grants.grant(output);
    currentTime = 151;
    assert.throws(() => grants.consume(output), /刚刚由插件导出/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
