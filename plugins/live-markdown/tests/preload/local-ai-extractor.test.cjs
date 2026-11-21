"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Writable } = require("node:stream");
const { gzipSync } = require("node:zlib");
const test = require("node:test");
const { extractTarGz } = require("../../preload/local-ai/extractor.cjs");

const root = path.join(__dirname, ".tmp", `local-ai-extractor-${process.pid}`);

function tarHeader(name, { type = "0", size = 0, linkName = "" } = {}) {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, "utf8");
  header.write("0000777\0", 100, 8, "ascii");
  header.write("0000000\0", 108, 8, "ascii");
  header.write("0000000\0", 116, 8, "ascii");
  header.write(`${size.toString(8).padStart(11, "0")}\0`, 124, 12, "ascii");
  header.write("00000000000\0", 136, 12, "ascii");
  header.fill(0x20, 148, 156);
  header.write(type, 156, 1, "ascii");
  header.write(linkName, 157, 100, "utf8");
  header.write("ustar\0", 257, 6, "ascii");
  header.write("00", 263, 2, "ascii");
  let checksum = 0;
  for (const byte of header) checksum += byte;
  header.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148, 8, "ascii");
  return header;
}

function tarFile(name, data) {
  const content = Buffer.from(data);
  const padding = Buffer.alloc((512 - (content.length % 512)) % 512);
  return Buffer.concat([tarHeader(name, { size: content.length }), content, padding]);
}

function tarLink(name, linkName) { return tarHeader(name, { type: "2", linkName }); }

function digest(data) { return crypto.createHash("sha256").update(data).digest("hex"); }

test("manifest-approved tar symlink chains are copied to regular files and checked", async (t) => {
  fs.rmSync(root, { recursive: true, force: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const content = Buffer.from("verified dynamic library");
  const archive = gzipSync(Buffer.concat([
    tarLink("libllama.dylib", "libllama.0.dylib"),
    tarLink("libllama.0.dylib", "libllama.0.7.0.dylib"),
    tarFile("libllama.0.7.0.dylib", content),
    Buffer.alloc(1024)
  ]));
  const archivePath = path.join(root, "runtime.tar.gz");
  const destination = path.join(root, "staged");
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(archivePath, archive);
  const file = (name, linkTarget) => ({ path: name, ...(linkTarget ? { linkTarget } : {}), size: content.length, sha256: digest(content) });
  await extractTarGz(archivePath, destination, { files: [
    file("libllama.dylib", "libllama.0.dylib"),
    file("libllama.0.dylib", "libllama.0.7.0.dylib"),
    file("libllama.0.7.0.dylib")
  ] });
  for (const name of ["libllama.dylib", "libllama.0.dylib", "libllama.0.7.0.dylib"]) {
    const target = path.join(destination, name);
    assert.equal(fs.lstatSync(target).isFile(), true);
    assert.equal(fs.lstatSync(target).isSymbolicLink(), false);
    assert.deepEqual(fs.readFileSync(target), content);
  }
});

test("tar symbolic links outside the manifest destination are rejected", async (t) => {
  fs.rmSync(root, { recursive: true, force: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const archivePath = path.join(root, "unsafe.tar.gz");
  const destination = path.join(root, "staged");
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(archivePath, gzipSync(Buffer.concat([tarLink("alias", "../../outside"), Buffer.alloc(1024)])));
  await assert.rejects(extractTarGz(archivePath, destination, {
    files: [{ path: "alias", linkTarget: "outside", size: 1, sha256: digest("x") }]
  }), /target|unsafe|path|link/i);
});

test("tar member write errors such as ENOSPC reject safely without an unhandled stream error", async (t) => {
  fs.rmSync(root, { recursive: true, force: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const data = Buffer.alloc(128 * 1024, 0x31);
  const archivePath = path.join(root, "write-error.tar.gz");
  const destination = path.join(root, "staged");
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(archivePath, gzipSync(Buffer.concat([tarFile("model.bin", data), Buffer.alloc(1024)])));
  let writes = 0;
  let extractionError;
  try {
    await extractTarGz(archivePath, destination,
      { files: [{ path: "model.bin", size: data.length, sha256: digest(data) }] },
      { createWriteStream: () => new Writable({ write(_chunk, _encoding, callback) {
        writes++;
        const error = new Error("disk full");
        error.code = "ENOSPC";
        callback(error);
      } }) }
    );
  } catch (error) { extractionError = error; }
  assert.ok(writes > 0, `expected a write attempt, saw ${writes}`);
  assert.match(extractionError?.message || "", /disk full|ENOSPC/i);
  assert.equal(fs.existsSync(path.join(destination, "model.bin")), false);
});
