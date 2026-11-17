import { describe, expect, it, vi } from "vitest";
import { buildSummaryCandidates } from "../../src/core/ai/summaryFactLedger";
import { runAiTask, type AiTaskRunnerOptions } from "../../src/core/ai/aiTaskRunner";
// Retained full-policy regression; default thin behavior has separate production-entry tests.
import { runFullHarnessTaskCore as runPlannedAiTask } from "../../src/core/ai/fullHarnessTaskRunnerCore";
import type { AiDocumentSnapshot } from "../../src/types/aiEditing";

const instruction = "严格依据原文整理技术方案，包含目标、方案、风险；保留 6GB、离线和不外发约束。不要新增品牌、型号、负责人或日期。";
const source = "## 已确认条件\n\n项目代号为雾港。需要在离线环境整理 Markdown。设备可用内存为 6GB。文稿不得发送到外部。未指定模型品牌、设备型号或上线日期。主要风险是内存不足和输出失真。";

function snapshot(): AiDocumentSnapshot {
  return { documentId: "h14.md", revision: 1, content: source, selection: null, cursor: null, readOnly: false };
}

function invokeWith(...outputs: string[]): AiTaskRunnerOptions["invoke"] {
  const queue = [...outputs];
  return vi.fn(async (prompt: string) => {
    if (prompt.includes("本次用户指令：")) return JSON.stringify({
      version: 1, kind: "edit", operation: "rewrite", target: "document", content: { mode: "generate", task: "tech-spec" }
    });
    const next = queue.shift();
    if (next === undefined) throw new Error("unexpected model call");
    return next;
  });
}

function invokeSingle(output: string): AiTaskRunnerOptions["invoke"] {
  return vi.fn(async () => output);
}

type JsonSchema = Record<string, unknown>;
function suggestionSchemaParts(schema?: JsonSchema) {
  const rootProperties = schema?.properties as JsonSchema | undefined;
  const suggestions = rootProperties?.suggestions as JsonSchema | undefined;
  const item = suggestions?.items as JsonSchema | undefined;
  const itemProperties = item?.properties as JsonSchema | undefined;
  const evidenceIds = itemProperties?.evidenceIds as JsonSchema | undefined;
  const evidenceItem = evidenceIds?.items as JsonSchema | undefined;
  return { suggestions, evidenceEnum: evidenceItem?.enum as string[] | undefined };
}

