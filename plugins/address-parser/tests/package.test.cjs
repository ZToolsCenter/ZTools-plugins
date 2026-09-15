"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "plugin.json"), "utf8"));

test("plugin.json 的入口、preload 和图标都存在", function () {
  assert.equal(manifest.name, "address-parser");
  [manifest.main, manifest.preload, manifest.logo].forEach(function (relativePath) {
    assert.ok(relativePath && !path.isAbsolute(relativePath));
    assert.ok(fs.existsSync(path.join(root, relativePath)), relativePath + " 应存在");
  });
});

test("插件不限制平台且触发器保持窄匹配", function () {
  const feature = manifest.features[0];
  assert.equal(feature.platform, undefined);
  const regexCommand = feature.cmds.find(function (command) { return command && command.type === "regex"; });
  assert.ok(regexCommand);
  assert.doesNotThrow(function () {
    const parts = regexCommand.match.match(/^\/(.*)\/([a-z]*)$/i);
    new RegExp(parts[1], parts[2]);
  });
  const parts = regexCommand.match.match(/^\/(.*)\/([a-z]*)$/i);
  const trigger = new RegExp(parts[1], parts[2]);
  assert.equal(trigger.test("张三 13800138000 广东省深圳市"), true);
  assert.equal(trigger.test("订单号 913800138000012345"), false);
  assert.equal(feature.cmds.some(function (command) { return command && command.type === "over"; }), false);
});

test("发布文件没有硬编码用户绝对路径或平台专属依赖", function () {
  const files = ["index.html", "styles.css", "app.js", "preload.js", "core/address-parser.js", "core/csv.js", "core/exporter.cjs"];
  files.forEach(function (file) {
    const content = fs.readFileSync(path.join(root, file), "utf8");
    assert.doesNotMatch(content, /\/Users\/[^/]+|[A-Z]:\\\\Users\\\\/);
    assert.doesNotMatch(content, /require\(["'](?:fsevents|win32-api|node-mac-permissions)["']\)/);
  });
});
