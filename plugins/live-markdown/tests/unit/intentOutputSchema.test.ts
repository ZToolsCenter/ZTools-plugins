import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { buildAiIntentCandidates } from "../../src/core/ai/intentContext";
import { buildIntentOutputSchema, intentOccurrenceChoices } from "../../src/core/ai/intentOutputSchema";
const { validateOutputSchema } = createRequire(import.meta.url)("../../preload/local-ai/output-constraint.cjs");

describe("per-request intent decoding constraints", () => {
  it.each([
    ["底部hello改成helloworld", ["last"]],
    ["把所有hello改成helloworld", ["all"]],
    ["把hello改成helloworld", ["single"]],
    ["把第2处hello改成helloworld", [2]],
    ["把第12处hello改成helloworld", [12]],
    ["把第二处hello改成helloworld", [2]],
    ["replace the 2nd occurrence of hello with world", [2]],
    ["把hello改成“all occurrences”", ["single"]],
    ["把hello改成“文末”", ["single"]],
    ["把hello改成helloworld，底部hello不要动", ["single"]]
  ])("projects only grounded qualifiers, leaving the operation to the model: %s", (instruction, expected) => {
    expect(intentOccurrenceChoices(instruction, buildAiIntentCandidates(instruction, "hello"))).toEqual(expected);
  });

  it("narrows explicit replacements to their grounded target, payload and occurrence", () => {
    const instruction = "底部hello改成helloworld";
    const candidates = buildAiIntentCandidates(instruction, "hello\n\nhello");
    const schema = buildIntentOutputSchema(instruction, false, candidates);
    const serialized = JSON.stringify(schema);
    expect(serialized).not.toContain('"selection"');
    expect(serialized).not.toContain('"selection_end"');
    expect(serialized).not.toContain('"const":"insert"');
    expect(serialized).not.toContain('"const":"rewrite"');
    expect(serialized).not.toContain('"const":"answer"');
    const replaceBranches = (schema.anyOf as Array<{ properties: Record<string, { const?: unknown; enum?: unknown[] }> }>)
      .filter((branch) => branch.properties.operation?.const === "replace_exact");
    expect(replaceBranches).toHaveLength(2); // The grounded find-ID and direct text wire forms.
    expect(replaceBranches.every((branch) => JSON.stringify(branch.properties.occurrence.enum) === '["last"]')).toBe(true);
    for (const branch of replaceBranches) {
      expect(branch.properties.target).toEqual({ const: "document" });
      expect(JSON.stringify(branch.properties.content)).not.toContain('"generate"');
      expect(JSON.stringify(branch.properties.content)).not.toContain('"literal-1"');
    }
  });

  it("keeps typical bounded candidates within the preload schema budget and excludes source prose", () => {
    const candidates = {
      headings: Array.from({ length: 32 }, (_, index) => ({ id: `heading:${index}:${index + 1}`, text: "不发送全文正文", level: 2 })),
      literals: Array.from({ length: 16 }, (_, index) => ({ id: `literal-${index + 1}`, text: "字面数据" }))
    };
    const json = JSON.stringify(buildIntentOutputSchema("末尾添加文字", false, candidates));
    expect(JSON.stringify(validateOutputSchema(JSON.parse(json)))).toBe(json);
    expect(new TextEncoder().encode(json).byteLength).toBeLessThan(32 * 1024);
    expect(json).not.toContain("不发送全文正文");
    expect(json).not.toContain("字面数据");
  });

  it("rejects incompatible grammar string bounds before invoking the managed server", () => {
    expect(() => validateOutputSchema({ type: "string", minLength: -1 })).toThrow(/minLength/);
    expect(() => validateOutputSchema({ type: "string", minLength: 2, maxLength: 1 })).toThrow(/conflicting/);
  });
});
