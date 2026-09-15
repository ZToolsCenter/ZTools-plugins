"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const zlib = require("node:zlib");
const { createRuntimeInstaller, extractNpmTarball, supportsCurrentPlatform, verifyIntegrity } = require("../../preload/runtime-installer.cjs");
const { runtimeRequire } = require("../../preload/runtime-loader.cjs");

const root = path.join(__dirname, "..", ".tmp-runtime-installer");

function tarHeader(name, size, type = "0") {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, "utf8");
  header.write("0000700\0", 100, 8, "ascii");
  header.write("0000000\0", 108, 8, "ascii");
  header.write("0000000\0", 116, 8, "ascii");
  header.write(`${size.toString(8).padStart(11, "0")}\0`, 124, 12, "ascii");
  header.write("00000000000\0", 136, 12, "ascii");
  header.fill(0x20, 148, 156);
  header.write(type, 156, 1, "ascii");
  header.write("ustar\0", 257, 6, "ascii");
  header.write("00", 263, 2, "ascii");
  const checksum = [...header].reduce((sum, byte) => sum + byte, 0);
  header.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148, 8, "ascii");
  return header;
}

function tarball(files) {
  const chunks = [];
  for (const [name, value] of Object.entries(files)) {
    const body = Buffer.from(value);
    chunks.push(tarHeader(`package/${name}`, body.length), body, Buffer.alloc((512 - body.length % 512) % 512));
  }
  chunks.push(Buffer.alloc(1024));
  return zlib.gzipSync(Buffer.concat(chunks));
}

test.beforeEach(async () => { await fs.rm(root, { recursive: true, force: true }); await fs.mkdir(root, { recursive: true }); });
test.after(async () => { await fs.rm(root, { recursive: true, force: true }); });

test("downloads, verifies and atomically installs a locked runtime package", async () => {
  const body = tarball({
    "package.json": JSON.stringify({ name: "format-converter-fixture-runtime", version: "1.0.0", main: "index.js" }),
    "index.js": "module.exports = { ready: true }\n"
  });
  const integrity = `sha512-${crypto.createHash("sha512").update(body).digest("base64")}`;
  const manifest = {
    schemaVersion: 1, runtimeVersion: "test-1",
    groups: { fixture: { label: "Fixture", estimateMb: 1, roots: ["format-converter-fixture-runtime"], packages: ["node_modules/format-converter-fixture-runtime"] } },
    packages: { "node_modules/format-converter-fixture-runtime": { version: "1.0.0", integrity, urls: ["https://registry.npmmirror.com/fixture.tgz"] } }
  };
  const installer = createRuntimeInstaller({ runtimeRoot: root, manifest, requestBuffer: async () => ({ body }) });
  assert.equal(installer.status("fixture").available, false);
  const installed = await installer.install("fixture");
  assert.equal(installed.available, true);
  assert.equal((await installer.install("fixture")).available, true);
  assert.equal(runtimeRequire("format-converter-fixture-runtime").ready, true);
});

test("rejects tampered archives and traversal entries", async () => {
  assert.equal(verifyIntegrity(Buffer.from("a"), `sha512-${crypto.createHash("sha512").update("b").digest("base64")}`), false);
  const unsafe = tarball({ "../escape.txt": "bad" });
  await assert.rejects(extractNpmTarball(unsafe, root), error => error.code === "RUNTIME_ARCHIVE_UNSAFE");
});

test("filters native packages by operating system, architecture and libc", () => {
  assert.equal(supportsCurrentPlatform({ os: ["darwin"], cpu: ["arm64"] }, "darwin", "arm64"), true);
  assert.equal(supportsCurrentPlatform({ os: ["linux"], cpu: ["x64"], libc: ["musl"] }, "linux", "x64", "glibc"), false);
  assert.equal(supportsCurrentPlatform({ os: ["!win32"] }, "win32", "x64"), false);
});

test("generated runtime manifest is immutable, mirror-first and excludes build-only packages", () => {
  const manifest = require("../../preload/runtime-manifest.json");
  assert.deepEqual(Object.keys(manifest.groups).sort(), ["excel", "ocr", "pdf", "sharp"]);
  assert.deepEqual(manifest.groups.ocr.roots, ["tesseract.js", "@tesseract.js-data/eng", "@tesseract.js-data/chi_sim"]);
  assert.equal(manifest.groups.pdf.packages.some(key => key.endsWith("/canvas")), false);
  assert.equal(Object.keys(manifest.packages).some(key => key.includes("node_modules/@types/")), false);
  for (const entry of Object.values(manifest.packages)) {
    assert.match(entry.integrity, /^sha512-/);
    assert.match(entry.urls[0], /^https:\/\/registry\.npmmirror\.com\//);
    entry.urls.forEach(url => assert.ok(["registry.npmmirror.com", "registry.npmjs.org"].includes(new URL(url).hostname)));
  }
});
