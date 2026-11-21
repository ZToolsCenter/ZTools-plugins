import { describe, expect, it } from "vitest";
import { B8_SCHEDULE, buildB8AttemptPlan, buildB8ProfileConfig, freezeB8 } from "./prepare-ai-common-failures-b8.mjs";

function baseConfig(profileId = "light") {
  return {
    schemaVersion: 2,
    evaluationId: "ai-common-failures-v1",
    caseSets: { "ai-common-failures-80-plus-7-v1": "cases/frozen.json" },
    defaultCaseSetId: "ai-common-failures-80-plus-7-v1",
    outputRoot: ".cache/old/runs/light",
    localAiDirectory: ".cache/verified-runtime/" + profileId,
    viteCacheRoot: ".cache/old/vite/light",
    requestRecipe: { relativePath: "recipe.ts", intent: "frozen recipe", sharedModules: ["recipe.ts"] },
    sourceVariants: {
      A: { label: "baseline", sourceRoot: "baseline/source", sourceManifest: "baseline/manifest.json" },
      B: { label: "B7", sourceRoot: "B7/source", sourceManifest: "B7/manifest.json", provenance: "B7", verificationMode: "snapshot-only" }
    },
    model: { provider: "local", activeRoleId: "general", profileId, modelId: "model-" + profileId, retries: 0, deploymentAllowed: false },
    limits: { maxCallsPerCase: 64, runnerDeadlineMs: 90000, independentHarnessDeadlineMs: 90000, productionDeadlineMs: 300000 }
  };
}

describe("B8 extra-run freeze", () => {
  it("freezes two interleaved rounds in the requested order", () => {
    expect(B8_SCHEDULE.map(item => item.profile)).toEqual(["balanced", "light", "light", "balanced"]);
    expect(B8_SCHEDULE.map(item => item.round)).toEqual([1, 1, 2, 2]);
    expect(B8_SCHEDULE.every(item => item.variant === "B8")).toBe(true);
  });

  it("rebinds only candidate/output identity while preserving role, recipes, limits and models", () => {
    const base = baseConfig();
    const result = buildB8ProfileConfig(base);
    expect(result).not.toBe(base);
    expect(base.sourceVariants.B.sourceManifest).toBe("B7/manifest.json");
    expect(result.sourceVariants.A).toEqual(base.sourceVariants.A);
    expect(result.sourceVariants.B.sourceManifest).toBe(".cache/acceptance/ai-common-failures/v1/snapshots/B8/source-manifest.json");
    expect(result.requestRecipe).toEqual(base.requestRecipe);
    expect(result.caseSets).toEqual(base.caseSets);
    expect(result.model).toEqual(base.model);
    expect(result.limits).toEqual(base.limits);
    expect(result.localAiDirectory).toBe(base.localAiDirectory);
  });

  it("keeps 87 real tasks and 16 controlled boundary checks on separate denominators", () => {
    const plan = buildB8AttemptPlan({
      caseManifestSha256: "case-hash",
      derivedCaseManifestSha256: "case-hash",
      b7SourceManifestSha256: "b7-source",
      b7ToolManifestSha256: "b7-tool",
      b7RunLedgerSha256: "b7-ledger",
      runtimePreparationSha256: "runtime",
      profiles: [
        { id: "balanced", configSha256: "balanced-config", toolManifestSha256: "balanced-tool" },
        { id: "light", configSha256: "light-config", toolManifestSha256: "light-tool" }
      ]
    });
    expect(plan.policy.realCases).toBe(87);
    expect(plan.policy.controlledCases).toBe(16);
    expect(plan.schedule).toHaveLength(4);
    expect(plan.policy.retries).toBe(0);
  });

  it("rejects an unbound case hash and refuses freeze without the explicit product-stable signal", () => {
    expect(() => buildB8AttemptPlan({
      caseManifestSha256: "wrong",
      derivedCaseManifestSha256: "case-hash",
      b7SourceManifestSha256: "b7-source",
      b7ToolManifestSha256: "b7-tool",
      b7RunLedgerSha256: "b7-ledger",
      runtimePreparationSha256: "runtime",
      profiles: []
    })).toThrow(/case set/);
    expect(() => freezeB8()).toThrow(/product-stable/);
  });
});
