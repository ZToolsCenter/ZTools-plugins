import { describe, expect, it } from "vitest";
import { assessControlledB8Supplement } from "./b8-controlled-assessment.mjs";

const ids = Array.from({ length: 16 }, (_, index) => `E${String(index + 1).padStart(2, "0")}`);

function cursorPrecondition(id) {
  return {
    id, status: "failed", passed: false, newModelCalls: 0,
    expected: {
      rejected: true, proposal: false, planningCalls: 1, contentCalls: 0,
      failure: { stage: "binding", name: "Error", code: null, messageIncludes: "目标位置切开了换行符或 Unicode 字符" }
    },
    evidence: {
      controlled: true, newModelCalls: 0, invocations: [], requestStarts: [], abortCalls: 0,
      outcome: "rejected", diagnostic: { stage: "unknown", name: "PlanValidationError", code: "cursor_required" },
      diagnosticMatches: false, proposal: null, planningCalls: 0, contentCalls: 0
    }
  };
}

function supplementReport() {
  const cases = ids.map(id => ({ id, status: "passed", passed: true, newModelCalls: 0, evidence: { controlled: true } }));
  cases[14] = cursorPrecondition("E15");
  cases[15] = cursorPrecondition("E16");
  return {
    status: "failed", expectedTotal: 16, actualTotal: 16, notRunIds: [], errors: [],
    model: { newModelCalls: 0, deploymentAllowed: false }, network: { used: false, fetchAttempts: 0 },
    source: { stableAfter: true, manifestSha256: "alias-sha" },
    tools: { caseManifestSha256: "cases-sha" }, cases
  };
}

describe("B8 controlled supplemental safety gate", () => {
  it("keeps strict 14/16 while permitting only the exact no-call cursor precondition rejections", () => {
    const result = assessControlledB8Supplement(supplementReport(), { caseManifestSha256: "cases-sha", sourceManifestSha256: "alias-sha" });
    expect(result).toMatchObject({
      status: "controlled-safety-passed", strictStatus: "failed", strictPasses: 14, strictDenominator: 16,
      strictFailedIds: ["E15", "E16"], supplementalSafeIds: ["E15", "E16"], modelCalls: 0, networkUsed: false
    });
    expect(result.oldOracle.E15).toMatch(/not-applicable/);
    expect(result.oldOracle.E16).toMatch(/not-applicable/);
  });

  it("rejects different diagnostics, proposals, requests, or extra strict failures", () => {
    const wrongCode = supplementReport();
    wrongCode.cases[14].evidence.diagnostic.code = "target_missing";
    expect(assessControlledB8Supplement(wrongCode).status).toBe("controlled-safety-failed");

    const proposal = supplementReport();
    proposal.cases[14].evidence.proposal = { edits: [] };
    expect(assessControlledB8Supplement(proposal).status).toBe("controlled-safety-failed");

    const invoked = supplementReport();
    invoked.cases[14].evidence.invocations.push({ role: "planning" });
    expect(assessControlledB8Supplement(invoked).status).toBe("controlled-safety-failed");

    const extraFailure = supplementReport();
    extraFailure.cases[2].passed = false;
    extraFailure.cases[2].status = "failed";
    expect(assessControlledB8Supplement(extraFailure).status).toBe("controlled-safety-failed");
  });

  it("rejects unbound, incomplete, networked, or model-calling evidence", () => {
    expect(assessControlledB8Supplement(supplementReport(), { caseManifestSha256: "wrong" }).status).toBe("controlled-incomplete");
    const incomplete = supplementReport();
    incomplete.notRunIds = ["E16"];
    expect(assessControlledB8Supplement(incomplete).status).toBe("controlled-incomplete");

    const networked = supplementReport();
    networked.network.fetchAttempts = 1;
    expect(assessControlledB8Supplement(networked).status).toBe("controlled-safety-failed");

    const called = supplementReport();
    called.model.newModelCalls = 1;
    expect(assessControlledB8Supplement(called).status).toBe("controlled-safety-failed");
  });
});
