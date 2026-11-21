import { parser } from "@lezer/javascript";
import type { SyntaxNode } from "@lezer/common";
import { validateCodeBodySyntax } from "./codeBodySyntax";

interface Line { readonly from: number; readonly to: number; readonly text: string; }
interface EchoMatch { readonly lineIndex: number; readonly markdownHeading: boolean; }

export interface CodeHeadingEchoResult {
  readonly body?: string;
}

const JAVASCRIPT = new Set(["js", "javascript", "node", "nodejs", "mjs", "cjs"]);
const TYPESCRIPT = new Set(["ts", "typescript", "mts", "cts"]);
const MAX_CODE_BYTES = 131_072;
const MAX_TREE_NODES = 65_536;
const encoder = new TextEncoder();

function children(node: SyntaxNode): SyntaxNode[] {
  const result: SyntaxNode[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) result.push(child);
  return result;
}

function linesOf(source: string): Line[] {
  const lines: Line[] = [];
  let from = 0;
  while (from <= source.length) {
    const newline = source.indexOf("\n", from);
    const end = newline < 0 ? source.length : newline;
    const to = end > from && source[end - 1] === "\r" ? end - 1 : end;
    lines.push({ from, to, text: source.slice(from, to) });
    if (newline < 0) break;
    from = newline + 1;
  }
  return lines;
}

