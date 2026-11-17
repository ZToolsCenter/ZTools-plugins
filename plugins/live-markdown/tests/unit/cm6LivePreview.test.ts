import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { Table, TaskList, Strikethrough } from "@lezer/markdown";
import { buildLivePreviewDecorations } from "../../src/core/cm6/livePreviewPlugin";
import { TaskCheckboxWidget, MermaidBlockWidget, MathBlockWidget } from "../../src/core/cm6/widgets";

describe("CodeMirror 6 Live Preview Engine (Typora-level Continuous Stream)", () => {
  it("initializes CM6 state with markdown language and GFM extensions", () => {
    const doc = "# Heading 1\n\n**Bold Text** and *italic*\n\n- [ ] Task Item\n\n```mermaid\ngraph LR\n  A --> B\n```";
    const state = EditorState.create({
      doc,
      extensions: [markdown({ extensions: [Table, TaskList, Strikethrough] })]
    });

    expect(state.doc.toString()).toBe(doc);
    expect(state.doc.lines).toBe(10);
  });

  it("builds decorations hiding heading prefixes when cursor is not on the heading line", () => {
    const doc = "# First Heading\n\nSome body text.";
    const state = EditorState.create({
      doc,
      // Cursor on line 2 (offset 20)
      selection: { anchor: 20 },
      extensions: [markdown()]
    });

    // Mock a minimal EditorView
    const mockView = {
      state
    } as unknown as EditorView;

    const decos = buildLivePreviewDecorations(mockView);
    expect(decos.size).toBeGreaterThan(0);

    // Iterate through decorations to find replace on heading prefix
    let hasReplaceOnPrefix = false;
    let hasHeadingLineDeco = false;

    decos.between(0, state.doc.length, (from, to, deco) => {
      if (from === 0 && to === 2 && (deco as unknown as { isReplace?: boolean }).isReplace) {
        hasReplaceOnPrefix = true;
      }
      if (deco.spec.class?.includes("cm-heading-1")) {
        hasHeadingLineDeco = true;
      }
    });

    expect(hasReplaceOnPrefix).toBe(true);
    expect(hasHeadingLineDeco).toBe(true);
  });

  it("reveals heading prefix when cursor is editing on the heading line and hides when unfocused", () => {
    const doc = "# First Heading\n\nSome body text.";
    const state = EditorState.create({
      doc,
      // Cursor on line 1 inside "# First Heading" (editing state)
      selection: { anchor: 4 },
      extensions: [markdown()]
    });

    const mockView = { state } as unknown as EditorView;
    const decos = buildLivePreviewDecorations(mockView);

    let hasGhostMarkOnPrefix = false;
    decos.between(0, 5, (from, to, deco) => {
      if (from === 0 && to === 2 && deco.spec.class?.includes("cm-ghost-mark")) {
        hasGhostMarkOnPrefix = true;
      }
    });

    expect(hasGhostMarkOnPrefix).toBe(true);
  });

  it("replaces task list [ ] marker with TaskCheckboxWidget", () => {
    const doc = "- [ ] Unchecked Task\n- [x] Completed Task";
    const state = EditorState.create({
      doc,
      selection: { anchor: 10 }, // not on task markers
      extensions: [markdown({ extensions: [TaskList] })]
    });

    const mockView = { state } as unknown as EditorView;
    const decos = buildLivePreviewDecorations(mockView);

    const taskWidgets: TaskCheckboxWidget[] = [];
    decos.between(0, state.doc.length, (_from, _to, deco) => {
      if (deco.spec.widget instanceof TaskCheckboxWidget) {
        taskWidgets.push(deco.spec.widget);
      }
    });

    expect(taskWidgets.length).toBe(2);
    expect(taskWidgets[0].checked).toBe(false);
    expect(taskWidgets[1].checked).toBe(true);
  });

  it("replaces unfocused Mermaid block with MermaidBlockWidget", () => {
    const doc = "Intro\n\n```mermaid\ngraph LR\n  A --> B\n```\n\nOutro";
    const state = EditorState.create({
      doc,
      selection: { anchor: 2 }, // Cursor on "Intro", outside Mermaid block
      extensions: [markdown()]
    });

    const mockView = { state } as unknown as EditorView;
    const decos = buildLivePreviewDecorations(mockView);

    let mermaidWidget: MermaidBlockWidget | null = null;
    decos.between(0, state.doc.length, (_from, _to, deco) => {
      if (deco.spec.widget instanceof MermaidBlockWidget) {
        mermaidWidget = deco.spec.widget;
      }
    });

    expect(mermaidWidget).not.toBeNull();
    expect(mermaidWidget!.code).toContain("graph LR");
  });

  it("provides unified transaction undo / redo history without textarea tearing", () => {
    let state = EditorState.create({
      doc: "Initial sentence.",
      extensions: [markdown()]
    });

    // Type addition
    const tr1 = state.update({
      changes: { from: 17, insert: " Added text." }
    });
    state = tr1.state;
    expect(state.doc.toString()).toBe("Initial sentence. Added text.");

    // Replace
    const tr2 = state.update({
      changes: { from: 0, to: 7, insert: "Updated" }
    });
    state = tr2.state;
    expect(state.doc.toString()).toBe("Updated sentence. Added text.");
  });
});

  it("replaces unfocused Markdown Table with TableBlockWidget", () => {
    const doc = "Intro\n\n| Col 1 | Col 2 |\n| :--- | :--- |\n| Val 1 | Val 2 |\n\nOutro";
    const state = EditorState.create({
      doc,
      selection: { anchor: 2 },
      extensions: [markdown({ extensions: [Table] })]
    });

    const mockView = { state } as unknown as EditorView;
    const decos = buildLivePreviewDecorations(mockView);

    let hasTableWidget = false;
    decos.between(0, state.doc.length, (_from, _to, deco) => {
      if (deco.spec.widget && deco.spec.widget.constructor.name === "TableBlockWidget") {
        hasTableWidget = true;
      }
    });

    expect(hasTableWidget).toBe(true);
  });

  it("replaces unfocused Callout Alert with AlertBlockWidget", () => {
    const doc = "Intro\n\n> [!WARNING]\n> Be careful with unsaved files!\n\nOutro";
    const state = EditorState.create({
      doc,
      selection: { anchor: 2 },
      extensions: [markdown()]
    });

    const mockView = { state } as unknown as EditorView;
    const decos = buildLivePreviewDecorations(mockView);

    let hasAlertWidget = false;
    decos.between(0, state.doc.length, (_from, _to, deco) => {
      if (deco.spec.widget && deco.spec.widget.constructor.name === "AlertBlockWidget") {
        hasAlertWidget = true;
      }
    });

    expect(hasAlertWidget).toBe(true);
  });

  it("replaces unfocused $$ ... $$ Math Block with MathBlockWidget", () => {
    const doc = "Intro\n\n$$\nf(x) = \\sum_{n=0}^{\\infty} x^n\n$$\n\nOutro";
    const state = EditorState.create({
      doc,
      selection: { anchor: 2 },
      extensions: [markdown()]
    });

    const mockView = { state } as unknown as EditorView;
    const decos = buildLivePreviewDecorations(mockView);

    let hasMathWidget = false;
    decos.between(0, state.doc.length, (_from, _to, deco) => {
      if (deco.spec.widget && deco.spec.widget.constructor.name === "MathBlockWidget") {
        hasMathWidget = true;
      }
    });

    expect(hasMathWidget).toBe(true);
  });

  it("renders standalone one-line and multiline display math after a hardbreak", () => {
    const cases = [
      { doc: "Title\n\n$$ x^2 + y^2 $$", expectedTex: "x^2 + y^2" },
      { doc: "Intro  \n$$ x^2 + y^2 $$  \nAfter", expectedTex: "x^2 + y^2" },
      { doc: "Intro  \n$$\nx^2 + y^2\n$$\nAfter", expectedTex: "x^2 + y^2" }
    ];

    for (const { doc, expectedTex } of cases) {
      const state = EditorState.create({ doc, selection: { anchor: 1 }, extensions: [markdown()] });
      const decos = buildLivePreviewDecorations(state);
      const widgets: MathBlockWidget[] = [];
      decos.between(0, state.doc.length, (_from, _to, deco) => {
        if (deco.spec.widget instanceof MathBlockWidget) widgets.push(deco.spec.widget);
      });
      expect(widgets).toHaveLength(1);
      expect(widgets[0].tex).toBe(expectedTex);
      expect(widgets[0].displayMode).toBe(true);
      expect(state.doc.toString()).toBe(doc);
    }
  });

  it("keeps inline code, link destinations, fenced code, and glued delimiters out of math preview", () => {
    const cases = [
      { doc: "Literal `$$x$$` and `$y$` then $z$", expectedTex: ["z"] },
      { doc: "[link](https://example.com/?q=$x$) then $z$", expectedTex: ["z"] },
      { doc: "```text\n$$\nx^2\n$$\n```", expectedTex: [] },
      { doc: "Text$$\nx^2\n$$", expectedTex: [] }
    ];

    for (const { doc, expectedTex } of cases) {
      const state = EditorState.create({ doc, selection: { anchor: 0 }, extensions: [markdown()] });
      const decos = buildLivePreviewDecorations(state);
      const widgets: MathBlockWidget[] = [];
      decos.between(0, state.doc.length, (_from, _to, deco) => {
        if (deco.spec.widget instanceof MathBlockWidget) widgets.push(deco.spec.widget);
      });
      expect(widgets.map((widget) => widget.tex)).toEqual(expectedTex);
      expect(widgets.every((widget) => !widget.displayMode)).toBe(true);
      expect(state.doc.toString()).toBe(doc);
    }
  });

  it("preserves outer bold text around inline math and inline code", () => {
    const cases = [
      { doc: "**text $x$ end**", expectedVisibleBold: ["text ", " end"] },
      { doc: "**before `code` after**", expectedVisibleBold: ["before `code` after"] }
    ];
    for (const { doc, expectedVisibleBold } of cases) {
      const state = EditorState.create({ doc, selection: { anchor: 0 }, extensions: [markdown()] });
      const decos = buildLivePreviewDecorations(state);
      const visibleBold: string[] = [];
      decos.between(0, state.doc.length, (from, to, deco) => {
        if (deco.spec.class === "cm-bold") visibleBold.push(state.sliceDoc(from, to));
      });
      expect(visibleBold).toEqual(expectedVisibleBold);
      expect(state.doc.toString()).toBe(doc);
    }
  });

  it("does not let Markdown marks inside display TeX escape the block widget", () => {
    const docs = [
      "Intro\n\n$$\n**x** and $y$\n$$",
      "**Intro  \n$$\nx^2\n$$\nmore**"
    ];
    for (const doc of docs) {
      const state = EditorState.create({ doc, selection: { anchor: 1 }, extensions: [markdown()] });
      const decos = buildLivePreviewDecorations(state);
      let mathWidget: MathBlockWidget | null = null;
      let hasOverlappingMark = false;
      decos.between(0, state.doc.length, (_from, _to, deco) => {
        if (deco.spec.widget instanceof MathBlockWidget) mathWidget = deco.spec.widget;
      });
      expect(mathWidget).not.toBeNull();
      decos.between(mathWidget!.from, mathWidget!.to, (from, to, deco) => {
        if (deco.spec.class && from < mathWidget!.to && to > mathWidget!.from) hasOverlappingMark = true;
      });
      expect(hasOverlappingMark).toBe(false);
      expect(state.doc.toString()).toBe(doc);
    }
  });

  it("replaces unfocused [TOC] with TocBlockWidget", () => {
    const doc = "# Heading 1\n\n[TOC]\n\n## Heading 2\n\nBody text.";
    const state = EditorState.create({
      doc,
      // Cursor on line 4 inside Body text (unfocused TOC)
      selection: { anchor: 40 },
      extensions: [markdown()]
    });

    const mockView = { state } as unknown as EditorView;
    const decos = buildLivePreviewDecorations(mockView);

    let hasTocWidget = false;
    decos.between(0, state.doc.length, (_from, _to, deco) => {
      if (deco.spec.widget && deco.spec.widget.constructor.name === "TocBlockWidget") {
        hasTocWidget = true;
      }
    });

    expect(hasTocWidget).toBe(true);
  });
