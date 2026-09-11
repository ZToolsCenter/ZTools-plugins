"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { releaseAsset, latestVersionFromUrl, checksumForAsset } = require("../../preload/officecli-installer.cjs");

test("selects immutable OfficeCLI assets for all supported platform families", () => {
  assert.equal(releaseAsset("darwin", "arm64"), "officecli-mac-arm64");
  assert.equal(releaseAsset("darwin", "x64"), "officecli-mac-x64");
  assert.equal(releaseAsset("win32", "arm64"), "officecli-win-arm64.exe");
  assert.equal(releaseAsset("linux", "x64", false), "officecli-linux-x64");
  assert.equal(releaseAsset("linux", "arm64", true), "officecli-linux-alpine-arm64");
  assert.throws(() => releaseAsset("freebsd", "x64"), error => error.code === "UNSUPPORTED_PLATFORM");
});

test("parses release redirect and exact checksum entry", () => {
  assert.equal(latestVersionFromUrl("https://github.com/iOfficeAI/OfficeCLI/releases/tag/v1.2.3"), "v1.2.3");
  assert.equal(checksumForAsset(`${"a".repeat(64)}  officecli-mac-arm64\n${"b".repeat(64)} *other`, "officecli-mac-arm64"), "a".repeat(64));
  assert.equal(checksumForAsset(`${"a".repeat(64)}  officecli-mac-arm64-extra`, "officecli-mac-arm64"), null);
});
