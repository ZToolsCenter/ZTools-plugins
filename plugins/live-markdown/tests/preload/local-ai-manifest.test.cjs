"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { DEFAULT_MANIFEST, SUPPORTED_PLATFORMS, createManifestCatalog, isValidResource } = require("../../preload/local-ai/manifest.cjs");

test("checked-in manifest maps all declared profiles to verified resources on each package target", () => {
  for (const [platform, arch] of SUPPORTED_PLATFORMS) {
    const catalog = createManifestCatalog(DEFAULT_MANIFEST, platform, arch);
    assert.equal(catalog.profiles.light.available, true, `${platform}-${arch} light`);
    assert.equal(catalog.profiles.balanced.available, true, `${platform}-${arch} balanced`);
    assert.equal(catalog.profiles.quality.available, true, `${platform}-${arch} quality`);
    assert.equal(catalog.profiles.light.runtime.entryPoint.endsWith(platform === "win32" ? ".exe" : "llama-server"), true);
  }
});

test("resource catalog rejects missing digests, unsafe paths, and unlisted entrypoints", () => {
  const valid = {
    id: "runtime-test", version: "1", url: "https://example.com/runtime.tar.gz",
    sha256: "a".repeat(64), size: 10, archive: "tar.gz", backend: "cpu", entryPoint: "bin/server",
    files: [{ path: "bin/server", size: 5, sha256: "b".repeat(64), executable: true }]
  };
  assert.equal(isValidResource(valid), true);
  assert.equal(isValidResource({ ...valid, sha256: "" }), false);
  assert.equal(isValidResource({ ...valid, files: [{ ...valid.files[0], path: "../server" }] }), false);
  assert.equal(isValidResource({ ...valid, entryPoint: "other" }), false);
});
