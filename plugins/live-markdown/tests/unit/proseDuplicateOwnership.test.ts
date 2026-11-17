import { describe, expect, it } from "vitest";
import { authorizesDuplicateSentenceRemoval, groupAuthorizedDuplicateSentenceRun, validateDuplicateSentenceReplacement } from "../../src/core/ai/proseDuplicateOwnership";
import { buildThinProseSlots } from "../../src/core/ai/thinProseSlots";
import { planReadableProse } from "../../src/core/ai/readableProsePlan";

const instruction = "润色正文，删除完全重复的第二个句子，只保留一次提交结果的要求。";
const sentence = "请在周四提交结果。";

describe("source-derived duplicate sentence ownership", () => {
  it.each([
    [instruction, true],
    ["删除重复句，只保留一个。", true],
    ["删除第三个重复句，只保留一个。", true],
    ["删除完全重复的第三个句子，只保留一个。", true],
    ["删除第三个相同句，只保留一个。", false],
    ["删除第三个句子，只保留一个。", false],
    ["删除完全句，只保留一个。", false],
    ["删除全部句子，只保留一个。", false],
    ["删除完全重复的第二个句子。", false],
    ["只保留一次提交结果。", false],
    ["不要删除重复句，只保留一次。", false],
    ["删除重复句并增加标题，只保留一次。", false],
    ["删除重复句，保留两份。", false],
    ["润色正文，删除重复句，只保留一次并修改日期。", false],
    ["润色正文，删除重复句，只保留一次；再总结重点。", false]
  ])("recognizes only a single positive remove-and-keep-one operation: %s", (value, expected) => {
    expect(authorizesDuplicateSentenceRemoval(value)).toBe(expected);
  });

  it.each([
    "删除重复句，只保留一个？",
    "删除重复句，只保留一个吗？",
    "删除重复句？只保留一个。",
    "删除重复句，只保留一个吗。",
    "删除重复句，只保留一个么",
    "删除重复句，只保留一个呢"
  ])("does not grant destructive authority from an interrogative instruction: %s", value => {
    expect(authorizesDuplicateSentenceRemoval(value)).toBe(false);
    const source = sentence.repeat(3);
    const plan = planReadableProse(source, buildThinProseSlots(source, value), { instruction: value });
    expect(plan?.slots.some(slot => slot.duplicateSentenceRun)).toBe(false);
  });

  it.each([
    "删除重复句，只保留一个吗。润色正文。",
    "删除重复句，只保留一个呢，校对正文。",
    "删除重复句，只保留一个的话。",
    "删除重复句，只保留一次是否合适。",
    "删除重复句，只保留一次能否满足要求。"
  ])("does not accept interrogative, conditional, or open-ended keep-one tails: %s", value => {
    expect(authorizesDuplicateSentenceRemoval(value)).toBe(false);
    const source = sentence.repeat(3);
    const plan = planReadableProse(source, buildThinProseSlots(source, value), { instruction: value });
    expect(plan?.slots.some(slot => slot.duplicateSentenceRun)).toBe(false);
  });

  it.each([
    "删除重复句，只保留一个是否合适的要求。",
    "删除重复句，只保留一个如果可行的要求。",
    "删除重复句，只保留一次能否满足要求的结果。"
  ])("requires a keep-one object phrase to be grounded in the repeated source: %s", value => {
    const source = sentence.repeat(3);
    const plan = planReadableProse(source, buildThinProseSlots(source, value), { instruction: value });
    expect(plan?.slots.some(slot => slot.duplicateSentenceRun)).toBe(false);
  });

  it("accepts exactly one source copy and rejects empty, changed, or repeated candidate text", () => {
    const source = sentence.repeat(3);
    const plan = planReadableProse(source, buildThinProseSlots(source, instruction), { instruction });
    const slot = plan!.slots[0]!;

    expect(validateDuplicateSentenceReplacement(slot, sentence, source)).toBe(sentence);
    for (const invalid of ["", sentence.repeat(2), sentence.replace("周四", "周五")]) {
      expect(() => validateDuplicateSentenceReplacement(slot, invalid, source)).toThrow(/一个原句副本/u);
    }
  });

  it("does not treat ordinary slots as carrying duplicate-delete authority", () => {
    const source = sentence + sentence;
    const plan = planReadableProse(source, buildThinProseSlots(source, "只润色正文，不改变原意。"));
    expect(plan!.slots.every(slot => validateDuplicateSentenceReplacement(slot, slot.sourceText, source) === slot.sourceText)).toBe(true);
  });

  it("does not take a safe-looking suffix from a larger run containing a date-owned copy", () => {
    const source = sentence.repeat(3);
    const slots = buildThinProseSlots(source, instruction).map((slot, index) =>
      index === 0 ? { ...slot, dateOwnerCandidate: { id: "owner" } } : slot);

    expect(groupAuthorizedDuplicateSentenceRun(source, slots, instruction)).toBeNull();
  });
});
