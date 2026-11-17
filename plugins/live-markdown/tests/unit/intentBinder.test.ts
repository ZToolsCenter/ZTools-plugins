import { describe, expect, it } from "vitest";
import type { AiDocumentSnapshot } from "../../src/types/aiEditing";
import type { IntentCandidates, ValidatedIntent } from "../../src/core/ai/intentTypes";
import { bindAiIntent, buildBoundIntentPatch } from "../../src/core/ai/intentBinder";
import { getIntentHeadings } from "../../src/core/ai/intentTargets";

const snapshot = (content: string, overrides: Partial<AiDocumentSnapshot> = {}): AiDocumentSnapshot => ({
  documentId: "doc.md", revision: 3, content, selection: null, cursor: null, readOnly: false, ...overrides
});

const candidatesFor = (content: string, literals: IntentCandidates["literals"] = []): IntentCandidates => ({
  headings: getIntentHeadings(content), literals
});

const literalInsert = (target: "body_start" | "document_end" | "selection_end" | "cursor" | "heading_end" | "section_end" | "exact_match", text: string, extra: Record<string, unknown> = {}): ValidatedIntent => ({
  version: 1, kind: "edit", operation: "insert", target, layout: "block", content: { mode: "literal", text }, ...extra
} as ValidatedIntent);

