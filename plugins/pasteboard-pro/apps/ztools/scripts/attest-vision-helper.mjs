import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

export function parseCodesignDetails(output) {
  const lines = String(output).split(/\r?\n/u);
  return {
    identifier: lines.find((line) => line.startsWith("Identifier="))?.slice("Identifier=".length) ?? null,
    signature: lines.find((line) => line.startsWith("Signature="))?.slice("Signature=".length) ?? null,
    authorities: lines
      .filter((line) => line.startsWith("Authority="))
      .map((line) => line.slice("Authority=".length)),
    teamIdentifier:
      lines.find((line) => line.startsWith("TeamIdentifier="))?.slice("TeamIdentifier=".length) ?? null,
    hardenedRuntime: lines.some((line) => /^CodeDirectory .*\bflags=.*\bruntime\b/iu.test(line)),
  };
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  return {
    status: result.status,
    output: `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim(),
    error: result.error?.message ?? null,
  };
}

export async function attestVisionHelper(helperPath, options = {}) {
  assert.equal(process.platform, "darwin", "Vision helper attestation requires macOS");
  const absoluteHelper = path.resolve(helperPath);
  const metadata = await stat(absoluteHelper);
  assert.equal(metadata.isFile(), true, "Vision helper must be a regular file");
  assert.notEqual(metadata.mode & 0o111, 0, "Vision helper must be executable");

  const verification = run("codesign", ["--verify", "--deep", "--strict", absoluteHelper]);
  assert.equal(verification.status, 0, verification.output || verification.error || "codesign failed");
  const detailsResult = run("codesign", ["-dv", "--verbose=4", absoluteHelper]);
  assert.equal(detailsResult.status, 0, detailsResult.output || detailsResult.error || "codesign details failed");
  const codesign = parseCodesignDetails(detailsResult.output);

  if (options.signature === "adhoc") {
    assert.match(codesign.signature ?? "", /^adhoc$/iu, "PR helper must use an ad-hoc signature");
  } else if (options.signature === "developer-id") {
    assert.ok(
      codesign.authorities.some((authority) => authority.startsWith("Developer ID Application:")),
      "Release helper must use a Developer ID Application identity",
    );
    assert.match(codesign.teamIdentifier ?? "", /^[A-Z0-9]{10}$/u, "Release helper has no TeamIdentifier");
    assert.equal(codesign.hardenedRuntime, true, "Release helper must enable hardened runtime");
  } else {
    throw new Error("Expected --signature=adhoc or --signature=developer-id");
  }

  let gatekeeper = { checked: false, accepted: null };
  if (options.requireGatekeeper) {
    const assessment = run("spctl", ["--assess", "--type", "execute", "--verbose=4", absoluteHelper]);
    assert.equal(assessment.status, 0, assessment.output || assessment.error || "Gatekeeper rejected helper");
    gatekeeper = { checked: true, accepted: true };
  }

  const bytes = await readFile(absoluteHelper);
  const report = {
    schemaVersion: 1,
    artifact: path.basename(absoluteHelper),
    size: metadata.size,
    sha256: sha256(bytes),
    executable: true,
    codesign: {
      checked: true,
      valid: true,
      expectedSignature: options.signature,
      ...codesign,
    },
    gatekeeper,
  };

  if (options.outputPath) {
    await writeFile(path.resolve(options.outputPath), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }
  return report;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const args = process.argv.slice(2);
  const helperPath = args.find((argument) => !argument.startsWith("--"));
  const signature = args.find((argument) => argument.startsWith("--signature="))?.slice("--signature=".length);
  const outputPath = args.find((argument) => argument.startsWith("--output="))?.slice("--output=".length);
  assert.ok(helperPath, "Usage: attest-vision-helper.mjs <helper> --signature=adhoc|developer-id --output=path");
  assert.ok(outputPath, "Vision helper attestation requires --output=path");
  const report = await attestVisionHelper(helperPath, {
    signature,
    outputPath,
    requireGatekeeper: args.includes("--require-gatekeeper"),
  });
  console.log(`PasteboardPro Vision helper attested (${report.sha256})`);
}
