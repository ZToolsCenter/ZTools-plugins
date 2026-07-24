import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { verifyReleaseArchive } from "./verify-release-archive.mjs";

const root = await mkdtemp(path.join(os.tmpdir(), "pasteboardpro-archive-test-"));

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
  await writeFile(path.join(directory, "logo.svg"), "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>\n");
  await writeFile(path.join(directory, "assets", "index.js"), "console.log('fixture');\n");
  await writeFile(path.join(directory, "pasteboard-vision"), "fixture helper\n");
  await chmod(path.join(directory, "pasteboard-vision"), 0o755);
}

function zipPackage(directory, archive) {
  execFileSync("zip", ["-q", "-r", archive, "."], {
    cwd: directory,
    stdio: ["ignore", "pipe", "pipe"],
  });
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
  zipPackage(goodPackage, goodArchive);
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
  zipPackage(badPackage, badArchive);
  await assert.rejects(
    verifyReleaseArchive(badArchive),
    /absolute development path/u,
  );

  console.log("PasteboardPro release archive verifier tested");
} finally {
  await rm(root, { recursive: true, force: true });
}
