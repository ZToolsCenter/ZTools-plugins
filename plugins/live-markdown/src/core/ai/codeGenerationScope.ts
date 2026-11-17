import { GFM, parser } from "@lezer/markdown";
import { ROLE_PRESETS } from "./agentOrchestrator";
import { artifactFieldIsGrounded, type ArtifactField, type ArtifactSpec } from "./artifactSpec";
import { resolveArtifactSpec } from "./artifactSpecFromInstruction";
import { prepareArtifactFill } from "./artifactFill";
import { parseCodeFunctionInstruction } from "./codeFunctionRequirement";
import { resolveGenerationRequirements } from "./generationRequirements";
import { maskQuotedInstruction, scanInstructionQuotes } from "./instructionLiteralEvidence";

const MAX_INSTRUCTION_UNITS = 8192;
const MAX_SYSTEM_UNITS = 16384;
const MAX_MARKDOWN_NODES = 4096;
const MAX_MARKDOWN_DEPTH = 64;
const markdownParser = parser.configure(GFM);
const GENERAL_SYSTEM_PROMPT = ROLE_PRESETS.find(role => role.id === "general")?.systemPrompt;

const LANGUAGE_ALIASES = new Map<string, "JavaScript" | "TypeScript" | "Python">([
  ["javascript", "JavaScript"], ["ecmascript", "JavaScript"], ["js", "JavaScript"],
  ["typescript", "TypeScript"], ["ts", "TypeScript"], ["python", "Python"], ["py", "Python"]
]);
const RESERVED: Record<"JavaScript" | "TypeScript" | "Python", ReadonlySet<string>> = {
  JavaScript: new Set("await break case catch class const continue debugger default delete do else export extends finally for function if import in instanceof new return super switch this throw typeof var void while with yield enum implements interface let package private protected public static null true false".split(" ")),
  TypeScript: new Set("abstract any as asserts bigint boolean break case catch class const continue debugger declare default delete do else enum export extends false finally for from function get if implements import in infer instanceof interface is keyof let module namespace never new null number object package private protected public readonly require global return set static string super switch symbol this throw true try type typeof undefined unique unknown var void while with yield".split(" ")),
  Python: new Set("False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield".split(" "))
};

