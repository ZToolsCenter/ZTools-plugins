"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { compareVersions, copyDirectory, directoriesMatch, getHostCompatibility, runtimeRoot } = require("../../preload/host-compatibility.cjs");

test("host compatibility only bypasses an explicit browser preview", () => {
  assert.equal(compareVersions("3.2.0", "3.1.9"), 1);
  assert.equal(compareVersions("2.4", "2.4.0"), 0);
  assert.equal(compareVersions("2.4.0-beta.1", "2.4.0"), -1);
  assert.equal(compareVersions("unknown", "2.4.0"), null);
  assert.equal(getHostCompatibility(undefined).supported, true);
  assert.equal(getHostCompatibility({}).supported, false);
  const throwingGetter = {};
  Object.defineProperty(throwingGetter, "getAppVersion", { get() { throw new Error("unavailable"); } });
  assert.equal(getHostCompatibility(throwingGetter).supported, false);
  assert.equal(getHostCompatibility({ getAppVersion: () => { throw new Error("unavailable"); } }).supported, false);
  for (const version of ["", "unknown", 320]) {
    assert.equal(getHostCompatibility({ getAppVersion: () => version }).supported, false);
  }
  assert.equal(getHostCompatibility({ getAppVersion: () => "2.3.9" }).supported, false);
  assert.equal(getHostCompatibility({ getAppVersion: () => "2.4.0-beta.1" }).supported, false);
  assert.equal(getHostCompatibility({ getAppVersion: () => "2.4.0" }).supported, true);
  assert.equal(getHostCompatibility({ getAppVersion: () => "3.1.9" }).supported, true);
});

test("runtime migration copy verifies its complete directory before writing a marker", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "format-host-compat-"));
  try {
    const source = path.join(root, "old");
    const destination = path.join(root, "new");
    fs.mkdirSync(path.join(source, "nested"), { recursive: true });
    fs.writeFileSync(path.join(source, "nested", "runtime.bin"), "runtime");
    assert.equal(copyDirectory(source, destination), true);
    assert.equal(directoriesMatch(source, destination), true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("runtime migration removes the verified userData copy", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "format-host-compat-move-"));
  try {
    const pluginData = path.join(base, "plugin-data");
    const legacy = path.join(base, "legacy");
    fs.mkdirSync(legacy, { recursive: true });
    fs.writeFileSync(path.join(legacy, "runtime.bin"), "runtime");
    const resolved = runtimeRoot({ getPath: () => pluginData }, legacy);
    assert.equal(resolved.root, path.join(pluginData, "runtime", "v1"));
    assert.equal(resolved.migrated, true);
    assert.equal(fs.existsSync(legacy), false);
    assert.equal(fs.existsSync(path.join(pluginData, ".format-converter-runtime-migration-v2.json")), true);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test("runtime migration keeps using legacy data when an unverified destination already exists", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "format-host-compat-partial-"));
  try {
    const pluginData = path.join(base, "plugin-data");
    const legacy = path.join(base, "legacy");
    const destination = path.join(pluginData, "runtime", "v1");
    fs.mkdirSync(legacy, { recursive: true });
    fs.mkdirSync(destination, { recursive: true });
    fs.writeFileSync(path.join(legacy, "runtime.bin"), "complete");
    fs.writeFileSync(path.join(destination, "runtime.bin"), "partial");

    const resolved = runtimeRoot({ getPath: () => pluginData }, legacy);
    assert.equal(resolved.root, legacy);
    assert.equal(resolved.modern, false);
    assert.equal(fs.existsSync(path.join(pluginData, ".format-converter-runtime-migration-v2.json")), false);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});
