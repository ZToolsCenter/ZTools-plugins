import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { syntaxTree } from "@codemirror/language";
import { collectDocumentMetaDecorations } from "../../src/core/cm6/documentMetaDecorations";
import { composeLivePreviewDecorations } from "../../src/core/cm6/decorationComposer";

function build(source: string, cursor = -1, readOnly = false) {
  const normalized = source.replace(/\r\n/g, "\n");
  const selection = cursor < 0 ? normalized.length : cursor;
  const state = EditorState.create({
    doc: normalized,
    selection: { anchor: selection },
    extensions: [markdown(), EditorState.readOnly.of(readOnly)]
  });
  const meta = collectDocumentMetaDecorations(state, cursor, cursor);
  return { state, meta, decorations: composeLivePreviewDecorations(meta.entries) };
}

describe("CM6 document metadata preview", () => {
  it("shows complete first-document YAML as a card and keeps incomplete/delimiter lines literal", () => {
    const complete = "---\ntitle: A <script>bad()</script>\nauthor: harris\n---\n\n# Body";
    const { state, meta, decorations } = build(complete);
    expect(meta.blockRanges).toContainEqual({ from: 0, to: complete.indexOf("---", 4) + 3 });
    expect(meta.shouldSkipNode("HorizontalRule", 0, 3)).toBe(true);
    expect(meta.shouldSkipNode("SetextHeading2", 4, complete.indexOf("---", 4) + 3)).toBe(true);
    expect(meta.shouldSkipNode("Document", 0, complete.length)).toBe(false);
    let widgetClass = "";
    decorations.between(0, state.doc.length, (_from, _to, decoration) => {
      widgetClass = decoration.spec.widget?.constructor.name ?? widgetClass;
    });
    expect(widgetClass).toBe("FrontMatterWidget");

    expect(build("---\ntitle: A\nbody").meta.blockRanges).toEqual([]);
    expect(build("---\n正文\n---").meta.blockRanges).toEqual([]);
    expect(build("---\n\n---").meta.blockRanges).toEqual([]);
    const validHeader = "---\nauthor: harris\n---";
    expect(build(validHeader).meta.blockRanges).toContainEqual({ from: 0, to: validHeader.length });
    expect(build("Body\n\n---\nvalue\n---").meta.blockRanges).toEqual([]);
    const crlf = "---\r\ntitle: A\r\n...\r\nBody";
    const normalizedCrlf = crlf.replace(/\r\n/g, "\n");
    expect(build(crlf).meta.blockRanges).toContainEqual({ from: 0, to: normalizedCrlf.indexOf("...") + 3 });
    expect(build("\uFEFF---\r\ntitle: A\r\n---\r\nBody").meta.blockRanges).toHaveLength(1);
  });

  it("previews definitions and references while excluding literals, links, and fenced code", () => {
    const source = [
      "Body [^1], [^1], [^missing], [linked [^1]](https://example.test/[^1]).",
      "Inline `[^1]`, escaped \\[^1], and normal *emphasis*.",
      "",
      "```markdown",
      "[^code]: do not collect",
      "Code [^1]",
      "```",
      "",
      "[^1]: Safe <img src=x onerror=alert(1)> text",
      "    continuation **shown as literal source**",
      "",
      "    second paragraph"
    ].join("\n");
    const { state, meta, decorations } = build(source);
    expect(meta.footnotes).toEqual({ "1": "Safe <img src=x onerror=alert(1)> text\ncontinuation **shown as literal source**\n\nsecond paragraph" });
    expect(meta.inlineRanges.map(({ from, to }) => state.sliceDoc(from, to))).toEqual(["[^1]", "[^1]", "[^missing]"]);
    expect(meta.inlineRanges.some(({ from }) => source.slice(from - 1, from + 2).includes("linked"))).toBe(false);
    expect(meta.blockRanges).toHaveLength(1);
    const widgetNames: string[] = [];
    decorations.between(0, state.doc.length, (_from, _to, decoration) => {
      if (decoration.spec.widget) widgetNames.push(decoration.spec.widget.constructor.name);
    });
    expect(widgetNames.filter((name) => name === "FootnoteReferenceWidget")).toHaveLength(3);
    expect(widgetNames.filter((name) => name === "FootnoteDefinitionWidget")).toHaveLength(1);
  });

  it("preserves duplicate definitions in source and flags unresolved references", () => {
    const source = "[^x] and [^gone].\n\n[^x]: first\n\n[^x]: duplicate";
    const { state, meta, decorations } = build(source);
    expect(meta.footnotes).toEqual({ x: "first" });
    expect(meta.blockRanges).toHaveLength(2);
    expect(meta.shouldSkipNode("Link", source.lastIndexOf("[^x]"), source.lastIndexOf("[^x]") + 4)).toBe(true);
    let unresolved = false;
    decorations.between(0, state.doc.length, (_from, _to, decoration) => {
      if (decoration.spec.widget?.constructor.name === "FootnoteReferenceWidget") {
        unresolved = (decoration.spec.widget as { definition?: unknown }).definition === undefined;
      }
    });
    expect(unresolved).toBe(true);
    expect(source.slice(source.lastIndexOf("[^x]"))).toBe("[^x]: duplicate");
  });

  it("indexes large footnote documents without confusing inline code or link destinations", () => {
    const count = 20;
    const tick = String.fromCharCode(96);
    const body = Array.from({ length: count }, (_, index) => `Ref [^n${index}] ${tick}[^n${index}]${tick} [^n${index}](https://example.test/${index}).`).join("\n");
    const definitions = Array.from({ length: count }, (_, index) => `[^n${index}]: Note ${index}`).join("\n");
    const source = `${body}\n\n${definitions}`;
    const { meta } = build(source);
    expect(meta.inlineRanges).toHaveLength(count);
    expect(Object.keys(meta.footnotes)).toHaveLength(count);
  });

  it("leaves the focused YAML and footnote definition as source, including in read-only mode", () => {
    const source = "---\ntitle: A\n---\n\nRef [^1]\n\n[^1]: Definition";
    const yamlCursor = source.indexOf("title") + 2;
    expect(build(source, yamlCursor).meta.entries.some((entry) => entry.deco.spec.widget?.constructor.name === "FrontMatterWidget")).toBe(false);
    const definitionCursor = source.indexOf("Definition") + 2;
    expect(build(source, definitionCursor, true).meta.entries.some((entry) => entry.deco.spec.widget?.constructor.name === "FootnoteDefinitionWidget")).toBe(false);
  });

  it("recreates metadata widgets when the editor read-only mode changes", () => {
    const source = "---\ntitle: A\n---\n\n[^1]\n\n[^1]: Definition";
    const editing = build(source);
    const readOnly = build(source, -1, true);
    const widgets = (result: typeof editing) => result.meta.entries
      .map((entry) => entry.deco.spec.widget as (typeof entry.deco.spec.widget & { eq?: (other: unknown) => boolean }))
      .filter((widget) => widget && (widget.constructor.name === "FrontMatterWidget" || widget.constructor.name === "FootnoteDefinitionWidget"));
    const editingWidgets = widgets(editing);
    const readOnlyWidgets = widgets(readOnly);
    expect(editingWidgets.map((widget) => widget.constructor.name)).toEqual(["FrontMatterWidget", "FootnoteDefinitionWidget"]);
    expect(readOnlyWidgets.map((widget) => widget.constructor.name)).toEqual(["FrontMatterWidget", "FootnoteDefinitionWidget"]);
    editingWidgets.forEach((widget, index) => {
      expect(widget.eq?.(readOnlyWidgets[index])).toBe(false);
      expect(widget.eq?.(widget)).toBe(true);
    });
  });

  it("does not scan footnotes in the unparsed document tail", () => {
    const tail = "```markdown\n[^tail]: hidden definition\n```\n\n[^tail]";
    const source = `${"ordinary text\n".repeat(6000)}${tail}`;
    const state = EditorState.create({ doc: source, extensions: [markdown()] });
    expect(syntaxTree(state).length).toBeLessThan(state.doc.length);

    const meta = collectDocumentMetaDecorations(state, -1, -1);
    expect(meta.footnotes).toEqual({});
    expect(meta.inlineRanges).toEqual([]);
    expect(meta.blockRanges).toEqual([]);
  });
});
