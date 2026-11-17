import { describe, expect, it } from "vitest";
import { buildThinProseSlots } from "../../src/core/ai/thinProseSlots";
import { prepareReadableProse } from "../../src/core/ai/readableProseView";
import { restoreUniqueEnglishIntegerSpellings } from "../../src/core/ai/proseNumericSpelling";

const instruction = "润色并纠正可读正文的语法错误，保留已有 Markdown 格式、数字和单位不变。";

function prepare(source: string) {
  const slots = buildThinProseSlots(source, instruction);
  const view = prepareReadableProse(source, slots);
  return { slots, view };
}

function apply(source: string, slots: ReturnType<typeof buildThinProseSlots>, values: Map<string, string>): string {
  return [...slots].reverse().reduce((result, slot) =>
    result.slice(0, slot.range.from) + values.get(slot.id)! + result.slice(slot.range.to), source);
}

describe("readable prose numeric spelling restoration", () => {
  it("normalizes a uniquely equivalent readonly integer before the postpass while retaining user text", () => {
    const source = "The release has 3 stages, and each stage needs approval.";
    const { slots, view } = prepare(source);
    expect(view).not.toBeNull();
    const raw = "The release has three stages, and each stage requires approval.";
    const normalized = "The release has 3 stages, and each stage requires approval.";

    expect(view!.normalizeReadonlySurface(raw)).toBe(normalized);
    expect(apply(source, slots, view!.decode(raw))).toBe(normalized);
  });

  it("does not normalize multiple same-valued facts when their correspondence is ambiguous", () => {
    const source = "The release has 3 stages and 3 checks.";
    const raw = "The release has three stages and three checks.";
    const { view } = prepare(source);
    expect(view).not.toBeNull();

    expect(view!.normalizeReadonlySurface(raw)).toBe(raw);
    expect(() => view!.decode(raw)).toThrow(/只读/u);
  });

  it("restores the exact source integer when a Qwen correction only spells it out", () => {
    const source = "The release have 3 stages, and each stage need approval.";
    const { slots, view } = prepare(source);
    expect(view).not.toBeNull();

    const edits = view!.decode("The release has three stages, and each stage needs approval.");
    expect(apply(source, slots, edits)).toBe("The release has 3 stages, and each stage needs approval.");
  });

  it.each([
    ["changed value", "The release have 3 stages, and need approval.", "The release has four stages, and needs approval."],
    ["dropped number", "The release have 3 stages, and need approval.", "The release has stages, and needs approval."],
    ["duplicated number", "The release have 3 stages, and need approval.", "The release has three three stages, and needs approval."],
    ["swapped quantities", "The release have 3 stages and need 5 approvals.", "The release has five stages and needs three approvals."],
    ["changed unit", "The release have 3 stages, and need approval.", "The release has three days, and needs approval."],
    ["percentage", "The release have 3% growth, and need approval.", "The release has three% growth, and needs approval."],
    ["percentage word", "The release have 3 percent growth, and need approval.", "The release has three percent growth, and needs approval."],
    ["date", "The release have 3/4 stages, and need approval.", "The release has three/4 stages, and needs approval."],
    ["decimal", "The release have 3.5 stages, and need approval.", "The release has three point five stages, and needs approval."],
    ["signed number", "The release have -3 stages, and need approval.", "The release has minus three stages, and needs approval."],
    ["identifier", "R3 have 4 stages, and need approval.", "Rthree has 4 stages, and needs approval."]
  ])("still rejects %s", (_label, source, raw) => {
    const { view } = prepare(source);
    expect(view).not.toBeNull();
    expect(() => view!.decode(raw)).toThrow();
  });

  it("rejects a cardinal word embedded after an astral Unicode letter", () => {
    const source = "The release have 3 stages, and each stage need approval.";
    const { view } = prepare(source);
    expect(view).not.toBeNull();
    expect(() => view!.decode("The release has 𐐀three stages, and each stage needs approval.")).toThrow();
  });

  it.each(["𐐀three stages", "x\u0301three stages"]) (
    "does not restore a cardinal inside a Unicode word: %s", raw => {
      expect(restoreUniqueEnglishIntegerSpellings("3 stages", raw, [{ from: 0, to: 8 }])).toBe(raw);
    }
  );

  it("keeps URLs, code, emoji, and an adjacent quantity untouched", () => {
    const source = "🙂 The release have 3 stages. Read [guide](https://private.invalid/doc), keep `R3`, and retain 10.5%.";
    const { slots, view } = prepare(source);
    expect(view).not.toBeNull();
    const raw = view!.text.replace("have", "has").replace("3 stages", "three stages");
    const edits = view!.decode(raw);
    expect(apply(source, slots, edits)).toBe("🙂 The release has 3 stages. Read [guide](https://private.invalid/doc), keep `R3`, and retain 10.5%.");
  });

  it("does not resolve repeated candidate context ambiguously", () => {
    const source = "The release have 3 stages, then note 3 stages before need approval.";
    const { view } = prepare(source);
    expect(view).not.toBeNull();
    expect(() => view!.decode("The release has three stages, then note three stages before needs approval.")).toThrow();
  });

  it.each([
    ["one hundred", "The release has one hundred three stages, and each stage needs approval."],
    ["one hundred and", "The release has one hundred and three stages, and each stage needs approval."],
    ["ordinal suffix", "The release has threefold stages, and each stage needs approval."],
    ["uppercase", "The release has Three stages, and each stage needs approval."],
    ["hyphenated", "The release has twenty-three stages, and each stage needs approval."],
    ["joined prefix", "The release has hundredthree stages, and each stage needs approval."]
  ])("does not restore an unsupported composite cardinal form: %s", (_label, raw) => {
    const source = "The release have 3 stages, and each stage need approval.";
    const { view } = prepare(source);
    expect(view).not.toBeNull();
    expect(() => view!.decode(raw)).toThrow();
  });
});
