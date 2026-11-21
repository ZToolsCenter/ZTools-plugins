import { describe, expect, it } from "vitest";
import { B8_SCHEDULE } from "./prepare-ai-common-failures-b8.mjs";
import { assessControlledB8Report, parseB8RunArgs } from "./run-ai-common-failures-b8.mjs";
import { buildControlledSourceAlias, serializeControlledSourceAlias, verifyControlledSourceAlias } from "./b8-controlled-source-alias.mjs";
import crypto from "node:crypto";

const manifestSha = "a".repeat(64);
const controlledIds = Array.from({ length: 16 }, (_, index) => `E${String(index + 1).padStart(2, "0")}`);

function controlledReport(overrides = {}) {
  return {
    status: "passed", expectedTotal: 16, actualTotal: 16, notRunIds: [], errors: [],
    model: { newModelCalls: 0, deploymentAllowed: false },
    network: { used: false, fetchAttempts: 0 },
    source: { stableAfter: true, manifestSha256: "source-hash" },
    tools: { caseManifestSha256: "case-hash" },
    cases: controlledIds.map(id => ({ id, status: "passed", passed: true, newModelCalls: 0, evidence: { controlled: true } })),
    ...overrides
  };
}

function canonicalSourceManifest() {
  return {
    schemaVersion: 1, variant: "B8", caseManifestSha256: "b".repeat(64),
    provenance: "captured-fixed-candidate-after-B7-real-evaluation", verificationMode: "snapshot-only-after-freeze",
    paths: ["package.json", "src/index.ts"],
    files: {
      "package.json": { sha256: "c".repeat(64), bytes: 12 },
      "src/index.ts": { sha256: "d".repeat(64), bytes: 34 }
    }, stable: true, parentB7SourceManifestSha256: "e".repeat(64)
  };
}

function sourceAlias(canonical, derived = "f".repeat(64)) {
  const canonicalSha256 = crypto.createHash("sha256").update(`${JSON.stringify(canonical, null, 2)}\n`).digest("hex");
  const expected = { canonicalSha256, baseCaseManifestSha256: canonical.caseManifestSha256, derivedCaseManifestSha256: derived };
  return { expected, alias: buildControlledSourceAlias(canonical, expected) };
}

