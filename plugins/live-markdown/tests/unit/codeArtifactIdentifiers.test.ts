import { expect, it } from "vitest";
import { validateArtifactCandidate } from "../../src/core/ai/artifactValidation";

const spec = (language: string) => ({ kind: "code" as const, displaySource: false, sourceDependent: false, issues: [],
  language: { value: language, evidence: [] }, functionName: { value: "add", evidence: [] } });

it.each([
  ["python", '"""\ndef add(a,b):\n    return a+b\n"""'],
  ["python", "# def add(a,b):\nvalue=1"],
  ["javascript", "/*\nfunction add(a,b) { return a+b; }\n*/\nconst value=1;"],
  ["typescript", "const text = `\nfunction add(a,b) { return a+b; }\n`;"],
  ["java", 'class Example {\n  String text = """\n  "\n  public int add(int a, int b) { return a + b; }\n  "\n  """;\n}'],
  ["rust", 'fn main() {\n  let text = r#""\n  pub fn add(a: i32, b: i32) -> i32 { a+b }\n  "#;\n  let _ = text;\n}'],
  ["rust", 'fn main() {\n  let text = r##"prefix "#\n  pub fn add(a: i32, b: i32) -> i32 { a+b }\n  "##;\n  let _ = text;\n}'],
  ["javascript", "const s = `${`inner\nfunction add(a,b) {return a+b}\n`}`;"],
  ["javascript", "function addendum(a,b) {return a+b}"]
])("does not accept a function name hidden in strings/comments: %s", (language, body) => {
  expect(() => validateArtifactCandidate(spec(language), `\`\`\`${language}\n${body}\n\`\`\``)).toThrow(/函数/u);
});

it.each([
  ["python", '"""module description"""\nasync def add(a,b):\n    return a+b'],
  ["javascript", "// comment\nexport function add(a,b) { return a+b; }"],
  ["typescript", "const text='unrelated';\nexport const add = (a,b) => a+b;"],
  ["rust", "pub fn add(a:i32,b:i32)->i32 {a+b}"],
  ["java", 'class Example {\n  String text = """\n  literal text\n  """;\n  public int add(int a, int b) { return a + b; }\n}'],
  ["rust", 'fn main() {\n  let text = r#"\n  string contents\n  "#;\n  let _ = text;\n}\npub fn add(a: i32, b: i32) -> i32 { a+b }'],
  ["rust", 'fn main() {\n  let text = r##"literal "# contents\n  "##;\n  let _ = text;\n}\npub fn add(a: i32, b: i32) -> i32 { a+b }'],
  ["javascript", "const s = `${`inner\nfunction add(a,b) {return a+b}\n`}`;\nfunction add(a,b) {return a+b}"],
  ["go", "func add(a int,b int) int {return a+b}"]
])("accepts actual supported declaration forms: %s", (language, body) => {
  expect(() => validateArtifactCandidate(spec(language), `\`\`\`${language}\n${body}\n\`\`\``)).not.toThrow();
});

it.each([
  ["typescript", "loadLabel", "const loadLabel = async (label: string): Promise<string> => label;"],
  ["typescript", "loadLabel", "const loadLabel = async function (label: string): Promise<string> { return label; };"],
  ["typescript", "loadLabel", "const other = 1, loadLabel = async (label: string): Promise<string> => label;"],
  ["javascript", "loadLabel", "export const loadLabel = async (label) => label;"]
])("accepts an exact JavaScript binding for %s %s", (language, name, body) => {
  const namedSpec = { ...spec(language), functionName: { value: name, evidence: [] } };
  expect(() => validateArtifactCandidate(namedSpec, `\`\`\`${language}\n${body}\n\`\`\``)).not.toThrow();
});

it("does not resolve a different variable binding by a requested function name", () => {
  const namedSpec = { ...spec("typescript"), functionName: { value: "loadLabel", evidence: [] } };
  expect(() => validateArtifactCandidate(namedSpec, "```typescript\nconst other = async (label: string): Promise<string> => label;\n```"))
    .toThrow(/指定函数/u);
});

// Accessors are properties, not callable function declarations.
it.each([
  "class Example { get add(): number { return 1; } }",
  "class Example { set add(value: number) {} }",
  "const example = { get add() { return 1; } };",
  "const example = { set add(value: number) {} };"
])("does not treat a getter or setter as the requested callable: %s", body => {
  expect(() => validateArtifactCandidate(spec("typescript"), `\`\`\`typescript\n${body}\n\`\`\``)).toThrow(/函数/u);
});