export interface CodeGenerationScopeInput {
  readonly instruction: string;
  readonly spec: ArtifactSpec;
  readonly baseSystemPrompt: string;
  readonly systemPrompt: string;
  readonly source?: string;
  readonly includeSource?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactObject(left: unknown, right: unknown): boolean {
  try { return JSON.stringify(left) === JSON.stringify(right); }
  catch { return false; }
}

function grounded<T>(instruction: string, field: ArtifactField<T> | undefined): field is ArtifactField<T> {
  return Boolean(field && artifactFieldIsGrounded(instruction, field));
}

interface SourceRange { from: number; to: number }

/** Returns AST-owned Markdown code spans; uncertain trees disable this scope. */
function collectMarkdownCodeRanges(source: string): SourceRange[] | undefined {
  const ranges: SourceRange[] = [];
  const cursor = markdownParser.parse(source).cursor();
  let nodes = 0;
  let uncertain = false;
  const visit = (depth = 0) => {
    nodes += 1;
    if (nodes > MAX_MARKDOWN_NODES || depth > MAX_MARKDOWN_DEPTH) { uncertain = true; return; }
    if (cursor.name === "CodeBlock" || cursor.name === "InlineCode") {
      ranges.push({ from: cursor.from, to: cursor.to });
      return;
    }
    if (cursor.name === "FencedCode") {
      let marks = 0;
      if (cursor.firstChild()) {
        do { if ((cursor.name as string) === "CodeMark") marks += 1; } while (cursor.nextSibling());
        cursor.parent();
      }
      if (marks < 2) uncertain = true;
      else ranges.push({ from: cursor.from, to: cursor.to });
      return;
    }
    if (cursor.firstChild()) {
      do { visit(depth + 1); } while (cursor.nextSibling() && !uncertain);
      cursor.parent();
    }
  };
  visit();
  if (uncertain) return undefined;
  ranges.sort((left, right) => left.from - right.from);

  const inlineRanges = [...ranges];
  let rangeIndex = 0;
  let inlineStart = -1;
  let inlineSize = 0;
  let slashRun = 0;
  for (let index = 0; index < source.length;) {
    while (rangeIndex < ranges.length && index >= ranges[rangeIndex]!.to) rangeIndex += 1;
    if (rangeIndex < ranges.length && index >= ranges[rangeIndex]!.from) {
      index = ranges[rangeIndex]!.to;
      slashRun = 0;
      continue;
    }
    if (source[index] === "\\") { slashRun += 1; index += 1; continue; }
    if (source[index] !== "`") { slashRun = 0; index += 1; continue; }
    let end = index + 1;
    while (end < source.length && source[end] === "`") end += 1;
    const size = end - index;
    const escaped = slashRun % 2 === 1;
    slashRun = 0;
    if (!escaped) {
      if (inlineStart < 0) { inlineStart = index; inlineSize = size; }
      else if (inlineSize === size) {
        inlineRanges.push({ from: inlineStart, to: end });
        inlineStart = -1;
        inlineSize = 0;
      }
    }
    index = end;
  }
  return inlineStart < 0 ? inlineRanges : undefined;
}

function intersectsProtectedRange(field: ArtifactField<unknown>, ranges: readonly SourceRange[]): boolean {
  return field.evidence.some(({ from, to }) => ranges.some(range => from < range.to && to > range.from));
}

function isClearlyQuestion(maskedInstruction: string): boolean {
  const instruction = maskedInstruction.trim();
  return /[?？]\s*$/u.test(instruction) ||
    /^(?:请问\s*)?(?:如何|怎么(?:样)?|怎样|how\s+(?:do|can|should|to)\b|what\s+(?:is|does)\b)/iu.test(instruction);
}

function validHeadingField(instruction: string, heading: unknown): boolean {
  if (heading === undefined) return true;
  if (!isRecord(heading)) return false;
  const level = heading.level as ArtifactField<unknown> | undefined;
  const text = heading.text as ArtifactField<unknown> | undefined;
  if (level && !grounded(instruction, level) || text && !grounded(instruction, text)) return false;
  return Boolean(level && text);
}

function languageLabel(value: string): "JavaScript" | "TypeScript" | "Python" | undefined {
  return LANGUAGE_ALIASES.get(value.trim().toLowerCase());
}

function safeFunctionName(language: "JavaScript" | "TypeScript" | "Python", value: string): boolean {
  if (value.length > 64) return false;
  const identifier = language === "Python" ? /^[A-Za-z_]\w*$/u : /^[A-Za-z_$][A-Za-z0-9_$]*$/u;
  return identifier.test(value) && !RESERVED[language].has(value);
}

/** Adds only the R24-R2 source-evidenced code-body scope; null means keep the original system. */
export function buildCodeGenerationScope(input: CodeGenerationScopeInput): string | null {
  const { instruction, spec, baseSystemPrompt, systemPrompt } = input;
  if (typeof instruction !== "string" || !instruction.trim() || instruction.length > MAX_INSTRUCTION_UNITS ||
      baseSystemPrompt !== GENERAL_SYSTEM_PROMPT || systemPrompt !== baseSystemPrompt ||
      systemPrompt.length > MAX_SYSTEM_UNITS || !spec || spec.kind !== "code") return null;

  try {
    const requirements = resolveGenerationRequirements(instruction, "custom");
    if ((instruction.match(/[“‘「『《]/gu)?.length ?? 0) > 64) return null;
    const maskedInstruction = maskQuotedInstruction(instruction, scanInstructionQuotes(instruction));
    if (isClearlyQuestion(maskedInstruction) || requirements.artifact.state !== "explicit" || requirements.artifact.value !== "code" ||
        requirements.display.state === "explicit" && requirements.display.value === "source" || requirements.requiredHeadings.length > 1) return null;

    const resolved = resolveArtifactSpec(instruction, requirements, { effect: "edit", operation: "insert" });
    if (!exactObject(spec, resolved) || resolved.kind !== "code" || resolved.issues.length || resolved.literalBody !== undefined ||
        resolved.jsonBody !== undefined || !grounded(instruction, resolved.language) || typeof resolved.language.value !== "string") return null;

    const fill = prepareArtifactFill({ instruction, spec: resolved, requirements, source: input.source,
      includeSource: input.includeSource, systemPrompt });
    if (!fill) return null;

    const language = languageLabel(resolved.language.value);
    if (!language || !validHeadingField(instruction, resolved.heading) || !validHeadingField(instruction, resolved.prefixHeading)) return null;
    const ranges = collectMarkdownCodeRanges(instruction);
    if (!ranges || intersectsProtectedRange(resolved.language, ranges)) return null;

    const parsedFunction = parseCodeFunctionInstruction(instruction, maskedInstruction);
    if (parsedFunction.conflict) return null;
    if (resolved.functionName) {
      if (!grounded(instruction, resolved.functionName) || intersectsProtectedRange(resolved.functionName, ranges) ||
          parsedFunction.functionName?.value !== resolved.functionName.value || !safeFunctionName(language, resolved.functionName.value)) return null;
    } else if (parsedFunction.functionName) {
      return null;
    }

    const lines = [
      `代码正文范围：只生成原指令要求的 ${language} 代码正文，不输出 Markdown 标题或代码围栏；代码围栏和标题由程序渲染。`,
      "不要把未要求的示例、说明文字或事实加入代码正文。"
    ];
    if (resolved.functionName) {
      const name = JSON.stringify(resolved.functionName.value);
      lines.push(`原指令明确要求定义的函数名（原文证据值）：${name}。代码正文必须真实定义该函数；仅导入、调用、引用该名称不算定义。不要据此推断未写明的签名或行为。`);
    }
    return `${systemPrompt}\n\n${lines.join("\n")}`;
  } catch {
    return null;
  }
}