describe("B8 runner safety contract", () => {
  it("creates a controlled-only alias with an explicit canonical/base/derived provenance chain", () => {
    const canonical = canonicalSourceManifest();
    const { expected, alias } = sourceAlias(canonical);
    expect(verifyControlledSourceAlias(canonical, alias, expected)).toBe(true);
    expect(alias).toMatchObject({
      caseManifestSha256: expected.derivedCaseManifestSha256,
      provenance: {
        canonicalB8SourceManifestSha256: expected.canonicalSha256,
        baseCaseManifestSha256: expected.baseCaseManifestSha256,
        derivedCaseManifestSha256: expected.derivedCaseManifestSha256
      }
    });
    expect(alias.paths).toEqual(canonical.paths);
    expect(alias.files).toEqual(canonical.files);
    expect(canonical.caseManifestSha256).toBe(expected.baseCaseManifestSha256);
    expect(canonical.provenance).toBe("captured-fixed-candidate-after-B7-real-evaluation");
    expect(serializeControlledSourceAlias(alias)).toContain(expected.derivedCaseManifestSha256);
  });

  it("rejects any extra difference to the controlled-only source manifest", () => {
    const canonical = canonicalSourceManifest();
    const { expected, alias } = sourceAlias(canonical);
    const changedFiles = structuredClone(alias);
    changedFiles.files["src/index.ts"].bytes += 1;
    expect(() => verifyControlledSourceAlias(canonical, changedFiles, expected)).toThrow(/only the case binding and provenance/);

    const changedPaths = structuredClone(alias);
    changedPaths.paths.push("secret.txt");
    expect(() => verifyControlledSourceAlias(canonical, changedPaths, expected)).toThrow(/only the case binding and provenance/);

    const changedMetadata = { ...alias, verificationMode: "different" };
    expect(() => verifyControlledSourceAlias(canonical, changedMetadata, expected)).toThrow(/only the case binding and provenance/);
  });

  it("refuses a mismatched canonical or derived case binding", () => {
    const canonical = canonicalSourceManifest();
    const { expected } = sourceAlias(canonical);
    expect(() => buildControlledSourceAlias(canonical, { ...expected, canonicalSha256: "0".repeat(64) })).toThrow(/not bound/);
    expect(() => buildControlledSourceAlias(canonical, { ...expected, baseCaseManifestSha256: "1".repeat(64) })).toThrow(/not bound/);
    expect(() => buildControlledSourceAlias(canonical, { ...expected, derivedCaseManifestSha256: "invalid" })).toThrow(/not bound/);
  });

  it("keeps the four real-run groups interleaved and separate from E01-E16", () => {
    expect(B8_SCHEDULE.map(({ profile }) => profile)).toEqual(["balanced", "light", "light", "balanced"]);
    const result = assessControlledB8Report(controlledReport(), { caseManifestSha256: "case-hash", sourceManifestSha256: "source-hash" });
    expect(result).toMatchObject({ status: "controlled-passed", expectedCases: 16, actualCases: 16, modelCalls: 0, networkUsed: false });
  });

  it("requires a manifest hash before execution and an explicit execute switch", () => {
    expect(parseB8RunArgs([`--manifest-sha256=${manifestSha}`, "--verify-only"])).toEqual({
      manifestSha256: manifestSha, execute: false, verifyOnly: true, attemptId: "authorized-run-02", candidateId: "B8"
    });
    expect(parseB8RunArgs([`--manifest-sha256=${manifestSha}`, "--execute"])).toEqual({
      manifestSha256: manifestSha, execute: true, verifyOnly: false, attemptId: "authorized-run-02", candidateId: "B8"
    });
    expect(parseB8RunArgs(["--attempt=authorized-run-03", "--candidate=B9", `--manifest-sha256=${manifestSha}`, "--verify-only"])).toMatchObject({
      attemptId: "authorized-run-03", candidateId: "B9", execute: false, verifyOnly: true
    });
    expect(() => parseB8RunArgs(["--attempt=authorized-run-03", `--manifest-sha256=${manifestSha}`, "--verify-only"])).toThrow(/explicit --candidate=B9/);
    expect(() => parseB8RunArgs(["--execute"])).toThrow(/manifest-sha256/);
    expect(() => parseB8RunArgs([`--manifest-sha256=${manifestSha}`, "--execute", "--execute"])).toThrow(/duplicate/);
    expect(() => parseB8RunArgs([`--manifest-sha256=${manifestSha}`])).toThrow(/verify-only\|--execute/);
    expect(() => parseB8RunArgs([`--manifest-sha256=${manifestSha}`, "--execute", "--verify-only"])).toThrow(/verify-only\|--execute/);
  });

  it("rejects a controlled report that makes any model or network call", () => {
    expect(assessControlledB8Report(controlledReport({ model: { newModelCalls: 1 } })).status).toBe("controlled-failed");
    expect(assessControlledB8Report(controlledReport({ network: { used: true, fetchAttempts: 1 } })).status).toBe("controlled-failed");
  });

  it("requires controlled output to remain bound to the frozen source and case manifest", () => {
    const report = controlledReport();
    expect(assessControlledB8Report(report, { caseManifestSha256: "other-case", sourceManifestSha256: "source-hash" }).status).toBe("controlled-incomplete");
    expect(assessControlledB8Report(report, { caseManifestSha256: "case-hash", sourceManifestSha256: "other-source" }).status).toBe("controlled-incomplete");
    report.source.stableAfter = false;
    expect(assessControlledB8Report(report).status).toBe("controlled-incomplete");
  });

  it("rejects missing, duplicate, reordered, or incomplete controlled cases", () => {
    const duplicate = controlledReport();
    duplicate.cases[1].id = duplicate.cases[0].id;
    expect(assessControlledB8Report(duplicate).status).toBe("controlled-incomplete");

    const short = controlledReport({ actualTotal: 15, notRunIds: ["E16"] });
    expect(assessControlledB8Report(short).status).toBe("controlled-incomplete");

    const failed = controlledReport();
    failed.cases[4].status = "failed";
    expect(assessControlledB8Report(failed).status).toBe("controlled-failed");
  });
});
