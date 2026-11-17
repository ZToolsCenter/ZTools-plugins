import { describe, expect, it } from "vitest";
import {
  findEligibleProseDateOwner,
  validateProseDateOwnerReplacement,
  type ProseDateOwnerFact
} from "../../src/core/ai/proseDateOwnership";
import { buildThinProseSlots } from "../../src/core/ai/thinProseSlots";
import { planReadableProse } from "../../src/core/ai/readableProsePlan";
import { runThinProseTask } from "../../src/core/ai/thinProseTask";
import { createAiTaskExecution } from "../../src/core/ai/aiTaskExecution";
import type { AiTaskRunnerOptions } from "../../src/core/ai/aiTaskRunner";
import { validateMarkdownAstIntegrity } from "../../src/core/ai/markdownAstIntegrity";
import { validateProseDateFactLedger } from "../../src/core/ai/proseDateOwnership";
import { vi } from "vitest";

const source = "由林安负责的排期日期是2026-11-03，请请大家进行确认。";

function findFact(text: string, from = 0, to = text.length) {
  return findEligibleProseDateOwner({
    source: text,
    sourcePlanRange: { from, to },
    astSyntaxRanges: []
  });
}

describe("source-owned prose date facts", () => {
  it("recognizes one safe date tied to one explicit owner and source event", () => {
    expect(findFact(source)).toMatchObject({
      date: { iso: "2026-11-03", sourceSurface: "2026-11-03" },
      owner: { value: "林安", relation: "responsible-attributive" },
      event: { value: "排期" }
    });
    expect(findFact("由周明负责的交付日期为2027-02-28，请各位确认。"))
      .toMatchObject({ date: { iso: "2027-02-28" }, owner: { value: "周明" }, event: { value: "交付" } });
  });

  it.each([
    ["invalid calendar", "由林安负责的排期日期是2026-02-30。"],
    ["timezone", "由林安负责的排期时间是2026-11-03T09:00Z。"],
    ["date range", "由林安负责的排期从2026-11-03至2026-11-04。"],
    ["second date in one source scope", "由林安负责的排期日期是2026-11-03，复盘日期是2026-11-10"],
    ["multiple facts", "由林安负责的第2项排期日期是2026-11-03。"],
    ["unit", "由林安负责的排期日期是2026-11-03天。"],
    ["multiple owners", "由林安负责的排期日期是2026-11-03，由王安负责的交付另计。"],
    ["request instead of owner relation", "请林安负责的排期日期是2026-11-03。"],
    ["delegation instead of owner relation", "让林安负责的排期日期是2026-11-03。"],
    ["owner not linked to date", "由林安负责的交付已完成，其他日期是2026-11-03。"],
    ["second responsible owner", "由林安负责的排期日期是2026-11-03，周宁负责审核。"],
    ["second handoff owner", "由林安负责的排期日期是2026-11-03，交给周宁负责审核。"],
    ["second direct handoff", "由林安负责的排期日期是2026-11-03，交给周宁审核。"],
    ["second role owner", "由林安负责的排期日期是2026-11-03，周宁担任复核。"],
    ["no event anchor", "由林安负责的日期是2026-11-03。"],
    ["negation", "由林安不负责的排期日期是2026-11-03。"],
    ["status", "由林安负责的已完成排期日期是2026-11-03。"],
    ["quote", "“由林安负责的排期日期是2026-11-03”"],
    ["heading", "## 由林安负责的排期日期是2026-11-03"],
    ["list", "- 由林安负责的排期日期是2026-11-03"],
    ["inline code", "由林安负责的`排期`日期是2026-11-03。"],
    ["link", "由林安负责的[排期](https://example.test)日期是2026-11-03。"],
    ["math", "由林安负责的排期日期是2026-11-03，预算为$x$。"],
    ["mixed-language identifiers", "Cedar owns schedule 2026-11-03; Maple owns release 2026-11-04."]
  ])("abstains for %s", (_name, text) => {
    expect(findFact(text)).toBeNull();
  });

  it("requires the exact source-planned scope to contain the full fact", () => {
    const dateStart = source.indexOf("2026-11-03");
    expect(findFact(source, 0, dateStart)).toBeNull();
    expect(findFact(source, 2, source.length)).toBeNull();
    expect(findFact(`${source}\n后续正文。`)).toBeNull();
    expect(findFact(`${"普通文本".repeat(100)}${source}`)).toBeNull();
    expect(findEligibleProseDateOwner({
      source,
      sourcePlanRange: { from: 0, to: source.length },
      astSyntaxRanges: [{ from: source.indexOf("排期"), to: source.indexOf("排期") + 2 }]
    })).toBeNull();
  });

  it("accepts a complete selected cluster at a nonzero offset without borrowing neighboring text", () => {
    const prefix = "前文。\r\n";
    const cluster = "由周岚负责的审计排期日期为2024-02-29";
    const full = `${prefix}${cluster}\r\n后文不动。`;
    const fact = findFact(full, prefix.length, prefix.length + cluster.length);
    expect(fact?.date.from).toBe(prefix.length + cluster.indexOf("2024-02-29"));
    expect(() => validateProseDateOwnerReplacement(fact!, cluster, "周岚负责的2024年2月29日审计排期")).not.toThrow();
    expect(findFact(full, prefix.length, prefix.length + cluster.indexOf("日期"))).toBeNull();
  });

  it("accepts exact source text, a copula-only edit, and the compact source-derived permutation", () => {
    const fact = findFact(source);
    expect(fact).not.toBeNull();
    const sourceClause = source.split("，")[0]!;
    const candidates = [
      sourceClause,
      "由林安负责的排期日期为2026-11-03",
      "林安负责的排期日期为2026年11月3日",
      "林安负责的2026-11-03排期"
    ];
    for (const candidate of candidates) {
      expect(() => validateProseDateOwnerReplacement(fact!, sourceClause, candidate)).not.toThrow();
    }
  });

  it.each([
    ["date value", "林安负责的2026-11-04排期"],
    ["duplicate date", "林安负责的2026-11-03排期日期2026-11-03"],
    ["owner", "王安负责的2026-11-03排期"],
    ["event", "林安负责的2026-11-03辞退"],
    ["added event text", "林安负责的2026-11-03排期辞退"],
    ["negation", "林安不负责的2026-11-03排期"],
    ["status", "林安负责的2026-11-03已完成排期"],
    ["unit", "林安负责的2026-11-03天排期"],
    ["sign", "林安负责的+2026-11-03排期"],
    ["relation split", "林安负责的排期，日期是2026-11-03"],
    ["terminal punctuation change", "林安负责的2026-11-03排期。"],
    ["non-equivalent copula", "林安负责的排期日期:2026-11-03"],
    ["Markdown", "林安负责的**2026-11-03**排期"]
  ])("rejects a candidate that changes the %s", (_name, candidate) => {
    const fact = findFact(source)!;
    const sourceClause = source.split("，")[0]!;
    expect(() => validateProseDateOwnerReplacement(fact, sourceClause, candidate)).toThrow();
  });

  it("types the fact shape independently from text-slot metadata", () => {
    const fact: ProseDateOwnerFact | null = findFact(source);
    expect(fact?.id).toMatch(/^prose-date-owner:/u);
  });

  it("does not let a legal owner/date edit hide changes in the same source tail", () => {
    const fact = findFact(source)!;
    expect(() => validateProseDateOwnerReplacement(
      fact, source, "林安负责的2026-11-03排期，请各位确认。"
    )).toThrow();
    expect(() => validateProseDateOwnerReplacement(fact, source, source)).not.toThrow();
  });

  it("does not allow dates to swap between independently owned source clauses", () => {
    const original = "由林安负责的排期日期是2026-11-03。\n\n由周明负责的交付日期是2026-11-04。";
    const splitAt = original.indexOf("\n\n");
    const facts = [findFact(original, 0, splitAt), findFact(original, splitAt + 2, original.length)]
      .filter((fact): fact is ProseDateOwnerFact => fact !== null);
    expect(facts).toHaveLength(2);
    expect(() => validateProseDateFactLedger(original,
      "由林安负责的排期日期是2026-11-04。\n\n由周明负责的交付日期是2026-11-03。", facts)).toThrow();
  });

  it("scans only a bounded source scope even when the document has a long prefix", () => {
    const prefix = "普通说明。\n".repeat(4_000);
    const tail = "由周明负责的交付日期为2027-02-28。";
    const source = `${prefix}${tail}`;
    const fact = findFact(source, prefix.length, source.length);
    expect(fact?.date.from).toBe(prefix.length + tail.indexOf("2027-02-28"));
  });

  it("keeps owner/date qualification local across many short source lines", () => {
    const lines = Array.from({ length: 160 }, (_, index) =>
      `由周明负责的交付日期为2027-02-${String(index % 28 + 1).padStart(2, "0")}。`);
    const document = lines.join("\n");
    const candidates = buildThinProseSlots(document, "润色正文")
      .filter(slot => slot.dateOwnerCandidate);
    const facts = new Map(candidates.map(slot => [slot.dateOwnerCandidate!.id, slot.dateOwnerCandidate!]));

    expect(facts.size).toBe(lines.length);
    for (const fact of facts.values()) {
      expect(Array.from(document.slice(fact.scope.from, fact.scope.to)).length).toBeLessThanOrEqual(256);
      expect(document.slice(fact.scope.from, fact.scope.to)).toMatch(/^由周明负责的交付日期为2027-02-\d{2}。$/u);
      expect(document.slice(fact.date.from, fact.date.to)).toBe(fact.date.sourceSurface);
    }
  });
});

