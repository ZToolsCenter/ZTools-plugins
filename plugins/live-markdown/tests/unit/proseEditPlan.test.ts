import { describe, expect, it } from "vitest";
import { buildProseEditPlan, type ProseEditRequest } from "../../src/core/ai/proseEditPlan";

const budget = { contextLimit: 4096, maxOutputTokens: 2048 };

function request(source: string, extra: Partial<ProseEditRequest> = {}): ProseEditRequest {
  return {
    source,
    instruction: "校对错字并保持原意",
    systemPrompt: "只改已有正文文本槽",
    revision: "revision-7",
    providerBudget: budget,
    ...extra
  };
}

describe("source-bound prose edit plan", () => {
  it("owns complete prose sentences while keeping source offsets and protected blocks intact", () => {
    const source = [
      "---\r\ntitle: 原始标题\r\n---\r\n",
      "# 标题 ✨\r\n\r\n",
      "保留 2026-10-23、8GB、✨、`inline code`、[链接](https://example.test)、$x+y$ 和 **以经正确**。\r\n\r\n",
      "| 项目 | 值 |\r\n| --- | --- |\r\n| Alpha | 42 |\r\n\r\n",
      "```ts\r\nconst answer = 42;\r\n```\r\n\r\n",
      "普通正文错字。[^note]\r\n\r\n[^note]: 脚注内容不进入可编辑槽。\r\n"
    ].join("");

    const plan = buildProseEditPlan(request(source), 50);

    expect(plan.sourceHash).toBeTruthy();
    expect(plan.revision).toBe("revision-7");
    expect(plan.scope).toEqual({ from: 0, to: source.length });
    expect(plan.slots.length).toBeGreaterThan(0);
    for (const slot of plan.slots) {
      expect(source.slice(slot.range.from, slot.range.to)).toBe(slot.sourceText);
      expect(slot.range.from).toBeGreaterThanOrEqual(0);
      expect(slot.range.to).toBeLessThanOrEqual(source.length);
      expect(slot.sourceText).not.toMatch(/[\r\n\u{1F000}-\u{1FAFF}]/u);
    }
    expect(plan.slots.map((slot) => slot.range.from)).toEqual(
      [...plan.slots].map((slot) => slot.range.from).sort((a, b) => a - b)
    );
    const richSentence = "保留 2026-10-23、8GB、✨、`inline code`、[链接](https://example.test)、$x+y$ 和 **以经正确**。";
    expect(plan.slots.some((slot) => slot.sourceText === richSentence)).toBe(true);
    expect(plan.slots.some((slot) => slot.sourceText.includes("[^note]"))).toBe(true);
    expect(plan.slots.some((slot) => /answer|脚注内容|原始标题/.test(slot.sourceText))).toBe(false);
    expect(plan.slots.some((slot) => slot.sourceText.includes("普通正文错字"))).toBe(true);
  });

  it("keeps each replacement slot single-line and offsets in the original UTF-16 source", () => {
    const source = "✨ 前文\r\n\r\n**正文错字** 后文\r\n";
    const plan = buildProseEditPlan(request(source), 10);

    expect(plan.slots.length).toBeGreaterThan(0);
    for (const slot of plan.slots) {
      expect(source.slice(slot.range.from, slot.range.to)).toBe(slot.sourceText);
      expect(slot.sourceText).not.toMatch(/[\r\n]/);
    }
    expect(plan.slots.map(({ sourceText }) => sourceText)).toEqual(["✨ 前文", "**正文错字** 后文"]);
  });

  it("rejects selection endpoints inside a surrogate pair or CRLF sequence", () => {
    const source = "🪄\r\n正文错字";
    for (const offset of [1, 3]) {
      expect(() => buildProseEditPlan(request(source, { scope: { from: offset, to: source.length } }), 10))
        .toThrow(/Unicode 或换行边界/);
    }
    const valid = buildProseEditPlan(request(source, { scope: { from: 4, to: source.length } }), 10);
    expect(valid.slots.every((slot) => source.slice(slot.range.from, slot.range.to) === slot.sourceText)).toBe(true);
  });

  it("keeps numbers, identifiers and quantities together inside the complete sentence", () => {
    const source = "编号 C01/H01、版本 v2、容量 8GB、温度 24°C、金额 ¥128.5 元和 USD 128.5、日期 2026年10月23日、数量 3 个均保持不变。其余正文错字。";
    const plan = buildProseEditPlan(request(source), 10);
    const protectedValues = ["C01/H01", "v2", "8GB", "24°C", "¥128.5 元", "USD 128.5", "2026年10月23日", "3 个"];

    expect(plan.slots.map(({ sourceText }) => sourceText)).toEqual([
      "编号 C01/H01、版本 v2、容量 8GB、温度 24°C、金额 ¥128.5 元和 USD 128.5、日期 2026年10月23日、数量 3 个均保持不变。",
      "其余正文错字。"
    ]);
    for (const value of protectedValues) expect(plan.slots[0].sourceText).toContain(value);
  });

  it("keeps Typora subscript and superscript expressions intact as semantic atoms", () => {
    const source = "首行普通正文错字。\r\n水分子 H~2~O、平方项 x^2^、硫酸根 SO~4~^2-^ 与指数 x^max^ 均不应拆开。普通正文错字。";
    const plan = buildProseEditPlan(request(source), 10);

    expect(plan.slots.map(({ sourceText }) => sourceText)).toEqual([
      "首行普通正文错字。",
      "水分子 H~2~O、平方项 x^2^、硫酸根 SO~4~^2-^ 与指数 x^max^ 均不应拆开。",
      "普通正文错字。"
    ]);
  });

  it("owns one complete Markdown sentence including inline syntax and source facts", () => {
    const sentence = "水分子H~2~O旁有错字，平方项x^2^、**强调错字**、`inline.code`、[链接](https://example.test/a) 与日期 2026-10-23 均保留。";
    const source = `${sentence}\r\n第二句普通正文错字。`;
    const plan = buildProseEditPlan(request(source), 10);

    expect(plan.slots.map(({ sourceText }) => sourceText)).toEqual([sentence, "第二句普通正文错字。"]);
    for (const slot of plan.slots) {
      expect(source.slice(slot.range.from, slot.range.to)).toBe(slot.sourceText);
      expect(slot.sourceText).not.toMatch(/[\r\n]/);
    }
  });

  it("keeps inline math syntax inside complete sentences with adjacent Chinese prose", () => {
    const source = "H~2~O 是水。水分子H~2~O旁有错字，变量α^2^、数量10^6^也固定。未闭合x^2后有错字。";
    const plan = buildProseEditPlan(request(source), 10);
    expect(plan.slots.map(({ sourceText }) => sourceText)).toEqual([
      "H~2~O 是水。", "水分子H~2~O旁有错字，变量α^2^、数量10^6^也固定。", "未闭合x^2后有错字。"
    ]);
  });

  it("provides bounded same-line context only from within the authorized selection", () => {
    const source = "选区外的保密内容。编号 C01，选区内句子错字后接 8GB。选区外尾部保密内容。";
    const from = source.indexOf("编号");
    const to = source.indexOf("。选区外尾部") + 1;
    const scope = { from, to };
    const plan = buildProseEditPlan(request(source, { scope }), 10);

    expect(plan.slots.length).toBeGreaterThan(0);
    for (const slot of plan.slots) {
      expect(Array.from(slot.readOnlyContext.before).length).toBeLessThanOrEqual(64);
      expect(Array.from(slot.readOnlyContext.after).length).toBeLessThanOrEqual(64);
      expect(source.slice(scope.from, slot.range.from).endsWith(slot.readOnlyContext.before)).toBe(true);
      expect(source.slice(slot.range.to, scope.to).startsWith(slot.readOnlyContext.after)).toBe(true);
      expect(slot.readOnlyContext.before).not.toContain("选区外的保密内容");
      expect(slot.readOnlyContext.after).not.toContain("选区外尾部保密内容");
    }
    expect(plan.batches[0].prompt).toContain('"contextBefore"');
    expect(plan.batches[0].prompt).toContain('"contextAfter"');
    expect(plan.batches[0].systemPrompt).toContain("绝不可复制或拼接到任何 text");
  });

  it("plans a selection only and leaves surrounding source outside the owned scope", () => {
    const source = "前置内容\n\n选区里的错字\n\n后置内容";
    const from = source.indexOf("选区");
    const to = source.indexOf("\n\n后置");
    const plan = buildProseEditPlan(request(source, { scope: { from, to } }), 10);

    expect(plan.scope).toEqual({ from, to });
    expect(plan.slots.every((slot) => slot.range.from >= from && slot.range.to <= to)).toBe(true);
    expect(plan.slots.map((slot) => slot.sourceText).join(" ")).toContain("选区里的错字");
    expect(plan.slots.map((slot) => slot.sourceText).join(" ")).not.toMatch(/前置内容|后置内容/);
  });

  it("does not expand a partial sentence selection and keeps a complete cross-line sentence", () => {
    const partialSource = "前句错字。选中这几个字。后句错字。";
    const from = partialSource.indexOf("这几个字");
    const partial = buildProseEditPlan(request(partialSource, { scope: { from, to: from + "这几个字".length } }), 10);
    expect(partial.slots).toEqual([]);

    const multilineSource = "第一行有错字，\r\n第二行仍属于同一句。";
    const multilinePlan = buildProseEditPlan(request(multilineSource), 10);
    expect(multilinePlan.slots.map(({ sourceText }) => sourceText)).toEqual([multilineSource]);
    expect(multilineSource.slice(multilinePlan.slots[0].range.from, multilinePlan.slots[0].range.to)).toBe(multilineSource);
    expect(multilinePlan.batches[0].systemPrompt).toContain("槽内已有换行须保留其原序列、数量和类型");
  });

  it("keeps block display math in all supported delimiter forms out of prose slots", () => {
    const source = ["$$x^2$$", "$$ x^2 $$", "\\[x^2\\]", "\\[", "x^2", "\\]", "普通正文错字。"].join("\n\n");
    const plan = buildProseEditPlan(request(source), 10);
    expect(plan.slots.map(({ sourceText }) => sourceText)).toEqual(["普通正文错字。"]);
  });

  it("returns no editable slots for a source containing only protected structures", () => {
    const source = "# 标题 ✨\n\n```ts\nconst answer = 42;\n```";
    const plan = buildProseEditPlan(request(source), 10);

    expect(plan.slots).toEqual([]);
    expect(plan.batches).toEqual([]);
  });

  it("accounts for full instruction, system prompt, slot payload and worst-case response before batching", () => {
    const source = Array.from({ length: 18 }, (_, index) => `第${index + 1}段正文错字，保留原文事实。`).join("\n\n");
    const short = buildProseEditPlan(request(source), 50);
    const long = buildProseEditPlan(request(source, {
      instruction: `校对正文。${"额外约束".repeat(100)}`,
      systemPrompt: `系统规则。${"保持语义".repeat(40)}`,
      providerBudget: { contextLimit: 2400, maxOutputTokens: 512 }
    }), 50);

    expect(long.batches.length).toBeGreaterThan(short.batches.length);
    for (const batch of long.batches) {
      expect(batch.prompt).toContain("额外约束");
      expect(batch.systemPrompt).toContain("保持语义");
      expect(batch.contextTokens).toBeLessThanOrEqual(2400);
      expect(batch.maxTokens).toBeLessThanOrEqual(512);
      expect(batch.maxOutputBytes).toBeGreaterThan(0);
    }
  });

  it("rejects a source beyond the established 1 MiB input cap before producing batches", () => {
    const source = "正文".repeat(600_000);
    expect(() => buildProseEditPlan(request(source), 50)).toThrow(/1 MiB/);
  });

  it("keeps 5,000 fenced code blocks outside editable slots", () => {
    const sourceFor = (count: number) => Array.from({ length: count }, () =>
      "```text\r\nx\r\n```\r\n\r\n"
    ).join("");
    const largeSource = sourceFor(5_000);
    expect(new TextEncoder().encode(largeSource).byteLength).toBeGreaterThan(50_000);
    const plan = buildProseEditPlan(request(largeSource), 50);
    expect(plan.slots).toEqual([]);
    expect(plan.batches).toEqual([]);
  });
});
