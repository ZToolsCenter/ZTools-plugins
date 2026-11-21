import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { syntaxTree } from "@codemirror/language";
import { buildTocDecorations } from "../../src/core/cm6/tocDecorations";
import { buildLivePreviewDecorations } from "../../src/core/cm6/livePreviewPlugin";
import { TocBlockWidget } from "../../src/core/cm6/widgets";
import type { TextDecorationEntry } from "../../src/core/cm6/textNodeDecorations";

function collectTocEntries(doc: string, cursor = -1) {
  const state = EditorState.create({ doc, extensions: [markdown()] });
  const tree = syntaxTree(state);
  const entries: TextDecorationEntry[] = [];
  tree.iterate({
    enter(node) {
      if (node.name === "Paragraph") {
        entries.push(...buildTocDecorations(state, tree, node.from, node.to, cursor, cursor));
      }
    }
  });
  return { state, entries };
}

describe("TOC Markdown decorations", () => {
  it("renders a standalone TOC line between adjacent prose without consuming its source", () => {
    const doc = "# Title\n\nIntro\n[toc]\nAfter";
    const { state, entries } = collectTocEntries(doc);

    expect(entries).toHaveLength(1);
    expect(entries[0].deco.spec.widget).toBeInstanceOf(TocBlockWidget);
    expect(state.sliceDoc(entries[0].from, entries[0].to)).toBe("[toc]");
    expect(state.doc.toString()).toBe(doc);

    const preview = buildLivePreviewDecorations(state);
    let renderedWidget = false;
    preview.between(0, state.doc.length, (_from, _to, decoration) => {
      if (decoration.spec.widget instanceof TocBlockWidget) renderedWidget = true;
    });
    expect(renderedWidget).toBe(true);
  });

  it("does not render markers embedded in prose, inline code, escaped text, lists, or quotes", () => {
    const doc = [
      "[toc] 12",
      "`[toc]`",
      "\\[toc]",
      "",
      "- [toc]",
      "",
      "> [toc]"
    ].join("\n");
    expect(collectTocEntries(doc).entries).toHaveLength(0);
  });

  it("keeps marker source visible while the cursor is on it and renders after leaving", () => {
    const doc = "Intro\n[toc]\nAfter";
    const markerFrom = doc.indexOf("[toc]");
    expect(collectTocEntries(doc, markerFrom + 2).entries).toHaveLength(0);
    expect(collectTocEntries(doc, markerFrom + 7).entries).toHaveLength(1);
  });

  it("projects escaped heading punctuation for TOC labels while preserving source offsets and escaped emoji", () => {
    const doc = [
      String.raw`## API \<v2\> & C\+\+ :smile:`,
      String.raw`#### 接口 \(v2\) \[beta\]`,
      String.raw`### \:rocket:`,
      "[toc]"
    ].join("\n");
    const { state, entries } = collectTocEntries(doc);
    const widget = entries[0]?.deco.spec.widget;

    expect(widget).toBeInstanceOf(TocBlockWidget);
    const headings = (widget as TocBlockWidget).headings;
    expect(headings.map(({ level, text }) => ({ level, text }))).toEqual([
      { level: 2, text: "API <v2> & C++ 😄" },
      { level: 4, text: "接口 (v2) [beta]" },
      { level: 3, text: ":rocket:" }
    ]);
    expect(headings.map(({ from }) => from)).toEqual([0, doc.indexOf("####"), doc.lastIndexOf("###")]);
    expect(state.doc.toString()).toBe(doc);
  });
});
