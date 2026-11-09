import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { deflateRawSync } from "node:zlib";

import { verifyReleaseArchive } from "./verify-release-archive.mjs";

const root = await mkdtemp(path.join(os.tmpdir(), "pasteboardpro-archive-test-"));

function makeCrcTable() {
  const table = new Uint32Array(256);
  for (let value = 0; value < table.length; value += 1) {
    let crc = value;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
    table[value] = crc >>> 0;
  }
  return table;
}

const CRC_TABLE = makeCrcTable();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

async function collectFiles(directory, prefix = "") {
  const entries = await readdir(path.join(directory, prefix), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(directory, relative)));
    } else {
      const fullPath = path.join(directory, ...relative.split("/"));
      const fileStat = await stat(fullPath);
      const bytes = await readFile(fullPath);
      const executable = entry.name === "pasteboard-vision" || (fileStat.mode & 0o111) !== 0;
      files.push({
        path: relative,
        bytes,
        mode: executable ? 0o100755 : 0o100644,
      });
    }
  }
  return files;
}

async function zipPackage(directory, archive) {
  const entries = await collectFiles(directory);
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.path, "utf8");
    const compressed = deflateRawSync(entry.bytes, { level: 9 });
    const crc = crc32(entry.bytes);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(33, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.bytes.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    const localBlock = Buffer.concat([local, name, compressed]);
    localParts.push(localBlock);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(33, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(entry.bytes.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE((entry.mode * 0x10000) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(Buffer.concat([central, name]));
    offset += localBlock.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  await writeFile(archive, Buffer.concat([...localParts, centralDirectory, end]));
}

async function makePackage(directory, preload = "module.exports = {};\n") {
  await mkdir(path.join(directory, "assets"), { recursive: true });
  await writeFile(
    path.join(directory, "plugin.json"),
    JSON.stringify({
      name: "pasteboard-pro",
      version: "1.0.0",
      main: "index.html",
      preload: "preload.js",
      logo: "logo.svg",
    }),
  );
  await writeFile(path.join(directory, "package.json"), '{"type":"commonjs"}\n');
  await writeFile(path.join(directory, "index.html"), "<!doctype html><div id=app></div>\n");
  await writeFile(path.join(directory, "preload.js"), preload);
  await writeFile(path.join(directory, "history-worker.cjs"), "module.exports = {};\n");
  await writeFile(path.join(directory, "content-scan-worker.cjs"), "module.exports = {};\n");
  await writeFile(path.join(directory, "HTML_PARSER_NOTICES.txt"), "Synthetic parser notice fixture\n");
  await writeFile(path.join(directory, "logo.svg"), "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>\n");
  await writeFile(path.join(directory, "assets", "index.js"), "console.log('fixture');\n");
  await writeFile(path.join(directory, "pasteboard-vision"), "fixture helper\n");
  await chmod(path.join(directory, "pasteboard-vision"), 0o755);
}

try {
  const goodPackage = path.join(root, "good");
  const goodArchive = path.join(root, "good.zip");
  const reportPath = path.join(root, "report.json");
  const attestationPath = path.join(root, "helper-attestation.json");
  await makePackage(goodPackage);
  const helperBytes = await readFile(path.join(goodPackage, "pasteboard-vision"));
  const helperSha256 = createHash("sha256").update(helperBytes).digest("hex");
  await writeFile(
    attestationPath,
    JSON.stringify({
      schemaVersion: 1,
      artifact: "pasteboard-vision",
      executable: true,
      sha256: helperSha256,
      codesign: {
        checked: true,
        valid: true,
        expectedSignature: "developer-id",
        authorities: ["Developer ID Application: Example Corp (ABCDE12345)"],
        teamIdentifier: "ABCDE12345",
        hardenedRuntime: true,
      },
      gatekeeper: { checked: true, accepted: true },
    }),
  );
  await zipPackage(goodPackage, goodArchive);
  const report = await verifyReleaseArchive(goodArchive, {
    reportPath,
    helperAttestationPath: attestationPath,
    requireHelperSignature: "developer-id",
  });
  assert.equal(report.manifest.name, "pasteboard-pro");
  assert.equal(report.checks.rootLayout, true);
  assert.equal(report.checks.noDevelopmentPaths, true);
  assert.match(report.archiveSha256, /^[a-f0-9]{64}$/u);
  assert.equal(report.checks.helperAttestation.checked, true);

  const wrongAttestationPath = path.join(root, "wrong-helper-attestation.json");
  await writeFile(
    wrongAttestationPath,
    JSON.stringify({
      schemaVersion: 1,
      artifact: "pasteboard-vision",
      executable: true,
      sha256: "0".repeat(64),
      codesign: { checked: true, valid: true },
    }),
  );
  await assert.rejects(
    verifyReleaseArchive(goodArchive, { helperAttestationPath: wrongAttestationPath }),
    /does not match the signed helper attestation/u,
  );

  await assert.rejects(
    verifyReleaseArchive(goodArchive, {
      helperAttestationPath: attestationPath,
      requireHelperSignature: "adhoc",
    }),
    /Expected a adhoc helper attestation/u,
  );

  const badPackage = path.join(root, "bad");
  const badArchive = path.join(root, "bad.zip");
  await makePackage(badPackage, "const leaked = '/Users/example/PasteboardPro';\n");
  await zipPackage(badPackage, badArchive);
  await assert.rejects(
    verifyReleaseArchive(badArchive),
    /absolute development path/u,
  );

  console.log("PasteboardPro release archive verifier tested");
} finally {
  await rm(root, { recursive: true, force: true });
}
