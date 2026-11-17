import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { syntaxTree } from "@codemirror/language";
import { buildFencedCodeDecorations } from "../../src/core/cm6/fencedCodeDecorations";
import { CodeBlockHeaderWidget } from "../../src/core/cm6/widgets";
import { composeLivePreviewDecorations } from "../../src/core/cm6/decorationComposer";

function build(source: string, cursor = 0) {
  const state = EditorState.create({ doc: source, selection: { anchor: cursor }, extensions: [markdown()] });
  const tree = syntaxTree(state);
  let range: { from: number; to: number } | undefined;
  tree.iterate({ enter(node) { if (node.name === "FencedCode") range = { from: node.from, to: node.to }; } });
  if (!range) throw new Error(`Expected a fenced code node, got ${tree.toString()}`);
  const entries = buildFencedCodeDecorations(state, range.from, range.to, cursor, cursor);
  return { state, entries };
}

describe("CM6 fenced code decorations", () => {
  it("hides a backtick fence on blur and highlights supported TypeScript tokens", () => {
    const source = "Intro\n\n```typescript title=sample.ts\nconst answer = 42;\n```";
    const { state, entries } = build(source, 1);
    const replacements = entries.filter((entry) => entry.priority === 0);
    const marks = entries.filter((entry) => entry.deco.spec.class?.startsWith("hljs-"));

    expect(replacements.map(({ from, to }) => state.sliceDoc(from, to))).toEqual([
      "```typescript title=sample.ts", "```"
    ]);
    expect(marks.map((entry) => [entry.deco.spec.class, state.sliceDoc(entry.from, entry.to)])).toEqual([
      ["hljs-keyword", "const"], ["hljs-number", "42"]
    ]);
    const header = entries.find((entry) => entry.deco.spec.widget instanceof CodeBlockHeaderWidget)?.deco.spec.widget as CodeBlockHeaderWidget;
    expect(header.language).toBe("typescript");
    expect(header.codeContent).toBe("const answer = 42;\n");
    expect(() => composeLivePreviewDecorations(entries)).not.toThrow();
    expect(state.doc.toString()).toBe(source);
  });

  it("keeps delimiters visible while editing, keeps token colors, and styles code rows", () => {
    const source = "Intro\n\n~~~ts\nconst value = 1;\n~~~";
    const cursor = source.indexOf("value");
    const { entries } = build(source, cursor);

    expect(entries.some((entry) => entry.priority === 0)).toBe(false);
    expect(entries.some((entry) => entry.deco.spec.class === "hljs-keyword")).toBe(true);
    expect(entries.some((entry) => entry.deco.spec.widget instanceof CodeBlockHeaderWidget)).toBe(false);
    expect(entries.filter((entry) => entry.deco.spec.class === "cm-codeblock-line")).toHaveLength(3);
  });

  it("normalizes common aliases and accepts only a matching sufficiently long closing fence", () => {
    const source = "Intro\n\n````py\n# Keep a # comment\nprint(1)\n~~~\n````";
    const { state, entries } = build(source, 0);
    const marks = entries.filter((entry) => entry.deco.spec.class?.startsWith("hljs-"));
    const replacements = entries.filter((entry) => entry.priority === 0);

    expect(marks.some((entry) => entry.deco.spec.class === "hljs-comment" && state.sliceDoc(entry.from, entry.to) === "# Keep a # comment")).toBe(true);
    expect(replacements.map(({ from, to }) => state.sliceDoc(from, to))).toEqual(["````py", "````"]);
    expect(marks.some((entry) => state.sliceDoc(entry.from, entry.to) === "1")).toBe(true);
  });

  it("leaves unknown languages and plain text uncolored while retaining code row styling", () => {
    const source = "Intro\n\n```brainfuck\n+++++\n```";
    const { entries } = build(source);

    expect(entries.some((entry) => entry.deco.spec.class?.startsWith("hljs-"))).toBe(false);
    expect(entries.some((entry) => entry.deco.spec.class === "cm-codeblock-line")).toBe(true);
    expect(entries.filter((entry) => entry.priority === 0)).toHaveLength(2);
  });

  it("does not color explicitly plaintext blocks", () => {
    const { entries } = build("Intro\n\n```plaintext\nconst text = 123;\n```");
    expect(entries.some((entry) => entry.deco.spec.class?.startsWith("hljs-"))).toBe(false);
  });

  it("leaves blockquote and list code fences untouched until their container prefixes can be rendered safely", () => {
    for (const source of [
      "> ```ts\n> const x = 1;\n> ```",
      "- ```ts\n  const x = 1;\n  ```",
      "- item\n\n  ```ts\n  const x = 1;\n  ```"
    ]) {
      const { entries } = build(source);
      expect(entries).toEqual([]);
    }
  });

  it("handles an empty closed block and an unclosed tilde block without inventing body text", () => {
    const empty = build("Intro\n\n```text\n```");
    expect(empty.entries.filter((entry) => entry.priority === 0)).toHaveLength(2);
    expect(empty.entries.some((entry) => entry.deco.spec.class?.startsWith("hljs-"))).toBe(false);
    expect(empty.entries.filter((entry) => entry.deco.spec.class === "cm-codeblock-line")).toHaveLength(2);

    const unclosed = build("Intro\n\n~~~js\nconst ready = true;");
    expect(unclosed.entries.filter((entry) => entry.priority === 0)).toHaveLength(1);
    expect(unclosed.entries.some((entry) => entry.deco.spec.class === "hljs-keyword")).toBe(true);
  });
});