describe("date-owned prose pipeline", () => {
  it("keeps one complete date inside a real nonempty source slot and plan piece", () => {
    const slots = buildThinProseSlots(source, "润色正文使其简洁，不改变日期和负责人。");
    const dateSlots = slots.filter(slot => slot.dateOwnerCandidate);
    expect(dateSlots).toHaveLength(2);
    expect(new Set(dateSlots.map(slot => slot.dateOwnerCandidate!.id)).size).toBe(1);
    expect(dateSlots.every(slot => !slot.sourceText.includes("2026-11-03"))).toBe(true);
    expect(dateSlots[0]!.sourceText.length).toBeGreaterThan(0);

    const plan = planReadableProse(source, slots);
    expect(plan).not.toBeNull();
    const owners = plan!.slots.filter(slot => slot.dateOwnerFact);
    expect(owners).toHaveLength(1);
    expect(owners[0]!.sourceText).toContain("2026-11-03");
    expect(plan!.jobs.map(job => job.kind ?? "model")).toEqual(["model", "literal", "model"]);
    expect(plan!.jobs[0]!.view.text).toContain("2026-11-03");
    expect(() => plan!.jobs[0]!.view.decode("林安负责的2026-11-03排期。" )).toThrow();
    expect(plan!.jobs[1]!.view.text).toBe("，");
    expect(plan!.jobs[2]!.view.text).toBe("请请大家进行确认。");
  });

  it("activates only a complete date-at-end scope, without an empty trailing slot", () => {
    const selected = "由林安负责的排期日期是2026-11-03";
    const slots = buildThinProseSlots(selected, "润色选中内容，不改变日期和负责人。");
    const plan = planReadableProse(selected, slots);
    expect(plan).not.toBeNull();
    expect(plan!.slots).toHaveLength(1);
    expect(plan!.slots[0]!.sourceText).toBe(selected);
    expect(plan!.slots[0]!.range).toEqual({ from: 0, to: selected.length });
    expect(plan!.slots.every(slot => slot.sourceText.length > 0)).toBe(true);
    const decoded = plan!.jobs[0]!.view.decode("林安负责的2026-11-03排期");
    expect([...decoded.values()]).toEqual(["林安负责的2026-11-03排期"]);
  });

  it("keeps a source terminal period in the date-owned source range", async () => {
    const text = "由林安负责的排期日期是2026-11-03。";
    const slots = buildThinProseSlots(text, "润色正文，不改变日期和负责人。");
    const plan = planReadableProse(text, slots);
    expect(plan).not.toBeNull();
    expect(plan!.slots).toHaveLength(1);
    expect(plan!.slots[0]!.sourceText).toBe(text);
    expect(plan!.jobs[0]!.view.text).toBe(text);

    const invoke = vi.fn<AiTaskRunnerOptions["invoke"]>(async () => "林安负责的2026-11-03排期。");
    const options: AiTaskRunnerOptions = { invoke, isCurrent: () => true, abortCurrent: vi.fn() };
    const result = await runThinProseTask({ source: text, instruction: "润色正文，不改变日期和负责人。",
      systemPrompt: "", preferReadable: true }, createAiTaskExecution(options), options);
    expect(result.text).toBe("林安负责的2026-11-03排期。");
  });

  it("runs one owner/date clause and one confirmation clause without touching source before acceptance", async () => {
    const responses = ["林安负责的2026-11-03排期", "请大家确认。"];
    const invoke = vi.fn<AiTaskRunnerOptions["invoke"]>(async () => responses.shift()!);
    const options: AiTaskRunnerOptions = { invoke, isCurrent: () => true, abortCurrent: vi.fn() };
    const execution = createAiTaskExecution(options);

    const result = await runThinProseTask({
      source,
      instruction: "润色正文使其简洁，不改变日期和负责人。",
      systemPrompt: "",
      preferReadable: true
    }, execution, options);

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(result.text).toBe("林安负责的2026-11-03排期，请大家确认。");
    expect(source).toBe("由林安负责的排期日期是2026-11-03，请请大家进行确认。");
    expect(() => validateProseDateFactLedger(source, result.text, buildThinProseSlots(source, "润色正文").flatMap(slot =>
      slot.dateOwnerFact ? [slot.dateOwnerFact] : []))).not.toThrow();
    expect(() => validateMarkdownAstIntegrity(source, result.text, true)).not.toThrow();
  });

  it.each([
    ["without an owner relation", "排期日期是2026-11-03，请确认。", "排期日期是2026-11-03，请确认。"],
    ["after a second protected fact", "由林安负责的排期日期是2026-11-03，金额为5万元。", "由林安负责的排期日期是2026-11-03，金额为5万元。"],
    ["inside a list AST node", "- 由林安负责的排期日期是2026-11-03。", "- 由林安负责的排期日期是2026-11-03。"],
    ["inside a quote AST node", "> 由林安负责的排期日期是2026-11-03。", "> 由林安负责的排期日期是2026-11-03。"],
    ["outside an exact selected construction", "前缀由林安负责的排期日期是2026-11-03。", "前缀由林安负责的排期日期是2026-11-03。"]
  ])("falls back to the ordinary readonly path for a scoped source %s", (_label, text) => {
    expect(buildThinProseSlots(text, "润色正文").some(slot => slot.dateOwnerCandidate)).toBe(false);
  });

  it.each([
    ["fence", "\x60\x60\x60text\n", "\n\x60\x60\x60"],
    ["blockquote", "> ", ""],
    ["link label", "[", "](https://example.invalid/plan)"],
    ["strong emphasis", "**", "**"]
  ])("uses full-document AST ancestors for a selected %s", (_label, prefix, suffix) => {
    const fullDocument = prefix + source + suffix;
    const from = prefix.length;
    const slots = buildThinProseSlots(source, "润色选中内容，不改变日期和负责人。", "", {
      document: fullDocument,
      range: { from, to: from + source.length }
    });
    expect(slots.some(slot => slot.dateOwnerCandidate)).toBe(false);
  });

  it("does not activate the date owner when the frozen full document exceeds the AST byte budget", () => {
    const selected = "由林安负责的排期日期是2026-11-03";
    const document = "x".repeat(1_048_577) + "\n" + selected;
    const from = document.length - selected.length;
    const slots = buildThinProseSlots(selected, "润色选中内容，不改变日期和负责人。", "", {
      document,
      range: { from, to: document.length }
    });
    expect(slots.some(slot => slot.dateOwnerCandidate)).toBe(false);
    expect(slots.every(slot => !slot.dateOwnerFact)).toBe(true);
    expect(planReadableProse(selected, slots)?.slots.some(slot => slot.dateOwnerFact)).toBe(false);
  });

  it("does not activate the date owner when an unrelated full-document AST exceeds the depth budget", () => {
    const selected = "由林安负责的排期日期是2026-11-03";
    const nested = "> ".repeat(130) + "深层说明\n\n";
    const document = nested + selected;
    const from = nested.length;
    const slots = buildThinProseSlots(selected, "润色选中内容，不改变日期和负责人。", "", {
      document,
      range: { from, to: document.length }
    });
    expect(slots.some(slot => slot.dateOwnerCandidate)).toBe(false);
    expect(slots.every(slot => !slot.dateOwnerFact)).toBe(true);
    expect(planReadableProse(selected, slots)?.slots.some(slot => slot.dateOwnerFact)).toBe(false);
  });

  it("does not activate the date owner when an unrelated full-document AST exceeds the node budget", () => {
    const selected = "由林安负责的排期日期是2026-11-03";
    const unrelatedList = Array.from({ length: 30_000 }, (_, index) => "- item " + index).join("\n");
    const document = selected + "\n\n" + unrelatedList;
    expect(new TextEncoder().encode(document).byteLength).toBeLessThan(1_048_576);
    const slots = buildThinProseSlots(selected, "润色选中内容，不改变日期和负责人。", "", {
      document,
      range: { from: 0, to: selected.length }
    });
    expect(slots.some(slot => slot.dateOwnerCandidate)).toBe(false);
    expect(slots.every(slot => !slot.dateOwnerFact)).toBe(true);
    expect(planReadableProse(selected, slots)?.slots.some(slot => slot.dateOwnerFact)).toBe(false);
  });

  it.each([
    ["timezone suffix", " UTC"],
    ["date range suffix", " 至2026-11-04"],
    ["unit suffix", "天"]
  ])("does not split a selected date from its enclosing full-document %s", (_label, suffix) => {
    const text = "由林安负责的排期日期是2026-11-03";
    const fullDocument = text + suffix;
    const slots = buildThinProseSlots(text, "润色选中内容，不改变日期和负责人。", "", {
      document: fullDocument,
      range: { from: 0, to: text.length }
    });
    expect(slots.some(slot => slot.dateOwnerCandidate)).toBe(false);
  });
});
