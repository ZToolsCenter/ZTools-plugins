import { describe, expect, it, vi } from "vitest";
import { buildAiTaskRequest } from "../../src/core/ai/aiTaskRequest";
import type { AiTaskRunnerOptions } from "../../src/core/ai/aiTaskRunner";
import { runPlannedAiTaskCore } from "../../src/core/ai/plannedTaskRunnerCore";
import type { AiDocumentSnapshot } from "../../src/types/aiEditing";
import { resolveArtifactHeadingList } from "../../src/core/ai/artifactHeadingListEvidence";

const source = "# Release\n\nExisting context.";
const snapshot: AiDocumentSnapshot = {
  documentId: "multiple-headings.md",
  revision: 1,
  content: source,
  selection: null,
  cursor: source.length,
  readOnly: false
};

function request(userPrompt: string) {
  return buildAiTaskRequest({
    source,
    selected: false,
    action: "custom",
    userPrompt,
    config: { provider: "local", activeRoleId: "general" }
  });
}

function options(invoke: AiTaskRunnerOptions["invoke"]): AiTaskRunnerOptions {
  return { invoke, isCurrent: () => true, abortCurrent: vi.fn() };
}

describe("enumerated Markdown headings", () => {
  it("appends the requested H2 headings separately, in order, without calling a model", async () => {
    const instruction = "按顺序在文末新增两个 H2 标题：迁移观察、后续计划。只需要标题。";
    const invoke = vi.fn<AiTaskRunnerOptions["invoke"]>(async () => {
      throw new Error("Explicit heading labels must be rendered from the instruction.");
    });

    const result = await runPlannedAiTaskCore(request(instruction), snapshot, options(invoke));

    expect(invoke).not.toHaveBeenCalled();
    expect(result.proposal?.patch?.insertText).toBe("\n\n## 迁移观察\n\n## 后续计划");
  });

  it.each([
    ["Append exactly two H3 headings in order: ‘Design, delivery’ and \"Risks, follow-up\". Headings only.", ["Design, delivery", "Risks, follow-up"], 3],
    ["Add these two H2 headings at the end, in order: Compatibility Review, Next Actions. Add headings only.", ["Compatibility Review", "Next Actions"], 2],
    ["文末按顺序新增两个二级标题：“迁移、现状”和‘下一步，计划’，只要标题。", ["迁移、现状", "下一步，计划"], 2]
  ] as const)("keeps quoted commas inside each enumerated heading: %s", async (instruction, labels, level) => {
    const invoke = vi.fn<AiTaskRunnerOptions["invoke"]>(async () => {
      throw new Error("Fully specified heading labels must not need model inference.");
    });

    const result = await runPlannedAiTaskCore(request(instruction), snapshot, options(invoke));

    expect(invoke).not.toHaveBeenCalled();
    expect(result.proposal?.patch?.insertText).toBe(`\n\n${labels.map(label => `${"#".repeat(level)} ${label}`).join("\n\n")}`);
  });

  it("infers the count from an explicit multi-title H3 list with mixed-language quoted labels", async () => {
    const instruction = "文末新增 H3 标题：“API, tools”、“R&D and QA”。只新增标题。";
    const invoke = vi.fn<AiTaskRunnerOptions["invoke"]>(async () => {
      throw new Error("A fully enumerated title list must not need model inference.");
    });

    const result = await runPlannedAiTaskCore(request(instruction), snapshot, options(invoke));

    expect(invoke).not.toHaveBeenCalled();
    expect(result.proposal?.patch?.insertText).toBe("\n\n### API, tools\n\n### R&D and QA");
  });

  it("preserves duplicate heading labels and their order", async () => {
    const instruction = "在文末依次新增两个 H2 标题：状态、状态。只需要标题。";
    const invoke = vi.fn<AiTaskRunnerOptions["invoke"]>(async () => {
      throw new Error("Repeated labels are valid and must be rendered from the instruction.");
    });

    const result = await runPlannedAiTaskCore(request(instruction), snapshot, options(invoke));

    expect(invoke).not.toHaveBeenCalled();
    expect(result.proposal?.patch?.insertText).toBe("\n\n## 状态\n\n## 状态");
  });

  it("keeps a prose task after an enumerated heading list on the generated path", async () => {
    const instruction = "在文末新增两个 H2 标题：迁移观察、后续计划，并分别写一段说明。";
    const invoke = vi.fn<AiTaskRunnerOptions["invoke"]>(async (_prompt, _system, _tokens, _emit, schema) => {
      expect(schema).toMatchObject({
        type: "object",
        properties: { payload: { properties: { sections: { properties: {
          迁移观察: { type: "string" }, 后续计划: { type: "string" }
        } } } } }
      });
      return JSON.stringify({ payload: { sections: { 迁移观察: "记录已确认的迁移范围。", 后续计划: "列出后续验证步骤。" } } });
    });

    const result = await runPlannedAiTaskCore(request(instruction), snapshot, options(invoke));

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(result.proposal?.patch?.insertText).toBe(
      "\n\n## 迁移观察\n\n记录已确认的迁移范围。\n\n## 后续计划\n\n列出后续验证步骤。"
    );
  });

  it("does not guess when the stated heading count conflicts with the enumerated labels", async () => {
    const instruction = "在文末新增两个 H2 标题：迁移观察、后续计划、风险记录。只需要标题。";
    const invoke = vi.fn<AiTaskRunnerOptions["invoke"]>(async () => {
      throw new Error("A count conflict must be clarified before generation.");
    });

    await expect(runPlannedAiTaskCore(request(instruction), snapshot, options(invoke)))
      .rejects.toThrow(/数量与清单不一致/u);

    expect(invoke).not.toHaveBeenCalled();
  });

  it("clarifies conflicting explicit heading levels before generation", async () => {
    const instruction = "Add two H2 and H3 headings: Compatibility, Follow-up. Headings only.";
    const invoke = vi.fn<AiTaskRunnerOptions["invoke"]>(async () => {
      throw new Error("A heading-level conflict must not reach generation.");
    });

    await expect(runPlannedAiTaskCore(request(instruction), snapshot, options(invoke)))
      .rejects.toThrow(/级别不明确/u);

    expect(invoke).not.toHaveBeenCalled();
  });

  it("reports overlong explicit title lists instead of dropping later titles", () => {
    const instruction = "在文末新增 9 个 H2 标题：一、二、三、四、五、六、七、八、九。只需要标题。";

    expect(resolveArtifactHeadingList(instruction)).toMatchObject({
      recognized: true,
      headings: Array(9).fill(expect.objectContaining({ text: expect.any(Object) })),
      issues: ["heading_list_too_long"]
    });
  });

  it("leaves a count-only request for generated title content to the model", async () => {
    const instruction = "在文末新增两个 H2 标题，主题是性能问题。";
    const invoke = vi.fn<AiTaskRunnerOptions["invoke"]>(async () => {
      throw new Error("model-path-sentinel");
    });

    await expect(runPlannedAiTaskCore(request(instruction), snapshot, options(invoke)))
      .rejects.toThrow("model-path-sentinel");

    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it.each([
    "如何新增两个 H2 标题：迁移观察、后续计划？",
    "保留两个 H2 标题：迁移观察、后续计划。",
    "说明 `新增两个 H2 标题：迁移观察、后续计划` 这段语法。",
    ["示例代码：", "```md", "新增两个 H2 标题：迁移观察、后续计划。", "```"].join("\n")
  ])("does not treat questions, preservation, or code examples as title creation: %s", instruction => {
    const parsed = resolveArtifactHeadingList(instruction);

    expect(parsed.recognized).toBe(false);
    expect(parsed.issues).toEqual([]);
  });

  it("does not issue a clarification gate before the user has supplied any literal title list", () => {
    const parsed = resolveArtifactHeadingList("在文末新增两个 H2 标题，主题是性能问题。");

    expect(parsed.recognized).toBe(false);
    expect(parsed.issues).toEqual([]);
    expect(parsed.onlyHeadings).toBe(false);
  });
});
