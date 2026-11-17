import { describe, expect, it } from "vitest";
import { buildIntentOutputSchema, intentOccurrenceChoices } from "../../src/core/ai/intentOutputSchema";
import { buildAiIntentCandidates } from "../../src/core/ai/intentContext";

type WireSchema = { anyOf?: WireSchema[]; properties?: Record<string, WireSchema>; const?: unknown; enum?: unknown[] };
const values = (schema: WireSchema | undefined): unknown[] => schema?.enum ?? (schema && "const" in schema ? [schema.const] : []);
const branches = (instruction: string, source = "正文") => buildIntentOutputSchema(instruction, false, buildAiIntentCandidates(instruction, source)).anyOf as WireSchema[];

describe("grounded instruction constraints on the public wire schema", () => {
  it.each([
    ['把第 3 处“hello”替换为“world”。', [3]],
    ['Replace the last draft with final in the document.', ["last"]]
  ])("does not exclude the requested occurrence: %s", (instruction, expected) => {
    expect(intentOccurrenceChoices(instruction, buildAiIntentCandidates(instruction, "hello draft"))).toEqual(expected);
  });

  it("allows the cursor insertion and excludes EOF when the cursor is explicit", () => {
    const edits = branches('在光标处原样插入“  keep spaces  ”').filter(branch => values(branch.properties?.kind).includes("edit"));
    expect(edits.length).toBeGreaterThan(0);
    for (const branch of edits) {
      expect(values(branch.properties?.operation)).toEqual(["insert"]);
      expect(values(branch.properties?.target)).toEqual(["cursor"]);
      expect(values(branch.properties?.layout)).toEqual(["inline"]);
      expect(JSON.stringify(branch.properties?.content)).not.toContain('"generate"');
    }
  });

  it("does not allow answer or generate branches to replace a quoted literal append", () => {
    const wire = branches('在文末新增一段“发布说明”');
    expect(wire.some(branch => values(branch.properties?.kind).includes("answer"))).toBe(false);
    const edits = wire.filter(branch => values(branch.properties?.kind).includes("edit"));
    expect(edits.length).toBeGreaterThan(0);
    expect(edits.every(branch => values(branch.properties?.target).join() === "document_end")).toBe(true);
    expect(edits.every(branch => !JSON.stringify(branch.properties?.content).includes('"generate"'))).toBe(true);
  });
});
