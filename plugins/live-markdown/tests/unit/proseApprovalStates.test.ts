import { describe, expect, it, vi } from "vitest";
import { runPlannedAiTaskCore } from "../../src/core/ai/plannedTaskRunnerCore";
import { buildAiTaskRequest } from "../../src/core/ai/aiTaskRequest";
import { validateProseReplacementFacts } from "../../src/core/ai/proseEditFactGuard";
import { extractApprovalStateMarkers } from "../../src/core/ai/proseApprovalStates";

describe("English approval-state safeguards", () => {
  it("returns no approval markers when a document has no English approval cue", () => {
    expect(extractApprovalStateMarkers("纯中文正文，没有英文审批状态。\nThe release is ready.".repeat(100)))
      .toEqual([]);
  });

  it("extracts only the supported required, recommended, completed, and pending constructions", () => {
    const examples: Array<[string, string]> = [
      ["Each stage need approval.", "required"],
      ["Each stage needs approval.", "required"],
      ["The team requires approval.", "required"],
      ["The release needs to be approved.", "required"],
      ["The release has to be approved.", "required"],
      ["The release must be approved.", "required"],
      ["The release should be approved.", "recommended"],
      ["The release ought to be approved.", "recommended"],
      ["The release is approved.", "completed"],
      ["The release was approved.", "completed"],
      ["The release has been approved.", "completed"],
      ["The release is already approved.", "completed"],
      ["The release has pending approval.", "pending"],
      ["The release approval is pending.", "pending"],
      ["The release approval pending.", "pending"]
    ];

    for (const [text, state] of examples) {
      expect(extractApprovalStateMarkers(text).map(({ state: value }) => value), text).toEqual([state]);
    }
  });

  it("retains unknown, negated, and conditional approval wording as opaque source evidence", () => {
    const examples = [
      "The release may be approved.",
      "The release can be approved.",
      "The release will be approved.",
      "The release would be approved.",
      "The release could have been approved.",
      "The release may have been approved.",
      "The release will have been approved.",
      "The release might have been approved.",
      "The release would have been approved.",
      "The release must have been approved.",
      "The release shall have been approved.",
      "The release has to have been approved.",
      "The release needs to need approval.",
      "The release should have to be approved.",
      "The release may need approval.",
      "The release might need approval.",
      "The release should need approval.",
      "The release did need approval.",
      "The release will require approval.",
      "Does the release need approval?",
      "Is the release already approved?",
      "If approved, the release can proceed.",
      "When the release is approved, notify the team.",
      "The release does not need approval.",
      "None of the stages needs approval.",
      "The release must not be approved.",
      "The release is not yet approved."
    ];

    for (const text of examples) {
      expect(extractApprovalStateMarkers(text), text).toEqual([
        expect.objectContaining({ state: "opaque", raw: text })
      ]);
    }
  });

  it("keeps multiple approval events in source order", () => {
    expect(extractApprovalStateMarkers("Stage A needs approval; Stage B is approved.")
      .map(({ state }) => state)).toEqual(["required", "completed"]);
  });

  it("consumes supported governing modals without treating them as an outer unknown modal", () => {
    expect(extractApprovalStateMarkers("Stage A should be approved; Stage B must be approved.")
      .map(({ state }) => state)).toEqual(["recommended", "required"]);
    expect(() => validateProseReplacementFacts(
      "Stage A should be approved; Stage B must be approved.",
      "Stage A ought to be approved; Stage B needs to be approved."
    )).not.toThrow();
  });

  it("accepts a source-backed required-approval paraphrase without changing the count", () => {
    const source = "The release have 3 stages, and each stage need approval.";
    const candidate = "The release has 3 stages, and each stage must be approved.";

    expect(() => validateProseReplacementFacts(source, candidate)).not.toThrow();
    expect(candidate.match(/\b3\b/gu)).toEqual(source.match(/\b3\b/gu));
  });

  it("accepts only the supported aliases within each approval-state class", () => {
    const aliases: Array<[string, string]> = [
      ["The release needs approval.", "The release requires approval."],
      ["The release needs approval.", "The release needs to be approved."],
      ["The release has to be approved.", "The release must be approved."],
      ["The release needs approval.", "The release must be approved."],
      ["The release should be approved.", "The release ought to be approved."],
      ["The release is approved.", "The release has been approved."],
      ["The release is already approved.", "The release was approved."],
      ["The release has pending approval.", "The release approval is pending."],
      ["The release has pending approval.", "The release approval pending."]
    ];

    for (const [source, candidate] of aliases) {
      expect(() => validateProseReplacementFacts(source, candidate), `${source} -> ${candidate}`).not.toThrow();
    }
    expect(extractApprovalStateMarkers("The release has pending approval.")).toHaveLength(1);
  });

  it("does not let a completed approval become a new requirement", () => {
    expect(() => validateProseReplacementFacts(
      "The release is already approved.",
      "The release must be approved."
    )).toThrow();
    expect(() => validateProseReplacementFacts(
      "The release is already approved.",
      "The release needs approval."
    )).toThrow();
  });

  it("keeps required, recommended, completed, and pending approval states distinct", () => {
    const changedStates: Array<[string, string]> = [
      ["The release must be approved.", "The release should be approved."],
      ["The release is approved.", "The release must be approved."],
      ["The release has pending approval.", "The release needs approval."]
    ];

    for (const [source, candidate] of changedStates) {
      expect(() => validateProseReplacementFacts(source, candidate)).toThrow();
      expect(() => validateProseReplacementFacts(candidate, source)).toThrow();
    }
  });

  it("does not treat unsupported modals, conditions, or negated approval as completed states", () => {
    const ambiguousPairs: Array<[string, string]> = [
      ["The release may be approved.", "The release is approved."],
      ["The release can be approved.", "The release is approved."],
      ["The release will be approved.", "The release is approved."],
      ["The release would be approved.", "The release is approved."],
      ["If approved, the release can proceed.", "The release is approved."],
      ["When the release is approved, notify the team.", "The release is approved."],
      ["The release does not need approval.", "The release must not be approved."],
      ["The release could have been approved.", "The release has been approved."],
      ["The release has to have been approved.", "The release has been approved."],
      ["The release needs to need approval.", "The release needs approval."],
      ["The release should have to be approved.", "The release has to be approved."],
      ["The release did need approval.", "The release needs approval."]
    ];

    for (const [source, candidate] of ambiguousPairs) {
      expect(() => validateProseReplacementFacts(source, candidate)).toThrow();
      expect(() => validateProseReplacementFacts(candidate, source)).toThrow();
    }

    expect(() => validateProseReplacementFacts(
      "The release is not yet approved.",
      "The release is already approved."
    )).toThrow();
    expect(() => validateProseReplacementFacts(
      "The release is already approved.",
      "The release is not yet approved."
    )).toThrow();
  });

  it("preserves order when a sentence contains multiple approval states", () => {
    expect(() => validateProseReplacementFacts(
      "Stage A needs approval; Stage B is approved.",
      "Stage A is approved; Stage B needs approval."
    )).toThrow();
  });

  it("applies the same state comparison when read-only context completes a split phrase", () => {
    expect(() => validateProseReplacementFacts("has been", "must be", {
      contextBefore: "The release ",
      contextAfter: " approved."
    })).toThrow();
  });

  it("keeps the original Chinese status and action checks active", () => {
    expect(() => validateProseReplacementFacts("验收通过。", "验收失败。")).toThrow();
    expect(() => validateProseReplacementFacts("请完成校对后再导出。", "请做完校对后再导出。"))
      .not.toThrow();
  });

  it("returns a real rewrite proposal through the planned-task runner with the frozen R28 request tuple", async () => {
    const source = "The release have 3 stages, and each stage need approval.";
    const instruction = "润色并纠正可读正文的语法错误，保留已有 Markdown 格式、代码、链接目标、公式和数字不变。";
    const raw = "The release has 3 stages, and each stage must be approved.";
    const request = buildAiTaskRequest({
      source,
      selected: false,
      action: "polish",
      userPrompt: instruction,
      config: {
        provider: "local",
        activeRoleId: "general",
        executionPolicy: "thin",
        model: "Qwen3-0.6B-Q4_K_M.gguf"
      }
    });
    const snapshot = {
      documentId: "r28-light-B32-POL-NUMBER.md",
      revision: 1,
      content: source,
      selection: null,
      cursor: null,
      selectionValid: true,
      readOnly: false
    };
    const invoke = vi.fn(async () => raw);

    const result = await runPlannedAiTaskCore(request, snapshot, {
      invoke,
      isCurrent: () => true,
      abortCurrent() {}
    });

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(result.proposal?.patch?.expectedText).toBe(source);
    expect(result.proposal?.patch?.insertText).toBe(raw);
    expect(result.proposal?.patch?.insertText.match(/\b3\b/gu)).toEqual(["3"]);
    expect(snapshot.content).toBe(source);
  });
});
