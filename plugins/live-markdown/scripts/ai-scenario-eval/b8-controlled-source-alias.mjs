import crypto from "node:crypto";

const sha256 = value => crypto.createHash("sha256").update(value).digest("hex");
const removeAliasFields = value => {
  const result = { ...value };
  delete result.caseManifestSha256;
  delete result.provenance;
  return result;
};

export function buildControlledSourceAlias(canonical, { canonicalSha256, baseCaseManifestSha256, derivedCaseManifestSha256 }) {
  if (!canonical || canonicalSha256 !== sha256(JSON.stringify(canonical, null, 2) + "\n") ||
      canonical.caseManifestSha256 !== baseCaseManifestSha256 || !/^[a-f0-9]{64}$/u.test(derivedCaseManifestSha256 ?? "")) {
    throw new Error("Controlled-only source alias is not bound to the canonical B8 and derived case manifests.");
  }
  return {
    ...canonical,
    caseManifestSha256: derivedCaseManifestSha256,
    provenance: {
      purpose: "controlled-only case binding; product identity remains the canonical B8 file manifest",
      canonicalB8SourceManifestSha256: canonicalSha256,
      baseCaseManifestSha256,
      derivedCaseManifestSha256
    }
  };
}

export function verifyControlledSourceAlias(canonical, alias, expected) {
  const rebuilt = buildControlledSourceAlias(canonical, expected);
  if (JSON.stringify(alias) !== JSON.stringify(rebuilt) ||
      JSON.stringify(removeAliasFields(alias)) !== JSON.stringify(removeAliasFields(canonical)) ||
      JSON.stringify(alias.paths) !== JSON.stringify(canonical.paths) || JSON.stringify(alias.files) !== JSON.stringify(canonical.files)) {
    throw new Error("Controlled-only manifest may change only the case binding and provenance; B8 product file identity must remain exact.");
  }
  return true;
}

export function serializeControlledSourceAlias(alias) {
  return `${JSON.stringify(alias, null, 2)}\n`;
}
