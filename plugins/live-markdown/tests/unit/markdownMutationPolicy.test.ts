import { describe, expect, it } from "vitest";
import { deriveMarkdownMutationPolicy, type MarkdownMutationPolicy } from "../../src/core/ai/markdownMutationPolicy";
import { validateMarkdownAstIntegrity } from "../../src/core/ai/markdownAstIntegrity";

function boundChange(source: string, find: string, insertText: string, startAt = 0) {
  const from = source.indexOf(find, startAt);
  if (from < 0) throw new Error(`Missing fixture literal: ${find}`);
  return { from, to: from + find.length, matchedText: find, insertText };
}

function policyFor(source: string, change: ReturnType<typeof boundChange>) {
  return deriveMarkdownMutationPolicy(source, {
    operation: "replace_exact",
    contentMode: "literal",
    matchesBound: true,
    changes: [change]
  });
}

function apply(source: string, change: ReturnType<typeof boundChange>): string {
  return source.slice(0, change.from) + change.insertText + source.slice(change.to);
}

describe("Markdown mutation policy", () => {
  it("only issues a capability for a bound, exact literal replacement", () => {
    const source = "```ts\nconst value = 'old';\n```";
    const change = boundChange(source, "old", "new");

    expect(deriveMarkdownMutationPolicy(source, {
      operation: "rewrite", contentMode: "literal", matchesBound: true, changes: [change]
    })).toBeNull();
    expect(deriveMarkdownMutationPolicy(source, {
      operation: "replace_exact", contentMode: "generate", matchesBound: true, changes: [change]
    })).toBeNull();
    expect(deriveMarkdownMutationPolicy(source, {
      operation: "replace_exact", contentMode: "literal", matchesBound: false, changes: [change]
    })).toBeNull();
    expect(deriveMarkdownMutationPolicy(source, {
      operation: "replace_exact", contentMode: "literal", matchesBound: true,
      changes: [{ ...change, matchedText: "not-the-source" }]
    })).toBeNull();
  });

  it.each([
    {
      label: "fenced code body",
      source: "# Example\n\n```ts\nconst value = 'old-value';\n```\n",
      find: "old-value",
      replacement: "new-value"
    },
    {
      label: "table cell",
      source: "| Name | Value |\n| --- | --- |\n| state | old-value |",
      find: "old-value",
      replacement: "new-value"
    },
    {
      label: "link destination",
      source: "[Guide](https://docs.example.test/old-path)",
      find: "old-path",
      replacement: "new-path"
    },
    {
      label: "plain frontmatter scalar",
      source: "---\ntitle: old-title\nauthor: editor\n---\n\nBody.",
      find: "old-title",
      replacement: "new-title"
    },
    {
      label: "math expression body",
      source: "Area is $x^2$.",
      find: "x^2",
      replacement: "x^3"
    }
  ])("allows a precise literal mutation inside $label while preserving the rest", ({ source, find, replacement }) => {
    const change = boundChange(source, find, replacement);
    const policy = policyFor(source, change);
    expect(policy).not.toBeNull();
    expect(() => validateMarkdownAstIntegrity(source, apply(source, change), false, policy!)).not.toThrow();
  });

  it("keeps protected-node edits rejected when no capability is provided", () => {
    const source = "```js\nconst value = 'old';\n```";
    const change = boundChange(source, "old", "new");
    expect(() => validateMarkdownAstIntegrity(source, apply(source, change), false)).toThrow(/AST 结构校验/);
  });

  it("rejects a candidate that changes bytes outside the bound replacement", () => {
    const source = "```js\nconst value = 'old';\n```\n\nKeep this paragraph.";
    const change = boundChange(source, "old", "new");
    const policy = policyFor(source, change)!;
    expect(() => validateMarkdownAstIntegrity(source, `${apply(source, change)}\nextra`, false, policy))
      .toThrow(/超出已绑定的精确替换范围/);
  });

  it("rejects overlapping, unbound, or out-of-range changes", () => {
    const source = "```js\nconst value = 'old';\n```";
    const change = boundChange(source, "old", "new");
    expect(deriveMarkdownMutationPolicy(source, {
      operation: "replace_exact", contentMode: "literal", matchesBound: true,
      changes: [change, change]
    })).toBeNull();
    expect(deriveMarkdownMutationPolicy(source, {
      operation: "replace_exact", contentMode: "literal", matchesBound: true,
      changes: [{ ...change, from: -1 }]
    })).toBeNull();
  });

  it("supports multiple already-bound occurrences in one protected node", () => {
    const source = "```txt\nold and old\n```";
    const first = boundChange(source, "old", "new");
    const second = boundChange(source, "old", "new", first.to);
    const changes = [first, second];
    const output = source.slice(0, second.from) + second.insertText + source.slice(second.to);
    const twice = source.slice(0, first.from) + first.insertText + output.slice(first.to);
    const policy = deriveMarkdownMutationPolicy(source, {
      operation: "replace_exact", contentMode: "literal", matchesBound: true, changes
    });
    expect(policy).not.toBeNull();
    expect(() => validateMarkdownAstIntegrity(source, twice, false, policy!)).not.toThrow();
  });

  it("does not allow a table-cell replacement to add a pipe or a line break", () => {
    const source = "| Name | Value |\n| --- | --- |\n| state | old |";
    for (const insertText of ["new|column", "new\nrow", "new\r\nrow"]) {
      expect(policyFor(source, boundChange(source, "old", insertText))).toBeNull();
    }
  });

  it("does not allow a code edit to expand line breaks or touch fence and language text", () => {
    const source = "```ts\nconst value = 'old';\n```";
    expect(policyFor(source, boundChange(source, "old", "new\nline"))).toBeNull();
    expect(policyFor(source, boundChange(source, "ts", "js"))).toBeNull();
    expect(policyFor(source, boundChange(source, "const value = 'old';", "const value = 'new';\nrun();"))).toBeNull();
  });

  it("rejects invalid URL targets without performing network access", () => {
    const source = "[Guide](https://docs.example.test/old-path)";
    expect(policyFor(source, boundChange(source, "old-path", "bad path"))).toBeNull();
    expect(policyFor(source, boundChange(source, "https://docs.example.test/old-path", "javascript:alert(1)"))).toBeNull();
  });

  it("only permits simple single-line frontmatter scalars", () => {
    const source = "---\ntitle: old-title\ntags: [one, two]\n---\nBody.";
    expect(policyFor(source, boundChange(source, "old-title", "new: title"))).toBeNull();
    expect(policyFor(source, boundChange(source, "[one, two]", "[three]"))).toBeNull();
    expect(policyFor(source, boundChange(source, "old-title", "new\ntitle"))).toBeNull();
  });

  it("keeps math delimiters and footnote identities protected", () => {
    const math = "Area is $x^2$.";
    expect(policyFor(math, boundChange(math, "x^2", "x$^3"))).toBeNull();
    const footnote = "[^id]: body";
    expect(policyFor(footnote, boundChange(footnote, "id", "other"))).toBeNull();
    expect(() => validateMarkdownAstIntegrity(footnote, "[^other]: body", false)).toThrow(/AST 结构校验/);
  });

  it("rejects forged capabilities and policies bound to another source", () => {
    const source = "```js\nconst value = 'old';\n```";
    const change = boundChange(source, "old", "new");
    const policy = policyFor(source, change)!;
    const forged = { ...policy } as MarkdownMutationPolicy;
    expect(() => validateMarkdownAstIntegrity(source, apply(source, change), false, forged)).toThrow(/不是由精确替换授权器签发/);
    expect(() => validateMarkdownAstIntegrity(`${source}\nextra`, apply(source, change), false, policy)).toThrow(/与当前文档不一致/);
  });
});
