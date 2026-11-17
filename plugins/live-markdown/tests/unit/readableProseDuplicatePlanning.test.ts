import { describe, expect, it } from "vitest";
import { buildThinProseSlots, type ThinProseSlot } from "../../src/core/ai/thinProseSlots";
import { planReadableProse } from "../../src/core/ai/readableProsePlan";

const instruction = "润色正文，删除完全重复的第二个句子，只保留一次提交结果的要求。";
const sentence = "请在周四提交结果。";

function decodeUnchanged(plan: NonNullable<ReturnType<typeof planReadableProse>>): Map<string, string> {
  return new Map(plan.jobs.flatMap(({ view }) => [...view.decode(view.text)]));
}

function applySlots(source: string, slots: readonly ThinProseSlot[], values: Map<string, string>): string {
  return [...slots].sort((left, right) => right.range.from - left.range.from).reduce((result, slot) =>
    result.slice(0, slot.range.from) + values.get(slot.id)! + result.slice(slot.range.to), source);
}

function plan(source: string, taskInstruction = instruction, scopeContext?: { document: string; range: { from: number; to: number } }) {
  const slots = buildThinProseSlots(source, taskInstruction, "", scopeContext);
  return planReadableProse(source, slots, { instruction: taskInstruction, scopeContext });
}

describe("explicit duplicate-sentence source ownership", () => {
  it("owns the captured adjacent duplicate run as one nonempty slot only for an explicit keep-one request", () => {
    const source = sentence + sentence;
    const result = plan(source);

    expect(result).not.toBeNull();
    expect(result!.slots).toHaveLength(1);
    expect(result!.slots[0]!.sourceText).toBe(source);
    expect(result!.slots[0]!.duplicateSentenceRun?.sentenceText).toBe(sentence);
    expect(result!.slots[0]!.duplicateSentenceRun?.copies).toHaveLength(2);
    expect(result!.jobs).toHaveLength(1);
    expect(result!.jobs[0]!.slotIds).toEqual([result!.slots[0]!.id]);
    expect(result!.jobs[0]!.view.text).toBe(source);
    expect(result!.jobs[0]!.view.decode(sentence).get(result!.slots[0]!.id)).toBe(sentence);
    expect(applySlots(source, result!.slots, decodeUnchanged(result!))).toBe(source);
  });

  it("keeps the legacy separate slots when the instruction does not authorize deletion", () => {
    const source = sentence + sentence;
    const result = plan(source, "只润色正文，不改变原意。");
    const legacy = planReadableProse(source, buildThinProseSlots(source, "只润色正文，不改变原意。"));

    expect(result).not.toBeNull();
    expect(result!.slots).toHaveLength(2);
    expect(result!.slots.every(slot => !slot.duplicateSentenceRun)).toBe(true);
    expect(legacy!.slots).toHaveLength(2);
    expect(() => legacy!.jobs[0]!.view.decode(sentence)).toThrow();
  });

  it.each([
    "删除完全重复的句子。",
    "只保留一次提交结果的要求。",
    "不要删除完全重复的第二个句子，只保留一次。",
    "删除完全重复的第二个句子，只保留两次。",
    "润色正文，删除完全重复的第二个句子，只保留一次并修改日期。"
  ])("does not authorize a broader or contradictory instruction: %s", taskInstruction => {
    const source = sentence + sentence;
    const result = plan(source, taskInstruction);
    expect(result).not.toBeNull();
    expect(result!.slots).toHaveLength(2);
    expect(result!.slots.every(slot => !slot.duplicateSentenceRun)).toBe(true);
  });

  it("only groups one exact run and rejects multiple runs, three copies with extra retained text, or changed sentences", () => {
    const three = sentence.repeat(3);
    const threePlan = plan(three);
    expect(threePlan!.slots).toHaveLength(1);
    expect(threePlan!.slots[0]!.duplicateSentenceRun?.copies).toHaveLength(3);

    const multipleRuns = sentence.repeat(2) + "请在周五确认。".repeat(2);
    const multiplePlan = plan(multipleRuns);
    expect(multiplePlan!.slots).toHaveLength(4);
    expect(multiplePlan!.slots.every(slot => !slot.duplicateSentenceRun)).toBe(true);

    const nonidentical = plan("请在周四提交结果。请在周五提交结果。");
    expect(nonidentical!.slots).toHaveLength(2);
    expect(nonidentical!.slots.every(slot => !slot.duplicateSentenceRun)).toBe(true);
  });

  it("does not group across lines or protected factual content", () => {
    for (const source of [
      `${sentence}\n${sentence}`,
      "请在2026-11-03提交结果。请在2026-11-03提交结果。"
    ]) {
      const result = plan(source);
      expect(result).not.toBeNull();
      expect(result!.slots.every(slot => !slot.duplicateSentenceRun)).toBe(true);
    }
  });

  it.each([
    (text: string) => `**${text}**`,
    (text: string) => `[${text}](https://example.invalid)`,
    (text: string) => `\`${text}\``,
    (text: string) => `> ${text}`,
    (text: string) => `- ${text}`,
    (text: string) => `\`\`\`text\n${text}\n\`\`\``
  ])("does not infer plain ownership from a selected substring inside Markdown structure", wrap => {
    const selectedSource = sentence + sentence;
    const document = wrap(selectedSource);
    const from = document.indexOf(selectedSource);
    const scopeContext = { document, range: { from, to: from + selectedSource.length } };
    const result = plan(selectedSource, instruction, scopeContext);

    expect(result).not.toBeNull();
    expect(result!.slots.every(slot => !slot.duplicateSentenceRun)).toBe(true);
  });

  it("rejects a selected fragment that happens to resemble repeated sentence windows", () => {
    const prefix = "先处理这件事，然后";
    const source = sentence + sentence;
    const document = prefix + source;
    const scopeContext = { document, range: { from: prefix.length, to: document.length } };
    const result = plan(source, instruction, scopeContext);

    expect(result).not.toBeNull();
    expect(result!.slots.every(slot => !slot.duplicateSentenceRun)).toBe(true);
  });

  it("supports a complete CRLF-scoped plain-text run without changing source bytes", () => {
    const line = sentence + sentence;
    const document = `${line}\r\n后续段落需要校对。`;
    const scopeContext = { document, range: { from: 0, to: line.length } };
    const result = plan(line, instruction, scopeContext);

    expect(result).not.toBeNull();
    expect(result!.slots).toHaveLength(1);
    expect(result!.slots[0]!.sourceText).toBe(line);
    expect(result!.slots[0]!.duplicateSentenceRun?.copies).toHaveLength(2);
    expect(applySlots(line, result!.slots, decodeUnchanged(result!))).toBe(line);
  });
});
