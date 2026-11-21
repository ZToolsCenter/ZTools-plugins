import { describe, expect, it } from "vitest";
import { normalizeCodePayload } from "../../src/core/ai/codePayloadNormalization";

describe("code heading echo normalization", () => {
  it("removes one standalone requested heading echoed after a complete TypeScript function", () => {
    const source = "function makeLabel(name: string): string {\n  return `Name: ${name}`;\n}\n\nExample";

    expect(normalizeCodePayload(source, "typescript", false, { expectedHeading: "Example" })).toEqual({
      body: "function makeLabel(name: string): string {\n  return `Name: ${name}`;\n}",
      warning: "已移除与明确标题关联的重复标题。",
      syntax: "valid"
    });
  });

  it("preserves a same-word value inside the requested function body", () => {
    const source = "function describeExample(name) {\n  return `Example ${name}`;\n}";

    expect(normalizeCodePayload(source, "javascript", false, { expectedHeading: "Example" })).toEqual({
      body: source,
      syntax: "valid"
    });
  });

  it("preserves a special-character title that parses as a potentially meaningful expression", () => {
    const source = "API <v3> / C++ & Rust\n\nfunction makeBadge(label: string): string {\n  return `Badge ${label}`;\n}";

    expect(normalizeCodePayload(source, "typescript", false, { expectedHeading: "API <v3> / C++ & Rust" })).toEqual({
      body: source,
      syntax: "valid"
    });
  });

  it("removes an explicit Markdown heading only when removing it restores a complete function body", () => {
    const source = "## Example\n\nfunction describeExample(name) {\n  return name;\n}";

    expect(normalizeCodePayload(source, "javascript", false, { expectedHeading: "Example" })).toMatchObject({
      body: "function describeExample(name) {\n  return name;\n}",
      warning: "已移除与明确标题关联的重复标题。",
      syntax: "valid"
    });
  });

  it("preserves same-named binding, references, comments, and strings at the boundary", () => {
    const binding = "Example\n\nconst Example = getExample();\nfunction describeExample(name) { return Example + name; }";
    const reference = "function describeExample(Example) { return Example; }\n\nExample";
    const comment = "function describeExample(name) { return name; }\n\n// Example";
    const string = "function describeExample(name) { return name; }\n\nconst label = `Example`;";
    const multilineTemplate = "function describeExample(name) { return name; }\nconst label = `\nExample\n`;";
    const multilineComment = "function describeExample(name) { return name; }\n/*\nExample\n*/";

    for (const source of [binding, reference, comment, string, multilineTemplate, multilineComment]) {
      const normalized = normalizeCodePayload(source, "javascript", false, { expectedHeading: "Example" });
      expect(normalized?.body).toBe(source);
      expect(normalized?.warning).toBeUndefined();
    }
  });

  it("leaves unmatched, repeated, and function-free code untouched", () => {
    const unmatched = "function describeExample(name) { return name; }\n\nExamples";
    const repeated = "Example\n\nfunction describeExample(name) { return name; }\n\nExample";
    const noFunction = "Example\n\nimport { makeBadge } from './badge.js';\nmakeBadge('x');";

    expect(normalizeCodePayload(unmatched, "javascript", false, { expectedHeading: "Example" })?.body).toBe(unmatched);
    expect(normalizeCodePayload(repeated, "javascript", false, { expectedHeading: "Example" })?.body).toBe(repeated);
    expect(normalizeCodePayload(noFunction, "javascript", false, { expectedHeading: "Example" })?.body).toBe(noFunction);
    expect(normalizeCodePayload("function describeExample(name) { return name; }\n\nExample", "javascript", false)?.body)
      .toContain("Example");
  });
});
