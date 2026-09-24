"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { createExportService, sanitizeFileName } = require("../core/exporter.cjs");

function createMocks(pathApi, downloads, selectedPath) {
  const calls = { dialogs: [], writes: [] };
  const save = createExportService({
    fs: { writeFileSync: function () { calls.writes.push(Array.from(arguments)); } },
    path: pathApi,
    showSaveDialog: function (options) { calls.dialogs.push(options); return selectedPath; },
    getDownloadsPath: function () { return downloads; }
  });
  return { save: save, calls: calls };
}

test("Windows 使用 win32 路径并自动补齐 csv 扩展名", async function () {
  const mocks = createMocks(path.win32, "C:\\Users\\Tester\\Downloads", "D:\\Exports\\地址结果");
  const result = await mocks.save("序号,姓名\r\n1,张三\r\n", "地址结果.csv");
  assert.equal(mocks.calls.dialogs[0].defaultPath, "C:\\Users\\Tester\\Downloads\\地址结果.csv");
  assert.equal(result.path, "D:\\Exports\\地址结果.csv");
  assert.equal(mocks.calls.writes[0][0], "D:\\Exports\\地址结果.csv");
  assert.equal(mocks.calls.writes[0][1].charCodeAt(0), 0xFEFF);
});

test("macOS 和 Linux 使用 POSIX 路径", async function () {
  const mocks = createMocks(path.posix, "/Users/test/Downloads", "/tmp/地址结果.csv");
  const result = await mocks.save("\uFEFF序号,姓名\r\n", "地址结果.csv");
  assert.equal(mocks.calls.dialogs[0].defaultPath, "/Users/test/Downloads/地址结果.csv");
  assert.equal(result.path, "/tmp/地址结果.csv");
  assert.equal(mocks.calls.writes[0][1].match(/\uFEFF/g).length, 1);
});

test("取消保存时不写文件", async function () {
  const mocks = createMocks(path.posix, "/tmp", undefined);
  assert.deepEqual(await mocks.save("x", "x.csv"), { canceled: true });
  assert.equal(mocks.calls.writes.length, 0);
});

test("拒绝空内容和超过 20 MB 的内容", async function () {
  const mocks = createMocks(path.posix, "/tmp", "/tmp/a.csv");
  await assert.rejects(mocks.save("", "a.csv"), /不能为空/);
  await assert.rejects(mocks.save("x".repeat(20 * 1024 * 1024 + 1), "a.csv"), /20 MB/);
});

test("文件名过滤跨平台非法字符", function () {
  assert.equal(sanitizeFileName('地址<结果>:"/\\|?*.csv'), "地址-结果--------.csv");
});
