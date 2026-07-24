import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  lstat,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { verifyAssembledPackage } from "../apps/ztools/scripts/assemble-dist.mjs";

const developmentPathMarkers = [
  Buffer.from("/Users/"),
  Buffer.from("/home/runner/work/"),
  Buffer.from("/home/runner/actions-runner/"),
  Buffer.from("C:\\Users\\"),
];

const forbiddenArchiveFile = (relative) =>
  /(?:^|\/)(?:node_modules|\.git)(?:\/|$)/u.test(relative) ||
  /(?:^|\/)(?:\.env(?:\..*)?|\.DS_Store|id_rsa)$/iu.test(relative) ||
  /\.(?:map|sqlite|db|pem|p12|pfx|mobileprovision|key|ts|tsx|vue|svelte|swift)$/iu.test(
    relative,
  ) ||
  /(?:credentials?|secrets?)(?:\.[^/]*)?$/iu.test(relative);

function listArchiveEntries(archivePath) {
  const output = execFileSync("unzip", ["-Z1", archivePath], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const entries = output
    .split(/\r?\n/u)
    .map((entry) => entry.trim())
    .filter(Boolean);
  assert.ok(entries.length > 0, "PasteboardPro release archive must not be empty");
  assert.equal(new Set(entries).size, entries.length, "Archive entries must be unique");

  for (const entry of entries) {
    assert.equal(entry.includes("\\"), false, `Archive entry uses a backslash: ${entry}`);
    assert.equal(path.posix.isAbsolute(entry), false, `Archive entry is absolute: ${entry}`);
    assert.equal(
      entry.split("/").some((segment) => segment === ".."),
      false,
      `Archive entry escapes the package root: ${entry}`,
    );
  }
  return entries;
}

async function inspectExtractedTree(root, prefix = "") {
  const entries = await readdir(path.join(root, prefix), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relative = path.posix.join(prefix.split(path.sep).join("/"), entry.name);
    const absolute = path.join(root, ...relative.split("/"));
    const metadata = await lstat(absolute);
    assert.equal(metadata.isSymbolicLink(), false, `Symlink is forbidden: ${relative}`);
    if (metadata.isDirectory()) {
      files.push(...(await inspectExtractedTree(root, relative)));
      continue;
    }
    assert.equal(metadata.isFile(), true, `Unsupported archive entry type: ${relative}`);
    files.push(relative);
  }
  return files;
}

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

export async function verifyReleaseArchive(archivePath, options = {}) {
  const absoluteArchive = path.resolve(archivePath);
  const archiveEntries = listArchiveEntries(absoluteArchive);
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "pasteboardpro-release-"));

  try {
    execFileSync("unzip", ["-q", absoluteArchive, "-d", temporaryRoot], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    const extractedFiles = (await inspectExtractedTree(temporaryRoot)).sort();
    assert.deepEqual(
      extractedFiles.filter(forbiddenArchiveFile),
      [],
      "Release archive contains source, credentials, databases, or development files",
    );
    assert.equal(
      extractedFiles.some((file) => file.startsWith("atools/") || file.startsWith("ztools/")),
      false,
      "ZTools package files must be placed at the archive root",
    );

    const assembled = await verifyAssembledPackage(temporaryRoot);
    const markerHits = [];
    for (const relative of extractedFiles) {
      const bytes = await readFile(path.join(temporaryRoot, ...relative.split("/")));
      for (const marker of developmentPathMarkers) {
        if (bytes.includes(marker)) markerHits.push(`${relative}:${marker.toString("utf8")}`);
      }
      assert.equal(
        bytes.includes(Buffer.from("sourceMappingURL=data:")),
        false,
        `Inline source map is forbidden: ${relative}`,
      );
    }
    assert.deepEqual(markerHits, [], "Release archive leaks an absolute development path");

    const helperPath = path.join(temporaryRoot, "pasteboard-vision");
    let codesign = { checked: false, identity: null };
    if (options.verifyCodesign) {
      assert.equal(process.platform, "darwin", "codesign verification requires macOS");
      execFileSync("codesign", ["--verify", "--deep", "--strict", helperPath], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      const detailResult = spawnSync("codesign", ["-dv", "--verbose=4", helperPath], {
        encoding: "utf8",
      });
      assert.equal(detailResult.status, 0, detailResult.stderr || "codesign detail inspection failed");
      const detail = `${detailResult.stdout ?? ""}\n${detailResult.stderr ?? ""}`;
      codesign = { checked: true, identity: detail.match(/^Authority=(.+)$/mu)?.[1] ?? null };
    }

    const archiveBytes = await readFile(absoluteArchive);
    const helperBytes = await readFile(helperPath);
    let helperAttestation = { checked: false };
    if (options.helperAttestationPath) {
      const attestation = JSON.parse(
        await readFile(path.resolve(options.helperAttestationPath), "utf8"),
      );
      assert.equal(attestation.schemaVersion, 1);
      assert.equal(attestation.artifact, "pasteboard-vision");
      assert.equal(attestation.executable, true);
      assert.equal(attestation.codesign?.checked, true);
      assert.equal(attestation.codesign?.valid, true);
      if (options.requireHelperSignature) {
        assert.equal(
          attestation.codesign.expectedSignature,
          options.requireHelperSignature,
          `Expected a ${options.requireHelperSignature} helper attestation`,
        );
      }
      if (options.requireHelperSignature === "developer-id") {
        assert.equal(attestation.codesign.hardenedRuntime, true);
        assert.match(attestation.codesign.teamIdentifier ?? "", /^[A-Z0-9]{10}$/u);
        assert.ok(
          attestation.codesign.authorities?.some((authority) =>
            authority.startsWith("Developer ID Application:"),
          ),
          "Release helper attestation has no Developer ID Application authority",
        );
        assert.deepEqual(attestation.gatekeeper, { checked: true, accepted: true });
      }
      assert.match(attestation.sha256 ?? "", /^[a-f0-9]{64}$/u);
      assert.equal(
        attestation.sha256,
        sha256(helperBytes),
        "Final archive helper does not match the signed helper attestation",
      );
      helperAttestation = {
        checked: true,
        sha256: attestation.sha256,
        expectedSignature: attestation.codesign.expectedSignature,
        authorities: attestation.codesign.authorities,
        teamIdentifier: attestation.codesign.teamIdentifier,
        hardenedRuntime: attestation.codesign.hardenedRuntime,
        gatekeeper: attestation.gatekeeper,
      };
    }
    const report = {
      schemaVersion: 1,
      archive: path.basename(absoluteArchive),
      archiveSha256: sha256(archiveBytes),
      helperSha256: sha256(helperBytes),
      fileCount: extractedFiles.length,
      files: extractedFiles,
      manifest: {
        name: assembled.manifest.name,
        version: assembled.manifest.version,
        main: assembled.manifest.main,
        preload: assembled.manifest.preload,
      },
      checks: {
        rootLayout: true,
        safeEntries: archiveEntries.length > 0,
        executableHelper: true,
        noForbiddenFiles: true,
        noDevelopmentPaths: true,
        codesign,
        helperAttestation,
      },
    };

    if (options.reportPath) {
      const reportPath = path.resolve(options.reportPath);
      await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    }
    return report;
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const archivePath = process.argv.slice(2).find((argument) => !argument.startsWith("--"));
  assert.ok(archivePath, "Usage: verify-release-archive.mjs <archive.zip> [--report=path] [--verify-codesign]");
  const reportArgument = process.argv.slice(2).find((argument) => argument.startsWith("--report="));
  const attestationArgument = process.argv
    .slice(2)
    .find((argument) => argument.startsWith("--helper-attestation="));
  const signatureArgument = process.argv
    .slice(2)
    .find((argument) => argument.startsWith("--require-helper-signature="));
  const report = await verifyReleaseArchive(archivePath, {
    reportPath: reportArgument?.slice("--report=".length),
    helperAttestationPath: attestationArgument?.slice("--helper-attestation=".length),
    requireHelperSignature: signatureArgument?.slice("--require-helper-signature=".length),
    verifyCodesign: process.argv.includes("--verify-codesign"),
  });
  console.log(
    `PasteboardPro release archive verified (${report.fileCount} files, sha256 ${report.archiveSha256})`,
  );
}
