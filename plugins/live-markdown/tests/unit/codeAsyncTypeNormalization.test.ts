import { describe, expect, it } from "vitest";
import { prepareArtifactFill } from "../../src/core/ai/artifactFill";
import { resolveArtifactSpec } from "../../src/core/ai/artifactSpecFromInstruction";
import { resolveGenerationRequirements } from "../../src/core/ai/generationRequirements";
import { normalizeAsyncTypeScriptReturnAnnotations } from "../../src/core/ai/codeAsyncTypeNormalization";
import { definesAsyncFunction } from "../../src/core/ai/codeFunctionRequirement";

const instruction = "在文末添加 TypeScript 代码块，定义异步函数 loadLabel，接收字符串参数并返回该字符串，不要添加标题。";
const rawInvalidAnnotation = "async function loadLabel(str: string): string { return str; }";

function preparedFill() {
  const requirements = resolveGenerationRequirements(instruction, "custom");
  const spec = resolveArtifactSpec(instruction, requirements, { effect: "edit", operation: "insert" });
  return prepareArtifactFill({ instruction, spec, requirements });
}

function payload(body: string): string {
  return JSON.stringify({ payload: body });
}

describe("async TypeScript return annotation repair", () => {
  it("normalizes the captured candidate at the artifact fill boundary", () => {
    const fill = preparedFill();
    expect(fill).not.toBeNull();

    const result = fill!.decode(payload(rawInvalidAnnotation));

    expect(result.text).toBe("```typescript\nasync function loadLabel(str: string): Promise<string> { return str; }\n```");
    expect(result.warnings.join(" ")).toContain("Promise<T>");
    expect(result.warnings.join(" ")).toContain("Diff 中确认");
  });

  it.each([
    ["async function declaration", "async function getLabel(): string { return \"x\"; }", "getLabel", "async function getLabel(): Promise<string> { return \"x\"; }"],
    ["async arrow", "const getCount = async (): number => 1;", "getCount", "const getCount = async (): Promise<number> => 1;"],
    ["async function expression", "const getFlag = async function (): boolean { return true; };", "getFlag", "const getFlag = async function (): Promise<boolean> { return true; };"]
  ])("wraps a known primitive annotation on a %s", (_label, source, targetName, expected) => {
    expect(normalizeAsyncTypeScriptReturnAnnotations(source, "typescript", targetName)).toEqual({ body: expected, changed: true });
  });

  it.each([
    ["synchronous function", "function getLabel(): string { return \"x\"; }", "getLabel"],
    ["async generator", "async function* getLabel(): string { yield \"x\"; }", "getLabel"],
    ["unrequested async method", "class Example { async getLabel(): string { return \"x\"; } }", "anotherMethod"],
    ["generic alias", "async function getLabel(): Label { throw new Error(); }", "getLabel"],
    ["generic type variable", "async function getValue<T>(): T { throw new Error(); }", "getValue"],
    ["nested Promise type", "async function getLabel(): Promise<string> { return \"x\"; }", "getLabel"],
    ["union type", "async function getMaybeLabel(): string | undefined { return undefined; }", "getMaybeLabel"],
    ["array type", "async function getLabels(): string[] { return []; }", "getLabels"]
  ])("leaves %s unchanged", (_label, source, targetName) => {
    expect(normalizeAsyncTypeScriptReturnAnnotations(source, "typescript", targetName)).toEqual({ body: source, changed: false });
  });

  it("rewrites only the parsed annotation, preserving comments, strings and object fields", () => {
    const source = [
      "const example = { returnType: \"string\" };",
      "const note = \"async function fake(): string {}\";",
      "// async function commented(): number {}",
      "async function getLabel(): string { return \"x\"; }"
    ].join("\n");
    const expected = source.replace("async function getLabel(): string", "async function getLabel(): Promise<string>");
    expect(normalizeAsyncTypeScriptReturnAnnotations(source, "typescript", "getLabel")).toEqual({ body: expected, changed: true });
  });

  it("normalizes and validates only the explicitly bound target in a multi-variable declaration", () => {
    const source = "const loadLabel = () => \"x\", other = async (): string => \"y\";";
    expect(normalizeAsyncTypeScriptReturnAnnotations(source, "typescript", "loadLabel")).toEqual({ body: source, changed: false });
    expect(definesAsyncFunction(source, "typescript", "loadLabel")).toBe(false);

    const fill = preparedFill();
    expect(fill).not.toBeNull();
    expect(() => fill!.decode(payload(source))).toThrow();
  });

  it("changes only the target when adjacent variable bindings are both async", () => {
    const source = "const loadLabel = async (): string => \"x\", other = async (): number => 1;";
    const expected = "const loadLabel = async (): Promise<string> => \"x\", other = async (): number => 1;";
    expect(normalizeAsyncTypeScriptReturnAnnotations(source, "typescript", "loadLabel")).toEqual({ body: expected, changed: true });
    expect(definesAsyncFunction(source, "typescript", "loadLabel")).toBe(true);
  });

  it.each([
    ["class method", "class Service { async loadLabel(): string { return \"x\"; } }"],
    ["object method", "const service = { async loadLabel(): string { return \"x\"; } };" ]
  ])("normalizes a specifically requested async %s", (_label, source) => {
    const expected = source.replace("async loadLabel(): string", "async loadLabel(): Promise<string>");
    expect(normalizeAsyncTypeScriptReturnAnnotations(source, "typescript", "loadLabel")).toEqual({ body: expected, changed: true });
    expect(definesAsyncFunction(source, "typescript", "loadLabel")).toBe(true);

    const fill = preparedFill();
    expect(fill).not.toBeNull();
    expect(fill!.decode(payload(source)).text).toContain("Promise<string>");
  });

  it("does not normalize or classify an async generator as a Promise function", () => {
    const source = "async function* loadLabel(): string { yield \"x\"; }";
    expect(normalizeAsyncTypeScriptReturnAnnotations(source, "typescript", "loadLabel")).toEqual({ body: source, changed: false });
    expect(definesAsyncFunction(source, "typescript", "loadLabel")).toBe(false);
  });

  it("leaves an ambiguous nested same-name helper untouched", () => {
    const source = "async function loadLabel(): string { async function loadLabel(): number { return 1; } return \"x\"; }";
    expect(normalizeAsyncTypeScriptReturnAnnotations(source, "typescript", "loadLabel")).toEqual({ body: source, changed: false });
    expect(definesAsyncFunction(source, "typescript", "loadLabel")).toBe(false);
  });

  it.each([
    "async function loadLabel(): unknown { return \"x\"; }",
    "async function loadLabel(value: unknown): value is string { return true; }",
    "declare function loadLabel(): string;",
    "function loadLabel(value: string): Promise<string>; async function loadLabel(value: string): Promise<string> { return value; }"
  ])("does not guess unknown, predicate, ambient or overload types: %s", source => {
    expect(normalizeAsyncTypeScriptReturnAnnotations(source, "typescript", "loadLabel")).toEqual({ body: source, changed: false });
  });

  it("does nothing for non TypeScript labels or malformed source", () => {
    const source = "async function getLabel(): string { return \"x\"; }";
    expect(normalizeAsyncTypeScriptReturnAnnotations(source, "javascript", "getLabel")).toEqual({ body: source, changed: false });
    const malformed = "async function getLabel(): string {";
    expect(normalizeAsyncTypeScriptReturnAnnotations(malformed, "typescript", "getLabel")).toEqual({ body: malformed, changed: false });
  });
});
