import { describe, expect, it, vi } from "vitest";
import { buildSummaryCandidates } from "../../src/core/ai/summaryFactLedger";
import { resolveGenerationRequirements } from "../../src/core/ai/generationRequirements";
import { runGroundedGeneration } from "../../src/core/ai/groundedGeneration";
import type { AiInvocationLimits, AiTaskExecution } from "../../src/core/ai/aiTaskExecution";
import type { IntentTask } from "../../src/core/ai/intentTypes";

function execution(response: string) {
  const invoke = vi.fn(async (_prompt: string, _systemPrompt: string, _maxTokens: number, _limits?: AiInvocationLimits) => response);
  const value: AiTaskExecution = { remainingCalls: 8, assertRunning: vi.fn(), invoke };
  return { value, invoke };
}

function facts(source: string) {
  return buildSummaryCandidates(source, { index: 0, text: source, ownedRange: { from: 0, to: source.length } });
}

describe("runGroundedGeneration", () => {
  it("returns null only for tasks outside the evidence-bound generation contract", async () => {
    const runner = execution("{}");
    expect(await runGroundedGeneration({
      source: "source", instruction: "polish", systemPrompt: "system", task: "polish",
      requirements: resolveGenerationRequirements("polish", "polish")
    }, runner.value)).toBeNull();
    expect(runner.invoke).not.toHaveBeenCalled();
  });

  it("fails closed for source-bound technical specs without explicit section headings", async () => {
    const instruction = "严格依据原文整理技术方案，不新增事实。";
    const runner = execution("{}");
    await expect(runGroundedGeneration({
      source: "现有设备仅 8GB 内存。", instruction, systemPrompt: "system", task: "tech-spec",
      requirements: resolveGenerationRequirements(instruction, "tech-spec")
    }, runner.value)).rejects.toThrow(/标题/u);
    expect(runner.invoke).not.toHaveBeenCalled();
  });

  it("renders source-bound technical-plan headings from validated source fact IDs only", async () => {
    const source = "# Orion\n\nOrion 项目由林安负责，目标是在离线环境处理 Markdown。\n\n设备内存只有 8GB。\n\n风险是内存不足与模型输出失真。";
    const candidates = facts(source);
    const target = candidates.find(({ quote }) => quote.includes("目标"))!;
    const plan = candidates.find(({ quote }) => quote.includes("8GB"))!;
    const risk = candidates.find(({ quote }) => quote.includes("风险"))!;
    const instruction = "在全文末尾生成技术方案，使用目标、方案、风险三个 Markdown 标题。严格基于原文事实与约束。";
    const requirements = resolveGenerationRequirements(instruction, "tech-spec");
    const runner = execution(JSON.stringify({ sections: [
      { heading: "目标", evidenceIds: [target.id] },
      { heading: "方案", evidenceIds: [target.id, plan.id] },
      { heading: "风险", evidenceIds: [risk.id] }
    ] }));
    const result = await runGroundedGeneration({ source, instruction, systemPrompt: "base", task: "tech-spec", requirements }, runner.value);
    expect(result).toEqual({
      text: `## 目标\n\n> ${target.quote}\n\n## 方案\n\n> ${target.quote}\n\n> ${plan.quote}\n\n## 风险\n\n> ${risk.quote}`,
      sourceFacts: [target.quote, plan.quote, risk.quote],
      outputMode: "summary",
      factPolicy: "source_bound"
    });
    expect(runner.invoke).toHaveBeenCalledTimes(1);
    expect(runner.invoke.mock.calls[0][3]).toEqual(expect.objectContaining({ outputSchema: expect.any(Object), silent: true }));
  });

  it("keeps project identity, goal, risk, and privacy constraints in the H14 technical plan", async () => {
    const source = "## 已确认条件\n\n项目代号为雾港。需要在离线环境整理 Markdown。设备可用内存为 6GB。文稿不得发送到外部。未指定模型品牌、设备型号或上线日期。主要风险是内存不足和输出失真。";
    const candidates = facts(source);
    const goal = candidates.find(({ quote }) => quote.includes("离线"))!;
    const identity = candidates.find(({ quote }) => quote.includes("雾港"))!;
    const capacity = candidates.find(({ quote }) => quote.includes("6GB"))!;
    const privacy = candidates.find(({ quote }) => quote.includes("不得发送到外部"))!;
    const unspecified = candidates.find(({ quote }) => quote.includes("未指定"))!;
    const risk = candidates.find(({ quote }) => quote.includes("主要风险"))!;
    const instruction = "严格依据原文整理技术方案，包含目标、方案、风险；保留 6GB、离线和不外发约束。不要新增品牌、型号、负责人或日期。";
    const requirements = resolveGenerationRequirements(instruction, "tech-spec");
    expect(requirements.requiredHeadings.map(({ text }) => text)).toEqual(["目标", "方案", "风险"]);
    const runner = execution(JSON.stringify({ sections: [
      { heading: "目标", evidenceIds: [goal.id, identity.id] },
      { heading: "方案", evidenceIds: [goal.id] },
      { heading: "风险", evidenceIds: [capacity.id, privacy.id, unspecified.id, risk.id] }
    ] }));
    const result = await runGroundedGeneration({ source, instruction, systemPrompt: "base", task: "tech-spec", requirements }, runner.value);
    for (const value of ["雾港", "6GB", "离线", "不得发送到外部", "内存不足", "输出失真"]) expect(result?.text).toContain(value);
    expect(result?.text).not.toMatch(/新品牌|新型号|负责人.*王|2027/u);
    expect(result?.sourceFacts).toEqual(expect.arrayContaining([identity.quote, capacity.quote, goal.quote, privacy.quote, risk.quote]));

    for (const omittedId of [goal.id, privacy.id, risk.id]) {
      const incomplete = execution(JSON.stringify({ sections: [
        { heading: "目标", evidenceIds: [goal.id, identity.id].filter((id) => id !== omittedId) },
        { heading: "方案", evidenceIds: [goal.id].filter((id) => id !== omittedId) },
        { heading: "风险", evidenceIds: [capacity.id, privacy.id, unspecified.id, risk.id].filter((id) => id !== omittedId) }
      ] }));
      await expect(runGroundedGeneration({ source, instruction, systemPrompt: "base", task: "tech-spec", requirements }, incomplete.value)).rejects.toThrow();
    }
  });

  it("rejects missing source-required facts or model-authored facts in strict plans", async () => {
    const source = "由林安负责，目标为离线处理 Markdown。预算是 9 万元。风险是内存不足。";
    const candidates = facts(source);
    const target = candidates.find(({ quote }) => quote.includes("目标"))!;
    const risk = candidates.find(({ quote }) => quote.includes("风险"))!;
    const instruction = "生成技术方案，使用目标、方案、风险三个 Markdown 标题。严格基于原文事实。";
    const request = { source, instruction, systemPrompt: "base", task: "tech-spec" as IntentTask, requirements: resolveGenerationRequirements(instruction, "tech-spec") };
    const missing = execution(JSON.stringify({ sections: [
      { heading: "目标", evidenceIds: [target.id] }, { heading: "方案", evidenceIds: [target.id] }, { heading: "风险", evidenceIds: [risk.id] }
    ] }));
    await expect(runGroundedGeneration(request, missing.value)).rejects.toThrow(/required|必需|来源|事实/u);
    const unknown = execution(JSON.stringify({ sections: [
      { heading: "目标", evidenceIds: ["invented"] }, { heading: "方案", evidenceIds: [target.id] }, { heading: "风险", evidenceIds: [risk.id] }
    ] }));
    await expect(runGroundedGeneration(request, unknown.value)).rejects.toThrow();
  });

  it("binds continuation proposals to source evidence and prevents invented numbers, dates, and named entities", async () => {
    const source = "Orion 项目由林安负责。预算是 9 万元。计划在 2026-11-12 发布。发布前必须完成备份与恢复演练。";
    const candidates = facts(source);
    const action = candidates.find(({ quote }) => quote.includes("备份"))!;
    const instruction = "在文末续写一个下一步行动段落，沿用本文项目事实，提出发布前的具体检查事项。不要重复原文或杜撰数字与日期。";
    const request = { source, instruction, systemPrompt: "base", task: "continue" as IntentTask, requirements: resolveGenerationRequirements(instruction, "continue") };
    const valid = execution(JSON.stringify({ suggestions: [{ action: "验证", evidenceIds: [action.id] }] }));
    expect(await runGroundedGeneration(request, valid.value)).toMatchObject({
      text: "- 建议验证：先检查该事项的前置条件，再验证实际结果是否满足要求，保留结果证据并记录异常。\n依据摘录：完成备份与恢复演练",
      sourceFacts: [action.quote],
      outputMode: "grounded_actions", factPolicy: "allow_suggestions"
    });
    const schema = valid.invoke.mock.calls[0][3]?.outputSchema as { properties: { suggestions: { items: { properties: Record<string, unknown> } } } };
    expect(schema.properties.suggestions.items.properties).toHaveProperty("action");
    expect(schema.properties.suggestions.items.properties).not.toHaveProperty("text");

    for (const text of ["发布前应检查备份，并在 2027-01-01 发布。", "蓝海项目应检查备份并验证恢复演练。"] ) {
      const invalid = execution(JSON.stringify({ suggestions: [{ action: "验证", evidenceIds: [action.id], text }] }));
      await expect(runGroundedGeneration(request, invalid.value)).rejects.toThrow();
    }
  });

  it("rejects free-text model, brand, and owner claims when the source leaves them unspecified", async () => {
    const source = "当前未指定模型品牌、设备型号或负责人。";
    const candidate = facts(source)[0];
    const instruction = "在文末续写下一步行动，沿用本文项目事实，提出具体检查事项。不要杜撰数字与日期。";
    const request = { source, instruction, systemPrompt: "base", task: "continue" as IntentTask, requirements: resolveGenerationRequirements(instruction, "continue") };
    for (const text of [
      "建议采用 TinyBERT 模型进行部署。",
      "建议使用通义千问模型进行部署。",
      "建议让王敏担任负责人，推进模型选型。"
    ]) {
      const invalid = execution(JSON.stringify({ suggestions: [{ action: "验证", evidenceIds: [candidate.id], text }] }));
      await expect(runGroundedGeneration(request, invalid.value)).rejects.toThrow(/字段无效/u);
    }

    const sourceBacked = "项目采用 TinyBERT 模型。王敏负责部署。该计划仅处理离线 Markdown 文稿，并保持原始数据与网络访问隔离。";
    const sourceBackedFacts = facts(sourceBacked);
    const model = sourceBackedFacts.find(({ quote }) => quote.includes("TinyBERT"))!;
    const owner = sourceBackedFacts.find(({ quote }) => quote.includes("王敏"))!;
    const supported = execution(JSON.stringify({ suggestions: [
      { action: "核对", evidenceIds: [model.id] }, { action: "记录", evidenceIds: [owner.id] }
    ] }));
    await expect(runGroundedGeneration({ ...request, source: sourceBacked }, supported.value)).resolves.toMatchObject({
      text: "- 建议核对：将该事项拆成检查点，逐项核对前置条件、实际结果与完成证据，并记录未满足项。\n依据摘录：项目采用…\n\n- 建议记录：记录该事项的检查范围、执行证据和结果，并标记未完成或待确认项。\n依据摘录：王敏负责…",
      sourceFacts: [model.quote, owner.quote], factPolicy: "allow_suggestions"
    });
  });

  it("does not prescribe an exercise when the cited source only contains identity, amount, or owner facts", async () => {
    const source = "项目代号为雾港。预算为 9 万元。负责人未指定。";
    const candidate = facts(source).find(({ quote }) => quote.includes("雾港"))!;
    const instruction = "续写一段后续行动建议，沿用本文事实；不要编造日期、金额或负责人。";
    const runner = execution(JSON.stringify({ suggestions: [{ action: "演练", evidenceIds: [candidate.id] }] }));
    await expect(runGroundedGeneration({
      source, instruction, systemPrompt: "base", task: "continue", requirements: resolveGenerationRequirements(instruction, "continue")
    }, runner.value)).rejects.toThrow(/行动类型与所引用事实不匹配/u);
    expect(runner.invoke).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed grounded JSON instead of handing it back for free generation", async () => {
    const source = "发布前必须完成备份与恢复演练。";
    const instruction = "在文末续写下一步行动，沿用本文项目事实，提出具体检查事项。不要杜撰数字与日期。";
    const runner = execution("not json");
    await expect(runGroundedGeneration({ source, instruction, systemPrompt: "base", task: "continue", requirements: resolveGenerationRequirements(instruction, "continue") }, runner.value)).rejects.toThrow(/JSON/u);
    expect(runner.invoke).toHaveBeenCalledTimes(1);
  });

  it("does not let a continuation model turn an unfinished source fact into a completion claim", async () => {
    const source = "恢复演练尚未完成。";
    const candidate = facts(source)[0];
    const instruction = "在文末续写下一步行动，沿用本文项目事实，提出具体检查事项。不要杜撰数字与日期。";
    const freeText = execution(JSON.stringify({ suggestions: [{ action: "验证", evidenceIds: [candidate.id], text: "恢复演练已经完成，建议直接上线。" }] }));
    await expect(runGroundedGeneration({
      source, instruction, systemPrompt: "base", task: "continue", requirements: resolveGenerationRequirements(instruction, "continue")
    }, freeText.value)).rejects.toThrow();
    const safe = execution(JSON.stringify({ suggestions: [{ action: "核对", evidenceIds: [candidate.id] }] }));
    const result = await runGroundedGeneration({
      source, instruction, systemPrompt: "base", task: "continue", requirements: resolveGenerationRequirements(instruction, "continue")
    }, safe.value);
    expect(result?.text).toBe("- 建议核对：将该事项拆成检查点，逐项核对前置条件、实际结果与完成证据，并记录未满足项。\n依据摘录：恢复演练尚…");
    expect(result?.text).not.toMatch(/已经完成|直接上线/u);
  });
});
