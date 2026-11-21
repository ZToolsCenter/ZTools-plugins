import { generatedCodeGenerationActionEvidence, generatedCodeTaskEvidence } from "./generatedCodeTask";
import { parseCodeFunctionInstruction } from "./codeFunctionRequirement";

export interface OperationRange {
  readonly from: number;
  readonly to: number;
}

interface ArtifactRange extends OperationRange {
  readonly raw: string;
}

const FUNCTION_REFERENCE = /\b(?:it|the function|this function|that function|inside (?:the|that|this) function|within (?:the|that|this) function)\b|它|该函数|此函数|这个函数|该方法|此方法|同一个函数|(?:^|[,，;；]\s*)(?:该|此|这个|同一个)?函数(?=只|将|会|把|从|中|返回|根据|使用|处理|去除|转|移除|删除)/giu;
const EXPLICIT_FUNCTION_NOUN_REFERENCE = /\b(?:the|that|this) function\b|该函数|此函数|同一个函数|(?:^|[,，;；]\s*)(?:该|此|这个|同一个)?函数(?=只|将|会|把|从|中|返回|根据|使用|处理|去除|转|移除|删除)/giu;
const SENTENCE_BREAK = /[.!?。！？\r\n;；]+/gu;
const CLAUSE_CONNECTOR = /(?:[,，]\s*)?(?:然后|接着|并且|同时|再|以及|并|\band\s+then\b|\bthen\b|\balso\b|\band\b)\s*|[;；]\s*/giu;
const DOCUMENT_TARGET = /(?:原文|文档|文章|标题|段落|表格|文件|章节|正文|全文|前一段|上一段|首段|末段|第\s*(?:\d+|[一二三四五六七八九十]+)\s*段|\bH[1-6]\b|(?:the\s+)?(?:original|existing)\s+(?:document|article|paragraph|heading|table|file|section|text)|\b(?:document|article|paragraph|heading|table|file|section)\b)/iu;
const EXPLICIT_EDITOR_TARGET = /(?:当前|现有|所选|这个|该)(?:笔记|便笺|页面|编辑器|选区)(?:的|中|内)?(?:文本|内容|正文|首行|第一行|末行|最后一行|第\s*[0-9一二三四五六七八九十]+\s*行)?|(?:笔记|便笺|页面|编辑器|选区)(?:中|内)的?(?:首行|第一行|末行|最后一行|第\s*[0-9一二三四五六七八九十]+\s*行)|\b(?:current|existing|this|the current|the existing|selected)\s+(?:note|page|editor|selection)\b|\b(?:in|from|within)\s+(?:the\s+)?(?:current\s+)?(?:note|page|editor|selection)\b|\b(?:current|existing|this|selected)\s+(?:note|page|editor|selection)(?:['’]s)?\s+(?:(?:first|last|second|third|fourth|fifth|\d+(?:st|nd|rd|th))\s+)?(?:line|text|content|paragraph)\b|\bselected\s+(?:text|content|range)\b/iu;
const PARAMETER_DECLARATION = /^([A-Za-z_$][\w$]*)\??(?:\s*:\s*[A-Za-z_$][\w$]*(?:\[\])?(?:\s*\|\s*[A-Za-z_$][\w$]*(?:\[\])?)*)?$/u;
const RESERVED_CALL_NAMES = new Set(["if", "for", "while", "switch", "catch", "return", "function", "class", "new", "typeof", "instanceof"]);
const CODE_FORMAT = /代码(?:围栏|块)|\b(?:python|javascript|typescript)\b|\bcode\s+(?:block|fence)\b/iu;
const CODE_FORMAT_RANGE = /代码(?:围栏|块)|\b(?:python|javascript|typescript)\b|\bcode\s+(?:block|fence)\b/giu;
const FUNCTION_CREATION_ACTION = /(?:新增|新建|追加|添加|增加|插入|加入|写入|生成|编写|提供|定义|实现|创建|\b(?:add|append|insert|write|create|generate|define|implement|provide)\b)/giu;
const NEGATED_CODE_CREATION = /(?:不要|别|勿|不应|do\s+not|don't|must\s+not|never)[^，,。！？；;\n]{0,20}(?:新增|新建|添加|增加|插入|写入|生成|定义|创建|实现|编写|提供|add|append|insert|write|create|generate|define|implement|provide)[^，,。！？；;\n]{0,32}(?:代码|代码块|代码围栏|函数|\bcode\b|\bfunction\b|\bfence\b)/iu;
const INSERTION_ACTION = /^(?:新增|新建|追加|添加|增加|插入|加入|写入|生成|编写|提供|定义|实现|创建|add|append|insert|write|create|generate|define|implement|provide)$/iu;
const COMPOSED_CODE_FENCE = /代码(?:围栏|块)|\bcode\s+(?:fence|block)\b/giu;
const COMPOSED_HEADING = /(?:[一二三四五六七八九十\d]+级标题|\bH[1-6]\s*(?:标题|heading)?\b|\bheading\b|标题)/giu;
const COMPOSITION_CONNECTIVE = /(?:其后|后面|随后|紧接着|之后|followed\s+by|after(?:wards)?|then)/iu;
const EXPLICIT_DOCUMENT_END = /文末|文档(?:的)?(?:末尾|末端|底部|结尾)|文章(?:的)?(?:末尾|末端|底部|结尾)|文件(?:的)?(?:末尾|末端|底部|结尾)|全文(?:的)?(?:末尾|末端|结尾)|正文(?:的)?(?:末尾|末端|结尾)|\b(?:at\s+the\s+end|at\s+the\s+bottom|end\s+of\s+(?:the\s+)?document)\b/iu;
const MAX_SCOPE_INSTRUCTION_CHARS = 8192;
const MAX_SCOPE_OPERATIONS = 32;
const MAX_SCOPE_SIGNATURES = 16;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function hasDocumentTarget(text: string): boolean {
  return DOCUMENT_TARGET.test(text) || EXPLICIT_EDITOR_TARGET.test(text);
}

/** Recovers explicit code creation when punctuation in a function signature splits the generic artifact scan. */
export function generatedFunctionCreationAction(source: string, masked: string): OperationRange | undefined {
  if (NEGATED_CODE_CREATION.test(masked)) return undefined;
  const parsed = parseCodeFunctionInstruction(source, masked);
  const functionName = parsed.functionName;
  if (parsed.conflict || !functionName) return undefined;
  const position = functionName.evidence[0]?.from;
  if (position === undefined) return undefined;
  const contextFrom = Math.max(0, position - 160);
  const contextTo = Math.min(masked.length, functionName.evidence[0].to + 160);
  if (!CODE_FORMAT.test(masked.slice(contextFrom, contextTo))) return undefined;

  const candidates: OperationRange[] = [];
  FUNCTION_CREATION_ACTION.lastIndex = 0;
  for (const match of masked.slice(contextFrom, position).matchAll(FUNCTION_CREATION_ACTION)) {
    const from = contextFrom + (match.index ?? 0);
    const prefix = masked.slice(Math.max(contextFrom, from - 48), from);
    if (/(?:不要|别|勿|不应|do\s+not|don't|must\s+not|never)[^，,。！？；;\n]{0,24}$/iu.test(prefix)) continue;
    candidates.push({ from, to: from + match[0].length });
  }
  return candidates.at(-1);
}

/**
 * Treats a requested heading followed by one code fence and one named function as
 * one positioned code insertion. Only the nested function-creation verb is excluded;
 * other document operations remain visible to both operation guards.
 */
export function generatedCodeCompositionRanges(
  source: string,
  masked: string,
  operations: readonly OperationRange[]
): ReadonlySet<string> {
  if (!operations.length || source.length > MAX_SCOPE_INSTRUCTION_CHARS || operations.length > MAX_SCOPE_OPERATIONS ||
      NEGATED_CODE_CREATION.test(masked) || !EXPLICIT_DOCUMENT_END.test(masked)) return new Set();
  const parsed = parseCodeFunctionInstruction(source, masked);
  if (parsed.conflict || !parsed.functionName || parsed.functionName.evidence.length !== 1) return new Set();

  COMPOSED_CODE_FENCE.lastIndex = 0;
  const fences = [...masked.matchAll(COMPOSED_CODE_FENCE)];
  if (fences.length !== 1) return new Set();
  const fence = fences[0];
  const fenceFrom = fence.index ?? -1;
  if (fenceFrom < 0 || parsed.functionName.evidence[0].from <= fenceFrom) return new Set();
  const artifacts = generatedCodeTaskEvidence(source, masked);
  if (signatureCandidates(masked, artifacts).length > MAX_SCOPE_SIGNATURES) return new Set();

  const nestedCreation = generatedFunctionCreationAction(source, masked);
  if (!nestedCreation || nestedCreation.from < fenceFrom || !operations.some(({ from, to }) => from === nestedCreation.from && to === nestedCreation.to)) return new Set();
  const primaryInsertions = operations.filter(({ from, to }) => {
    if (from === nestedCreation.from && to === nestedCreation.to) return false;
    return INSERTION_ACTION.test(source.slice(from, to));
  });
  if (primaryInsertions.length !== 1) return new Set();
  const primary = primaryInsertions[0];
  if (primary.from >= fenceFrom || !EXPLICIT_DOCUMENT_END.test(masked.slice(0, primary.from))) return new Set();

  COMPOSED_HEADING.lastIndex = 0;
  const headings = [...masked.slice(primary.to, fenceFrom).matchAll(COMPOSED_HEADING)];
  if (headings.length !== 1) return new Set();
  const headingEnd = primary.to + (headings[0].index ?? 0) + headings[0][0].length;
  if (!COMPOSITION_CONNECTIVE.test(masked.slice(headingEnd, fenceFrom))) return new Set();

  return new Set([`${nestedCreation.from}:${nestedCreation.to}`]);
}

function parseParameterNames(raw: string): string[] | undefined {
  if (!raw.trim()) return undefined;
  const parameters = raw.split(",").map((part) => PARAMETER_DECLARATION.exec(part.trim())?.[1]);
  return parameters.length && parameters.every((parameter): parameter is string => Boolean(parameter)) ? parameters : undefined;
}

function requestedFunctionParameters(masked: string, name: string, evidence: readonly OperationRange[]): { names: string[]; signatureEnd: number } | undefined {
  const signature = new RegExp(`(?<![\\p{L}\\p{N}_$])${escapeRegExp(name)}\\s*\\(([^()\\r\\n]{1,160})\\)`, "gu");
  for (const match of masked.matchAll(signature)) {
    const from = match.index ?? 0;
    if (!evidence.some((item) => item.from === from)) continue;
    const names = parseParameterNames(match[1] ?? "");
    return names ? { names, signatureEnd: from + match[0].length } : undefined;
  }
  return undefined;
}

function mentionsParameter(text: string, parameters: readonly string[]): boolean {
  return parameters.some((parameter) => new RegExp(`(?<![A-Za-z0-9_$])${escapeRegExp(parameter)}(?![A-Za-z0-9_$])`, "u").test(text));
}

function mentionsParameterCue(text: string, parameters: readonly string[]): boolean {
  return parameters.some((parameter) => {
    const escaped = escapeRegExp(parameter);
    return new RegExp(`(?<![A-Za-z0-9_$])${escaped}(?![A-Za-z0-9_$])\\s*(?:参数|parameter|argument|input|输入)`, "iu").test(text) ||
      new RegExp(`\\b(?:parameter|argument|input)\\s+(?:named\\s+)?${escaped}(?![A-Za-z0-9_$])`, "iu").test(text);
  });
}

function signatureCandidates(masked: string, artifacts: readonly ArtifactRange[]): Array<{ name: string; from: number; to: number; signatureEnd: number; parameters: string[] }> {
  const candidates: Array<{ name: string; from: number; to: number; signatureEnd: number; parameters: string[] }> = [];
  const signature = /(?<![\p{L}\p{N}_$])([A-Za-z_$][\w$]*)\s*\(([^()\r\n]{1,160})\)/gu;
  for (const match of masked.matchAll(signature)) {
    const from = match.index ?? 0;
    const name = match[1] ?? "";
    const parameters = parseParameterNames(match[2] ?? "");
    if (!parameters || RESERVED_CALL_NAMES.has(name.toLowerCase()) ||
        !artifacts.some((artifact) => artifact.from <= from && from - artifact.to <= 192)) continue;
    candidates.push({ name, from, to: from + name.length, signatureEnd: from + match[0].length, parameters });
  }
  return candidates;
}

function sentences(source: string): Array<{ from: number; to: number }> {
  const result: Array<{ from: number; to: number }> = [];
  let from = 0;
  SENTENCE_BREAK.lastIndex = 0;
  for (const match of source.matchAll(SENTENCE_BREAK)) {
    const to = match.index ?? from;
    if (to > from) result.push({ from, to });
    from = to + match[0].length;
  }
  if (from < source.length) result.push({ from, to: source.length });
  return result;
}

function clauseRanges(source: string, from: number, to: number): Array<{ from: number; to: number; connected: boolean }> {
  const clauses: Array<{ from: number; to: number; connected: boolean }> = [];
  let start = from;
  let connected = false;
  CLAUSE_CONNECTOR.lastIndex = from;
  for (const match of source.matchAll(CLAUSE_CONNECTOR)) {
    const connectorFrom = match.index ?? from;
    if (connectorFrom >= to) break;
    if (connectorFrom > start) clauses.push({ from: start, to: connectorFrom, connected });
    start = connectorFrom + match[0].length;
    connected = !/^[;；]/u.test(match[0]);
  }
  if (start < to) clauses.push({ from: start, to, connected });
  return clauses;
}

/**
 * Identifies only operations grounded in one explicitly requested function's declared parameters.
 * The returned ranges are excluded from document-operation counting; generation requirements
 * remain in the original instruction and all unproven operations remain visible to safety guards.
 */
export function generatedFunctionBehaviorRanges(
  source: string,
  masked: string,
  operations: readonly OperationRange[]
): ReadonlySet<string> {
  if (!operations.length || source.length > MAX_SCOPE_INSTRUCTION_CHARS || operations.length > MAX_SCOPE_OPERATIONS ||
      (!generatedCodeGenerationActionEvidence(source, masked).length && !generatedFunctionCreationAction(source, masked))) return new Set();
  const artifacts: ArtifactRange[] = generatedCodeTaskEvidence(source, masked);
  const parsed = parseCodeFunctionInstruction(source, masked);
  const functionField = parsed.functionName;
  if (!artifacts.length && functionField) {
    const namePosition = functionField.evidence[0]?.from;
    if (namePosition !== undefined) {
      const from = Math.max(0, namePosition - 160);
      const to = Math.min(masked.length, namePosition + 160);
      CODE_FORMAT_RANGE.lastIndex = 0;
      const artifact = [...masked.slice(from, to).matchAll(CODE_FORMAT_RANGE)]
        .map((match) => ({ from: from + (match.index ?? 0), to: from + (match.index ?? 0) + match[0].length, raw: match[0] }))
        .sort((left, right) => Math.abs(left.from - namePosition) - Math.abs(right.from - namePosition))[0];
      if (artifact) artifacts.push(artifact);
    }
  }
  if (!artifacts.length) return new Set();

  const signatureList = signatureCandidates(masked, artifacts);
  if (signatureList.length > MAX_SCOPE_SIGNATURES) return new Set();
  const sentenceRanges = sentences(masked);
  if (parsed.conflict || !functionField || signatureList.length > 1) {
    const candidates = signatureList;
    if (!candidates.length) return new Set();
    const accepted = new Set<string>();
    const codeMarkers = [...masked.matchAll(/\bcode\s+(?:block|fence)\b|代码(?:围栏|块)/giu)];
    for (const operation of operations) {
      const previous = candidates.filter((candidate) => candidate.signatureEnd <= operation.from).at(-1);
      const next = candidates.find((candidate) => candidate.from >= operation.to && candidate.from - operation.to <= 64);
      const operationText = source.slice(operation.from, operation.to);
      if (INSERTION_ACTION.test(operationText) && previous && next && codeMarkers.length === 1 &&
          !/\bcode\s+(?:block|fence)\b|代码(?:围栏|块)/iu.test(masked.slice(operation.to, next.from)) && !hasDocumentTarget(masked.slice(operation.to, next.from))) {
        accepted.add(`${operation.from}:${operation.to}`);
        continue;
      }
      if (!previous) continue;
      const sentence = sentenceRanges.find((range) => operation.from >= range.from && operation.to <= range.to);
      if (!sentence) continue;
      const regionFrom = Math.max(sentence.from, previous.signatureEnd);
      FUNCTION_REFERENCE.lastIndex = 0;
      const reference = [...masked.slice(regionFrom, sentence.to).matchAll(FUNCTION_REFERENCE)][0];
      const referenceEnd = reference ? regionFrom + (reference.index ?? 0) + reference[0].length : regionFrom;
      let previousBehaviorClause = false;
      for (const clause of clauseRanges(masked, referenceEnd, sentence.to)) {
        const body = masked.slice(clause.from, clause.to);
        if (operation.from < clause.from || operation.to > clause.to) {
          previousBehaviorClause = reference ? mentionsParameter(body, previous.parameters) : mentionsParameterCue(body, previous.parameters);
          continue;
        }
        if (hasDocumentTarget(body)) break;
        const grounded = (reference ? mentionsParameter(body, previous.parameters) : mentionsParameterCue(body, previous.parameters)) || clause.connected && previousBehaviorClause;
        if (grounded) accepted.add(`${operation.from}:${operation.to}`);
        break;
      }
    }
    return accepted;
  }

  let functionName = functionField?.value;
  let declarations: OperationRange[] = [];
  if (functionName && functionField) {
    declarations = [...new Map(functionField.evidence
      .filter((name) => artifacts.some((artifact) => {
        const before = artifact.from <= name.from && name.from - artifact.to <= 192;
        const functionMarkerAfter = name.to <= artifact.from && artifact.from - name.to <= 32 && /^(?:函数|function|method)$/iu.test(artifact.raw);
        const artifactAfterName = name.to <= artifact.from && artifact.from - name.to <= 192;
        return before || functionMarkerAfter || artifactAfterName;
      }))
      .map((name) => [`${name.from}:${name.to}`, name])).values()];
    if (declarations.length !== 1) return new Set();
  } else {
    const explicitFunctionReferenceAfter = (from: number) => {
      EXPLICIT_FUNCTION_NOUN_REFERENCE.lastIndex = 0;
      return [...masked.slice(from).matchAll(EXPLICIT_FUNCTION_NOUN_REFERENCE)].length > 0;
    };
    const candidates = signatureList.filter((candidate) => explicitFunctionReferenceAfter(candidate.to) || mentionsParameterCue(masked.slice(candidate.signatureEnd), candidate.parameters));
    if (candidates.length !== 1) return new Set();
    functionName = candidates[0].name;
    declarations = [{ from: candidates[0].from, to: candidates[0].to }];
  }
  if (!functionName) return new Set();
  const signature = requestedFunctionParameters(masked, functionName, declarations);
  const parameters = signature?.names ?? (!functionField ? signatureCandidates(masked, artifacts).find((item) => item.name === functionName)?.parameters : undefined);
  if (!parameters?.length) return new Set();
  const declarationEnd = signature?.signatureEnd ?? declarations[0].to;
  const accepted = new Set<string>();

  for (const sentence of sentenceRanges) {
    if (sentence.to <= declarationEnd) continue;
    const sentenceOperations = operations.filter((item) => item.from >= Math.max(sentence.from, declarationEnd) && item.to <= sentence.to);
    if (!sentenceOperations.length) continue;
    FUNCTION_REFERENCE.lastIndex = 0;
    const reference = [...masked.slice(Math.max(sentence.from, declarationEnd), sentence.to).matchAll(FUNCTION_REFERENCE)][0];
    const referenceEnd = reference
      ? Math.max(sentence.from, declarationEnd) + (reference.index ?? 0) + reference[0].length
      : Math.max(sentence.from, declarationEnd);
    const clauses = clauseRanges(masked, referenceEnd, sentence.to);
    let previousBehaviorClause = false;
    for (const clause of clauses) {
      const clauseOperations = sentenceOperations.filter((item) => item.from >= clause.from && item.to <= clause.to);
      if (!clauseOperations.length) {
        const body = masked.slice(clause.from, clause.to);
        previousBehaviorClause = reference
          ? mentionsParameter(body, parameters)
          : mentionsParameterCue(body, parameters);
        continue;
      }
      const body = masked.slice(clause.from, clause.to);
      if (hasDocumentTarget(body)) {
        previousBehaviorClause = false;
        continue;
      }
      const grounded = (reference
        ? mentionsParameter(body, parameters)
        : mentionsParameterCue(body, parameters)) || clause.connected && previousBehaviorClause;
      if (!grounded) {
        previousBehaviorClause = false;
        continue;
      }
      for (const operation of clauseOperations) accepted.add(`${operation.from}:${operation.to}`);
      previousBehaviorClause = true;
    }
  }
  return accepted;
}

