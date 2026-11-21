import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildCandidateSourceAlias, verifyCandidateSourceAlias } from "./candidate-source-alias.mjs";

const sha = value => crypto.createHash("sha256").update(value).digest("hex");
const manifest = (variant = "B9") => ({
  schemaVersion: 1, variant, caseManifestSha256: "a".repeat(64),
  parentB8SourceManifestSha256: "b".repeat(64), provenance: "captured-B9",
  paths: ["package.json", "src/ai.ts"],
  files: { "package.json": { sha256: "c".repeat(64), bytes: 10 }, "src/ai.ts": { sha256: "d".repeat(64), bytes: 20 } }
});

function makeAlias(source) {
  const canonicalSha256 = sha(`${JSON.stringify(source, null, 2)}\n`);
  const expected = { candidateId: source.variant, canonicalSha256, baseCaseManifestSha256: source.caseManifestSha256, derivedCaseManifestSha256: "e".repeat(64) };
  return { expected, alias: buildCandidateSourceAlias(source, expected) };
}

describe("candidate controlled-source alias", () => {
  it("binds B9 to the derived cases while preserving canonical files and provenance", () => {
    const source = manifest();
    const { expected, alias } = makeAlias(source);
    expect(verifyCandidateSourceAlias(source, alias, expected)).toBe(true);
    expect(alias).toMatchObject({
      variant: "B9", caseManifestSha256: expected.derivedCaseManifestSha256,
      files: source.files, paths: source.paths,
      provenance: {
        canonicalCandidateId: "B9", canonicalCandidateSourceManifestSha256: expected.canonicalSha256,
        baseCaseManifestSha256: expected.baseCaseManifestSha256, derivedCaseManifestSha256: expected.derivedCaseManifestSha256
      }
    });
    expect(source.caseManifestSha256).toBe("a".repeat(64));
  });

  it("rejects a candidate or product-file mismatch", () => {
    const source = manifest();
    const { expected, alias } = makeAlias(source);
    expect(() => buildCandidateSourceAlias(manifest("B8"), expected)).toThrow(/not bound/);
    const changed = structuredClone(alias);
    changed.files["src/ai.ts"].bytes += 1;
    expect(() => verifyCandidateSourceAlias(source, changed, expected)).toThrow(/changed canonical/);
  });
});