function unescapeMarkdown(value: string): string {
  return value.replace(/\\([\\`*_{}\[\]()<>#+\-.!|])/gu, "$1");
}

function headingText(line: string): { text: string; markdownHeading: boolean } {
  const value = line.trim();
  const markdown = /^[ \t]{0,3}#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*$/u.exec(value);
  return markdown
    ? { text: unescapeMarkdown(markdown[1].trim()), markdownHeading: true }
    : { text: value, markdownHeading: false };
}

function headingLines(source: string, heading: string): EchoMatch[] {
  const lines = linesOf(source);
  const expected = heading.trim();
  return lines.flatMap((line, lineIndex) => {
    const parsed = headingText(line.text);
    return line.text.trim() && parsed.text === expected ? [{ lineIndex, markdownHeading: parsed.markdownHeading }] : [];
  });
}

function boundaryRange(lines: readonly Line[], lineIndex: number): { from: number; to: number } | undefined {
  let first = 0, last = lines.length - 1;
  while (first <= last && !lines[first]!.text.trim()) first += 1;
  while (last >= first && !lines[last]!.text.trim()) last -= 1;
  if (lineIndex === first) {
    if (!lines[lineIndex + 1]?.text.trim()) {
      let to = lineIndex + 1;
      while (to < lines.length && !lines[to]!.text.trim()) to += 1;
      return { from: lineIndex, to };
    }
    return undefined;
  }
  if (lineIndex === last) {
    if (!lines[lineIndex - 1]?.text.trim()) {
      let from = lineIndex - 1;
      while (from >= 0 && !lines[from]!.text.trim()) from -= 1;
      return { from: from + 1, to: lineIndex + 1 };
    }
  }
  return undefined;
}

function removeBoundary(lines: readonly Line[], range: { from: number; to: number }): string {
  const retained = lines.filter((_, index) => index < range.from || index >= range.to);
  let first = 0, last = retained.length - 1;
  while (first <= last && !retained[first]!.text.trim()) first += 1;
  while (last >= first && !retained[last]!.text.trim()) last -= 1;
  return retained.slice(first, last + 1).map(line => line.text).join("\n");
}

function languageDialect(language: string): string | undefined {
  const label = language.trim().toLowerCase();
  if (JAVASCRIPT.has(label)) return "";
  if (TYPESCRIPT.has(label)) return "ts";
  return undefined;
}

function parsedTree(source: string, language: string): SyntaxNode | undefined {
  if (encoder.encode(source).byteLength > MAX_CODE_BYTES) return undefined;
  const dialect = languageDialect(language);
  if (dialect === undefined) return undefined;
  try {
    const tree = parser.configure({ dialect }).parse(source);
    const cursor = tree.cursor();
    let nodes = 0;
    do {
      nodes += 1;
      if (nodes > MAX_TREE_NODES || cursor.type.isError) return undefined;
    } while (cursor.next());
    return tree.topNode;
  } catch {
    return undefined;
  }
}

function hasRootFunction(node: SyntaxNode): boolean {
  const callable = (statement: SyntaxNode): boolean => {
    const parts = children(statement);
    if (statement.name === "FunctionDeclaration") return parts.some(part => part.name === "Block");
    if (statement.name === "VariableDeclaration") {
      return parts.some(part => part.name === "VariableDefinition") &&
        parts.some(part => part.name === "ArrowFunction" || part.name === "FunctionExpression");
    }
    if (statement.name === "ExportDeclaration") return parts.some(callable);
    return false;
  };
  return children(node).some(callable);
}

function localIdentifierBindingExists(node: SyntaxNode, source: string, names: ReadonlySet<string>): boolean {
  let found = false;
  const cursor = node.cursor();
  do {
    const current = cursor;
    if ((current.name === "VariableDefinition" || current.name === "TypeDefinition") &&
        names.has(source.slice(current.from, current.to))) found = true;
  } while (!found && cursor.next());
  return found;
}

function isBareRootIdentifierEcho(node: SyntaxNode, source: string, line: Line, expected: string): boolean {
  return children(node).some(statement => {
    if (statement.name !== "ExpressionStatement" || statement.from < line.from || statement.to > line.to) return false;
    const expression = children(statement).filter(child => child.name !== ";");
    return expression.length === 1 && expression[0]!.name === "VariableName" &&
      source.slice(expression[0]!.from, expression[0]!.to) === expected;
  });
}

function expressionIdentifiers(node: SyntaxNode, source: string, from: number, to: number): Set<string> {
  const names = new Set<string>();
  const cursor = node.cursor();
  do {
    const current = cursor;
    if (current.from >= from && current.to <= to && current.name === "VariableName") {
      names.add(source.slice(current.from, current.to));
    }
  } while (cursor.next());
  return names;
}

/** Removes one program-owned heading echo only when its exact outer boundary is proven. */
export function recoverCodeHeadingEcho(value: string, language: string, expectedHeading?: string): CodeHeadingEchoResult {
  if (!expectedHeading?.trim() || encoder.encode(value).byteLength > MAX_CODE_BYTES || languageDialect(language) === undefined) {
    return {};
  }
  const source = value.replace(/\r\n?/gu, "\n");
  const lines = linesOf(source);
  const matches = headingLines(source, expectedHeading);
  if (!matches.length) return {};
  const boundary = matches.length === 1 ? boundaryRange(lines, matches[0]!.lineIndex) : undefined;
  if (!boundary) return {};

  const line = lines[matches[0]!.lineIndex]!;
  const body = removeBoundary(lines, boundary);
  if (!body.trim() || validateCodeBodySyntax(body, language) !== "valid") return {};

  const bodyTree = parsedTree(body, language);
  if (!bodyTree || !hasRootFunction(bodyTree)) return {};

  const sourceTree = parsedTree(source, language);
  if (!matches[0]!.markdownHeading) {
    // Ambiguous valid code stays byte-for-byte intact for the existing code guard.
    if (!sourceTree) return {};
    const expected = headingText(line.text).text;
    const simpleIdentifier = /^[A-Za-z_$][\w$]*$/u.test(expected);
    if (!simpleIdentifier || !isBareRootIdentifierEcho(sourceTree, source, line, expected)) {
      return {};
    }
    const names = expressionIdentifiers(sourceTree, source, line.from, line.to);
    if (localIdentifierBindingExists(sourceTree, source, names)) return {};
  }

  return { body };
}
