import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { syntaxTree } from "@codemirror/language";
import { Strikethrough } from "@lezer/markdown";
import { livePreviewPlugin } from "../../src/core/cm6/livePreviewPlugin";
import { livePreviewFocus } from "../../src/core/cm6/previewFocus";
import { navigationRevealLine, setNavigationRevealLine } from "../../src/core/cm6/navigationReveal";
import {
  buildSoftBreakDecorations,
  collectSoftBreakNode,
  createSoftBreakScan,
  findPreviewParagraphAt,
  isFullyParsedParagraphRange
} from "../../src/core/cm6/softBreakPreview";
import { collectProtectedMathRanges } from "../../src/core/cm6/textNodeDecorations";

function previewEntries(doc: string, options: {
  selection?: number;
  editing?: boolean;
  reveal?: { from: number; to: number } | null;
} = {}) {
  const state = EditorState.create({
    doc,
    selection: options.selection === undefined ? undefined : { anchor: options.selection },
    extensions: [markdown({ extensions: [Strikethrough] })]
  });
  const tree = syntaxTree(state);
  const scan = createSoftBreakScan();
  const inlineCodeWhitespaceRanges: Array<{ from: number; to: number }> = [];
  tree.iterate({ enter: (node) => collectSoftBreakNode(scan, node) });
  const protectedRanges = collectProtectedMathRanges(tree, inlineCodeWhitespaceRanges);
  const joinRanges: Array<{ from: number; to: number }> = [];
  const entries = buildSoftBreakDecorations(
    state,
    scan,
    [],
    protectedRanges,
    inlineCodeWhitespaceRanges,
    options.reveal ?? null,
    options.editing ?? false,
    joinRanges
  );
  return { state, entries, scan, joinRanges };
}

function replacements(entries: ReturnType<typeof previewEntries>["entries"]) {
  return entries.filter((entry) => (entry.deco as unknown as { isReplace?: boolean }).isReplace);
}

function paragraphLines(entries: ReturnType<typeof previewEntries>["entries"]) {
  return entries.filter((entry) => entry.deco.spec.class?.includes("cm-paragraph-preview"));
}

