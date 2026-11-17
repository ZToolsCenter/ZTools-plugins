import { describe, expect, it } from "vitest";
import type { AiDocumentSnapshot } from "../../src/types/aiEditing";
import type { IntentCandidates, ValidatedIntent } from "../../src/core/ai/intentTypes";
import { bindAiIntent } from "../../src/core/ai/intentBinder";
import { getIntentHeadings } from "../../src/core/ai/intentTargets";

const snapshot = (content: string, selection: AiDocumentSnapshot["selection"] = null): AiDocumentSnapshot => ({
  documentId: "doc.md", revision: 1, content, selection, cursor: null, readOnly: false
});

const candidates = (content: string): IntentCandidates => ({ headings: getIntentHeadings(content), literals: [] });

describe("AI intent constraints", () => {
  it("clarifies an explicit compound request before a weak rewrite plan can run", () => {
    const content = "first paragraph\nsecond paragraph";
    const mistakenRewrite: ValidatedIntent = {
      version: 1, kind: "edit", operation: "rewrite", target: "document", content: { mode: "generate", task: "polish" }
    };
    expect(() => bindAiIntent(mistakenRewrite, snapshot(content), "底部加hello，再润色第一段", candidates(content)))
      .toThrow("多个编辑操作，请拆分");
    const weakClarification: ValidatedIntent = { version: 1, kind: "clarify", reason: "missing_target" };
    expect(() => bindAiIntent(weakClarification, snapshot(content), "底部加hello，再润色第一段", candidates(content)))
      .toThrow("多个编辑操作，请拆分");
  });

  it("does not treat a negated constraint as a second edit", () => {
    const content = "original text";
    const append: ValidatedIntent = {
      version: 1, kind: "edit", operation: "insert", target: "document_end", layout: "inline", content: { mode: "literal", text: "hello" }
    };
    for (const instruction of ["不要修改原文，只在文末加hello", "不要对原文进行修改，只在文末加hello"]) {
      expect(() => bindAiIntent(append, snapshot(content), instruction, candidates(content)), instruction).not.toThrow();
    }
  });

  it("ignores edit-like instructions inside a quoted literal payload", () => {
    const content = "original text";
    const append: ValidatedIntent = {
      version: 1,
      kind: "edit",
      operation: "insert",
      target: "document_end",
      layout: "inline",
      content: { mode: "literal", text: "先润色，然后总结" }
    };
    expect(() => bindAiIntent(append, snapshot(content), "追加“先润色，然后总结”", candidates(content))).not.toThrow();
    expect(() => bindAiIntent({ ...append, content: { mode: "literal", text: "polish then summarize" } }, snapshot(content), "append 'polish then summarize'", candidates(content))).not.toThrow();
  });

  it("blocks generation when one quoted payload is explicitly requested verbatim", () => {
    const content = "旧词";
    const generateInsert: ValidatedIntent = {
      version: 1, kind: "edit", operation: "insert", target: "document_end", layout: "block", content: { mode: "generate", task: "summarize" }
    };
    expect(() => bindAiIntent(generateInsert, snapshot(content), "在文末原样添加“你好，世界！”", candidates(content)))
      .toThrow("要求原样插入或替换引用内容，但当前计划需要 AI 创作");
    const literalInsert: ValidatedIntent = { ...generateInsert, content: { mode: "literal", text: "你好，世界！" } };
    expect(() => bindAiIntent(literalInsert, snapshot(content), "在文末原样添加“你好，世界！”", candidates(content))).not.toThrow();

    const generateReplace: ValidatedIntent = {
      version: 1, kind: "edit", operation: "replace_exact", target: "document", find: "旧词", occurrence: "single", content: { mode: "generate", task: "custom" }
    };
    expect(() => bindAiIntent(generateReplace, snapshot(content), "将“你好，世界！”逐字替换旧词", candidates(content)))
      .toThrow("要求原样插入或替换引用内容");
  });

  it("does not infer a literal insert from a request to summarize and preserve a quoted term", () => {
    const content = "source";
    const summaryInsert: ValidatedIntent = {
      version: 1, kind: "edit", operation: "insert", target: "document_end", layout: "block", content: { mode: "generate", task: "summarize" }
    };
    expect(() => bindAiIntent(summaryInsert, snapshot(content), "总结并原样保留“术语”", candidates(content))).not.toThrow();
  });

  it("uses English word boundaries for edit verbs", () => {
    const content = "hello";
    const append: ValidatedIntent = {
      version: 1, kind: "edit", operation: "insert", target: "document_end", layout: "inline", content: { mode: "literal", text: " standard polish" }
    };
    expect(() => bindAiIntent(append, snapshot(content), "append standard polish", candidates(content))).not.toThrow();
    const compound: ValidatedIntent = {
      version: 1, kind: "edit", operation: "rewrite", target: "document", content: { mode: "generate", task: "polish" }
    };
    expect(() => bindAiIntent(compound, snapshot(content), "append hello then polish the first paragraph", candidates(content)))
      .toThrow("多个编辑操作，请拆分");
  });

  it("recognizes document-end scope wording with an active selection", () => {
    const content = "first paragraph\nsecond paragraph";
    const selected = snapshot(content, { from: 0, to: 15 });
    const append: ValidatedIntent = {
      version: 1, kind: "edit", operation: "insert", target: "document_end", layout: "inline", content: { mode: "literal", text: "hello" }
    };
    for (const instruction of ["在当前文档最末尾添加hello", "在当前文件最后添加hello", "在文章的末尾添加hello"]) {
      expect(() => bindAiIntent(append, selected, instruction, candidates(content)), instruction).not.toThrow();
    }
  });
});
