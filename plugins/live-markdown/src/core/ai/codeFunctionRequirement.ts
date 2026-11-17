import { parser } from "@lezer/javascript";
import type { SyntaxNode } from "@lezer/common";
import type { ArtifactField } from "./artifactSpec";
import { hasCodeDirectVariableBinding } from "./codeArtifactIdentifiers";

interface FunctionNameMatch {
  readonly name: string;
  readonly from: number;
  readonly to: number;
  readonly async: boolean;
}

export interface CodeFunctionInstruction {
  readonly functionName?: ArtifactField<string>;
  readonly asyncRequired: boolean;
  readonly conflict: boolean;
}

const IDENTIFIER = "([A-Za-z_$][\\w$]*)";
const TERMINATOR = "(?:\\s*\\(|(?=$|[\\s,，。！？；;.!?]))";
const LANGUAGE_ADJECTIVE = "(?:(?:TypeScript|JavaScript|ECMAScript|Python|Java|Golang|Go|Rust|Markdown|JSON|YAML|Bash|Shell|HTML|CSS|SQL|TS|JS|MD|YML|SH)\\s+)?";
const LANGUAGE_NAMES = new Set(["typescript", "javascript", "ecmascript", "python", "java", "golang", "go", "rust", "markdown", "json", "yaml", "bash", "shell", "html", "css", "sql", "ts", "js", "md", "yml", "sh"]);
const NEGATED_DEFINITION_PREFIX = /(?:不要(?:再)?|勿|无需|不必|不得|禁止|避免|do\s+not|don't|never|avoid)[^,，。！？；;.!?\r\n]{0,24}$/iu;

function collectMatches(
  source: string,
  pattern: RegExp,
  nameGroup: number,
  asyncGroups?: readonly number[] | "always",
  rejectLanguageName = false
): FunctionNameMatch[] {
  pattern.lastIndex = 0;
  return [...source.matchAll(pattern)].flatMap(match => {
    const name = match[nameGroup];
    const matchIndex = match.index ?? 0;
    if (NEGATED_DEFINITION_PREFIX.test(source.slice(Math.max(0, matchIndex - 24), matchIndex))) return [];
    if (rejectLanguageName && LANGUAGE_NAMES.has(name?.toLowerCase() ?? "")) return [];
    const nameOffset = match[0].lastIndexOf(name);
    if (!name || nameOffset < 0) return [];
    const from = matchIndex + nameOffset;
    return [{ name, from, to: from + name.length,
      async: asyncGroups === "always" || Boolean(asyncGroups?.some(group => match[group])) }];
  });
}

function findFunctionNameMatches(masked: string): FunctionNameMatch[] {
  const matches: FunctionNameMatch[] = [];
  const chineseVerb = "(?:定义|实现|创建|编写|新增|添加|生成)";
  const asyncToken = "(异步|async)";

  matches.push(...collectMatches(masked,
    new RegExp(`${chineseVerb}\\s*(?:一个|一名)?\\s*${LANGUAGE_ADJECTIVE}${asyncToken}?\\s*(?:函数|方法)\\s*${IDENTIFIER}${TERMINATOR}`, "giu"), 2, [1]));
  matches.push(...collectMatches(masked,
    new RegExp(`${chineseVerb}\\s*${asyncToken}?\\s*${IDENTIFIER}\\s*${asyncToken}?\\s*(?:函数|方法)${TERMINATOR}`, "giu"), 2, [1, 3], true));
  matches.push(...collectMatches(masked,
    new RegExp(`${chineseVerb}\\s*(?:一个|一名)?\\s*${IDENTIFIER}\\s*\\(`, "giu"), 1));

  const englishVerb = "(?:define|implement|create|write)";
  matches.push(...collectMatches(masked,
    new RegExp(`\\b${englishVerb}\\s+(?:an?\\s+)?${LANGUAGE_ADJECTIVE}(async\\s+)(?:function\\s+)?${IDENTIFIER}${TERMINATOR}`, "giu"), 2, [1]));
  matches.push(...collectMatches(masked,
    new RegExp(`\\b${englishVerb}\\s+(?:an?\\s+)?${LANGUAGE_ADJECTIVE}(async\\s+)?function\\s+${IDENTIFIER}${TERMINATOR}`, "giu"), 2, [1]));
  matches.push(...collectMatches(masked,
    new RegExp(`\\b(async\\s+)?function\\s+${IDENTIFIER}\\s*\\(`, "giu"), 2, [1]));
  matches.push(...collectMatches(masked,
    new RegExp(`\\b${englishVerb}\\s+(?:an?\\s+)?${IDENTIFIER}\\s*\\(`, "giu"), 1));
  matches.push(...collectMatches(masked,
    new RegExp(`\\b${englishVerb}\\s+(?:an?\\s+)?${IDENTIFIER}\\s+(async\\s+)?function${TERMINATOR}`, "giu"), 1, [2], true));

  return matches;
}

/** Captures a function name only when function syntax or an explicit function word makes it unambiguous. */
export function parseCodeFunctionInstruction(source: string, masked: string): CodeFunctionInstruction {
  const matches = findFunctionNameMatches(masked);
  const names = [...new Set(matches.map(({ name }) => name))];
  if (names.length !== 1) return { asyncRequired: false, conflict: names.length > 1 };
  const name = names[0];
  const matching = matches.filter(match => match.name === name);
  const evidence = matching.map(({ from, to }) => ({ from, to, raw: source.slice(from, to) }));
  return {
    functionName: { value: name, evidence },
    asyncRequired: matching.some(({ async }) => async),
    conflict: false
  };
}

function children(node: SyntaxNode): SyntaxNode[] {
  const result: SyntaxNode[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) result.push(child);
  return result;
}

function nodeText(source: string, node: SyntaxNode): string {
  return source.slice(node.from, node.to);
}

function targetFunctionBinding(source: string, node: SyntaxNode, name: string): boolean | undefined {
  const parts = children(node);
  if (node.name === "FunctionDeclaration") {
    if (!parts.some(part => part.name === "VariableDefinition" && nodeText(source, part) === name) ||
        !parts.some(part => part.name === "Block")) return undefined;
  } else if (node.name === "ArrowFunction" || node.name === "FunctionExpression") {
    if (!hasCodeDirectVariableBinding(source, node, name) ||
        (node.name === "FunctionExpression" && !parts.some(part => part.name === "Block"))) return undefined;
  } else if (node.name === "MethodDeclaration" || node.name === "Property") {
    if (!parts.some(part => part.name === "PropertyDefinition" && nodeText(source, part) === name) ||
        !parts.some(part => part.name === "ParamList") || !parts.some(part => part.name === "Block")) return undefined;
  } else {
    return undefined;
  }
  return parts.some(part => nodeText(source, part) === "async") && !parts.some(part => part.name === "Star");
}

/** Checks the requested async property on a parsed declaration without rewriting generated code. */
export function definesAsyncFunction(body: string, language: string, name: string): boolean {
  const dialect = asyncFunctionDialect(language);
  if (dialect === undefined) return false;

  try {
    const tree = parser.configure({ dialect }).parse(body);
    const bindings: boolean[] = [];
    let malformed = false;
    tree.iterate({ enter(node) {
      if (node.type.isError) {
        malformed = true;
        return;
      }
      const binding = targetFunctionBinding(body, node.node, name);
      if (binding !== undefined) bindings.push(binding);
    } });
    return !malformed && bindings.length === 1 && bindings[0];
  } catch {
    return false;
  }
}

function asyncFunctionDialect(language: string): string | undefined {
  const label = language.trim().toLowerCase();
  return ["ts", "typescript", "mts", "cts"].includes(label) ? "ts"
    : ["tsx"].includes(label) ? "ts jsx"
      : ["js", "javascript", "node", "nodejs", "mjs", "cjs"].includes(label) ? ""
        : ["jsx"].includes(label) ? "jsx" : undefined;
}

export function supportsAsyncFunctionValidation(language: string): boolean {
  return asyncFunctionDialect(language) !== undefined;
}
