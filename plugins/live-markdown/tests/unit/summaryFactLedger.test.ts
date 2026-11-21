import { describe, expect, it } from "vitest";
import {
  buildSummarySectionIndex,
  buildSummaryCandidates,
  mergeSummaryFactLedger,
  renderSummaryFactLedger,
  type SummaryFactCandidate,
  type SummaryFactLedgerEntry
} from "../../src/core/ai/summaryFactLedger";
import { validateMarkdownFragmentCompleteness } from "../../src/core/ai/markdownAstIntegrity";

function chunk(source: string, index = 0, from = 0, to = source.length) {
  return { index, text: source.slice(from, to), ownedRange: { from, to } };
}

describe("summary fact ledger", () => {
  it("keeps exact UTF-16 source spans and recognizes high-value fact facets", () => {
    const source = "封面🙂\r\n\r\n项目组决定于 2026-03-31 前由李明完成迁移，预算为 20 万元。\r\n普通背景说明。";
    const candidates = buildSummaryCandidates(source, chunk(source, 3));
    const decision = candidates.find((candidate) => candidate.category === "decision");

    expect(decision).toBeDefined();
    expect(decision).toMatchObject({ required: true, chunkIndex: 3 });
    expect(source.slice(decision!.range.from, decision!.range.to)).toBe(decision!.quote);
    expect(decision!.quote).toBe("项目组决定于 2026-03-31 前由李明完成迁移，预算为 20 万元。");
    expect(decision!.facets).toEqual(expect.arrayContaining(["decision", "owner", "date", "amount", "action"]));
    expect(decision!.range.from).toBe(source.indexOf("项目组"));
  });

  it("uses only the owned source range and never turns read-only context into candidates", () => {
    const source = "上下文里决定预算 9 万元。\n\n负责人与日期由原文提供。";
    const from = source.indexOf("负责人与");
    const candidates = buildSummaryCandidates(source, chunk(source, 1, from, source.length));

    expect(candidates.map(({ quote }) => quote)).toEqual(["负责人与日期由原文提供。"]);
  });

  it("fails closed when a nonempty chunk has no exact original-source ownership", () => {
    expect(() => buildSummaryCandidates("正文", { index: 0, text: "正文" })).toThrow(/ownedRange|原文范围/);
    expect(() => buildSummaryCandidates("正文", { index: 0, text: "被改写的正文", ownedRange: { from: 0, to: 3 } }))
      .toThrow(/source|原文|范围/);
    expect(buildSummaryCandidates("", { index: 0, text: "" })).toEqual([]);
  });

  it("splits list items and prose sentences without normalizing source characters", () => {
    const source = "# 计划\n\n第一项要求保留 CRLF。第二项决定使用 CM6。\n\n- 负责人：李明，截止 2026-04-01。\r\n- 预算：20 万元。\r\n";
    const candidates = buildSummaryCandidates(source, chunk(source));

    expect(candidates.map(({ quote }) => quote)).toEqual([
      "第一项要求保留 CRLF。",
      "第二项决定使用 CM6。",
      "- 负责人：李明，截止 2026-04-01。",
      "- 预算：20 万元。"
    ]);
    expect(candidates.every(({ quote, range }) => source.slice(range.from, range.to) === quote)).toBe(true);
  });

  it("does not discard a body immediately after a heading and keeps a fenced code block atomic", () => {
    const source = "## 决策\n正文决定采用 CM6。\n\n```text\n第一行\n\n第二行\n```\n后续风险说明。";
    const candidates = buildSummaryCandidates(source, chunk(source));

    expect(candidates.map(({ quote }) => quote)).toEqual([
      "正文决定采用 CM6。",
      "```text\n第一行\n\n第二行\n```",
      "后续风险说明。"
    ]);
  });

  it("keeps GFM alert markers and inline code tokens inside complete source sentences", () => {
    const source = "> [!TIP]\n> 按快捷键打开面板！\n\n规则为 `[!NOTE]` 标记。随后说明完整句子。";
    const candidates = buildSummaryCandidates(source, chunk(source));
    const quotes = candidates.map(({ quote }) => quote);

    expect(quotes).not.toContain("> [!");
    expect(quotes).not.toContain("TIP]");
    expect(quotes).toContain("> [!TIP]\n> 按快捷键打开面板！");
    expect(quotes).toContain("规则为 `[!NOTE]` 标记。");
    expect(quotes).toContain("随后说明完整句子。");
    expect(candidates.every(({ quote, range }) => source.slice(range.from, range.to) === quote)).toBe(true);
    const ledger = mergeSummaryFactLedger(source, candidates, candidates.map(({ id }) => id));
    const rendered = renderSummaryFactLedger(source, ledger);
    expect(rendered).not.toContain("[!TIP]");
    expect(rendered).toContain("按快捷键打开面板！");
    expect(rendered).toContain("`[!NOTE]`");
    expect(() => validateMarkdownFragmentCompleteness(rendered)).not.toThrow();
  });

  it("does not expose table-of-contents directives as summary facts", () => {
    const source = "[toc]\n\n[[toc]]\n\n项目决定保留离线模式。";
    const candidates = buildSummaryCandidates(source, chunk(source));
    expect(candidates.map(({ quote }) => quote)).toEqual(["项目决定保留离线模式。"]);
  });

  it("forces required facts into the ledger while keeping model-selected optional facts", () => {
    const source = "普通背景介绍。\n\n项目决定采用 CM6。\n\n下一步由李明在 2026-04-01 完成迁移。";
    const candidates = buildSummaryCandidates(source, chunk(source));
    const optional = candidates.find(({ required }) => !required)!;
    const ledger = mergeSummaryFactLedger(source, candidates, [optional.id]);

    expect(ledger.map(({ quote }) => quote)).toEqual(candidates.map(({ quote }) => quote));
    expect(ledger.filter(({ required }) => required).length).toBeGreaterThanOrEqual(2);
    expect(ledger.find(({ id }) => id === optional.id)).toMatchObject({ includedBy: "selected" });
    expect(ledger.filter(({ required }) => required).every(({ includedBy }) => includedBy === "required"))
      .toBe(true);
  });

  it("keeps explicit next steps selectable without forcing generic actions", () => {
    const source = "下一步升级代理配置。\n\n背景部分解释现状。";
    const candidates = buildSummaryCandidates(source, chunk(source));
    expect(candidates.find(({ quote }) => quote.startsWith("下一步"))).toMatchObject({
      category: "action",
      required: false
    });
    expect(candidates.find(({ quote }) => quote.startsWith("背景部分"))?.required).toBe(false);
  });

  it("keeps candidate IDs stable across chunk indexes and deduplicates overlap", () => {
    const source = "背景说明。决定延期发布。";
    const first = buildSummaryCandidates(source, chunk(source, 2));
    const second = buildSummaryCandidates(source, chunk(source, 9));
    const selected = first.filter(({ required }) => !required).map(({ id }) => id);
    const ledger = mergeSummaryFactLedger(source, [...first, ...second], selected);

    expect(first.map(({ id }) => id)).toEqual(second.map(({ id }) => id));
    expect(ledger).toHaveLength(first.length);
    expect(ledger.find(({ quote }) => quote === "决定延期发布。")?.includedBy).toBe("required");
  });

  it("deduplicates exact repeats inside a chunk without merging distinct entities or values", () => {
    const repeated = "日常背景用于说明记录方式。";
    const source = `${repeated.repeat(100)}项目决定使用 CM6。项目决定使用 CM7。李明负责部署。王明负责部署。预算为 10 万元。预算为 20 万元。`;
    const candidates = buildSummaryCandidates(source, chunk(source, 4));
    const background = candidates.filter(({ quote }) => quote === repeated);

    expect(background).toHaveLength(1);
    expect(background[0]).toMatchObject({ chunkIndex: 4, range: { from: 0 } });
    expect(candidates.map(({ quote }) => quote)).toEqual([
      repeated,
      "项目决定使用 CM6。",
      "项目决定使用 CM7。",
      "李明负责部署。",
      "王明负责部署。",
      "预算为 10 万元。",
      "预算为 20 万元。"
    ]);
  });

  it("deduplicates identical facts across chunks after span validation and keeps the earliest source span", () => {
    const quote = "重复决定采用 CM6。";
    const source = `${quote}\n普通背景。\n${quote}`;
    const chunks = [
      chunk(source, 3, source.lastIndexOf(quote), source.length),
      chunk(source, 8, 0, quote.length)
    ];
    const candidates = chunks.flatMap((part) => buildSummaryCandidates(source, part));
    const laterId = candidates.find(({ range }) => range.from > 0)!.id;
    const ledger = mergeSummaryFactLedger(source, candidates, [laterId]);
    const unique = ledger.filter(({ quote: item }) => item === quote);

    expect(unique).toHaveLength(1);
    expect(unique[0].range.from).toBe(0);
    expect(unique[0].includedBy).toBe("required");
  });

  it("keeps identical facts from different AST sections and renders their source headings", () => {
    const source = "# Alpha\n\n本周完成验收。\n\n# Beta\n\n本周完成验收。";
    const candidates = buildSummaryCandidates(source, chunk(source));
    const repeated = candidates.filter(({ quote }) => quote === "本周完成验收。");
    const ledger = mergeSummaryFactLedger(source, candidates, repeated.map(({ id }) => id));

    expect(repeated).toHaveLength(2);
    expect(repeated.map(({ sectionPath }) => sectionPath.map(({ text }) => text))).toEqual([ ["Alpha"], ["Beta"] ]);
    expect(repeated.map(({ sectionPath }) => source.slice(sectionPath[0].range.from, sectionPath[0].range.to)))
      .toEqual(["# Alpha", "# Beta"]);
    expect(renderSummaryFactLedger(source, ledger)).toBe("- （章节：Alpha）本周完成验收。\n- （章节：Beta）本周完成验收。");
  });

  it("prints a repeated section prefix once for adjacent facts", () => {
    const source = "# Alpha\n\n第一项已完成。\n第二项已验证。\n\n# Beta\n\n第三项已发布。";
    const candidates = buildSummaryCandidates(source, chunk(source));
    const ledger = mergeSummaryFactLedger(source, candidates, candidates.map(({ id }) => id));
    expect(renderSummaryFactLedger(source, ledger)).toBe(
      "- （章节：Alpha）第一项已完成。\n- 第二项已验证。\n- （章节：Beta）第三项已发布。"
    );
  });

  it("binds reusable section indexes to the exact source and revalidates heading paths", () => {
    const source = "# Alpha\n\n背景说明。";
    const candidate = buildSummaryCandidates(source, chunk(source), buildSummarySectionIndex(source))[0];
    const forged = [{ ...candidate, sectionPath: [] }];

    expect(() => buildSummaryCandidates(source, chunk(source), buildSummarySectionIndex("# Beta\n\n背景说明。")))
      .toThrow(/章节索引|原文/);
    expect(() => mergeSummaryFactLedger(source, forged, [candidate.id])).toThrow(/章节路径|AST/);
  });

  it("deduplicates repeated background facts within one section across owned chunks", () => {
    const quote = "重复背景说明。";
    const source = `# Alpha\n\n${quote}\n中间内容。\n${quote}`;
    const firstFrom = source.indexOf(quote);
    const secondFrom = source.lastIndexOf(quote);
    const first = buildSummaryCandidates(source, chunk(source, 0, firstFrom, firstFrom + quote.length));
    const second = buildSummaryCandidates(source, chunk(source, 1, secondFrom, secondFrom + quote.length));
    const candidates = [...first, ...second];
    const ledger = mergeSummaryFactLedger(source, candidates, candidates.map(({ id }) => id));

    expect(first[0].sectionPath).toEqual(second[0].sectionPath);
    expect(ledger.filter(({ quote: item }) => item === quote)).toHaveLength(1);
  });

  it("does not force generic process instructions into the required-fact set", () => {
    const quote = "需要验证原有事实不得变动。";
    const candidates = buildSummaryCandidates(quote, chunk(quote));
    const genericMetric = buildSummaryCandidates("性能提升明显。", chunk("性能提升明显。"));
    const quantifiedMetric = buildSummaryCandidates("性能提升 2 倍。", chunk("性能提升 2 倍。"));

    expect(candidates[0]).toMatchObject({ required: false });
    expect(mergeSummaryFactLedger(quote, candidates, [])).toEqual([]);
    expect(genericMetric[0].required).toBe(false);
    expect(quantifiedMetric[0].required).toBe(true);
  });

  it("keeps three real decisions while dropping 25 negative or undecided section notes", () => {
    const negativeExamples = ["本节没有新增决策。", "本节尚无新增决策。", "本节尚未作出决定。", "当前尚未决定是否采用方案 X。"];
    const negatives = Array.from({ length: 25 }, (_, index) => `## Background ${index + 1}\n\n${negativeExamples[index % negativeExamples.length]}`);
    const positiveQuotes = ["团队决定采用 CM6。", "项目组决定升级 API。", "最终决定保留兼容模式。"];
    const decisions = positiveQuotes.map((quote, index) => `## Decision ${index + 1}\n\n${quote}`);
    const source = [...negatives, ...decisions].join("\n\n");
    const candidates = buildSummaryCandidates(source, chunk(source));
    const retainedDecision = "本节没有新增决策，原决定仍采用 CM6。";
    const compound = buildSummaryCandidates(retainedDecision, chunk(retainedDecision));
    const ledger = mergeSummaryFactLedger(source, candidates, []);
    const negativeCandidates = candidates.filter(({ quote }) => negativeExamples.includes(quote));

    expect(negativeCandidates).toHaveLength(25);
    expect(negativeCandidates.every(({ required }) => !required)).toBe(true);
    expect(candidates.filter(({ required }) => required).map(({ quote }) => quote)).toEqual(positiveQuotes);
    expect(ledger.map(({ quote }) => quote)).toEqual(positiveQuotes);
    expect(compound[0].required).toBe(true);
  });

  it("accepts a 512-byte source fact and refuses a longer quote without truncating it", () => {
    const acceptedQuote = `${"a".repeat(511)}.`;
    const rejectedQuote = `${"a".repeat(512)}.`;
    expect(new TextEncoder().encode(acceptedQuote).byteLength).toBe(512);
    expect(buildSummaryCandidates(acceptedQuote, chunk(acceptedQuote))).toHaveLength(1);
    expect(() => buildSummaryCandidates(rejectedQuote, chunk(rejectedQuote))).toThrow(/512.*bytes|512.*字节/iu);
    const forged: SummaryFactCandidate = {
      id: `sf:0:${rejectedQuote.length}:other`,
      range: { from: 0, to: rejectedQuote.length },
      quote: rejectedQuote,
      category: "other",
      facets: [],
      sectionPath: [],
      required: false,
      chunkIndex: 0
    };
    expect(() => mergeSummaryFactLedger(rejectedQuote, [forged], [])).toThrow(/512.*bytes|512.*字节/iu);
  });

  it("enforces the 256-fact ledger limit after exact global deduplication", () => {
    const sourceFor = (count: number) => Array.from({ length: count }, (_, index) => `Fact ${index} explains a unique background detail.`).join("\n");
    const source256 = sourceFor(256);
    const candidates256 = buildSummaryCandidates(source256, chunk(source256));
    expect(candidates256).toHaveLength(256);
    expect(() => mergeSummaryFactLedger(source256, candidates256, [])).not.toThrow();

    const source257 = sourceFor(257);
    expect(() => mergeSummaryFactLedger(source257, buildSummaryCandidates(source257, chunk(source257)), []))
      .toThrow(/超过 256 条/iu);
  });

  it("rejects unknown selected IDs and candidate evidence that no longer matches source", () => {
    const source = "决定延期发布。";
    const candidates = buildSummaryCandidates(source, chunk(source));
    expect(() => mergeSummaryFactLedger(source, candidates, ["fact:unknown"])).toThrow(/unknown|候选/);

    const tampered = [{ ...candidates[0], quote: "决定立即发布。" }];
    expect(() => mergeSummaryFactLedger(source, tampered, [candidates[0].id])).toThrow(/source|原文|证据/);
  });

  it("renders plain Markdown bullets without internal IDs and keeps source quotes in the ledger", () => {
    const source = "决定采用 `CM6`。\n普通\n说明。";
    const candidates = buildSummaryCandidates(source, chunk(source));
    const optional = candidates.find(({ required }) => !required)!;
    const ledger = mergeSummaryFactLedger(source, candidates, [optional.id]);
    const prompt = renderSummaryFactLedger(source, ledger);

    expect(prompt).toBe("- 决定采用 `CM6`。\n- 普通 说明。");
    expect(prompt).not.toContain("sf:");
    expect(prompt).not.toContain("source[");
    expect(ledger.find(({ quote }) => quote.startsWith("普通"))?.quote).toBe("普通\n说明。");
  });

  it("keeps explicitly selected fenced code as a complete Markdown block", () => {
    const source = "结论采用版本 2。\n\n```ts\nconst stable = true;\n```";
    const candidates = buildSummaryCandidates(source, chunk(source));
    const ledger = mergeSummaryFactLedger(source, candidates, candidates.map(({ id }) => id));
    const rendered = renderSummaryFactLedger(source, ledger);
    expect(rendered).toContain("```ts\nconst stable = true;\n```");
    expect(() => validateMarkdownFragmentCompleteness(rendered)).not.toThrow();
  });

  it("keeps the rendered ledger below 256 KiB at the configured count and quote boundaries", () => {
    const source = Array.from({ length: 256 }, (_, index) => `${"x".repeat(505)}${String(index).padStart(3, "0")}.`).join("\n");
    const candidates = buildSummaryCandidates(source, chunk(source));
    const ledger = mergeSummaryFactLedger(source, candidates, candidates.map(({ id }) => id));
    const rendered = renderSummaryFactLedger(source, ledger);

    expect(candidates).toHaveLength(256);
    expect(candidates.every(({ quote }) => new TextEncoder().encode(quote).byteLength <= 512)).toBe(true);
    expect(new TextEncoder().encode(rendered).byteLength).toBeLessThanOrEqual(256 * 1024);
  });

  it("revalidates ledger ranges before rendering", () => {
    const source = "决定延期发布。";
    const ledger = mergeSummaryFactLedger(source, buildSummaryCandidates(source, chunk(source)), []);
    const tampered = ledger.map((entry) => ({ ...entry, range: { from: 1, to: source.length } })) as SummaryFactLedgerEntry[];
    expect(() => renderSummaryFactLedger(source, tampered)).toThrow(/source|原文|证据/);
  });
});
