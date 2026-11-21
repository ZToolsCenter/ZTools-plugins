import { parser as javascriptParser } from "@lezer/javascript";
import type { SyntaxNode } from "@lezer/common";
import { hasCodeDirectVariableBinding } from "./codeArtifactIdentifiers";

const PRIMITIVE_TYPES = new Set(["string", "number", "boolean", "void", "undefined", "null", "bigint", "symbol", "never"]);
const MAX_TREE_NODES = 65_536;

interface Replacement {
  readonly from: number;
  readonly to: number;
  readonly text: string;
}

interface TargetFunction {
  readonly async: boolean;
  readonly generator: boolean;
  readonly replacement?: Replacement;
}

export interface AsyncTypeScriptNormalization {
  readonly body: string;
  readonly changed: boolean;
}

function children(node: SyntaxNode): SyntaxNode[] {
  const result: SyntaxNode[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) result.push(child);
  return result;
}

function typescriptDialect(language: string): string | undefined {
  const label = language.trim().toLowerCase();
  if (["ts", "typescript", "mts", "cts"].includes(label)) return "ts";
  if (label === "tsx") return "ts jsx";
  return undefined;
}

function targetFunction(source: string, node: SyntaxNode, targetName: string): TargetFunction | undefined {
  if (!["FunctionDeclaration", "FunctionExpression", "ArrowFunction", "MethodDeclaration", "Property"].includes(node.name)) return undefined;
  const parts = children(node);
  if (node.name === "FunctionDeclaration") {
    if (!parts.some(part => part.name === "VariableDefinition" && source.slice(part.from, part.to) === targetName) ||
        !parts.some(part => part.name === "Block")) return undefined;
  } else if (node.name === "ArrowFunction" || node.name === "FunctionExpression") {
    if (!hasCodeDirectVariableBinding(source, node, targetName) ||
        (node.name === "FunctionExpression" && !parts.some(part => part.name === "Block"))) return undefined;
  } else if (!parts.some(part => part.name === "PropertyDefinition" && source.slice(part.from, part.to) === targetName) ||
      !parts.some(part => part.name === "ParamList") || !parts.some(part => part.name === "Block")) {
    return undefined;
  }

  const isAsync = parts.some(part => part.name === "async" && source.slice(part.from, part.to) === "async");
  const isGenerator = parts.some(part => part.name === "Star");
  const annotation = parts.find(part => part.name === "TypeAnnotation");
  if (!annotation) return { async: isAsync, generator: isGenerator };
  const type = children(annotation).find(part => part.name === "TypeName");
  if (!type) return { async: isAsync, generator: isGenerator };
  const rawType = source.slice(type.from, type.to);
  if (!PRIMITIVE_TYPES.has(rawType)) return { async: isAsync, generator: isGenerator };
  return { async: isAsync, generator: isGenerator, replacement: { from: type.from, to: type.to, text: `Promise<${rawType}>` } };
}

/** Wrap only the uniquely bound target's explicit primitive async TypeScript return annotation. */
export function normalizeAsyncTypeScriptReturnAnnotations(
  body: string,
  language: string,
  targetName: string
): AsyncTypeScriptNormalization {
  const dialect = typescriptDialect(language);
  if (dialect === undefined || !body.trim() || !/^[\p{L}_$][\p{L}\p{N}_$]*$/u.test(targetName)) return { body, changed: false };

  try {
    const tree = javascriptParser.configure({ dialect }).parse(body);
    const targets: TargetFunction[] = [];
    let nodeCount = 0;
    let malformed = false;
    tree.iterate({ enter(node) {
      nodeCount += 1;
      if (nodeCount > MAX_TREE_NODES || node.type.isError) {
        malformed = true;
        return;
      }
      const target = targetFunction(body, node.node, targetName);
      if (target) targets.push(target);
    } });
    if (malformed || targets.length !== 1 || !targets[0].async || targets[0].generator || !targets[0].replacement) {
      return { body, changed: false };
    }

    const { from, to, text } = targets[0].replacement;
    const normalized = body.slice(0, from) + text + body.slice(to);
    return { body: normalized, changed: normalized !== body };
  } catch {
    return { body, changed: false };
  }
}
