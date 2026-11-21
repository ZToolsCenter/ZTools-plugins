import { describe, expect, it } from "vitest";
import { extractIntentLiterals } from "../../src/core/ai/intentLiterals";

const texts = (instruction: string) => extractIntentLiterals(instruction).map((item) => item.text);

describe("lossless intent data candidates", () => {
  it.each([
    ["底部hello改成helloworld", ["hello", "helloworld"]],
    ["把文末的 hello 改成 helloworld", ["hello", "helloworld"]],
    ["将v1.2.0替换为v2.0.1", ["v1.2.0", "v2.0.1"]],
    ["把所有 foo bar 改成 baz qux", ["foo bar", "baz qux"]],
    ["底部hello改成**world**", ["hello", "**world**"]],
    ["底部hello改成[world](https://example.com)", ["hello", "[world](https://example.com)"]],
    ["底部hello改成$world$", ["hello", "$world$"]],
    ["把 **hello** 改成 **world**", ["**hello**", "**world**"]],
    ["底部加**hello**", ["**hello**"]],
    ["文末加一行：hello", ["hello"]],
    ["把第2处hello改成helloworld", ["hello", "helloworld"]],
    ["把“草案”换成“终稿”", ["草案", "终稿"]],
    ["把「 old 」改成『 new 』", [" old ", " new "]],
    ["底部加个hello， world  ", ["hello， world  "]]
  ])("provides raw data, without assigning old/new roles: %s", (instruction, expected) => {
    expect(texts(instruction)).toEqual(expected);
    for (const text of texts(instruction)) expect(instruction.includes(text)).toBe(true);
  });

  it("does not equate candidate extraction with an edit command", () => {
    expect(texts("解释v1和v2之间的区别")).toEqual(["v1", "v2"]);
    expect(texts("不要把foo换成bar")).toEqual(["foo", "bar"]);
    expect(texts("底部加hello，world后不要改原文")).toEqual([]);
  });

  it("bounds unquoted data and preserves quoted content including escapes", () => {
    expect(texts(`把${"a".repeat(257)}改成b`)).toEqual([]);
    expect(texts(Array.from({ length: 17 }, (_, i) => `第${i}项`).join(""))).toEqual([]);
    expect(texts('把"a\\"b"改成"c"')).toEqual(['a\\"b', "c"]);
    expect(texts("replace foo with bar")).toEqual([]);
  });
});
