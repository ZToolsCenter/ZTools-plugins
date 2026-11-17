import { describe, expect, it } from "vitest";
import { EditorState, Extension } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { buildEmojiDecorations, previewEmojiText } from "../../src/core/cm6/emojiDecorations";
import { buildLivePreviewDecorations } from "../../src/core/cm6/livePreviewPlugin";
import { navigationRevealLine, setNavigationRevealLine } from "../../src/core/cm6/navigationReveal";
import { livePreviewFocus } from "../../src/core/cm6/previewFocus";

function createFullyParsedMarkdownState(source: string, extensions: Extension[] = []) {
  const state = EditorState.create({ doc: source, extensions: [markdown(), ...extensions] });
  const tree = ensureSyntaxTree(state, state.doc.length, 1000);
  expect(tree).not.toBeNull();
  expect(tree?.length).toBe(state.doc.length);
  return { state, tree: tree! };
}

function collectReplacedBackslashes(state: EditorState): number[] {
  const positions: number[] = [];
  buildLivePreviewDecorations(state).between(0, state.doc.length, (from, to, decoration) => {
    if ((decoration as unknown as { isReplace: boolean }).isReplace
      && to === from + 1 && state.sliceDoc(from, to) === "\\") positions.push(from);
  });
  return positions;
}

describe("CM6 inline preview and actual editing state", () => {
  it("renders known shortcodes in headings/body while preserving code, URLs, escapes and unknown text", () => {
    const source = "# Hello :sparkles:\n\nBody :rocket: `:fire:` \\:bulb: :unknown: [link](https://test/:tada:) $:smile:$\n\n```text\n:tada:\n```";
    const { state, tree } = createFullyParsedMarkdownState(source);
    const entries = buildEmojiDecorations(state, tree, -1, -1);
    expect(entries.map(({ from, to }) => state.sliceDoc(from, to))).toEqual([":sparkles:", ":rocket:"]);
    expect(state.doc.toString()).toBe(source);
  });

  it("keeps shortcodes as source on the editing line and inside metadata", () => {
    const source = "title: :sparkles:\n\n# Hello :rocket:\n\nBody :fire:";
    const { state, tree } = createFullyParsedMarkdownState(source);
    const cursor = source.indexOf("Hello");
    const entries = buildEmojiDecorations(state, tree, cursor, cursor, [{ from: 0, to: 19 }]);
    expect(entries.map(({ from, to }) => state.sliceDoc(from, to))).toEqual([":fire:"]);
  });

  it("uses the same Emoji display for TOC labels while keeping inline literals", () => {
    expect(previewEmojiText("Hello :sparkles: `:fire:` \\:rocket: :not_known:")).toBe("Hello ✨ `:fire:` \\:rocket: :not_known:");
  });

  it("hides CommonMark escape backslashes in preview without changing source offsets", () => {
    const source = "## API \\<v2\\> & C\\+\\+\n#### 接口 \\(v2\\) \\[beta\\]\n\nLiteral \\*stars\\* and \\\\";
    const { state, tree } = createFullyParsedMarkdownState(source, [EditorState.readOnly.of(true)]);
    const expectedFrom: number[] = [];
    tree.iterate({ enter(node) { if (node.name === "Escape") expectedFrom.push(node.from); } });
    const actualFrom = collectReplacedBackslashes(state);

    expect(expectedFrom.length).toBeGreaterThan(8);
    expect(actualFrom).toEqual(expectedFrom);
    expect(state.doc.toString()).toBe(source);
  });

  it("keeps escape source visible on the focused line, navigation reveal, and active paragraph", () => {
    const headingSource = "## API \\<v2\\>\n\nOther heading";
    const headingEscape = headingSource.indexOf("\\<");
    const focused = EditorState.create({
      doc: headingSource,
      selection: { anchor: headingSource.indexOf("v2") },
      extensions: [markdown()]
    });
    expect(collectReplacedBackslashes(focused)).not.toContain(headingEscape);

    const otherLine = focused.doc.lineAt(headingSource.indexOf("Other heading"));
    const revealState = EditorState.create({
      doc: headingSource,
      selection: { anchor: headingSource.indexOf("Other heading") },
      extensions: [markdown(), navigationRevealLine]
    }).update({
      effects: setNavigationRevealLine.of({ from: focused.doc.lineAt(headingEscape).from, to: focused.doc.lineAt(headingEscape).to })
    }).state;
    expect(collectReplacedBackslashes(revealState)).not.toContain(headingEscape);
    expect(otherLine.number).toBeGreaterThan(1);

    const paragraph = "First line with \\+\ncontinuation at cursor";
    const paragraphEscape = paragraph.indexOf("\\+");
    const activeParagraph = EditorState.create({
      doc: paragraph,
      selection: { anchor: paragraph.indexOf("continuation") },
      extensions: [markdown()]
    });
    expect(collectReplacedBackslashes(activeParagraph)).not.toContain(paragraphEscape);
    expect(activeParagraph.doc.toString()).toBe(paragraph);
  });

  it("does not add escape decorations inside metadata, code, URLs, or math", () => {
    const source = [
      "---",
      "key: \\+",
      "---",
      "",
      "Outside \\+ and inline `\\*code\\*` with [link](https://example.com/\\+)",
      "",
      "Math $\\(x\\)$",
      "",
      "```text",
      "\\+",
      "```"
    ].join("\n");
    const { state } = createFullyParsedMarkdownState(source, [EditorState.readOnly.of(true)]);
    const replacements = collectReplacedBackslashes(state);
    const firstEscape = source.indexOf("\\+");
    const outsideEscape = source.indexOf("\\+", firstEscape + 2);
    const codeEscape = source.indexOf("\\*", source.indexOf("inline"));
    const urlEscape = source.indexOf("\\+", source.indexOf("https://"));
    const mathEscape = source.indexOf("\\(");
    const fencedEscape = source.lastIndexOf("\\+");

    expect(replacements).toContain(outsideEscape);
    for (const protectedPosition of [firstEscape, codeEscape, urlEscape, mathEscape, fencedEscape]) {
      expect(replacements).not.toContain(protectedPosition);
    }
    expect(state.doc.toString()).toBe(source);
  });

  it("mounts in preview even with the caret at the start, and read-only always hides markers", () => {
    const source = "# Hello :sparkles:\n\nBody";
    const states = [
      createFullyParsedMarkdownState(source, [livePreviewFocus]).state,
      createFullyParsedMarkdownState(source, [EditorState.readOnly.of(true)]).state
    ];
    for (const state of states) {
      let headingHidden = false;
      let emojiReplaced = false;
      buildLivePreviewDecorations(state).between(0, source.length, (from, to, decoration) => {
        if (from === 0 && to === 2 && (decoration as unknown as { isReplace: boolean }).isReplace) headingHidden = true;
        if (decoration.spec.widget?.constructor.name === "EmojiWidget") emojiReplaced = true;
      });
      expect(headingHidden).toBe(true);
      expect(emojiReplaced).toBe(true);
      expect(state.doc.toString()).toBe(source);
    }
  });
});
