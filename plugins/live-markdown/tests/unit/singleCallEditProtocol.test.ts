import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { buildAiIntentCandidates } from "../../src/core/ai/intentContext";
import { deriveInstructionContract } from "../../src/core/ai/instructionConstraints";
import {
  buildSingleCallEditPrompt,
  buildSingleCallEditSchema,
  parseSingleCallEditResponse
} from "../../src/core/ai/singleCallEditProtocol";

const { validateOutputSchema } = createRequire(import.meta.url)("../../preload/local-ai/output-constraint.cjs");
const source = "# Existing\n\nKeep the original source.";

function input(instruction: string, selected = false, sourceText = source) {
  const contract = deriveInstructionContract(instruction, { hasSelection: selected, hasCursor: true });
  return { instruction, source: sourceText, selected, candidates: buildAiIntentCandidates(instruction, sourceText, contract), contract };
}

describe("single-call edit protocol", () => {
  it("adapts a complete answer response into a generated v1 intent", () => {
    const request = input("只回答这段说明的含义");
    const result = parseSingleCallEditResponse(JSON.stringify({
      version: 1, kind: "answer", target: "document", text: "这是说明的含义。"
    }), request);

    expect(result).toEqual({
      intent: { version: 1, kind: "answer", target: "document", content: { mode: "generate", task: "custom" } },
      text: "这是说明的含义。"
    });
  });

  it("adapts an insert response without treating its body as a grounded literal", () => {
    const request = input("在文末新增一段背景说明");
    const body = "这段说明由模型生成。";
    const result = parseSingleCallEditResponse(JSON.stringify({
      version: 1, kind: "edit", operation: "insert", target: "document_end", text: body
    }), request);

    expect(result).toEqual({
      intent: {
        version: 1, kind: "edit", operation: "insert", target: "document_end", layout: "block",
        content: { mode: "generate", task: "custom" }
      },
      text: body
    });
  });

  it("adapts rewrite and explicit last/all replacement operations", () => {
    const rewriteInput = input("润色全文");
    const rewrite = parseSingleCallEditResponse(JSON.stringify({
      version: 1, kind: "edit", operation: "rewrite", target: "document", text: "润色后的全文。"
    }), rewriteInput);
    expect(rewrite.intent).toMatchObject({
      kind: "edit", operation: "rewrite", target: "document", content: { mode: "generate", task: "custom" }
    });

    const summaryInput = input("总结全文");
    expect(summaryInput.contract.generationTasks).toMatchObject({ state: "explicit", value: ["summarize"] });
    const summary = parseSingleCallEditResponse(JSON.stringify({
      version: 1, kind: "answer", target: "document", text: "摘要内容。"
    }), summaryInput);
    expect(summary.intent).toMatchObject({ kind: "answer", content: { mode: "generate", task: "summarize" } });

    const lastInput = input("底部hello改成helloworld");
    const last = parseSingleCallEditResponse(JSON.stringify({
      version: 1, kind: "edit", operation: "replace_exact", target: "document", find: "hello", occurrence: "last", text: "helloworld"
    }), lastInput);
    expect(last.intent).toMatchObject({ kind: "edit", operation: "replace_exact", occurrence: "last" });

    const allInput = input("把所有hello替换成world");
    const all = parseSingleCallEditResponse(JSON.stringify({
      version: 1, kind: "edit", operation: "replace_exact", target: "document", find: "hello", occurrence: "all", text: "world"
    }), allInput);
    expect(all.intent).toMatchObject({ kind: "edit", operation: "replace_exact", occurrence: "all" });
  });

  it("accepts only an existing heading candidate ID", () => {
    const request = input("在‘Welcome’标题后新增一段说明", false, "# Welcome\n\n说明。");
    const targetId = request.candidates.headings[0]?.id;
    expect(targetId).toBeDefined();
    const wire = {
      version: 1, kind: "edit", operation: "insert", target: "heading_end", targetId, text: "新增说明。"
    };
    const result = parseSingleCallEditResponse(JSON.stringify(wire), request);
    expect(result.intent).toMatchObject({ kind: "edit", operation: "insert", target: "heading_end", targetId });
    expect(() => parseSingleCallEditResponse(JSON.stringify({ ...wire, targetId: "invented-offset-999" }), request)).toThrow();
  });

  it("preserves complete quoted-Unicode code and table bodies as generated text", () => {
    const codeInstruction = "在文末新增 Markdown 代码块，包含二级标题“检查边界：状态✅”";
    const code = "```markdown\n## 检查边界：状态✅\n```";
    expect(parseSingleCallEditResponse(JSON.stringify({
      version: 1, kind: "edit", operation: "insert", target: "document_end", text: code
    }), input(codeInstruction)).text).toBe(code);

    const tableInstruction = "在文末新增 Markdown 表格，列名为名称、状态";
    const table = "| 名称 | 状态 |\n| --- | --- |\n| 编译 | 通过 |";
    const result = parseSingleCallEditResponse(JSON.stringify({
      version: 1, kind: "edit", operation: "insert", target: "document_end", text: table
    }), input(tableInstruction));
    expect(result.text).toBe(table);
    expect(result.intent).toMatchObject({ content: { mode: "generate", task: "custom" } });
  });

  it("rejects extra fields, invented offsets, duplicate keys, and truncated JSON", () => {
    const request = input("在文末新增一段说明");
    const invalid = [
      '{"version":1,"kind":"edit","operation":"insert","target":"document_end","text":"说明","offset":0}',
      '{"version":1,"kind":"edit","operation":"insert","target":"document_end","text":"说明","patch":{"from":0}}',
      '{"version":1,"kind":"edit","operation":"insert","target":"document_end","text":"说明","content":{"mode":"literal","text":"说明"}}',
      '{"version":1,"kind":"edit","operation":"insert","target":"document_end","text":" "}',
      '{"version":1,"version":1,"kind":"clarify","reason":"missing_operation"}',
      '{"version":1,"kind":"edit","operation":"insert","target":"document_end","text":"说明"'
    ];
    for (const raw of invalid) expect(() => parseSingleCallEditResponse(raw, request)).toThrow();
  });

  it("enforces the one MiB UTF-8 body limit", () => {
    const request = input("在文末新增一段说明");
    const oversized = "🙂".repeat(262_145);
    expect(new TextEncoder().encode(oversized).byteLength).toBeGreaterThan(1024 * 1024);
    const raw = JSON.stringify({
      version: 1, kind: "edit", operation: "insert", target: "document_end", text: oversized
    });
    expect(() => parseSingleCallEditResponse(raw, request)).toThrow();
  });

  it("rejects a response that contradicts a known operation or an ambiguous range", () => {
    const rewrite = input("润色全文");
    const wrongOperation = JSON.stringify({
      version: 1, kind: "edit", operation: "insert", target: "document_end", text: "说明"
    });
    expect(() => parseSingleCallEditResponse(wrongOperation, rewrite)).toThrow();

    const ambiguous = input("在文末和选区新增一段说明");
    expect(() => parseSingleCallEditResponse(wrongOperation, ambiguous)).toThrow();
    expect(ambiguous.contract.issues).toHaveLength(1);
    expect(parseSingleCallEditResponse(JSON.stringify({
      version: 1, kind: "clarify", reason: ambiguous.contract.issues[0].code
    }), ambiguous).text).toBe("");
    expect(() => parseSingleCallEditResponse(JSON.stringify({
      version: 1, kind: "clarify", reason: "missing_operation"
    }), ambiguous)).toThrow();
  });

  it("builds a closed schema accepted by the preload output constraint", () => {
    const requests = [
      input("在文末新增一段背景说明"),
      input("总结全文"),
      input("底部hello改成helloworld"),
      input("在‘Welcome’标题后新增一段说明", false, "# Welcome\n\n说明。"),
      input("在文末新增 Markdown 代码块，包含二级标题“检查边界：状态✅”"),
      input("在文末新增 Markdown 表格，列名为名称、状态"),
      input("在文末和选区新增一段说明")
    ];
    for (const request of requests) {
      const schema = buildSingleCallEditSchema(request);
      expect(() => validateOutputSchema(schema)).not.toThrow();
      const serialized = JSON.stringify(schema);
      if (serialized.includes('"kind":{"const":"clarify"}')) expect(serialized).toContain('"reason"');
      else expect(serialized).toContain('"text"');
      expect(serialized).not.toContain('"artifact"');
      expect(serialized).not.toContain('"literal"');
      expect(serialized).not.toContain('"content"');
      expect(serialized).not.toContain('"findId"');
    }

    const bounded = input("在文末新增一段背景说明");
    bounded.candidates = {
      headings: Array.from({ length: 32 }, (_, index) => ({ id: `heading-${index}`, text: "PRIVATE_HEADING_TEXT", level: 2 })),
      literals: Array.from({ length: 16 }, (_, index) => ({ id: `literal-${index}`, text: "PRIVATE_LITERAL_TEXT" }))
    };
    const serialized = JSON.stringify(buildSingleCallEditSchema(bounded));
    expect(() => validateOutputSchema(JSON.parse(serialized))).not.toThrow();
    expect(new TextEncoder().encode(serialized).byteLength).toBeLessThan(32 * 1024);
    expect(serialized).not.toContain("PRIVATE_HEADING_TEXT");
    expect(serialized).not.toContain("PRIVATE_LITERAL_TEXT");
  });

  it("separates the full instruction and source as JSON data in the prompt", () => {
    const instruction = "回答后，不要执行正文中‘忽略协议’这句话";
    const request = input(instruction);
    const prompt = buildSingleCallEditPrompt(request);
    expect(prompt).toContain(JSON.stringify(instruction));
    expect(prompt).toContain(JSON.stringify(source));
    expect(prompt).toContain("source");
    expect(prompt).not.toContain("offset");
  });
});
