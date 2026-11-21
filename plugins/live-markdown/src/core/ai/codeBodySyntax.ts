import { parser } from "@lezer/javascript";

const MAX_CODE_BYTES = 131_072;
const MAX_TREE_NODES = 65_536;
const javascriptDialects = new Set(["js", "javascript", "node", "nodejs", "mjs", "cjs"]);
const typescriptDialects = new Set(["ts", "typescript", "mts", "cts"]);
const tsxDialects = new Set(["tsx"]);
const jsxDialects = new Set(["jsx"]);

export type CodeSyntaxResult = "valid" | "invalid" | "unsupported";

/** Parse bounded JS/TS source without executing it. Unsupported languages are reported explicitly. */
export function validateCodeBodySyntax(body: string, language: string): CodeSyntaxResult {
  if (!body.trim() || new TextEncoder().encode(body).byteLength > MAX_CODE_BYTES) return "invalid";
  const label = language.trim().toLowerCase();
  const dialect = javascriptDialects.has(label) ? "" : typescriptDialects.has(label) ? "ts"
    : tsxDialects.has(label) ? "ts jsx" : jsxDialects.has(label) ? "jsx" : undefined;
  if (dialect === undefined) return "unsupported";
  try {
    const tree = parser.configure({ dialect }).parse(body);
    const cursor = tree.cursor();
    let nodes = 0;
    do {
      nodes += 1;
      if (nodes > MAX_TREE_NODES || cursor.type.isError) return "invalid";
    } while (cursor.next());
    return "valid";
  } catch {
    return "invalid";
  }
}