describe("source-bound technical plans through the public runner", () => {
  it("rejects free Markdown for a whole-document H14 rewrite instead of proposing unsupported methods", async () => {
    const unsupported = "## 目标\n\n在离线环境整理 Markdown。\n\n## 方案\n\n采用 USB 设备并通过压缩处理文稿。\n\n## 风险\n\n主要风险是内存不足和输出失真。";
    const invoke = invokeWith(unsupported);
    const request = {
      source, action: "custom" as const, userPrompt: instruction, baseSystemPrompt: "只按来源事实生成。",
      actionDefinition: { id: "custom" as const, label: "自定义", prompt: instruction }
    };

    await expect(runPlannedAiTask(request, snapshot(), { invoke, isCurrent: () => true, abortCurrent: vi.fn() }))
      .rejects.toThrow(/JSON/u);
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("accepts section IDs while retaining the project's identity and every stated constraint", async () => {
    const candidates = buildSummaryCandidates(source, { index: 0, text: source, ownedRange: { from: 0, to: source.length } });
    const fact = (marker: string) => candidates.find(({ quote }) => quote.includes(marker))!;
    const identity = fact("雾港");
    const goal = fact("离线环境");
    const capacity = fact("6GB");
    const privacy = fact("不得发送到外部");
    const unspecified = fact("未指定");
    const risk = fact("主要风险");
    const grounded = JSON.stringify({ sections: [
      { heading: "目标", evidenceIds: [goal.id, identity.id] },
      { heading: "方案", evidenceIds: [goal.id, capacity.id] },
      { heading: "风险", evidenceIds: [privacy.id, unspecified.id, risk.id] }
    ] });
    const invoke = invokeWith(grounded);
    const request = {
      source, action: "custom" as const, userPrompt: instruction, baseSystemPrompt: "只按来源事实生成。",
      actionDefinition: { id: "custom" as const, label: "自定义", prompt: instruction }
    };

    const result = await runPlannedAiTask(request, snapshot(), { invoke, isCurrent: () => true, abortCurrent: vi.fn() });

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(result.proposal?.patch).toMatchObject({ from: 0, to: source.length, expectedText: source });
    for (const value of ["雾港", "6GB", "离线", "不得发送到外部", "内存不足", "输出失真"]) expect(result.text).toContain(value);
    expect(result.text).not.toMatch(/USB|压缩处理/u);
  });

  it("uses grounded action selection for continuation even when the request is not read-only", async () => {
    const continuationSource = "发布前必须完成备份与恢复演练。";
    const candidate = buildSummaryCandidates(continuationSource, {
      index: 0, text: continuationSource, ownedRange: { from: 0, to: continuationSource.length }
    })[0];
    const continuation = "在文末续写下一步行动，沿用本文事实，提出具体检查事项。不要杜撰数字与日期。";
    const invoke = invokeWith(JSON.stringify({ suggestions: [{ action: "验证", evidenceIds: [candidate.id] }] }));
    const request = {
      source: continuationSource, action: "continue" as const, userPrompt: continuation,
      baseSystemPrompt: "只根据来源事实。", intentPlanned: true,
      actionDefinition: { id: "continue" as const, label: "续写", prompt: continuation }
    };

    const result = await runPlannedAiTask(request, {
      documentId: "continue.md", revision: 1, content: continuationSource, selection: null, cursor: null, readOnly: false
    }, { invoke, isCurrent: () => true, abortCurrent: vi.fn() });

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(result.text).toBe("- 建议验证：先检查该事项的前置条件，再验证实际结果是否满足要求，保留结果证据并记录异常。\n依据摘录：完成备份与恢复演练");
    expect(result.outputMode).toBe("grounded_actions");
  });

  it("turns an evidence-bound continuation into concrete checklist steps instead of quoting the source as the whole action", async () => {
    const continuationSource = "发布前必须完成备份与恢复演练。";
    const candidate = buildSummaryCandidates(continuationSource, {
      index: 0, text: continuationSource, ownedRange: { from: 0, to: continuationSource.length }
    })[0];
    const continuation = "在文末续写一个下一步行动段落，沿用本文项目事实，提出发布前的具体检查事项。不要重复原文或杜撰数字与日期。";
    const invoke = invokeSingle(JSON.stringify({ suggestions: [{ action: "验证", evidenceIds: [candidate.id] }] }));
    const result = await runAiTask({
      source: continuationSource, action: "continue", userPrompt: continuation, baseSystemPrompt: "只根据来源事实。",
      actionDefinition: { id: "continue", label: "续写", prompt: continuation }
    }, { invoke, isCurrent: () => true, abortCurrent: vi.fn() });

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(result.text).toBe("- 建议验证：先检查该事项的前置条件，再验证实际结果是否满足要求，保留结果证据并记录异常。\n依据摘录：完成备份与恢复演练");
    expect(result.text).toContain("保留结果证据并记录异常");
    expect(result.text).not.toBe(`- 核对以下原文事项：\n> ${continuationSource}`);
    expect(result.sourceFacts).toEqual([continuationSource]);
    expect(result.outputMode).toBe("grounded_actions");
  });

  it("allows checklist citations to cover the complete source while keeping their rendered text concise", async () => {
    const continuationSource = "发布前应完成构建检查。上线后应记录实际结果。";
    const candidates = buildSummaryCandidates(continuationSource, {
      index: 0, text: continuationSource, ownedRange: { from: 0, to: continuationSource.length }
    });
    expect(candidates).toHaveLength(2);
    const continuation = "在文末续写后续行动建议，沿用本文事实，提出具体检查事项。不要重复原文或杜撰数字与日期。";
    const invoke = invokeSingle(JSON.stringify({ suggestions: [
      { action: "核对", evidenceIds: [candidates[0].id] },
      { action: "记录", evidenceIds: [candidates[1].id] }
    ] }));
    const result = await runAiTask({
      source: continuationSource, action: "continue", userPrompt: continuation, baseSystemPrompt: "只根据来源事实。",
      actionDefinition: { id: "continue", label: "续写", prompt: continuation }
    }, { invoke, isCurrent: () => true, abortCurrent: vi.fn() });

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(result.sourceFacts).toEqual(candidates.map(({ quote }) => quote));
    expect(result.text).not.toContain(continuationSource);
    expect(result.text).toContain("前置条件");
    expect(result.text).toContain("执行证据和结果");
    expect(result.text).toContain("依据摘录：");
    expect(result.outputMode).toBe("grounded_actions");
  });

  it("keeps the required action and object visible in compact public-runner citations", async () => {
    const cases = [
      {
        fact: "下一步应核对依赖清单、安排双人复核并记录结果。",
        action: "核对",
        citation: "依据摘录：核对依赖清单、安排双人复核并记录结果"
      },
      {
        fact: "发布前必须完成备份与恢复演练。",
        action: "验证",
        citation: "依据摘录：完成备份与恢复演练"
      },
      {
        fact: "下一步应检查已完成的备份结果。",
        action: "核对",
        citation: "依据摘录：检查已完成的备份结果"
      }
    ] as const;

    for (const { fact, action, citation } of cases) {
      const source = `${fact}项目代号为雾港。发布时间尚未确定。已完成本轮构建。`;
      const candidates = buildSummaryCandidates(source, {
        index: 0, text: source, ownedRange: { from: 0, to: source.length }
      });
      const candidate = candidates.find(({ quote }) => quote === fact)!;
      let schemaSeen: JsonSchema | undefined;
      const invoke = vi.fn<AiTaskRunnerOptions["invoke"]>(async (_prompt, _system, _max, _emit, schema) => {
        schemaSeen = schema;
        return JSON.stringify({ suggestions: [{ action, evidenceIds: [candidate.id] }] });
      });
      const instruction = "在文末提出下一步检查建议，沿用原文事实，不要杜撰。";
      const result = await runAiTask({
        source, action: "continue", userPrompt: instruction, baseSystemPrompt: "只根据来源事实。",
        actionDefinition: { id: "continue", label: "续写", prompt: instruction }
      }, { invoke, isCurrent: () => true, abortCurrent: vi.fn() });

      expect(invoke).toHaveBeenCalledTimes(1);
      expect(suggestionSchemaParts(schemaSeen)).toMatchObject({
        suggestions: { minItems: 1, maxItems: 1 }, evidenceEnum: [candidate.id]
      });
      expect(result.text).toContain(citation);
      expect(result.text).not.toContain(fact);
      expect(result.sourceFacts).toEqual([fact]);
      expect(result.outputMode).toBe("grounded_actions");
    }
  });

  it("rejects a background-only model choice when an explicit source action is required", async () => {
    const requiredFact = "下一步应核对依赖清单、安排双人复核并记录结果。";
    const source = `${requiredFact}项目代号为雾港。发布时间尚未确定。已完成本轮构建。`;
    const candidates = buildSummaryCandidates(source, { index: 0, text: source, ownedRange: { from: 0, to: source.length } });
    const background = candidates.find(({ quote }) => quote.includes("雾港"))!;
    const invoke = invokeSingle(JSON.stringify({ suggestions: [{ action: "记录", evidenceIds: [background.id] }] }));
    const instruction = "在文末提出下一步检查建议，沿用原文事实，不要杜撰。";

    await expect(runAiTask({
      source, action: "continue", userPrompt: instruction, baseSystemPrompt: "只根据来源事实。",
      actionDefinition: { id: "continue", label: "续写", prompt: instruction }
    }, { invoke, isCurrent: () => true, abortCurrent: vi.fn() })).rejects.toThrow(/来源明确待办|来源待办/u);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("requires each explicit pending action exactly once and accepts the complete set", async () => {
    const first = "下一步应核对依赖清单、安排双人复核并记录结果。";
    const second = "恢复演练尚未完成，但仍需验证恢复流程。";
    const source = `${first}${second}项目代号为雾港。`;
    const candidates = buildSummaryCandidates(source, { index: 0, text: source, ownedRange: { from: 0, to: source.length } });
    const firstCandidate = candidates.find(({ quote }) => quote === first)!;
    const secondCandidate = candidates.find(({ quote }) => quote === second)!;
    const instruction = "在文末提出下一步检查建议，沿用原文事实，不要杜撰。";
    let schemaSeen: JsonSchema | undefined;
    const invoke = vi.fn<AiTaskRunnerOptions["invoke"]>(async (_prompt, _system, _max, _emit, schema) => {
      schemaSeen = schema;
      return JSON.stringify({ suggestions: [
        { action: "核对", evidenceIds: [firstCandidate.id] },
        { action: "验证", evidenceIds: [secondCandidate.id] }
      ] });
    });
    const result = await runAiTask({
      source, action: "continue", userPrompt: instruction, baseSystemPrompt: "只根据来源事实。",
      actionDefinition: { id: "continue", label: "续写", prompt: instruction }
    }, { invoke, isCurrent: () => true, abortCurrent: vi.fn() });

    expect(suggestionSchemaParts(schemaSeen)).toMatchObject({
      suggestions: { minItems: 2, maxItems: 2 }, evidenceEnum: [firstCandidate.id, secondCandidate.id]
    });
    expect(result.sourceFacts).toEqual([first, second]);
    expect(result.text).toContain("核对依赖清单、安排双人复核并记录结果");
    expect(result.text).toContain("验证恢复流程");
  });

  it("rejects duplicate or omitted required action evidence instead of returning a partial plan", async () => {
    const first = "下一步应核对依赖清单。";
    const second = "后续必须安排双人复核。";
    const source = `${first}${second}`;
    const candidates = buildSummaryCandidates(source, { index: 0, text: source, ownedRange: { from: 0, to: source.length } });
    const firstCandidate = candidates.find(({ quote }) => quote === first)!;
    const secondCandidate = candidates.find(({ quote }) => quote === second)!;
    const instruction = "在文末提出下一步检查建议，沿用原文事实，不要杜撰。";
    const request = {
      source, action: "continue" as const, userPrompt: instruction, baseSystemPrompt: "只根据来源事实。",
      actionDefinition: { id: "continue" as const, label: "续写", prompt: instruction }
    };
    for (const suggestions of [
      [
        { action: "核对", evidenceIds: [firstCandidate.id] },
        { action: "复核", evidenceIds: [firstCandidate.id] }
      ],
      [{ action: "核对", evidenceIds: [firstCandidate.id] }]
    ]) {
      const invoke = invokeSingle(JSON.stringify({ suggestions }));
      await expect(runAiTask(request, { invoke, isCurrent: () => true, abortCurrent: vi.fn() }))
        .rejects.toThrow(/来源明确待办|来源待办/u);
      expect(invoke).toHaveBeenCalledTimes(1);
    }
    expect(secondCandidate.id).not.toBe(firstCandidate.id);
  });

  it("rejects more than twelve explicit source actions before calling the model", async () => {
    const source = Array.from({ length: 13 }, (_, index) => `下一步应核对项目${index + 1}清单。`).join("");
    const instruction = "在文末提出下一步检查建议，沿用原文事实，不要杜撰。";
    const invoke = invokeSingle(JSON.stringify({ suggestions: [] }));

    await expect(runAiTask({
      source, action: "continue", userPrompt: instruction, baseSystemPrompt: "只根据来源事实。",
      actionDefinition: { id: "continue", label: "续写", prompt: instruction }
    }, { invoke, isCurrent: () => true, abortCurrent: vi.fn() })).rejects.toThrow(/来源明确待办超过12条/u);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("does not invent unselected required facts while rendering a grounded suggestion", async () => {
    const source = "不需要验证远端服务。不得执行部署。项目代号为雾港。预算为9万元。已完成构建检查。下一步检查已经完成。发布时间尚未确定。";
    const candidates = buildSummaryCandidates(source, { index: 0, text: source, ownedRange: { from: 0, to: source.length } });
    const candidate = candidates.find(({ quote }) => quote.includes("雾港"))!;
    const instruction = "在文末提出下一步检查建议，沿用原文事实，不要杜撰。";
    let schemaSeen: JsonSchema | undefined;
    const invoke = vi.fn<AiTaskRunnerOptions["invoke"]>(async (_prompt, _system, _max, _emit, schema) => {
      schemaSeen = schema;
      return JSON.stringify({ suggestions: [{ action: "记录", evidenceIds: [candidate.id] }] });
    });
    const result = await runAiTask({
      source, action: "continue", userPrompt: instruction, baseSystemPrompt: "只根据来源事实。",
      actionDefinition: { id: "continue", label: "续写", prompt: instruction }
    }, { invoke, isCurrent: () => true, abortCurrent: vi.fn() });

    expect(suggestionSchemaParts(schemaSeen)).toMatchObject({
      suggestions: { minItems: 1, maxItems: 12 }, evidenceEnum: candidates.map(({ id }) => id)
    });
    expect(result.sourceFacts).toEqual([candidate.quote]);
    expect(result.text).not.toMatch(/验证远端服务|执行部署|核对项目/u);
  });
});
