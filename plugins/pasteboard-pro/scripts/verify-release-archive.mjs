import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { inflateRawSync } from "node:zlib";

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

function findEndOfCentralDirectory(buffer) {
  const minEocdSize = 22;
  const maxCommentLength = 0xffff;
  const start = Math.max(0, buffer.length - minEocdSize - maxCommentLength);
  for (let offset = buffer.length - minEocdSize; offset >= start; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      const commentLength = buffer.readUInt16LE(offset + 20);
      if (offset + minEocdSize + commentLength === buffer.length) {
        return offset;
      }
    }
  }
  throw new Error("Invalid ZIP archive: End of Central Directory not found");
}

function parseZipArchive(archiveBytes) {
  const eocdOffset = findEndOfCentralDirectory(archiveBytes);
  const totalEntries = archiveBytes.readUInt16LE(eocdOffset + 10);
  const centralDirSize = archiveBytes.readUInt32LE(eocdOffset + 12);
  const centralDirOffset = archiveBytes.readUInt32LE(eocdOffset + 16);
  assert.ok(totalEntries > 0, "PasteboardPro release archive must not be empty");
  assert.ok(
    centralDirOffset + centralDirSize <= eocdOffset,
    "Invalid ZIP archive: central directory bounds",
  );

  const parsedEntries = [];
  let cursor = centralDirOffset;
  for (let index = 0; index < totalEntries; index += 1) {
    assert.equal(
      archiveBytes.readUInt32LE(cursor),
      0x02014b50,
      "Invalid ZIP central directory signature",
    );
    const compressionMethod = archiveBytes.readUInt16LE(cursor + 10);
    const compressedSize = archiveBytes.readUInt32LE(cursor + 20);
    const uncompressedSize = archiveBytes.readUInt32LE(cursor + 24);
    const fileNameLength = archiveBytes.readUInt16LE(cursor + 28);
    const extraFieldLength = archiveBytes.readUInt16LE(cursor + 30);
    const fileCommentLength = archiveBytes.readUInt16LE(cursor + 32);
    const externalAttributes = archiveBytes.readUInt32LE(cursor + 38);
    const localHeaderOffset = archiveBytes.readUInt32LE(cursor + 42);
    const nameStart = cursor + 46;
    const nameEnd = nameStart + fileNameLength;
    const rawName = archiveBytes.subarray(nameStart, nameEnd).toString("utf8");
    cursor = nameEnd + extraFieldLength + fileCommentLength;

    assert.equal(rawName.includes("\\"), false, `Archive entry uses a backslash: ${rawName}`);
    assert.equal(path.posix.isAbsolute(rawName), false, `Archive entry is absolute: ${rawName}`);
    assert.equal(
      rawName.split("/").some((segment) => segment === ".."),
      false,
      `Archive entry escapes the package root: ${rawName}`,
    );

    const unixMode = (externalAttributes >>> 16) & 0xffff;
    const unixFileType = unixMode & 0o170000;
    assert.notEqual(unixFileType, 0o120000, `Symlink is forbidden: ${rawName}`);

    assert.equal(
      archiveBytes.readUInt32LE(localHeaderOffset),
      0x04034b50,
      `Invalid ZIP local header signature for ${rawName}`,
    );
    const localNameLength = archiveBytes.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = archiveBytes.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    assert.ok(dataEnd <= archiveBytes.length, `Truncated ZIP entry data for ${rawName}`);
    const compressedData = archiveBytes.subarray(dataStart, dataEnd);

    let data = Buffer.alloc(0);
    const isDirectory = rawName.endsWith("/") || unixFileType === 0o040000;
    if (!isDirectory) {
      if (compressionMethod === 0) {
        data = Buffer.from(compressedData);
      } else if (compressionMethod === 8) {
        data = inflateRawSync(compressedData);
      } else {
        throw new Error(`Unsupported ZIP compression method ${compressionMethod} for ${rawName}`);
      }
      assert.equal(
        data.length,
        uncompressedSize,
        `Uncompressed size mismatch for ${rawName}`,
      );
    }

    parsedEntries.push({
      name: rawName,
      isDirectory,
      mode: unixMode & 0o777,
      data,
    });
  }

  const names = parsedEntries.map((entry) => entry.name);
  assert.equal(new Set(names).size, names.length, "Archive entries must be unique");
  return parsedEntries;
}

async function extractZipArchive(parsedEntries, destinationRoot) {
  for (const entry of parsedEntries) {
    const normalized = entry.name.replace(/\/+$/u, "");
    if (normalized.length === 0) continue;
    const targetPath = path.join(destinationRoot, ...normalized.split("/"));
    if (entry.isDirectory) {
      await mkdir(targetPath, { recursive: true });
      continue;
    }
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, entry.data);
    if (entry.mode !== 0) {
      await chmod(targetPath, entry.mode);
    }
  }
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
  const archiveBytes = await readFile(absoluteArchive);
  const parsedEntries = parseZipArchive(archiveBytes);
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "pasteboardpro-release-"));

  try {
    await extractZipArchive(parsedEntries, temporaryRoot);

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
    const hasHelper = extractedFiles.includes("pasteboard-vision");
    if (process.platform === "darwin" || options.verifyCodesign || options.helperAttestationPath) {
      assert.equal(hasHelper, true, "Release archive is missing pasteboard-vision helper");
    }

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

    const helperBytes = hasHelper ? await readFile(helperPath) : null;
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
      helperSha256: helperBytes ? sha256(helperBytes) : null,
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
        safeEntries: parsedEntries.length > 0,
        executableHelper: hasHelper,
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