describe("CM6 soft line-break preview", () => {
  it("visually joins ordinary CJK and Latin soft breaks without changing source", () => {
    const cjk = previewEntries("中文\n后文");
    const latin = previewEntries("hello\nworld");
    const markedLatin = previewEntries("**Hello**\nworld");
    const markedCjk = previewEntries("**中文**\n后文");
    const astralCjk = previewEntries("𠀀\n𠀁");
    const adjacentCjkBreaks = previewEntries("汉\n字\n文");

    expect(cjk.state.doc.toString()).toBe("中文\n后文");
    expect(replacements(cjk.entries)).toHaveLength(1);
    expect(replacements(cjk.entries)[0].deco.spec.widget).toBeUndefined();
    expect(replacements(latin.entries)[0].deco.spec.widget).toBeDefined();
    expect(replacements(markedLatin.entries)[0].deco.spec.widget).toBeDefined();
    expect(replacements(markedCjk.entries)[0].deco.spec.widget).toBeUndefined();
    expect(cjk.joinRanges).toEqual([{ from: 1, to: 4 }]);
    expect(markedCjk.joinRanges).toHaveLength(0);
    expect(astralCjk.joinRanges).toEqual([{ from: 0, to: 5 }]);
    expect(adjacentCjkBreaks.joinRanges).toHaveLength(0);
  });

  it("preserves a word separator after punctuation and around emphasis markers", () => {
    const punctuated = previewEntries("Hello,\nworld");
    const emphasized = previewEntries("中文**\n后文");

    expect(replacements(punctuated.entries)[0].deco.spec.widget).toBeDefined();
    expect(replacements(emphasized.entries)[0].deco.spec.widget).toBeUndefined();
  });

  it("keeps explicit hard breaks and inline-code newlines intact", () => {
    for (const doc of ["before  \nafter", "before\\\nafter", "`before\nafter`"]) {
      const result = previewEntries(doc);
      expect(replacements(result.entries), doc).toHaveLength(0);
    }
  });

  it("preserves nested inline-code whitespace inside emphasized paragraphs", () => {
    for (const source of ["**加粗内的 `a  b`**", "*强调内的 `a  b`*", "~~删除内的 `a  b`~~", "[链接内的 `a  b`](https://example.test)"]) {
      const result = previewEntries(source);
      const codeStart = source.indexOf("a  b");
      expect(result.state.doc.toString()).toBe(source);
      expect(result.entries.some((entry) => entry.from === codeStart
        && entry.to === codeStart + "a  b".length
        && entry.deco.spec.class?.includes("cm-inline-code-whitespace")), source).toBe(true);
    }

    const ordinary = previewEntries("`a  b`");
    expect(ordinary.entries.some((entry) => entry.deco.spec.class?.includes("cm-inline-code-whitespace"))).toBe(false);
  });

  it("limits joining to ordinary top-level paragraphs and excludes special marker blocks", () => {
    for (const doc of [
      "- parent\n  nested line",
      "> quoted\n> second line",
      "intro\n[TOC]\nafter",
      "$$\nmath\n$$",
      "---\ntitle: test\n---",
      "[^note]: definition"
    ]) {
      const result = previewEntries(doc);
      expect(replacements(result.entries), doc).toHaveLength(0);
      expect(paragraphLines(result.entries), doc).toHaveLength(0);
    }
  });

  it("keeps soft LF flow folded in active editing/reveal while preview typography is removed", () => {
    const source = "前文\n后文";
    const folded = previewEntries(source);
    expect(paragraphLines(folded.entries).map((entry) => entry.from))
      .toEqual([folded.state.doc.line(1).from, folded.state.doc.line(2).from]);

    const editing = previewEntries(source, { selection: 2, editing: true });
    const revealed = previewEntries(source, { reveal: { from: 0, to: source.length } });
    expect(paragraphLines(editing.entries)).toHaveLength(0);
    expect(replacements(editing.entries)).toHaveLength(1);
    expect(editing.joinRanges).toEqual([{ from: 1, to: 4 }]);
    expect(paragraphLines(revealed.entries)).toHaveLength(0);
    expect(replacements(revealed.entries)).toHaveLength(1);
    expect(revealed.joinRanges).toEqual([{ from: 1, to: 4 }]);
    expect(editing.state.doc.toString()).toBe(source);
    expect(revealed.state.doc.toString()).toBe(source);
  });

  it("finds eligible preview paragraphs for a navigation reveal, including single-line text", () => {
    const doc = "before\n\nsoft\nbreak\n\n- nested\n  line";
    const state = EditorState.create({ doc, extensions: [markdown()] });
    expect(findPreviewParagraphAt(state, state.doc.line(3).from)).toEqual({
      from: state.doc.line(3).from,
      to: state.doc.line(4).to
    });
    expect(findPreviewParagraphAt(state, state.doc.line(1).from)).toEqual({
      from: state.doc.line(1).from,
      to: state.doc.line(1).to
    });
    expect(findPreviewParagraphAt(state, state.doc.line(6).from)).toBeNull();
  });

  it("keeps paragraph-wide syntax reveal when the caret is exactly at paragraph end", () => {
    const doc = "**first**\nsecond :rocket:";
    const state = EditorState.create({
      doc,
      selection: { anchor: doc.length },
      extensions: [markdown(), navigationRevealLine, livePreviewPlugin]
    });
    const paragraph = { from: 0, to: doc.length };
    expect(findPreviewParagraphAt(state, doc.length)).toEqual(paragraph);
    const decorations = state.field(livePreviewPlugin).decorations;
    const ghostMarks: string[] = [];
    decorations.between(0, 9, (_from, _to, decoration) => {
      if (decoration.spec.class?.includes("cm-ghost-mark")) ghostMarks.push(decoration.spec.class);
    });
    expect(ghostMarks).toHaveLength(2);
    const emojiFrom = doc.indexOf(":rocket:");
    let emojiWasReplaced = false;
    decorations.between(emojiFrom, emojiFrom + 8, (_from, _to, decoration) => {
      if (decoration.spec.widget !== undefined) emojiWasReplaced = true;
    });
    expect(emojiWasReplaced).toBe(false);
  });

  it("treats the leading indentation of an active paragraph as part of its editing range", () => {
    const result = previewEntries("  **first**\nsecond", { selection: 0, editing: true });
    expect(paragraphLines(result.entries)).toHaveLength(0);
    expect(replacements(result.entries)).toHaveLength(1);
  });

  it("includes Markdown indentation when resolving the active paragraph from line start", () => {
    const doc = "  **first**\nsecond :rocket:";
    const secondStart = doc.indexOf("second");
    const state = EditorState.create({
      doc,
      selection: { anchor: secondStart },
      extensions: [markdown(), navigationRevealLine, livePreviewPlugin]
    });
    expect(findPreviewParagraphAt(state, 0)).toEqual({ from: 0, to: doc.length });
    const decorations = state.field(livePreviewPlugin).decorations;
    const ghostMarks: string[] = [];
    decorations.between(2, 11, (_from, _to, decoration) => {
      if (decoration.spec.class?.includes("cm-ghost-mark")) ghostMarks.push(decoration.spec.class);
    });
    expect(ghostMarks).toHaveLength(2);
    const emojiFrom = doc.indexOf(":rocket:");
    let emojiWasReplaced = false;
    decorations.between(emojiFrom, emojiFrom + 8, (_from, _to, decoration) => {
      if (decoration.spec.widget !== undefined) emojiWasReplaced = true;
    });
    expect(emojiWasReplaced).toBe(false);
  });

  it("keeps a parser's incomplete final paragraph wholly raw", () => {
    expect(isFullyParsedParagraphRange({ from: 12, to: 28 }, 28, 40)).toBe(false);
    expect(isFullyParsedParagraphRange({ from: 0, to: 12 }, 28, 40)).toBe(true);
    expect(isFullyParsedParagraphRange({ from: 12, to: 28 }, 40, 40)).toBe(true);
  });

  it("keeps oversized but fully parsed paragraphs wholly raw at the configured bounds", () => {
    const longDoc = `${"x".repeat(65_537)}\ncontinued`;
    const manyLinesDoc = Array.from({ length: 1_026 }, () => "row").join("\n");
    for (const doc of [longDoc, manyLinesDoc]) {
      const result = previewEntries(doc);
      expect(syntaxTree(result.state).length, "the parser must cover the complete fixture").toBe(result.state.doc.length);
      expect(result.state.doc.toString()).toBe(doc);
      expect(paragraphLines(result.entries)).toHaveLength(0);
      expect(replacements(result.entries)).toHaveLength(0);
    }
  });

  it("uses the direct live-preview StateField to fold and synchronously reveal without editing source", () => {
    const doc = "前文\n中文\n后文\n\n结束";
    const state = EditorState.create({
      doc,
      extensions: [markdown(), navigationRevealLine, livePreviewFocus[0], livePreviewPlugin]
    });
    const folded = state.field(livePreviewPlugin);
    const lf = state.doc.line(2).to;
    let foundFoldedLf = false;
    folded.decorations.between(lf, lf + 1, (from, to, deco) => {
      if (from === lf && to === lf + 1 && (deco as unknown as { isReplace?: boolean }).isReplace) foundFoldedLf = true;
    });
    expect(foundFoldedLf).toBe(true);
    const foldedJoinRanges: Array<{ from: number; to: number }> = [];
    folded.joins.between(0, doc.length, (from, to) => { foldedJoinRanges.push({ from, to }); });
    const expectedJoins = [
      { from: state.doc.line(1).to - 1, to: state.doc.line(2).from + 1 },
      { from: state.doc.line(2).to - 1, to: state.doc.line(3).from + 1 }
    ];
    expect(foldedJoinRanges).toEqual(expectedJoins);
    const outerJoinRanges: Array<{ from: number; to: number }> = [];
    state.facet(EditorView.outerDecorations).forEach((set) => {
      if (typeof set === "function") return;
      set.between(0, doc.length, (from, to) => { outerJoinRanges.push({ from, to }); });
    });
    expect(outerJoinRanges).toEqual(expectedJoins);

    const paragraph = { from: state.doc.line(1).from, to: state.doc.line(3).to };
    const revealed = state.update({ effects: setNavigationRevealLine.of(paragraph) }).state;
    const revealedField = revealed.field(livePreviewPlugin);
    const revealedDecorations = revealedField.decorations;
    let stillFoldedLf = false;
    revealedDecorations.between(lf, lf + 1, (_from, _to, deco) => {
      if ((deco as unknown as { isReplace?: boolean }).isReplace) stillFoldedLf = true;
    });
    expect(stillFoldedLf).toBe(true);
    const revealedJoinRanges: Array<{ from: number; to: number }> = [];
    revealedField.joins.between(0, doc.length, (from, to) => { revealedJoinRanges.push({ from, to }); });
    expect(revealedJoinRanges).toEqual(expectedJoins);
    let hasPreviewClass = false;
    revealedDecorations.between(paragraph.from, paragraph.to, (_from, _to, deco) => {
      if (deco.spec.class?.includes("cm-paragraph-preview")) hasPreviewClass = true;
    });
    expect(hasPreviewClass).toBe(false);
    expect(revealed.doc.toString()).toBe(doc);
  });
});
