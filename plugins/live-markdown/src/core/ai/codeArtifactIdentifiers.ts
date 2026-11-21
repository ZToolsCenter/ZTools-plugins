import { parser as javascriptParser } from "@lezer/javascript";
import type { SyntaxNode } from "@lezer/common";

interface Range { from: number; to: number; }

function skipDelimitedString(source: string, from: number, delimiter: string): number {
  let i = from + delimiter.length;
  while (i < source.length) {
    if (source[i] === "\\") { i = Math.min(source.length, i + 2); continue; }
    if (source.startsWith(delimiter, i)) return i + delimiter.length;
    i += 1;
  }
  return source.length;
}

function skipRustRawString(source: string, from: number): number | undefined {
  let quoteStart = from;
  if (source.startsWith("br", from)) quoteStart += 1;
  else if (source[from] !== "r") return undefined;
  if (from > 0 && /[\p{L}\p{N}_]/u.test(source[from - 1])) return undefined;

  let cursor = quoteStart + 1;
  while (source[cursor] === "#") cursor += 1;
  if (source[cursor] !== '"') return undefined;
  const terminator = `"${"#".repeat(cursor - quoteStart - 1)}`;
  const end = source.indexOf(terminator, cursor + 1);
  return end < 0 ? source.length : end + terminator.length;
}

const MAX_TEMPLATE_NESTING = 32;

function skipJavaScriptTemplate(source: string, from: number, depth = 0): number {
  if (depth >= MAX_TEMPLATE_NESTING) return source.length;
  let i = from + 1;
  while (i < source.length) {
    if (source[i] === "\\") { i = Math.min(source.length, i + 2); continue; }
    if (source[i] === "`") return i + 1;
    if (source.startsWith("${", i)) {
      i = skipJavaScriptTemplateExpression(source, i + 2, depth);
      continue;
    }
    i += 1;
  }
  return source.length;
}

function skipJavaScriptTemplateExpression(source: string, from: number, depth: number): number {
  let i = from;
  let braces = 1;
  while (i < source.length) {
    const char = source[i];
    if (char === "'" || char === '"') {
      i = skipDelimitedString(source, i, char);
    } else if (char === "`") {
      i = skipJavaScriptTemplate(source, i, depth + 1);
    } else if (source.startsWith("//", i)) {
      i += 2;
      while (i < source.length && !/[\r\n]/u.test(source[i])) i += 1;
    } else if (source.startsWith("/*", i)) {
      const end = source.indexOf("*/", i + 2);
      i = end < 0 ? source.length : end + 2;
    } else if (char === "{") {
      braces += 1;
      i += 1;
    } else if (char === "}") {
      braces -= 1;
      i += 1;
      if (braces === 0) return i;
    } else i += 1;
  }
  return source.length;
}

/** Lexical filtering only; this does not prove program syntax, scope or behavior. */
function maskCommentsAndStrings(source: string, language: string): string {
  const python = /^(?:python|py)$/iu.test(language);
  const java = /^java$/iu.test(language);
  const rust = /^(?:rust|rs)$/iu.test(language);
  const javascript = /^(?:javascript|js|typescript|ts|jsx|tsx)$/iu.test(language);
  const ranges: Range[] = [];
  let i = 0;
  while (i < source.length) {
    const from = i;
    if (rust) {
      const rawStringEnd = skipRustRawString(source, i);
      if (rawStringEnd !== undefined) {
        i = rawStringEnd;
        ranges.push({ from, to: i });
        continue;
      }
    }
    if (java && source.startsWith('"""', i)) {
      i = skipDelimitedString(source, i, '"""');
      ranges.push({ from, to: i });
    } else if (javascript && source[i] === "`") {
      i = skipJavaScriptTemplate(source, i);
      ranges.push({ from, to: i });
    } else if (python && source[i] === "#" || !python && source.startsWith("//", i)) {
      while (i < source.length && !/[\r\n]/u.test(source[i])) i += 1;
      ranges.push({ from, to: i });
    } else if (!python && source.startsWith("/*", i)) {
      i += 2;
      let depth = 1;
      while (i < source.length && depth > 0) {
        if (rust && source.startsWith("/*", i)) { depth += 1; i += 2; }
        else if (source.startsWith("*/", i)) { depth -= 1; i += 2; }
        else i += 1;
      }
      ranges.push({ from, to: i });
    } else if (source[i] === '"' || source[i] === "'" || source[i] === "`") {
      const quote = source[i];
      const delimiter = python && source.startsWith(quote.repeat(3), i) ? quote.repeat(3) : quote;
      i = skipDelimitedString(source, i, delimiter);
      ranges.push({ from, to: i });
    } else i += 1;
  }
  const pieces: string[] = [];
  let cursor = 0;
  for (const range of ranges) {
    pieces.push(source.slice(cursor, range.from), source.slice(range.from, range.to).replace(/[^\r\n]/gu, " "));
    cursor = range.to;
  }
  pieces.push(source.slice(cursor));
  return pieces.join("");
}

