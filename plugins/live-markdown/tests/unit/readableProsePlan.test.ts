import { describe, expect, it } from "vitest";
// @ts-expect-error Frozen scenario fixtures are executable JavaScript without declaration files.
import { contentExecutorCases } from "../../scripts/ai-scenario-eval/content-executor-cases.mjs";
import { buildThinProseSlots, type ThinProseSlot } from "../../src/core/ai/thinProseSlots";
import { prepareReadableProse } from "../../src/core/ai/readableProseView";
import { planReadableProse } from "../../src/core/ai/readableProsePlan";

const scenarios = contentExecutorCases as Array<{ id: string; source: string; instruction: string }>;
const inlineCase = scenarios.find(({ id }) => id === "B31-POL-INLINE-ATOMS")!;
const crlfCase = scenarios.find(({ id }) => id === "B31-POL-CRLF-STRUCTURE")!;

function applySlots(source: string, slots: readonly ThinProseSlot[], values: Map<string, string>): string {
  return [...slots].sort((left, right) => right.range.from - left.range.from).reduce((result, slot) => {
    return result.slice(0, slot.range.from) + values.get(slot.id)! + result.slice(slot.range.to);
  }, source);
}

function decodeUnchanged(plan: NonNullable<ReturnType<typeof planReadableProse>>): Map<string, string> {
  return new Map(plan.jobs.flatMap(({ view }) => [...view.decode(view.text)]));
}

