import { describe, expect, it } from "vitest";
import { chunkMarkdownForAi, restoreMarkdownAfterAi, combineMarkdownAiChunks, previewMarkdownAiStream } from "../../src/core/ai/markdownChunker";

describe("Markdown AI chunk boundaries", () => {
  it("stream preview hides internal markers and restores their original content", () => {
    const { chunks } = chunkMarkdownForAi("Run `build` now", { createMask: () => "LOCAL_AI_TEST_" });
    expect(previewMarkdownAiStream(chunks[0].text, chunks[0])).toBe("Run `build` now");
    expect(previewMarkdownAiStream("Run LOCAL_AI_TEST_0", chunks[0])).toBe("Run …");
    expect(previewMarkdownAiStream("Run LOCAL_AI_", chunks[0])).toBe("Run …");
  });

  it("removes model-added code quotes around an opaque marker before restoring exact source", () => {
    const source = "Run `npm run build` then [visit](https://example.test)";
    const { chunks } = chunkMarkdownForAi(source, { createMask: () => "SAFE_" });
    const quoted = chunks[0].text.replace(/SAFE_\d+__/g, token => "`" + token + "`");
    expect(restoreMarkdownAfterAi(quoted, chunks)).toBe(source);
  });
  it("restores code, math, tables, front matter and inline source exactly", () => {
    const source = [
      "---", "title: Keep this", "---", "",
      "Polish this paragraph.", "",
      "```ts", "const value = 1;", "```", "",
      "$$", "x^2 + y^2", "$$", "",
      "| Name | Value |", "| --- | --- |", "| A | 1 |", "",
      "Keep `inline()` and [the text](https://private.test/path).", ""
    ].join("\n");
    const result = chunkMarkdownForAi(source, { createMask: () => "TEST_MASK_" });

    expect(result.exceeded).toBeNull();
    const output = result.chunks.map((chunk) => chunk.text).join("");
    expect(output).not.toContain("const value");
    expect(output).not.toContain("https://private.test");
    expect(restoreMarkdownAfterAi(output, result.chunks)).toBe(source);
  });

  it("does not silently process documents beyond the byte limit or block count", () => {
    expect(chunkMarkdownForAi("long", { maxInputBytes: 2 }).exceeded).toBe("bytes");
    expect(chunkMarkdownForAi("a\n\nb\n\nc", { maxChunkCharacters: 1, maxChunks: 2 }).exceeded)
      .toBe("chunks");
  });

  it("rejects dropped or duplicated protected tokens before an edit can be applied", () => {
    const result = chunkMarkdownForAi("Before `do not change` after", { createMask: () => "SAFE_" });
    const token = result.chunks[0].text.match(/SAFE_\d+__/g)?.[0];
    expect(token).toBeTruthy();
    expect(() => restoreMarkdownAfterAi("rewritten text", result.chunks)).toThrow(/受保护/);
    expect(() => restoreMarkdownAfterAi(`${token} ${token}`, result.chunks)).toThrow(/受保护/);
  });

  it("returns no chunks for an empty document", () => {
    expect(chunkMarkdownForAi("\n ").chunks).toEqual([]);
  });

  it("restores hundreds of protected ranges in one ordered pass", () => {
    const source = Array.from({ length: 300 }, (_, index) => `\`value-${index}\``).join(" ");
    const result = chunkMarkdownForAi(source, { createMask: () => "MANY_" });
    const markerOnlyOutput = result.chunks.map((chunk) => chunk.text.match(/MANY_\d+__/g)?.join(" ") ?? "").join(" ");
    expect(restoreMarkdownAfterAi(markerOnlyOutput, result.chunks)).toBe(source);
  });

  it("preserves image destinations and does not add an opening parenthesis", () => {
    const source = "![图片](https://example.test/a.png) and [链接](https://example.test/a)";
    const result = chunkMarkdownForAi(source);
    expect(restoreMarkdownAfterAi(result.chunks.map(chunk => chunk.text).join(""), result.chunks)).toBe(source);
  });

  it("packs many short paragraphs within the context budget", () => {
    const source = "短段落。\n\n".repeat(80);
    const result = chunkMarkdownForAi(source);
    expect(result.exceeded).toBeNull();
    expect(result.chunks.length).toBe(1);
  });

  it("keeps paragraph boundaries even when model output drops trailing newlines", () => {
    const source = "第一段文字。\n\n第二段文字。\n\n第三段。\n";
    const result = chunkMarkdownForAi(source, { maxChunkCharacters: 12 });
    expect(combineMarkdownAiChunks(result.chunks.map(chunk => chunk.text.trimEnd()), result.chunks)).toBe(source);
  });

  it("restores original leading whitespace, mixed line endings, and hard-break spaces at every chunk boundary", () => {
    const source = "  第一段。  \r\n\r\n  第二段。\r第三段。  ";
    const result = chunkMarkdownForAi(source, { maxChunkCharacters: 12 });
    const outputs = result.chunks.map((chunk) => chunk.text.trim());
    expect(combineMarkdownAiChunks(outputs, result.chunks)).toBe(source);
  });

  it("protects an unclosed fenced block through end of document and an unmatched inline code span to line end", () => {
    const source = "Editable opening.\n\n~~~ts\nconst secret = 1;\nstill code";
    const inline = "Before `unclosed code stays unchanged\nNext paragraph remains editable.";
    const fencedResult = chunkMarkdownForAi(source, { createMask: () => "UNCLOSED_FENCE_" });
    const fencedSent = fencedResult.chunks.map(chunk => chunk.text).join("");
    expect(fencedSent).not.toContain("const secret");
    expect(restoreMarkdownAfterAi(fencedSent, fencedResult.chunks)).toBe(source);
    const inlineResult = chunkMarkdownForAi(inline, { createMask: () => "UNCLOSED_INLINE_" });
    const inlineSent = inlineResult.chunks.map(chunk => chunk.text).join("");
    expect(inlineSent).not.toContain("unclosed code stays unchanged");
    expect(inlineSent).toContain("Next paragraph remains editable.");
    expect(restoreMarkdownAfterAi(inlineSent, inlineResult.chunks)).toBe(inline);
  });

  it("uses parser source ranges for nested link and image destinations", () => {
    const source = "Rewrite [this label](https://example.test/a_(nested_(path))) and ![alt text](<https://img.test/folder_(one)/file.png> \"title\").";
    const result = chunkMarkdownForAi(source, { createMask: () => "LINK_" });
    const sent = result.chunks.map(chunk => chunk.text).join("");
    expect(sent).toContain("this label");
    expect(sent).not.toContain("https://example.test");
    expect(sent).not.toContain("https://img.test");
    expect(restoreMarkdownAfterAi(sent, result.chunks)).toBe(source);
  });

  it("protects reference link labels, definitions, destinations and titles", () => {
    const source = "See [the guide][docs].\n\n[docs]: <https://example.test/a_(b)> \"Reference title\"\n";
    const result = chunkMarkdownForAi(source, { createMask: () => "REF_" });
    const sent = result.chunks.map(chunk => chunk.text).join("");
    expect(sent).not.toContain("https://example.test");
    expect(sent).not.toContain("Reference title");
    expect(restoreMarkdownAfterAi(sent, result.chunks)).toBe(source);
  });

  it("protects GFM tables even without leading or trailing edge pipes", () => {
    const source = "Before table.\n\nName | Value\n:--- | ---:\nA | 1\n\nAfter table.";
    const result = chunkMarkdownForAi(source, { createMask: () => "TABLE_" });
    const sent = result.chunks.map(chunk => chunk.text).join("");
    expect(sent).not.toContain("Name | Value");
    expect(sent).not.toContain("A | 1");
    expect(restoreMarkdownAfterAi(sent, result.chunks)).toBe(source);
  });

  it("protects GFM tables with LF, CRLF, and CR while preserving adjacent source exactly", () => {
    for (const newline of ["\n", "\r\n", "\r"]) {
      const source = [
        "Editable introduction.",
        "| Name | Value |",
        "| --- | --- |",
        "| private | 42 |",
        "",
        "Editable middle.",
        "",
        "```ts",
        "const secret = true;",
        "```",
        "",
        "$$",
        "x_i = 42",
        "$$",
        "",
        "Editable ending."
      ].join(newline);
      const result = chunkMarkdownForAi(source, { createMask: () => "LINE_ENDING_" });
      const sent = result.chunks.map((chunk) => chunk.text).join("");

      expect(sent).not.toContain("| Name | Value |");
      expect(sent).not.toContain("| private | 42 |");
      expect(sent).not.toContain("const secret");
      expect(sent).not.toContain("x_i = 42");
      expect(sent).toContain("Editable introduction.");
      expect(sent).toContain("Editable middle.");
      expect(sent).toContain("Editable ending.");
      expect(restoreMarkdownAfterAi(sent, result.chunks)).toBe(source);
    }
  });

  it("keeps protected placeholders and UTF-16 surrogate pairs atomic when splitting long lines", () => {
    const source = "A🙂 `keep this token` Z";
    const result = chunkMarkdownForAi(source, {
      maxChunkCharacters: 1,
      createMask: () => "T_"
    });
    const token = result.chunks.flatMap(chunk => chunk.text.match(/T_\d+__/g) ?? []);

    expect(result.exceeded).toBeNull();
    expect(token).toEqual(["T_0__"]);
    // Atomic emoji and placeholder chunks may exceed a deliberately tiny test budget.
    expect(result.chunks.some(chunk => chunk.text.length > 1)).toBe(true);
    for (let index = 0; index < result.chunks.length - 1; index += 1) {
      const left = result.chunks[index].text.charCodeAt(result.chunks[index].text.length - 1);
      const right = result.chunks[index + 1].text.charCodeAt(0);
      expect(left >= 0xd800 && left <= 0xdbff && right >= 0xdc00 && right <= 0xdfff).toBe(false);
    }
    expect(restoreMarkdownAfterAi(result.chunks.map(chunk => chunk.text).join(""), result.chunks)).toBe(source);
  });

  it("protects footnote references and same-line display math", () => {
    const source = "Keep [^note] intact beside $$x^2 + y^2$$.\n\n[^note]: Definition stays unchanged.\n";
    const result = chunkMarkdownForAi(source, { createMask: () => "FOOTNOTE_MATH_" });
    const sent = result.chunks.map(chunk => chunk.text).join("");

    expect(sent).not.toContain("[^note]");
    expect(sent).not.toContain("x^2 + y^2");
    expect(restoreMarkdownAfterAi(sent, result.chunks)).toBe(source);
  });

  it("does not let a footnote reference on a bare-CR line consume following editable text", () => {
    const source = "Keep [^note]\rNext line remains editable.";
    const result = chunkMarkdownForAi(source, { createMask: () => "CR_FOOTNOTE_" });
    const sent = result.chunks.map((chunk) => chunk.text).join("");
    expect(sent).not.toContain("[^note]");
    expect(sent).toContain("Next line remains editable.");
    expect(restoreMarkdownAfterAi(sent, result.chunks)).toBe(source);
  });
});