describe("AI intent target binding", () => {
  it("lists AST headings outside frontmatter and code with stable distinct IDs", () => {
    const source = "---\r\ntitle: # metadata\r\n---\r\n# Same\r\n\r\n```md\r\n# Not a heading\r\n```\r\n## Same";
    const headings = getIntentHeadings(source);
    expect(headings.map(({ text, level }) => [text, level])).toEqual([["Same", 1], ["Same", 2]]);
    expect(headings[0].id).not.toBe(headings[1].id);
    expect(headings[0].id).toMatch(/^heading:\d+:\d+$/);
  });

  it("binds body start after closed CRLF frontmatter and preserves the source line ending", () => {
    const content = "---\r\ntitle: note\r\n---\r\n# Body";
    const intent = literalInsert("body_start", "New paragraph");
    const bound = bindAiIntent(intent, snapshot(content), "正文开头加 New paragraph", candidatesFor(content));
    expect(bound.range.from).toBe(content.indexOf("# Body"));
    const patch = buildBoundIntentPatch(bound, "New paragraph");
    expect(patch.insertText).toBe("New paragraph\r\n\r\n");
    expect(content.slice(0, patch.from) + patch.insertText + content.slice(patch.to)).toBe("---\r\ntitle: note\r\n---\r\nNew paragraph\r\n\r\n# Body");
  });

  it("uses heading IDs rather than ambiguous heading text and binds the selected section", () => {
    const content = "# Summary\nfirst\n## Detail\nchild\n# Summary\nsecond\n# Next";
    const candidates = candidatesFor(content);
    const second = candidates.headings[2];
    const intent = { ...literalInsert("section_end", "Added"), targetId: second.id } as ValidatedIntent;
    const bound = bindAiIntent(intent, snapshot(content), "在第二个 Summary 章节末尾增加 Added", candidates);
    expect(bound.summary).toContain("Summary");
    expect(bound.range.from).toBe(content.indexOf("# Next"));
    expect(bound.source).toBe("# Summary\nsecond\n");
    const patch = buildBoundIntentPatch(bound, "Added");
    expect(content.slice(0, patch.from) + patch.insertText + content.slice(patch.to)).toBe("# Summary\nfirst\n## Detail\nchild\n# Summary\nsecond\n\nAdded\n\n# Next");
  });

  it("requires a repeated heading name or its explicit AST ordinal", () => {
    const content = "# Summary\nfirst\n## Detail\nchild\n# Summary\nsecond";
    const candidates = candidatesFor(content);
    const secondSummary = { ...literalInsert("section_end", "Added"), targetId: candidates.headings[2].id } as ValidatedIntent;
    expect(() => bindAiIntent(secondSummary, snapshot(content), "在 Summary 章节末尾增加 Added", candidates)).toThrow("标题重复");
    expect(() => bindAiIntent(secondSummary, snapshot(content), "在第二个 Summary 章节末尾增加 Added", candidates)).not.toThrow();
    expect(() => bindAiIntent(secondSummary, snapshot(content), "在第 3 个标题末尾增加 Added", candidates)).not.toThrow();
    expect(() => bindAiIntent(secondSummary, snapshot(content), "在章节末尾增加 Added", candidates)).toThrow("确认模型选择的标题");
  });

  it("validates an explicit heading ordinal against AST heading order", () => {
    const content = "# One\ntext\n## Two\ntext\n# Three";
    const candidates = candidatesFor(content);
    const third = { ...literalInsert("heading_end", "Added"), targetId: candidates.headings[2].id } as ValidatedIntent;
    const second = { ...literalInsert("heading_end", "Added"), targetId: candidates.headings[1].id } as ValidatedIntent;
    expect(() => bindAiIntent(third, snapshot(content), "在第3个标题后增加 Added", candidates)).not.toThrow();
    expect(() => bindAiIntent(third, snapshot(content), "在第3处候选后增加 Added", candidates)).not.toThrow();
    expect(() => bindAiIntent(second, snapshot(content), "在第3个标题后增加 Added", candidates)).toThrow("AST 标题与模型选择");
    expect(() => bindAiIntent(second, snapshot(content), "在第3处候选后增加 Added", candidates)).toThrow("AST 标题与模型选择");
  });

  it("never widens an invalid selection to the whole document", () => {
    const content = "one\ntwo";
    const invalid = snapshot(content, { selection: null, selectionValid: false });
    const selectionRewrite: ValidatedIntent = { version: 1, kind: "edit", operation: "rewrite", target: "selection", content: { mode: "generate", task: "polish" } };
    expect(() => bindAiIntent(selectionRewrite, invalid, "改写选区", candidatesFor(content))).toThrow("无法准确定位当前选区");
    const explicitDocumentInsert = bindAiIntent(literalInsert("document_end", "tail"), invalid, "全文末尾加 tail", candidatesFor(content));
    expect(explicitDocumentInsert.range.from).toBe(content.length);
  });

  it("rejects document-wide plans that silently override an active selection", () => {
    const content = "paragraph one\nparagraph two";
    const selected = snapshot(content, { selection: { from: 0, to: 9 } });
    expect(() => bindAiIntent(literalInsert("document_end", "hello"), selected, "底部加hello", candidatesFor(content))).toThrow("没有明确指向全文");
    expect(() => bindAiIntent(literalInsert("document_end", "hello"), selected, "文末加hello", candidatesFor(content))).not.toThrow();

    const wholeRewrite: ValidatedIntent = { version: 1, kind: "edit", operation: "rewrite", target: "document", content: { mode: "generate", task: "polish" } };
    expect(() => bindAiIntent(wholeRewrite, selected, "润色", candidatesFor(content))).toThrow("未明确要求处理全文");
    expect(() => bindAiIntent(wholeRewrite, selected, "润色全文", candidatesFor(content))).not.toThrow();
  });

  it("accepts explicit English whole-document and document-end scopes with a selection", () => {
    const content = "paragraph one\nparagraph two";
    const selected = snapshot(content, { selection: { from: 0, to: 9 } });
    expect(() => bindAiIntent(literalInsert("document_end", "hello"), selected, "append hello to the end of the document", candidatesFor(content))).not.toThrow();
    const wholeRewrite: ValidatedIntent = { version: 1, kind: "edit", operation: "rewrite", target: "document", content: { mode: "generate", task: "polish" } };
    expect(() => bindAiIntent(wholeRewrite, selected, "polish the entire document", candidatesFor(content))).not.toThrow();
  });

  it("requires a unique exact match unless an explicit occurrence is supplied", () => {
    const content = "校验。 A 校验。 B";
    const makeReplace = (occurrence: "single" | number): ValidatedIntent => ({
      version: 1,
      kind: "edit",
      operation: "replace_exact",
      target: "document",
      find: "校验。",
      occurrence,
      content: { mode: "literal", text: "通过。" }
    });
    expect(() => bindAiIntent(makeReplace("single"), snapshot(content), "替换“校验。”为“通过。”", candidatesFor(content))).toThrow("找到 2 处");
    const second = bindAiIntent(makeReplace(2), snapshot(content), "替换第二处“校验。”为“通过。”", candidatesFor(content));
    expect(second.range.from).toBe(content.lastIndexOf("校验。"));
    expect(buildBoundIntentPatch(second, "通过。").insertText).toBe("通过。");
  });

  it("binds a large last-match scope without retaining every earlier position", () => {
    const content = "a".repeat(1_048_576);
    const intent: ValidatedIntent = { version: 1, kind: "edit", operation: "replace_exact", target: "document", find: "a", occurrence: "last", content: { mode: "literal", text: "b" } };
    const bound = bindAiIntent(intent, snapshot(content), "把最后一处a改为b", { headings: [], literals: [] });
    expect(bound.range).toEqual({ from: content.length - 1, to: content.length, expectedText: "a" });
    expect(bound.matches).toHaveLength(1);
    const overlapping = bindAiIntent({ ...intent, find: "aa" }, snapshot("aaaaa"), "最后一处aa改为b", { headings: [], literals: [] });
    expect(overlapping.range.from).toBe(2); // Keep the established non-overlapping exact-match semantics.
  });

  it("binds exact-match insertion only inside its declared selection scope", () => {
    const content = "outside anchor\nselected anchor end";
    const selectedFrom = content.indexOf("selected");
    const selectedTo = content.length;
    const selected = snapshot(content, { selection: { from: selectedFrom, to: selectedTo } });
    const intent: ValidatedIntent = {
      version: 1,
      kind: "edit",
      operation: "insert",
      target: "exact_match",
      find: "anchor",
      occurrence: "single",
      matchScope: "selection",
      layout: "inline",
      content: { mode: "literal", text: "!" }
    };
    const bound = bindAiIntent(intent, selected, "在选区中的 anchor 后加 !", candidatesFor(content));
    expect(bound.dependency).toBe("selection");
    expect(bound.range.from).toBe(content.lastIndexOf("anchor") + "anchor".length);
    expect(buildBoundIntentPatch(bound, "!").insertText).toBe("!");

    const wrongSelection = snapshot(content, { selection: { from: 0, to: 7 } });
    expect(() => bindAiIntent(intent, wrongSelection, "在选区中的 anchor 后加 !", candidatesFor(content))).toThrow("没有找到");
  });

  it("builds one all-match patch while preserving text between matches byte-for-byte", () => {
    const content = "a X b\r\nc X d";
    const intent: ValidatedIntent = {
      version: 1,
      kind: "edit",
      operation: "replace_exact",
      target: "document",
      find: "X",
      occurrence: "all",
      content: { mode: "literal", text: "Y" }
    };
    const bound = bindAiIntent(intent, snapshot(content), "全部替换 X 为 Y", candidatesFor(content));
    const patch = buildBoundIntentPatch(bound, "Y");
    expect(patch.expectedText).toBe("X b\r\nc X");
    expect(patch.insertText).toBe("Y b\r\nc Y");
    expect(content.slice(0, patch.from) + patch.insertText + content.slice(patch.to)).toBe("a Y b\r\nc Y d");
  });

  it("replaces only the last duplicate inside the selected range and preserves the rest exactly", () => {
    const content = "outside hello\nselected hello keep\nhello tail\noutside hello";
    const selectedFrom = content.indexOf("selected");
    const selectedTo = content.indexOf("\noutside hello");
    const selected = snapshot(content, { selection: { from: selectedFrom, to: selectedTo } });
    const intent: ValidatedIntent = {
      version: 1,
      kind: "edit",
      operation: "replace_exact",
      target: "selection",
      find: "hello",
      occurrence: "last",
      content: { mode: "literal", text: "helloworld" }
    };
    const bound = bindAiIntent(intent, selected, "把选区最后一处 hello 改成 helloworld", candidatesFor(content));
    expect(bound.range.from).toBe(content.indexOf("hello tail"));
    expect(bound.range.expectedText).toBe("hello");
    expect(bound.summary).toContain("最后一处");
    const patch = buildBoundIntentPatch(bound, "helloworld");
    const updated = content.slice(0, patch.from) + patch.insertText + content.slice(patch.to);
    expect(updated).toBe("outside hello\nselected hello keep\nhelloworld tail\noutside hello");
  });

  it("fails closed for a missing last-occurrence target and an invalid selection", () => {
    const intent: ValidatedIntent = {
      version: 1,
      kind: "edit",
      operation: "replace_exact",
      target: "selection",
      find: "absent",
      occurrence: "last",
      content: { mode: "literal", text: "replacement" }
    };
    const content = "whole document";
    expect(() => bindAiIntent(intent, snapshot(content, { selection: { from: 0, to: 4 } }), "选区末尾替换 absent 为 replacement", candidatesFor(content))).toThrow("没有找到");
    expect(() => bindAiIntent(intent, snapshot(content, { selectionValid: false }), "选区末尾替换 absent 为 replacement", candidatesFor(content))).toThrow("无法准确定位当前选区");
  });

  it("rejects offsets that split a surrogate pair or CRLF", () => {
    const emoji = "A😀B";
    expect(() => bindAiIntent(literalInsert("cursor", "x"), snapshot(emoji, { cursor: 2 }), "光标插入 x", candidatesFor(emoji))).toThrow("换行符或 Unicode 字符");
    const crlf = "A\r\nB";
    expect(() => bindAiIntent(literalInsert("cursor", "x"), snapshot(crlf, { cursor: 2 }), "光标插入 x", candidatesFor(crlf))).toThrow("换行符或 Unicode 字符");
  });

  it("resolves a long literal ID locally and does not let the model rewrite it", () => {
    const content = "start";
    const literal = "paragraph with **exact** words";
    const candidates = candidatesFor(content, [{ id: "literal-1", text: literal }]);
    const intent: ValidatedIntent = {
      version: 1,
      kind: "edit",
      operation: "insert",
      target: "document_end",
      layout: "block",
      content: { mode: "literal", literalId: "literal-1" }
    };
    const bound = bindAiIntent(intent, snapshot(content), `append “${literal}”`, candidates);
    expect(bound.literalText).toBe(literal);
    expect(buildBoundIntentPatch(bound, bound.literalText!).insertText).toBe(`\n\n${literal}`);
  });
});