function syntaxChildren(node: SyntaxNode): SyntaxNode[] {
  const result: SyntaxNode[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) result.push(child);
  return result;
}

export function hasCodeDirectVariableBinding(source: string, node: SyntaxNode, name: string): boolean {
  const parent = node.parent;
  if (!parent || parent.name !== "VariableDeclaration") return false;
  const siblings = syntaxChildren(parent);
  const functionIndex = siblings.findIndex(sibling => sibling.name === node.name && sibling.from === node.from && sibling.to === node.to);
  if (functionIndex < 0) return false;

  let bindingIndex = -1;
  for (let index = 0; index < functionIndex; index += 1) {
    if (siblings[index].name === "VariableDefinition") bindingIndex = index;
  }
  return bindingIndex >= 0 && source.slice(siblings[bindingIndex].from, siblings[bindingIndex].to) === name &&
    siblings.slice(bindingIndex + 1, functionIndex).some(sibling => sibling.name === "Equals");
}

function hasParsedJavaScriptFunction(body: string, name: string, language: string): boolean {
  const label = language.trim().toLowerCase();
  const dialect = ["ts", "typescript", "mts", "cts"].includes(label) ? "ts"
    : label === "tsx" ? "ts jsx"
      : ["jsx"].includes(label) ? "jsx"
        : ["js", "javascript", "node", "nodejs", "mjs", "cjs"].includes(label) ? "" : undefined;
  if (dialect === undefined) return false;

  try {
    const tree = javascriptParser.configure({ dialect }).parse(body);
    let found = false;
    tree.iterate({ enter(node) {
      if (found) return;
      const parts = syntaxChildren(node.node);
      if (node.name === "FunctionDeclaration" &&
          parts.some(part => part.name === "VariableDefinition" && body.slice(part.from, part.to) === name) &&
          parts.some(part => part.name === "Block")) {
        found = true;
      } else if (["ArrowFunction", "FunctionExpression"].includes(node.name) &&
          hasCodeDirectVariableBinding(body, node.node, name)) {
        found = true;
      } else if (["MethodDeclaration", "Property"].includes(node.name) &&
          !parts.some(part => ["get", "set"].includes(part.name)) &&
          parts.some(part => part.name === "PropertyDefinition" && body.slice(part.from, part.to) === name) &&
          parts.some(part => part.name === "ParamList") && parts.some(part => part.name === "Block")) {
        found = true;
      }
    } });
    return found;
  } catch {
    return false;
  }
}

export function hasCodeFunctionDefinition(body: string, name: string, language: string): boolean {
  if (!/^[\p{L}_$][\p{L}\p{N}_$]*$/u.test(name)) return false;
  if (hasParsedJavaScriptFunction(body, name, language)) return true;
  const code = maskCommentsAndStrings(body, language);
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const patterns = [
    new RegExp(`^\\s*(?:(?:export|default|async|declare|public|private|protected|static|inline|virtual|unsafe)\\s+)*function\\s+${escaped}(?![\\p{L}\\p{N}_$])`, "mu"),
    new RegExp(`^\\s*(?:async\\s+)?def\\s+${escaped}\\s*\\(`, "mu"),
    new RegExp(`^\\s*(?:pub(?:\\([^)]*\\))?\\s+)?(?:async\\s+)?fn\\s+${escaped}(?![\\p{L}\\p{N}_$])`, "mu"),
    new RegExp(`^\\s*(?:export\\s+)?(?:const|let|var)\\s+${escaped}\\s*=\\s*(?:async\\s*)?(?:function\\b|(?:\\([^)]*\\)|[\\p{L}_$][\\p{L}\\p{N}_$]*)\\s*=>)`, "mu"),
    new RegExp(`^\\s*func\\s+(?:\\([^)]*\\)\\s*)?${escaped}\\s*\\(`, "mu"),
    new RegExp(`^\\s*(?:(?:public|private|protected|static|async|inline|virtual|override|final)\\s+)*(?:[\\p{L}_$][\\p{L}\\p{N}_$<>?.\\[\\],]*\\s+)?${escaped}\\s*\\([^;{}]*\\)\\s*(?:throws\\s+[^\\n{]+)?\\s*\\{`, "mu")
  ];
  return patterns.some(pattern => pattern.test(code));
}
