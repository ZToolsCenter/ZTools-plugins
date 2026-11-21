import { describe, expect, it } from "vitest";
import { parseIntentOutput } from "../../src/core/ai/intentSchema";
import type { IntentCandidates } from "../../src/core/ai/intentTypes";

const literals = (oldText = "hello", newText = "helloworld"): IntentCandidates => ({
  headings: [],
  literals: [
    { id: "literal-old", text: oldText },
    { id: "literal-new", text: newText }
  ]
});

function replacePlan(fields: Record<string, unknown> = {}): string {
  return JSON.stringify({
    version: 1,
    kind: "edit",
    operation: "replace_exact",
    target: "document",
    content: { mode: "literal", literalId: "literal-new" },
    findId: "literal-old",
    occurrence: "last",
    ...fields
  });
}

describe("AI exact-replacement wire protocol", () => {
  it("resolves a grounded findId into canonical internal find and accepts unquoted bottom wording", () => {
    const intent = parseIntentOutput(
      replacePlan(),
      "底部 hello 改成 helloworld",
      literals()
    );
    expect(intent).toMatchObject({ operation: "replace_exact", find: "hello", occurrence: "last" });
    expect(intent).not.toHaveProperty("findId");
  });

  it.each([
    "把文末的 ‘hello’ 改成 ‘helloworld’",
    "把最后的 hello 改成 helloworld",
    "把最后一个 hello 改成 helloworld",
    "把末尾的 hello 改成 helloworld",
    "把 ‘hello’ 改成 ‘helloworld’，位置在末尾",
    "replace the last occurrence of ‘hello’ with ‘helloworld’",
    "replace the last match of ‘hello’ with ‘helloworld’",
    "change ‘hello’ to ‘helloworld’ at the bottom"
  ])("accepts explicit final-position wording: %s", (instruction) => {
    expect(() => parseIntentOutput(replacePlan(), instruction, literals())).not.toThrow();
  });

  it.each([
    "不要替换最后一处的 ‘hello’，改成 ‘helloworld’",
    "不改底部的 ‘hello’，改成 ‘helloworld’",
    "把 ‘hello’ 改成 ‘helloworld’，不要动最后一处",
    "把第一处 hello 改成 helloworld，底部 hello 不要动",
    "底部的 hello 保持不变",
    "replace ‘hello’ with ‘helloworld’",
    "do not replace the last match of ‘hello’ with ‘helloworld’",
    "keep the last occurrence of ‘hello’ unchanged"
  ])("does not let quoted, missing, or negated wording authorize last: %s", (instruction) => {
    expect(() => parseIntentOutput(replacePlan(), instruction, literals())).toThrow();
  });

  it("does not treat quoted location words as scope, even when they are valid literal IDs", () => {
    expect(() => parseIntentOutput(
      replacePlan(),
      "把 ‘底部’ 改成 ‘末尾’",
      literals("底部", "末尾")
    )).toThrow();
  });

  it("masks book quotes, escaped ASCII quotes, and inline code before location detection", () => {
    const instruction = "把hello改成helloworld，注意《底部》只是引用的词";
    expect(() => parseIntentOutput(replacePlan(), instruction, literals())).toThrow();

    const escaped = "把hello改成helloworld；解释一下\"say \\\"bottom\\\" now\"";
    expect(() => parseIntentOutput(replacePlan(), escaped, literals())).toThrow();

    const backtick = "把hello改成helloworld，说明 `last match` 是引用文本";
    expect(() => parseIntentOutput(replacePlan(), backtick, literals())).toThrow();
  });

  it.each([
    ["把第一处 hello 改成 bottom", "hello", "bottom"],
    ["把第一处 hello 改成 last match", "hello", "last match"],
    ["把第一处 hello 改成 文末", "hello", "文末"],
    ["把第一处 bottom 改成 helloworld", "bottom", "helloworld"]
  ])("does not let a grounded old/new literal masquerade as the last-position instruction: %s", (instruction, oldText, newText) => {
    expect(() => parseIntentOutput(replacePlan(), instruction, literals(oldText, newText))).toThrow();
  });

  it("rejects last when the instruction negates bottom and positively targets another occurrence", () => {
    expect(() => parseIntentOutput(
      replacePlan(),
      "不要改底部，把第一处 hello 改成 helloworld",
      literals()
    )).toThrow();
  });

  it("keeps a positive bottom replacement valid when an unrelated negative clause comes first", () => {
    const instruction = "不要改其它部分，只把底部 hello 改成 helloworld";
    expect(() => parseIntentOutput(replacePlan(), instruction, literals())).not.toThrow();
  });

  it("masks quoted or payload occurrence wording and rejects negated all or ordinal scopes", () => {
    const quotedAll = "把 hello 改成 helloworld，说明 ‘all occurrences’ 的含义";
    expect(() => parseIntentOutput(replacePlan({ occurrence: "all" }), quotedAll, literals())).toThrow();

    const payloadAll = "把第一处 hello 改成 all occurrences";
    expect(() => parseIntentOutput(replacePlan({ occurrence: "all" }), payloadAll, literals("hello", "all occurrences"))).toThrow();

    const negatedAll = "不要全部替换 hello，改成 helloworld";
    expect(() => parseIntentOutput(replacePlan({ occurrence: "all" }), negatedAll, literals())).toThrow();
    const trailingNegatedAll = "把所有 hello 不要替换，改成 world";
    expect(() => parseIntentOutput(replacePlan({ occurrence: "all" }), trailingNegatedAll, literals("hello", "world"))).toThrow();

    const payloadOrdinal = "把第一处 hello 改成第二处";
    expect(() => parseIntentOutput(replacePlan({ occurrence: 2 }), payloadOrdinal, literals("hello", "第二处"))).toThrow();
    const quotedOrdinal = "把 hello 改成 helloworld，说明 ‘第二处’ 的写法";
    expect(() => parseIntentOutput(replacePlan({ occurrence: 2 }), quotedOrdinal, literals())).toThrow();

    const negatedOrdinal = "不要改第二处 hello，把 helloworld 留给它";
    expect(() => parseIntentOutput(replacePlan({ occurrence: 2 }), negatedOrdinal, literals())).toThrow();
    const trailingNegatedOrdinal = "第二处 hello 不要改，改成 world";
    expect(() => parseIntentOutput(replacePlan({ occurrence: 2 }), trailingNegatedOrdinal, literals("hello", "world"))).toThrow();
  });

  it("requires exactly one grounded old-text reference", () => {
    const instruction = "底部 hello 改成 helloworld";
    expect(() => parseIntentOutput(replacePlan({ find: "hello" }), instruction, literals())).toThrow();
    expect(() => parseIntentOutput(replacePlan({ findId: undefined }), instruction, literals())).toThrow();
    expect(() => parseIntentOutput(replacePlan({ findId: "unknown" }), instruction, literals())).toThrow();
    expect(() => parseIntentOutput(replacePlan(), "底部其他 改成 helloworld", literals())).toThrow();
  });

  it("rejects findId on rewrite and last on exact-match insertion", () => {
    const rewrite = JSON.stringify({
      version: 1,
      kind: "edit",
      operation: "rewrite",
      target: "document",
      content: { mode: "generate", task: "custom" },
      findId: "literal-old"
    });
    expect(() => parseIntentOutput(rewrite, "改写全文", literals())).toThrow();

    const insert = JSON.stringify({
      version: 1,
      kind: "edit",
      operation: "insert",
      target: "exact_match",
      layout: "inline",
      content: { mode: "literal", literalId: "literal-new" },
      find: "hello",
      occurrence: "last",
      matchScope: "document"
    });
    expect(() => parseIntentOutput(insert, "在文末 hello 后加 helloworld", literals())).toThrow();
  });

  it("keeps existing single, all, and ordinal replacement forms working", () => {
    const single = parseIntentOutput(replacePlan({ findId: undefined, find: "hello", occurrence: "single" }), "把 hello 替换为 helloworld", literals());
    expect(single).toMatchObject({ find: "hello", occurrence: "single" });

    const all = parseIntentOutput(replacePlan({ occurrence: "all" }), "把所有 hello 替换为 helloworld", literals());
    expect(all).toMatchObject({ find: "hello", occurrence: "all" });

    const second = parseIntentOutput(replacePlan({ occurrence: 2 }), "把第 2 处 hello 替换为 helloworld", literals());
    expect(second).toMatchObject({ find: "hello", occurrence: 2 });
  });
});
