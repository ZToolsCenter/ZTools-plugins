import { describe, expect, it } from "vitest";
import { prepareArtifactFill } from "../../src/core/ai/artifactFill";
import { resolveArtifactSpec } from "../../src/core/ai/artifactSpecFromInstruction";
import { resolveGenerationRequirements } from "../../src/core/ai/generationRequirements";

const instruction = "在文末写一份 rollout 草案，按顺序用小标题 Goal、Steps、Risks 组织；不指定标题级别。";
function prepare(text = instruction, source?: string) {
  const requirements = resolveGenerationRequirements(text, "custom");
  const spec = resolveArtifactSpec(text, requirements, { effect: "edit", operation: "insert" });
  return prepareArtifactFill({ instruction: text, requirements, spec, source })!;
}

describe("artifact content regressions from B31 model receipts", () => {
  it("does not accept a copied task sentence as a finished section", () => {
    const raw = JSON.stringify({ payload: { sections: {
      Goal: instruction, Steps: "先小流量验证，再逐步放量。", Risks: "异常时暂停放量并回滚。"
    } } });
    expect(() => prepare().decode(raw)).toThrow(/正文|指令|完成/u);
  });

  it.each(["…", "...", "待补充", "TODO"])("does not count standalone placeholder %s as drafted content", placeholder => {
    const raw = JSON.stringify({ payload: { sections: {
      Goal: "验证变更可以逐步上线。", Steps: placeholder, Risks: "异常时回滚。"
    } } });
    expect(() => prepare().decode(raw)).toThrow(/正文|占位|完成/u);
  });

  it("keeps literal ellipsis and TODO inside meaningful technical prose", () => {
    const raw = JSON.stringify({ payload: { sections: {
      Goal: "确认加载中的省略号 … 会在完成后消失。", Steps: "检查代码中的 TODO 列表，再执行分批发布。", Risks: "未验证的配置可能阻止发布。"
    } } });
    expect(prepare().decode(raw).text).toContain("代码中的 TODO 列表");
  });

  it("preserves the currency in a source-derived price row instead of accepting a bare number", () => {
    const text = "根据原文生成两列表格，列名 Product、Price；仅列 Cedar 10 yuan 和 Maple 20 yuan，价格必须分别对应原文。";
    const fill = prepare(text, "# Current prices\n\nCedar costs 10 yuan. Maple costs 20 yuan.");
    const raw = (prices: string[]) => JSON.stringify({ payload: { rows: prices.map((price, i) => ({
      sourceId: `row-${i}`, cells: [i ? "Maple" : "Cedar", price]
    })) } });
    expect(() => fill.decode(raw(["10", "20"]))).toThrow();
    expect(fill.decode(raw(["10 yuan", "20 yuan"])).text).toContain("| Cedar | 10 yuan |");
  });
});
