import { describe, expect, it } from "vitest";
import { prepareArtifactFill } from "../../src/core/ai/artifactFill";
import { resolveArtifactSpec } from "../../src/core/ai/artifactSpecFromInstruction";
import { resolveGenerationRequirements } from "../../src/core/ai/generationRequirements";

const instruction = "At the end, write a release rehearsal draft with these headings in order: Goal, Steps, Risks. Include executable steps and concrete risk scenarios; frame it as a proposal, not a completed event.";

function prepare() {
  const requirements = resolveGenerationRequirements(instruction, "custom");
  const spec = resolveArtifactSpec(instruction, requirements, { effect: "edit", operation: "insert" });
  return prepareArtifactFill({ instruction, spec, requirements });
}

describe("artifact section body normalization", () => {
  it("normalizes the R49 repeated-heading response, then renders the declared H2 outline once", () => {
    const prepared = prepare();
    expect(prepared).not.toBeNull();
    const result = prepared!.decode(JSON.stringify({ payload: { sections: {
      Goal: "## Goal\n\nThe primary goal of this release rehearsal is to identify and address potential issues before the actual deployment, ensuring a smooth transition to the new version. This includes testing workflows, validating system interactions, and confirming that all features meet quality standards.",
      Steps: "## Steps\n\n1. **System Validation**\n   - Conduct unit tests for all core modules\n   - Verify compatibility between different components\n   - Ensure performance benchmarks are met\n\n2. **User Scenario Testing**\n   - Simulate common user workflows\n   - Test edge cases for critical paths\n   - Collect feedback from stakeholder reviews\n\n3. **Risk Mitigation Planning**\n   - Document identified risks with mitigation strategies\n   - Schedule remediation tasks for high-impact issues\n   - Assign ownership for each risk item\n\n4. **Deployment Preparation**\n   - Validate environment configurations\n   - Prepare rollback plans for failed scenarios\n   - Confirm dependencies are in place",
      Risks: "## Risks\n\n1. **Integration Failure**\n   - Risk: Components not aligning during deployment\n   - Mitigation: Perform pre-deployment compatibility checks\n   - Scenario: A module fails to integrate with the database\n\n2. **Performance Degradation**\n   - Risk: Exceeding system capacity thresholds\n   - Mitigation: Monitor resource usage in real-time\n   - Scenario: A critical service experiences a 50% response time increase\n\n3. **Data Loss**\n   - Risk: Incomplete data migration during deployment\n   - Mitigation: Implement version control for data files\n   - Scenario: A batch process fails to capture all transaction records"
    } } }));

    expect(result.text).toBe([
      "## Goal",
      "",
      "The primary goal of this release rehearsal is to identify and address potential issues before the actual deployment, ensuring a smooth transition to the new version. This includes testing workflows, validating system interactions, and confirming that all features meet quality standards.",
      "",
      "## Steps",
      "",
      "1. **System Validation**",
      "   - Conduct unit tests for all core modules",
      "   - Verify compatibility between different components",
      "   - Ensure performance benchmarks are met",
      "",
      "2. **User Scenario Testing**",
      "   - Simulate common user workflows",
      "   - Test edge cases for critical paths",
      "   - Collect feedback from stakeholder reviews",
      "",
      "3. **Risk Mitigation Planning**",
      "   - Document identified risks with mitigation strategies",
      "   - Schedule remediation tasks for high-impact issues",
      "   - Assign ownership for each risk item",
      "",
      "4. **Deployment Preparation**",
      "   - Validate environment configurations",
      "   - Prepare rollback plans for failed scenarios",
      "   - Confirm dependencies are in place",
      "",
      "## Risks",
      "",
      "1. **Integration Failure**",
      "   - Risk: Components not aligning during deployment",
      "   - Mitigation: Perform pre-deployment compatibility checks",
      "   - Scenario: A module fails to integrate with the database",
      "",
      "2. **Performance Degradation**",
      "   - Risk: Exceeding system capacity thresholds",
      "   - Mitigation: Monitor resource usage in real-time",
      "   - Scenario: A critical service experiences a 50% response time increase",
      "",
      "3. **Data Loss**",
      "   - Risk: Incomplete data migration during deployment",
      "   - Mitigation: Implement version control for data files",
      "   - Scenario: A batch process fails to capture all transaction records"
    ].join("\n"));
    expect(result.warnings).toContain("已合并模型重复输出的 3 个前置章节标题。");
  });

  it("preserves ordinary section prose and rejects a different heading or a second heading", () => {
    const prepared = prepare();
    expect(prepared).not.toBeNull();
    expect(prepared!.decode(JSON.stringify({ payload: { sections: {
      Goal: "Keep this goal prose.", Steps: "Deploy and verify.", Risks: "Review rollback risks."
    } } })).text).toContain("## Goal\n\nKeep this goal prose.");

    for (const goal of ["## Other\nWrong section.", "## Goal\nValid prose.\n\n## Extra\nUnexpected section."]) {
      expect(() => prepared!.decode(JSON.stringify({ payload: { sections: {
        Goal: goal, Steps: "Deploy and verify.", Risks: "Review rollback risks."
      } } }))).toThrow(/标题/u);
    }
  });
});
