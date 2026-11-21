import { describe, expect, it } from "vitest";
import { B9_SCHEDULE, buildB9AttemptPlan } from "./prepare-ai-common-failures-b9.mjs";

const sha = letter => letter.repeat(64);
const previousAttempt = {
  attemptManifestSha256: sha("a"), ledgerSha256: sha("b"), eventLedgerSha256: sha("c"),
  stopRecordSha256: sha("d"), stopEventHash: sha("e"), controlledReportSha256: sha("f"),
  controlledSourceManifestSha256: sha("1"),
  b8Attempt: { inputs: { b7SourceManifestSha256: sha("2"), b7ToolManifestSha256: sha("3"), b7RunLedgerSha256: sha("4") } }
};
const profiles = ["balanced", "light"].map(id => ({ id, configSha256: sha("5"), toolManifestSha256: sha("6") }));

describe("B9 attempt freeze contract", () => {
  it("keeps the original 87+16 cases, no-retry policy, and interleaved two-profile schedule", () => {
    expect(B9_SCHEDULE.map(({ variant, profile, round, runId }) => [variant, profile, round, runId])).toEqual([
      ["B9", "balanced", 1, "common-b9-balanced-r1"],
      ["B9", "light", 1, "common-b9-light-r1"],
      ["B9", "light", 2, "common-b9-light-r2"],
      ["B9", "balanced", 2, "common-b9-balanced-r2"]
    ]);
    const plan = buildB9AttemptPlan({
      caseManifestSha256: sha("7"), derivedCaseManifestSha256: sha("7"), b8SourceManifestSha256: sha("8"),
      b8LedgerSha256: sha("b"), b8ToolManifestSha256: sha("9"),
      runtimePreparationSha256: sha("0"), previousAttempt, profiles
    });
    expect(plan).toMatchObject({
      evaluationId: "ai-common-failures-b9-v1", candidateId: "B9", attemptId: "authorized-run-03",
      policy: { realCases: 87, controlledCases: 16, retries: 0, downloadsAllowed: false, deploymentAllowed: false,
        editorWriteback: false, sequential: true, controlledAssessment: "strict-plus-cursor-precondition-safety-v1" },
      inputs: { b8SourceManifestSha256: sha("8"), previousAttempt: { attemptId: "authorized-run-02" } }
    });
  });

  it("refuses case drift or incomplete profile bindings", () => {
    const base = {
      caseManifestSha256: sha("7"), derivedCaseManifestSha256: sha("7"), b8SourceManifestSha256: sha("8"),
      b8LedgerSha256: sha("b"), b8ToolManifestSha256: sha("9"),
      runtimePreparationSha256: sha("0"), previousAttempt, profiles
    };
    expect(() => buildB9AttemptPlan({ ...base, caseManifestSha256: sha("f") })).toThrow(/case hash/);
    expect(() => buildB9AttemptPlan({ ...base, profiles: profiles.slice(0, 1) })).toThrow(/exactly two/);
  });
});