describe("readable prose planning", () => {
  it("isolates readable sentences from protected atom noise in the frozen inline Markdown case", () => {
    const slots = buildThinProseSlots(inlineCase.source, inlineCase.instruction);
    const plan = planReadableProse(inlineCase.source, slots);

    expect(plan).not.toBeNull();
    expect(plan!.jobs.length).toBeGreaterThan(1);
    expect(plan!.jobs[0]!.view.text.trim()).toMatch(/\bneed a check\.$/u);
    expect(plan!.jobs[0]!.view.text).not.toMatch(/v2\.1|internal\.invalid|x\^2|Protected/u);
    expect(applySlots(inlineCase.source, plan!.slots, decodeUnchanged(plan!))).toBe(inlineCase.source);
  });

  it("restores source boundary spaces when a model returns a trimmed sentence", () => {
    const slots = buildThinProseSlots(inlineCase.source, inlineCase.instruction);
    const plan = planReadableProse(inlineCase.source, slots)!;
    const first = plan.jobs[0]!;
    const values = decodeUnchanged(plan);
    for (const [id, value] of first.view.decode(first.view.text.trim())) values.set(id, value);

    expect(applySlots(inlineCase.source, plan.slots, values)).toBe(inlineCase.source);
  });

  it("preserves an NBSP prefix and rejects empty or multiline model output", () => {
    const source = "\u00a0The **release note** need a check. Keep `v2.1` exact.\u00a0";
    const slots = buildThinProseSlots(source, "Polish while keeping the source Markdown.");
    const plan = planReadableProse(source, slots)!;
    const first = plan.jobs[0]!;
    const values = decodeUnchanged(plan);
    for (const [id, value] of first.view.decode(first.view.text.trim())) values.set(id, value);
    const last = plan.jobs.at(-1)!;
    for (const [id, value] of last.view.decode(last.view.text.trim())) values.set(id, value);

    expect(applySlots(source, plan.slots, values)).toBe(source);
    expect(() => first.view.decode("   \u00a0 ")).toThrow();
    expect(() => first.view.decode(`\n${first.view.text.trim()}`)).toThrow();
    expect(() => first.view.decode(`\t${first.view.text.trim()}`)).toThrow();
  });

  it("covers every original readable slot exactly once and preserves CRLF structure", () => {
    const slots = buildThinProseSlots(crlfCase.source, crlfCase.instruction);
    const plan = planReadableProse(crlfCase.source, slots);

    expect(plan).not.toBeNull();
    expect(plan!.jobs.every(({ view }) => view.text.length > 0 && !/[\r\n]/u.test(view.text))).toBe(true);
    for (const original of slots) {
      const pieces = plan!.slots.filter(({ range }) => range.from >= original.range.from && range.to <= original.range.to)
        .sort((left, right) => left.range.from - right.range.from);
      expect(pieces[0]?.range.from).toBe(original.range.from);
      expect(pieces.at(-1)?.range.to).toBe(original.range.to);
      expect(pieces.every((piece, index) => piece.sourceText === crlfCase.source.slice(piece.range.from, piece.range.to) &&
        (index === 0 || pieces[index - 1]!.range.to === piece.range.from))).toBe(true);
    }
    expect(applySlots(crlfCase.source, plan!.slots, decodeUnchanged(plan!))).toBe(crlfCase.source);
    expect([...crlfCase.source.matchAll(/\r\n/gu)]).toHaveLength([...applySlots(crlfCase.source, plan!.slots, decodeUnchanged(plan!)).matchAll(/\r\n/gu)].length);
  });

  it("keeps Unicode text and protected decimals, abbreviations, URLs, code, and math inside safe jobs", () => {
    const source = "第一句 need review。 第二句 keeps 3.14, Dr. Smith, https://internal.invalid/v2.1, `R3`, and $x^2$ exact. 第三句 needs care.";
    const slots = buildThinProseSlots(source, "Correct readable grammar while keeping Markdown and values intact.");
    const plan = planReadableProse(source, slots);

    expect(plan).not.toBeNull();
    expect(plan!.jobs.length).toBe(3);
    expect(plan!.jobs[0]!.view.text.trim()).toBe("第一句 need review。");
    expect(plan!.jobs[1]!.view.text).not.toMatch(/internal\.invalid|R3|x\^2/u);
    expect(plan!.jobs[1]!.view.text).toContain("3.14");
    expect(plan!.jobs[1]!.view.text).toContain("Dr. Smith");
    expect(plan!.jobs[2]!.view.text.trim()).toBe("第三句 needs care.");
    const protectedJob = plan!.jobs[1]!;
    expect(() => protectedJob.view.decode(protectedJob.view.text.replace("3.14", "3.15"))).toThrow();
  });

  it("plans forty adjacent Chinese sentences without inserting separator spaces", () => {
    const sentence = "请检查这段中文正文并逐句修复语法表达中的所有问题";
    expect(Array.from(sentence)).toHaveLength(24);
    const source = Array.from({ length: 40 }, () => `${sentence}。`).join("");
    const slots = buildThinProseSlots(source, "逐句检查并修正正文。");
    const plan = planReadableProse(source, slots);

    expect(plan).not.toBeNull();
    expect(Array.from(source).filter((character) => character !== "。")).toHaveLength(960);
    expect(plan!.jobs).toHaveLength(4);
    const jobRanges = plan!.jobs.map(({ slotIds }) => {
      const owned = slotIds.map((id) => plan!.slots.find((slot) => slot.id === id)!).sort((left, right) => left.range.from - right.range.from);
      return { from: owned[0]!.range.from, to: owned.at(-1)!.range.to };
    });
    expect(jobRanges.every(({ from, to }) => Array.from(source.slice(from, to)).length <= 256)).toBe(true);
    expect(plan!.jobs.every(({ view }) => Array.from(view.text).length <= 512 && /^(?:请检查这段中文正文并逐句修复语法表达中的所有问题。)+$/u.test(view.text))).toBe(true);
    expect(jobRanges.map(({ from, to }) => source.slice(from, to)).join("")).toBe(source);
    expect(applySlots(source, plan!.slots, decodeUnchanged(plan!))).toBe(source);
  });

  it("splits the held-out Chinese date clause from confirmation and keeps the comma literal", () => {
    const source = "由林安负责的排期日期是2026-11-03，请请大家进行确认。";
    const instruction = "润色正文使其简洁，不改变日期和负责人。";
    const slots = buildThinProseSlots(source, instruction);
    const plan = planReadableProse(source, slots);

    expect(plan).not.toBeNull();
    expect(plan!.jobs.map(({ kind }) => kind ?? "model")).toEqual(["model", "literal", "model"]);
    expect(plan!.jobs[0]!.view.text).toBe("由林安负责的排期日期是2026-11-03");
    expect(plan!.jobs[1]!.view.text).toBe("，");
    expect(plan!.jobs[2]!.view.text).toBe("请请大家进行确认。");
    expect(plan!.jobs.filter(({ kind }) => (kind ?? "model") === "model")).toHaveLength(2);
    expect(applySlots(source, plan!.slots, decodeUnchanged(plan!))).toBe(source);
  });

  it("keeps CRLF and clause-specific facts with their original subjects", () => {
    const source = "由林安负责的日期是2026-11-03，　陈雨负责的日期是2026-11-04，请确认。\r\n后续正文需要校对。";
    const instruction = "润色正文使其简洁，不改变日期和负责人。";
    const plan = planReadableProse(source, buildThinProseSlots(source, instruction));

    expect(plan).not.toBeNull();
    expect(plan!.jobs.map(({ kind }) => kind ?? "model")).toEqual(["model", "literal", "model", "literal", "model", "model"]);
    expect(plan!.jobs[0]!.view.text).toContain("由林安负责的日期是2026-11-03");
    expect(plan!.jobs[1]!.view.text).toBe("，　");
    expect(plan!.jobs[2]!.view.text).toContain("陈雨负责的日期是2026-11-04");
    expect(plan!.jobs[3]!.view.text).toBe("，");
    expect(plan!.jobs[4]!.view.text).toBe("请确认。");
    expect(applySlots(source, plan!.slots, decodeUnchanged(plan!))).toBe(source);
    expect(plan!.jobs.every(({ view }) => !/[\r\n]/u.test(view.text))).toBe(true);
  });

  it("does not classify numeric content as a no-op literal", () => {
    const source = "123";
    const slots: ThinProseSlot[] = [{
      id: "numeric-content", range: { from: 0, to: source.length }, sourceText: source,
      contextBefore: "", contextAfter: ""
    }];

    const plan = planReadableProse(source, slots);

    expect(plan).not.toBeNull();
    expect(plan!.jobs).toHaveLength(1);
    expect(plan!.jobs[0]!.kind ?? "model").toBe("model");
  });

  it("keeps caller-owned punctuation slots as model jobs while the normal slot builder filters them", () => {
    const source = "，🙂";
    const slots: ThinProseSlot[] = [{
      id: "punctuation-content", range: { from: 0, to: source.length }, sourceText: source,
      contextBefore: "", contextAfter: ""
    }];

    const plan = planReadableProse(source, slots);

    expect(plan).not.toBeNull();
    expect(plan!.jobs).toHaveLength(1);
    expect(plan!.jobs[0]!.kind ?? "model").toBe("model");
    expect(buildThinProseSlots(source, "润色可读正文")).toEqual([]);
  });

  it.each([
    "除非排期日期是2026-11-03，否则先不要确认。",
    "只有排期日期是2026-11-03，才可以对外发布。",
    "虽然排期日期是2026-11-03，但仍需要确认。",
    "如果排期日期是2026-11-03，请先确认。",
    "若排期日期是2026-11-03，请先确认。",
    "即使排期日期是2026-11-03，也需要确认。",
    "由于排期日期是2026-11-03，请先确认。",
    "凡2026-11-03前提交的材料，均需确认。",
    "发布日期是2026-11-03，不是立即发布，而是先确认。"
  ])("keeps dependent Chinese clauses together: %s", source => {
    const plan = planReadableProse(source, buildThinProseSlots(source, "润色正文使其简洁，不改变日期和负责人。"));

    expect(plan).not.toBeNull();
    expect(plan!.jobs).toHaveLength(1);
    expect(plan!.jobs.every(({ kind }) => kind !== "literal")).toBe(true);
  });

  it.each([
    "发布说明（日期为2026-11-03，负责人林安）需要确认。",
    "发布说明(日期为2026-11-03，负责人林安)需要确认。",
    "发布说明（日期为2026-11-03，负责人林安需要确认。",
    "发布说明日期为2026-11-03，负责人林安）需要确认。"
  ])("keeps a parenthesized fact clause intact: %s", source => {
    const plan = planReadableProse(source, buildThinProseSlots(source, "润色正文，使其简洁。"));

    expect(plan).not.toBeNull();
    expect(plan!.jobs).toHaveLength(1);
    expect(plan!.jobs.every(({ kind }) => kind !== "literal")).toBe(true);
  });

  it.each([
    "当排期日期是2026-11-03，项目仍须确认。",
    "日期是2026-11-03，不过仍需确认。"
  ])("keeps Chinese time and contrast relations together: %s", source => {
    const plan = planReadableProse(source, buildThinProseSlots(source, "润色正文使其简洁，不改变日期。"));

    expect(plan).not.toBeNull();
    expect(plan!.jobs).toHaveLength(1);
    expect(plan!.jobs.every(({ kind }) => kind !== "literal")).toBe(true);
  });

  it("keeps quoted and inline-atom commas inside the old safe plan", () => {
    const instruction = "润色正文使其简洁，不改变日期。";
    for (const source of [
      "请核对代码`x，y`并确认日期2026-11-03。",
      "请核对公式$x，y$并确认日期2026-11-03。",
      "请核对链接[排期，日期2026-11-03](https://例子.公司)并确认。",
      "请核对“排期，日期2026-11-03”并确认。",
      "请核对‘排期，日期2026-11-03并确认。"
    ]) {
      const plan = planReadableProse(source, buildThinProseSlots(source, instruction));
      expect(plan).not.toBeNull();
      expect(plan!.jobs).toHaveLength(1);
      expect(plan!.jobs.every(({ kind }) => kind === undefined || kind === "model")).toBe(true);
    }
  });

  it("splits CJK sentence punctuation after closing quotes while keeping emphasis, links, and math whole", () => {
    const source = "“需要检查这段文字！”后续内容需要修改。含有**粗体。仍完整**的句子需要保留。链接[标签。仍完整](https://例子.公司/路径)和代码`x。 y`与公式$x。 y$都保留。下一句需要修正。";
    const slots = buildThinProseSlots(source, "逐句修正可读正文，保留格式与语法对象。");
    const plan = planReadableProse(source, slots);

    expect(plan).not.toBeNull();
    expect(plan!.jobs).toHaveLength(5);
    expect(plan!.jobs[0]!.view.text).toBe("“需要检查这段文字！”");
    expect(plan!.jobs[1]!.view.text).toBe("后续内容需要修改。");
    expect(plan!.jobs[2]!.view.text).toContain("粗体。仍完整的句子需要保留。");
    expect(plan!.jobs[3]!.view.text).toContain("标签。仍完整");
    expect(plan!.jobs[3]!.view.text).toContain("都保留。");
    expect(plan!.jobs[3]!.view.text).not.toMatch(/例子\.公司|x。 y/u);
    expect(plan!.jobs[3]!.view.readonlyPlaceholders).toHaveLength(2);
    expect(plan!.jobs[4]!.view.text).toBe("下一句需要修正。");
    expect(applySlots(source, plan!.slots, decodeUnchanged(plan!))).toBe(source);
  });

  it("retains the single-job no-op path when sentence splitting is unnecessary", () => {
    const source = "This short sentence is already correct.";
    const slots = buildThinProseSlots(source, "Polish the readable prose.");
    const plan = planReadableProse(source, slots);

    expect(plan).not.toBeNull();
    expect(plan!.jobs).toHaveLength(1);
    expect([...plan!.jobs[0]!.view.decode(plan!.jobs[0]!.view.text)]).toEqual(plan!.jobs[0]!.slotIds.map((id) => [id, plan!.slots.find((slot) => slot.id === id)!.sourceText]));
  });

  it("does not split a punctuation-like boundary inside inline math", () => {
    const source = "Formula $x. y$ stays exact. Next sentence needs care.";
    const slots = buildThinProseSlots(source, "Polish readable prose.");
    const plan = planReadableProse(source, slots);

    expect(plan).not.toBeNull();
    expect(plan!.jobs).toHaveLength(2);
    expect(plan!.jobs[0]!.view.readonlyPlaceholders).toHaveLength(1);
    expect(plan!.jobs[0]!.view.text).toContain("stays exact.");
  });

  it("rejects overlapping, stale, and unbounded source ownership before inference", () => {
    const source = "A sentence needs correction.";
    const valid = buildThinProseSlots(source, "Polish.");
    const overlap: ThinProseSlot[] = [
      { ...valid[0]!, id: "first", range: { ...valid[0]!.range, to: valid[0]!.range.to - 1 }, sourceText: valid[0]!.sourceText.slice(0, -1) },
      { ...valid[0]!, id: "second", range: { ...valid[0]!.range, from: valid[0]!.range.from + 1 }, sourceText: valid[0]!.sourceText.slice(1) }
    ];
    const stale = [{ ...valid[0]!, sourceText: "stale" }];
    const oversized = `A ${"word ".repeat(120)}single sentence.`;

    expect(planReadableProse(source, overlap)).toBeNull();
    expect(planReadableProse(source, stale)).toBeNull();
    expect(planReadableProse(oversized, buildThinProseSlots(oversized, "Polish."))).toBeNull();
  });

  it("opts out before inference when the bounded plan would exceed fifty jobs", () => {
    const source = Array.from({ length: 51 }, (_, index) => `Line ${index + 1} needs review.`).join("\n");
    const slots = buildThinProseSlots(source, "Polish every readable line.");
    expect(planReadableProse(source, slots)).toBeNull();
  });

  it("rejects a source window that cuts through a protected atom", () => {
    const source = "Read `keep exact` and correct this sentence.";
    const slots = buildThinProseSlots(source, "Polish.");
    const atomStart = source.indexOf("`keep");
    expect(prepareReadableProse(source, slots.filter(({ range }) => range.from >= atomStart), {
      from: atomStart + 2,
      to: source.length
    })).toBeNull();
  });
});
