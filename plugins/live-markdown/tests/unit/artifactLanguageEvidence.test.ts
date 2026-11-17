import { describe, expect, it } from "vitest";
import { resolveArtifactSpec } from "../../src/core/ai/artifactSpecFromInstruction";
import { resolveGenerationRequirements } from "../../src/core/ai/generationRequirements";

describe("artifact language evidence", () => {
  it("does not treat Markdown heading format as the language of an adjacent TypeScript code fence", () => {
    const instruction = "在文末新增 Markdown 二级标题“API <v2> & C++”，其后放 TypeScript 代码围栏并定义 greetUser 函数。";
    const requirements = resolveGenerationRequirements(instruction, "custom");
    const spec = resolveArtifactSpec(instruction, requirements, { effect: "edit", operation: "insert" });

    expect(spec).toMatchObject({
      kind: "code", language: { value: "typescript" },
      prefixHeading: { level: { value: 2 }, text: { value: "API <v2> & C++" } }
    });
    expect(spec.issues).not.toContain("conflicting_code_languages");
  });

  it("keeps conflicting languages when Markdown explicitly labels a code block", () => {
    const instruction = "在文末新增 Markdown 代码块，语言为 Python。";
    const requirements = resolveGenerationRequirements(instruction, "custom");
    const spec = resolveArtifactSpec(instruction, requirements, { effect: "edit", operation: "insert" });

    expect(spec.kind).toBe("code");
    if (spec.kind !== "code") return;
    expect(spec.language).toBeUndefined();
    expect(spec.issues).toContain("conflicting_code_languages");
  });
});
