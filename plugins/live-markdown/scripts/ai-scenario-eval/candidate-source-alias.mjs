import crypto from "node:crypto";

const sha256 = value => crypto.createHash("sha256").update(value).digest("hex");
const projectFiles = manifest => ({ paths: manifest.paths, files: manifest.files });

export function buildCandidateSourceAlias(canonical, { candidateId, canonicalSha256, baseCaseManifestSha256, derivedCaseManifestSha256 }) {
  if (!["B8", "B9"].includes(candidateId) || canonical?.variant !== candidateId ||
      canonicalSha256 !== sha256(`${JSON.stringify(canonical, null, 2)}\n`) || canonical.caseManifestSha256 !== baseCaseManifestSha256 ||
      !/^[a-f0-9]{64}$/u.test(derivedCaseManifestSha256 ?? "")) {
    throw new Error("Controlled source alias is not bound to the selected canonical candidate and derived case manifest.");
  }
  return {
    ...canonical,
    caseManifestSha256: derivedCaseManifestSha256,
    provenance: {
      purpose: "controlled-only case binding; candidate source file identity remains canonical",
      canonicalCandidateId: candidateId,
      canonicalCandidateSourceManifestSha256: canonicalSha256,
      baseCaseManifestSha256,
      derivedCaseManifestSha256
    }
  };
}

export function verifyCandidateSourceAlias(canonical, alias, expected) {
  const expectedAlias = buildCandidateSourceAlias(canonical, expected);
  const sourceProjection = { ...alias };
  delete sourceProjection.caseManifestSha256;
  delete sourceProjection.provenance;
  if (JSON.stringify(alias) !== JSON.stringify(expectedAlias) ||
      JSON.stringify(sourceProjection) !== JSON.stringify({ ...canonical, caseManifestSha256: undefined, provenance: undefined }) ||
      JSON.stringify(projectFiles(alias)) !== JSON.stringify(projectFiles(canonical))) {
    throw new Error("Controlled source alias changed canonical candidate metadata or product files.");
  }
  return true;
}

export function serializeCandidateSourceAlias(alias) {
  return `${JSON.stringify(alias, null, 2)}\n`;
}
