"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { checkRuntimeCompatibility: check } = require("../../preload/local-ai/compatibility.cjs");

test("pinned Mac binaries refuse older OS before downloading", () => {
  assert.equal(check({ platform: "darwin", arch: "arm64", osVersion: "13.2.1" }).compatible, false);
  assert.equal(check({ platform: "darwin", arch: "arm64", osVersion: "13.3" }).compatible, true);
  assert.equal(check({ platform: "darwin", arch: "x64", osVersion: "15.0.1" }).compatible, true);
});
test("Linux checks both glibc and libstdc++ and fails closed on musl", () => {
  const x64 = { platform: "linux", arch: "x64", report: { header: { glibcVersionRuntime: "2.35" } }, glibcxxVersion: "3.4.30" };
  assert.equal(check(x64).compatible, true);
  assert.equal(check({ ...x64, report: { header: {} } }).compatible, false);
  assert.equal(check({ ...x64, glibcxxVersion: "3.4.29" }).compatible, false);
  assert.equal(check({ ...x64, arch: "arm64" }).compatible, false);
  assert.equal(check({ ...x64, arch: "arm64", report: { header: { glibcVersionRuntime: "2.39" } }, glibcxxVersion: "3.4.33" }).compatible, true);
});
test("Windows and unsupported architectures have explicit floors", () => {
  assert.equal(check({ platform: "win32", arch: "x64", osVersion: "6.3" }).compatible, false);
  assert.equal(check({ platform: "win32", arch: "arm64", osVersion: "10.0.22631" }).compatible, true);
  assert.equal(check({ platform: "linux", arch: "ia32" }).compatible, false);
});
