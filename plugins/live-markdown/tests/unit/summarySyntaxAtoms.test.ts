import { describe, expect, it } from "vitest";
import { buildSummaryCandidates, mergeSummaryFactLedger, renderSummaryFactLedger } from "../../src/core/ai/summaryFactLedger";

describe("summary Markdown atoms", () => {
  it.each([
    "访问 [查询](https://example.test/search?q=1&draft=2) 后确认结果。下一句。",
    "说明 **完整句子。第二句** 仍是一项说明。下一句。",
    "公式 $x!=y$ 保持原意。下一句。",
    "保留 \\! 字面字符。下一句。",
    "图片 ![图一？说明](https://example.test/a.png) 保持不变。下一句。",
    "多反引号 ``带 ` 和 ! 的代码`` 保持不变。下一句。",
    "脚注正文。[^note]下一句。"
  ])("keeps a complete sentence around protected inline syntax: %s", (source) => {
    const firstEnd = source.indexOf("下一句。");
    const candidates = buildSummaryCandidates(source, { index: 0, text: source, ownedRange: { from: 0, to: source.length } });
    expect(candidates.map(({ quote }) => quote)).toEqual([source.slice(0, firstEnd), "下一句。"]);
    const ledger = mergeSummaryFactLedger(source, candidates, [candidates[0].id]);
    expect(renderSummaryFactLedger(source, ledger)).toBe(`- ${source.slice(0, firstEnd)}`);
    expect(candidates.every(({ quote, range }) => source.slice(range.from, range.to) === quote)).toBe(true);
  });

  it("maps CRLF and surrogate offsets back to the unchanged source", () => {
    const source = "✨ **完整句子。\r\n第二句** 说明。下一句。";
    const candidates = buildSummaryCandidates(source, { index: 0, text: source, ownedRange: { from: 0, to: source.length } });
    expect(candidates.map(({ quote }) => quote)).toEqual(["✨ **完整句子。\r\n第二句** 说明。", "下一句。"]);
    expect(candidates.every(({ quote, range }) => source.slice(range.from, range.to) === quote)).toBe(true);
  });

  it("renders a selected source list item with one bullet while retaining task state", () => {
    const source = "- [x] 已完成校对。";
    const facts = buildSummaryCandidates(source, { index: 0, text: source, ownedRange: { from: 0, to: source.length } });
    const ledger = mergeSummaryFactLedger(source, facts, facts.map(({ id }) => id));
    expect(renderSummaryFactLedger(source, ledger)).toBe("- [x] 已完成校对。");
    expect(ledger[0].quote).toBe(source);
  });
});
