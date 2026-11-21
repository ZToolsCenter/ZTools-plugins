import { describe, expect, it } from "vitest";
import { renderArtifact } from "../../src/core/ai/artifactRenderer";
import { ArtifactValidationError, validateArtifactCandidate } from "../../src/core/ai/artifactValidation";
import type { ArtifactField, ArtifactSpec } from "../../src/core/ai/artifactSpec";

const field = <T>(value: T): ArtifactField<T> => ({ value, evidence: [] });
const base = { displaySource: false, sourceDependent: false, issues: [] } as const;

describe("artifact specification rendering", () => {
  it("renders a nested Markdown heading inside a fence longer than its body fences", () => {
    const spec: ArtifactSpec = {
      ...base,
      kind: "code",
      language: field("markdown"),
      heading: { level: field(1), text: field("标题一") },
      literalBody: field("# 标题一\n\n```ts\nconst message = `hello`;\n```")
    };

    const rendered = renderArtifact(spec);
    expect(rendered).toBe("````markdown\n# 标题一\n\n```ts\nconst message = `hello`;\n```\n````");
    expect(() => validateArtifactCandidate(spec, rendered!)).not.toThrow();
  });

  it("does not treat only a language or table columns as a complete artifact", () => {
    const code: ArtifactSpec = { ...base, kind: "code", language: field("typescript") };
    const table: ArtifactSpec = { ...base, kind: "table", columns: [field("名称"), field("价格")] };

    expect(renderArtifact(code)).toBeUndefined();
    expect(renderArtifact(table)).toBeUndefined();
  });

  it("does not construct source-dependent or conflicted artifacts", () => {
    const spec: ArtifactSpec = { ...base, kind: "list", ordered: false, items: [field("完成")], sourceDependent: true };
    const conflicted: ArtifactSpec = { ...spec, sourceDependent: false, issues: ["缺少来源"] };

    expect(renderArtifact(spec)).toBeUndefined();
    expect(renderArtifact(conflicted)).toBeUndefined();
  });

  it("checks a direct heading's exact text and level", () => {
    const spec: ArtifactSpec = { ...base, kind: "heading", heading: { level: field(1), text: field("标题一") } };

    expect(renderArtifact(spec)).toBe("# 标题一");
    expect(() => validateArtifactCandidate(spec, "# 标题一")).not.toThrow();
    expect(() => validateArtifactCandidate(spec, "# hello"))
      .toThrow(expect.objectContaining({ code: "heading_text_mismatch" } satisfies Partial<ArtifactValidationError>));
    expect(() => validateArtifactCandidate(spec, "## 标题一"))
      .toThrow(expect.objectContaining({ code: "heading_level_mismatch" } satisfies Partial<ArtifactValidationError>));
  });

  it("checks a nested heading's exact text and level inside a code fence", () => {
    const spec: ArtifactSpec = {
      ...base,
      kind: "code",
      language: field("markdown"),
      heading: { level: field(1), text: field("标题一") }
    };
    const valid = "```md\n# 标题一\n```";

    expect(() => validateArtifactCandidate(spec, valid)).not.toThrow();
    expect(() => validateArtifactCandidate(spec, "```markdown\n# hello\n```"))
      .toThrow(expect.objectContaining({ code: "heading_text_mismatch" } satisfies Partial<ArtifactValidationError>));
    expect(() => validateArtifactCandidate(spec, "```md\n## 标题一\n```"))
      .toThrow(expect.objectContaining({ code: "heading_level_mismatch" } satisfies Partial<ArtifactValidationError>));
  });

  it("matches explicit function names as definitions, not as substrings", () => {
    const spec: ArtifactSpec = { ...base, kind: "code", functionName: field("add") };

    expect(() => validateArtifactCandidate(spec, "```ts\nfunction add(a: number, b: number) { return a + b; }\n```"))
      .not.toThrow();
    expect(() => validateArtifactCandidate(spec, "```ts\nfunction a_plus_b(a: number, b: number) { return a + b; }\n```"))
      .toThrow(expect.objectContaining({ code: "function_name_mismatch" } satisfies Partial<ArtifactValidationError>));
    expect(renderArtifact({ ...spec, literalBody: field("function a_plus_b(a, b) { return a + b; }") })).toBeUndefined();
  });

  it("accepts equivalent explicit language aliases and an unlabeled code fence when unspecified", () => {
    const explicit: ArtifactSpec = { ...base, kind: "code", language: field("js") };
    const unspecified: ArtifactSpec = { ...base, kind: "code" };

    expect(() => validateArtifactCandidate(explicit, "```javascript\nconst answer = 42;\n```" )).not.toThrow();
    expect(() => validateArtifactCandidate(explicit, "```python\nanswer = 42\n```"))
      .toThrow(expect.objectContaining({ code: "language_mismatch" } satisfies Partial<ArtifactValidationError>));
    expect(() => validateArtifactCandidate(unspecified, "```\nplain body\n```" )).not.toThrow();
  });

  it("serializes JSON as JSON and compares parsed structure without depending on key order", () => {
    const spec: ArtifactSpec = { ...base, kind: "code", language: field("json"), jsonBody: field({ name: "橙子", price: 48 }) };
    const rendered = renderArtifact(spec);

    expect(rendered).toBe('```json\n{\n  "name": "橙子",\n  "price": 48\n}\n```');
    expect(() => validateArtifactCandidate(spec, '```json\n{"price":48,"name":"橙子"}\n```')).not.toThrow();
    expect(() => validateArtifactCandidate(spec, '```json\n{"price":21,"name":"橙子"}\n```'))
      .toThrow(expect.objectContaining({ code: "json_body_mismatch" } satisfies Partial<ArtifactValidationError>));
  });

  it("escapes table separators and preserves CRLF and Unicode cells", () => {
    const spec: ArtifactSpec = {
      ...base,
      kind: "table",
      columns: [field("名称"), field("备注")],
      rows: [[field("苹果"), field("A | B\r\n第二行")]]
    };
    const rendered = renderArtifact(spec);

    expect(rendered).toBe("| 名称 | 备注 |\n| --- | --- |\n| 苹果 | A \\| B<br>第二行 |");
    expect(() => validateArtifactCandidate(spec, rendered!)).not.toThrow();
    expect(() => validateArtifactCandidate(spec, rendered!.replace("苹果", "桃子")))
      .toThrow(expect.objectContaining({ code: "table_cell_mismatch" } satisfies Partial<ArtifactValidationError>));
  });

  it("accepts a table with a title and rejects a title or LaTeX fragment without a table", () => {
    const spec: ArtifactSpec = { ...base, kind: "table", columns: [field("名称"), field("数量")] };
    const titled = "水果\n\n| 名称 | 数量 |\n| --- | --- |\n| 苹果 | 2 |";

    expect(() => validateArtifactCandidate(spec, titled)).not.toThrow();
    expect(() => validateArtifactCandidate(spec, "水果"))
      .toThrow(expect.objectContaining({ code: "missing_table" } satisfies Partial<ArtifactValidationError>));
    expect(() => validateArtifactCandidate(spec, "LaTeX: x^2 + y^2"))
      .toThrow(expect.objectContaining({ code: "missing_table" } satisfies Partial<ArtifactValidationError>));
  });

  it("renders and validates ordered list items, count, and order", () => {
    const spec: ArtifactSpec = { ...base, kind: "list", ordered: true, count: field(2), items: [field("开始"), field("完成 ✅")] };
    const rendered = renderArtifact(spec);

    expect(rendered).toBe("1. 开始\n2. 完成 ✅");
    expect(() => validateArtifactCandidate(spec, rendered!)).not.toThrow();
    expect(() => validateArtifactCandidate(spec, "1. 完成 ✅\n2. 开始"))
      .toThrow(expect.objectContaining({ code: "list_item_mismatch" } satisfies Partial<ArtifactValidationError>));
    expect(() => validateArtifactCandidate(spec, "1. 开始\n2. 完成 ✅\n3. 额外"))
      .toThrow(expect.objectContaining({ code: "list_count_mismatch" } satisfies Partial<ArtifactValidationError>));
    const multiline: ArtifactSpec = { ...base, kind: "list", ordered: false, items: [field("第一行\n第二行")] };
    const multilineRendered = renderArtifact(multiline);
    expect(multilineRendered).toBe("- 第一行<br>第二行");
    expect(() => validateArtifactCandidate(multiline, multilineRendered!)).not.toThrow();
  });

  it("requires explicit math delimiters and checks the given formula", () => {
    const display: ArtifactSpec = { ...base, kind: "math", display: true, equation: field("a^2 + b^2 = c^2") };
    const inline: ArtifactSpec = { ...base, kind: "math", display: false, equation: field("x + 1") };

    expect(renderArtifact(display)).toBe("$$\na^2 + b^2 = c^2\n$$");
    expect(() => validateArtifactCandidate(display, "$$\na^2 + b^2 = c^2\n$$")).not.toThrow();
    expect(() => validateArtifactCandidate(display, "$$\na^2 + b^2 = c\n$$"))
      .toThrow(expect.objectContaining({ code: "math_equation_mismatch" } satisfies Partial<ArtifactValidationError>));
    expect(() => validateArtifactCandidate(display, "LaTeX: a^2 + b^2 = c^2"))
      .toThrow(expect.objectContaining({ code: "invalid_math" } satisfies Partial<ArtifactValidationError>));
    expect(() => validateArtifactCandidate(inline, "$x + 1$")).not.toThrow();
    expect(() => validateArtifactCandidate(inline, "$$\nx + 1\n$$"))
      .toThrow(expect.objectContaining({ code: "math_display_mismatch" } satisfies Partial<ArtifactValidationError>));
  });

  it("checks simple Mermaid direction, nodes, and relationships", () => {
    const spec: ArtifactSpec = {
      ...base,
      kind: "mermaid",
      graph: {
        direction: "LR",
        nodes: [field("开始"), field("审核"), field("结束")],
        edges: [{ from: 0, to: 1 }, { from: 1, to: 2 }]
      }
    };
    const valid = "```mermaid\ngraph LR\n  Start[开始] --> Check[审核] --> Done[结束]\n```";

    const rendered = renderArtifact(spec);
    expect(rendered).toContain("graph LR");
    expect(() => validateArtifactCandidate(spec, rendered!)).not.toThrow();
    expect(() => validateArtifactCandidate(spec, valid)).not.toThrow();
    expect(() => validateArtifactCandidate(spec, "```mermaid\ngraph LR\n  Start[开始] --> Review[审核]\n  Start[开始] --> Done[结束]\n```"))
      .toThrow(expect.objectContaining({ code: "mermaid_edge_mismatch" } satisfies Partial<ArtifactValidationError>));
    expect(() => validateArtifactCandidate(spec, "```mermaid\nflowchart TD\n  Start[开始] --> Check[审核] --> Done[结束]\n```"))
      .toThrow(expect.objectContaining({ code: "mermaid_direction_mismatch" } satisfies Partial<ArtifactValidationError>));
    expect(() => validateArtifactCandidate({ ...spec, graph: undefined }, "```mermaid\ngraph LR\n  Start[开始] --> Done[结束]\n```"))
      .not.toThrow();
    expect(() => validateArtifactCandidate(spec, "```mermaid\nsequenceDiagram\n  Alice->>Bob: 请求\n```"))
      .toThrow(expect.objectContaining({ code: "mermaid_edge_mismatch" }));
    expect(() => validateArtifactCandidate({ ...spec, graph: undefined }, "```mermaid\nsequenceDiagram\n  Alice->>Bob: 请求\n```"))
      .not.toThrow();
    expect(() => validateArtifactCandidate(spec, "水果"))
      .toThrow(expect.objectContaining({ code: "invalid_mermaid" } satisfies Partial<ArtifactValidationError>));
  });

  it("keeps explicit validation active for partial composition without constructing it", () => {
    const spec: ArtifactSpec = {
      ...base,
      kind: "heading",
      composition: "partial",
      heading: { level: field(2), text: field("目标") }
    };

    expect(renderArtifact(spec)).toBeUndefined();
    expect(() => validateArtifactCandidate(spec, "# 其他"))
      .toThrow(expect.objectContaining({ code: "heading_text_mismatch" } satisfies Partial<ArtifactValidationError>));
    expect(() => validateArtifactCandidate(spec, "## 目标")).not.toThrow();
    const unresolved: ArtifactSpec = { ...spec, issues: ["还有正文要求"] };
    expect(() => validateArtifactCandidate(unresolved, "# 其他"))
      .toThrow(expect.objectContaining({ code: "heading_text_mismatch" } satisfies Partial<ArtifactValidationError>));
    expect(() => validateArtifactCandidate(unresolved, "## 目标"))
      .toThrow(expect.objectContaining({ code: "invalid_spec" } satisfies Partial<ArtifactValidationError>));
  });

  it("does not add a content judgment for none or free-form Markdown", () => {
    expect(() => validateArtifactCandidate({ ...base, kind: "none" }, "anything at all")).not.toThrow();
    expect(() => validateArtifactCandidate({ ...base, kind: "markdown" }, "anything at all")).not.toThrow();
  });
});
it.each(["const x = 1;\n", "const x = 1;\r\n", "hello\n\n"])("retains a literal code body's final newline: %j", value => {
  const spec: ArtifactSpec = { kind: "code", displaySource: false, sourceDependent: false, issues: [], literalBody: { value, evidence: [] } };
  const result = renderArtifact(spec);
  expect(result).toBeDefined();
  expect(result).toContain(value);
  expect(() => validateArtifactCandidate(spec, result!)).not.toThrow();
});
