import { describe, expect, it } from "vitest";
import { buildSummaryCandidates } from "../../src/core/ai/summaryFactLedger";
import { focusSummaryCandidates, summaryFocus } from "../../src/core/ai/summarySelectionPolicy";

function facts(source: string) {
  return buildSummaryCandidates(source, { index: 0, text: source, ownedRange: { from: 0, to: source.length } });
}
describe("source-backed summary focus", () => {
  it("keeps decisions and required relations while excluding unrelated optional background", () => {
    const source = "开篇决定：舟桥由罗云负责。\n\n本节没有新增决策。\n\n日常沟通需要区分事实和待验证事项。\n\n预算为12万元。";
    const selected = focusSummaryCandidates(facts(source), summaryFocus("总结决定、负责人和金额，忽略背景"));
    expect(selected.map(fact => fact.quote)).toEqual(["开篇决定：舟桥由罗云负责。", "预算为12万元。"]);
  });
  it("keeps explicitly requested risk/action evidence and does not infer absence from filtering", () => {
    const source = "风险是依赖尚未确认。\n\n下一步检查备份。\n\n一般说明。";
    expect(focusSummaryCandidates(facts(source), summaryFocus("总结风险和行动"))).toHaveLength(2);
    expect(focusSummaryCandidates(facts(source), summaryFocus("总结全文"))).toHaveLength(3);
  });
  it("does not read quoted or negated focus words as a positive topic request", () => {
    expect([...summaryFocus("解释“风险”，不要总结决定")]).toEqual([]);
  });
});
