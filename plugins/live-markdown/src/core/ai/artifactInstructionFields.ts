import type { ArtifactField, ArtifactHeading, ArtifactSpec, HeadingLevel } from "./artifactSpec";
import type { InstructionSpan } from "./intentContract";
import type { GenerationRequirements } from "./generationRequirements";
import { shouldOmitArtifactGenerationSource } from "./artifactGenerationContext";
import {
  addIssue,
  contentSegmentEnd,
  field,
  headingTokens,
  markSpans,
  payloadStart,
  quotedValue,
  trimRange,
  type MatchSpan
} from "./artifactInstructionEvidence";
import { parseStructuredArtifactFields, type ParsedStructuredFields } from "./artifactStructuredFields";
import { extractRecognizedArtifactLanguages } from "./artifactLanguageEvidence";
import { parseExplicitJsonFieldPairs, parseExplicitJsonLiteral } from "./artifactJsonLiteralFields";
import { maskQuotedInstruction, scanInstructionQuotes } from "./instructionLiteralEvidence";
import { parseCodeFunctionInstruction } from "./codeFunctionRequirement";
import { compileLiteralMarkdownBody } from "./markdownLiteralBody";

export interface ParsedArtifactFields extends ParsedStructuredFields {
  language?: ArtifactField<string>;
  heading?: ArtifactHeading;
  prefixHeading?: ArtifactHeading;
  functionName?: ArtifactField<string>;
  literalBody?: ArtifactField<string>;
  jsonBody?: ArtifactField<unknown>;
  composition: "complete" | "partial";
  issues: string[];
}

const HEADING_INSTRUCTION_LEAD = /^(?:(?:请|please)\s*)?(?:(?:让|由)\s*(?:模型|你|我)\s*)?(?:生成|创作|创造|构思|撰写|编写|设计|拟定|产出|输出|写出|制作|创建|解释|说明|分析|讲解|描述|阐述|介绍|评估|generate|create|draft|compose|write|design|produce|explain|describe|analy[sz]e)(?=$|[\s，,。；;：:]|一个|一份|一段|一条|标题|内容|它|其|该|这)/iu;
const HEADING_CONDITIONAL_LEAD = /^(?:(?:请|please)\s*)?(?:根据|依据|结合|参考|按照|按(?:条件|要求|规范|规则)|依照|基于|遵循|如果|若|当|given\b|according\s+to\b|based\s+on\b|if\b|when\b)/iu;
const HEADING_INSTRUCTION_TRAIL = /[,，]\s*(?:(?:请|please)\s*)?(?:(?:根据|依据|结合|参考|按照|按(?:条件|要求|规范|规则)|依照|基于|遵循|given\b|according\s+to\b|based\s+on\b|if\b|when\b)[^。！？；;,，]{0,32}?)?(?:生成|创作|创造|构思|撰写|编写|设计|拟定|产出|输出|写出|制作|创建|解释|说明|分析|讲解|描述|阐述|介绍|评估|generate|create|draft|compose|write|design|produce|explain|describe|analy[sz]e)(?=$|[\s，,。；;：:]|一个|一份|一段|一条|标题|内容|它|其|该|这)/iu;
const HEADING_CONDITIONAL_TRAIL = /[,，]\s*(?:(?:请|please)\s*)?(?:根据|依据|结合|参考|按照|按(?:条件|要求|规范|规则)|依照|基于|遵循|如果|若|当|given\b|according\s+to\b|based\s+on\b|if\b|when\b)/iu;
const SECONDARY_ARTIFACT_CLAUSE = /(?:[,，]\s*|\s+|(?=和|以及|并且|并|同时|然后))(?:(?:和|以及|并且|并|同时|然后)|(?<![\p{L}\p{N}])(?:and|also|then)\b)\s*(?:(?:一(?:个|条|份|张|段)|a|an|one|the)\s*)?(?:markdown\s*)?(?:无序(?:项目)?列表|有序(?:项目)?列表|项目列表|unordered\s+list|ordered\s+list|bullet\s+list|checklist|清单|列表|表格|table|代码块|代码围栏|code\s*(?:block|fence)|公式|equation|formula|流程图|flowchart|diagram|mermaid|图表|chart|段落|paragraph|正文)(?=$|[\s，,。！？；;：:]|[“‘「『"'])/iu;

function extractLanguage(source: string, masked: string, issues: string[]): ArtifactField<string> | undefined {
  const matches = extractRecognizedArtifactLanguages(source, masked)
    .flatMap(({ value, evidence }) => evidence.map(({ from, to }) => ({ value, from, to })));
  const values = [...new Set(matches.map(({ value }) => value))];
  if (values.length > 1) {
    addIssue(issues, "conflicting_code_languages");
    return undefined;
  }
  if (!values.length) return undefined;
  return {
    value: values[0],
    evidence: matches.filter(({ value }) => value === values[0])
      .map(({ from, to }) => ({ from, to, raw: source.slice(from, to) }))
  };
}

function headingPayload(source: string, from: number, limit: number): MatchSpan | undefined {
  let start = payloadStart(source, from, limit);
  if (start === undefined) return undefined;
  while (start < limit && /\s/u.test(source[start])) start += 1;
  if (start >= limit) return undefined;
  const headingWord = /^(?:heading(?:\s+(?:with|for))?|标题)(?=\s|[:：]|[“‘「『"'])\s*(?:[:：])?\s*/iu.exec(source.slice(start, limit));
  if (headingWord) start += headingWord[0].length;
  const quoted = quotedValue(source, start, limit);
  if (quoted) return quoted;
  const unquotedTail = source.slice(start, limit);
  const secondaryClause = SECONDARY_ARTIFACT_CLAUSE.exec(unquotedTail);
  const headingTail = secondaryClause ? unquotedTail.slice(0, secondaryClause.index) : unquotedTail;
  if (HEADING_INSTRUCTION_TRAIL.test(headingTail) || HEADING_CONDITIONAL_TRAIL.test(headingTail)) return undefined;
  let end = start;
  const headingLimit = start + headingTail.length;
  while (end < headingLimit && !/[，,。！？；;\r\n]/u.test(source[end])) end += 1;
  [start, end] = trimRange(source, start, end);
  if (start >= end) return undefined;
  const raw = source.slice(start, end);
  if (HEADING_INSTRUCTION_LEAD.test(raw) || HEADING_CONDITIONAL_LEAD.test(raw) ||
      HEADING_INSTRUCTION_TRAIL.test(raw) || HEADING_CONDITIONAL_TRAIL.test(raw) ||
      /^(?:然后|并且|同时|再|and\b|then\b)/iu.test(raw) ||
      /(?:并(?:且)?|然后|同时|以及|\b(?:and|then|also)\b)\s*(?:解释|说明|生成|添加|创建|写|explain|add|create|write)/iu.test(raw)) return undefined;
  return { value: raw, from: start, to: end, raw };
}

function resolveHeading(source: string, masked: string, issues: string[]): ArtifactHeading | undefined {
  const tokens = headingTokens(masked);
  if (tokens.length > 1) {
    addIssue(issues, "ambiguous_heading_spec");
    return undefined;
  }
  const token = tokens[0];
  if (!token) return undefined;
  const level = field(source, token.from, token.to, token.level as HeadingLevel);
  const tailBoundary = masked.slice(token.to).search(/[。！？；;\n]/u);
  const sentenceLimit = tailBoundary < 0 ? source.length : token.to + tailBoundary;
  const limit = contentSegmentEnd(source, token.to, sentenceLimit);
  const value = headingPayload(source, token.to, limit);
  if (!value) return { level };
  return { level, text: field(source, value.from, value.to, value.value) };
}

function findJsonLiteral(source: string, masked: string): { value?: ArtifactField<unknown>; explicit: boolean; invalid: boolean; ambiguous?: boolean } {
  const marker = /(?:内容|字面量|body|literal)\s*(?:为|是|[:：=])\s*/giu;
  const matches = [...masked.matchAll(marker)];
  if (matches.length > 1) return { explicit: true, invalid: false, ambiguous: true };

  let start: number;
  if (matches.length === 1) {
    const match = matches[0];
    start = (match.index ?? 0) + match[0].length;
    while (start < source.length && /\s/u.test(source[start])) start += 1;
  } else {
    const arrayMarkers = [...masked.matchAll(/\bJSON\s*(?:数组|array)\s*/giu)];
    if (!arrayMarkers.length) return { explicit: false, invalid: false };
    const candidates = arrayMarkers.flatMap(match => {
      let candidateStart = (match.index ?? 0) + match[0].length;
      while (candidateStart < source.length && /\s/u.test(source[candidateStart])) candidateStart += 1;
      return source[candidateStart] === "[" ? [{ start: candidateStart }] : [];
    });
    if (!candidates.length) return { explicit: false, invalid: false };
    if (arrayMarkers.length !== 1 || candidates.length !== 1) {
      return { explicit: true, invalid: false, ambiguous: true };
    }
    start = candidates[0].start;
  }

  const end = jsonValueEnd(source, start);
  if (end === undefined) return { explicit: true, invalid: true };
  try {
    const parsed = parseExplicitJsonLiteral(source.slice(start, end));
    return { value: field(source, start, end, parsed), explicit: true, invalid: false };
  } catch {
    return { explicit: true, invalid: true };
  }
}

function jsonValueEnd(source: string, start: number): number | undefined {
  const first = source[start];
  if (first === "{" || first === "[") {
    const stack: string[] = [];
    let inString = false;
    let escaped = false;
    const limit = Math.min(source.length, start + 32_768);
    for (let index = start; index < limit; index += 1) {
      const character = source[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === "\"") inString = false;
        continue;
      }
      if (character === "\"") { inString = true; continue; }
      if (character === "{" || character === "[") stack.push(character);
      else if (character === "}" || character === "]") {
        const open = stack.pop();
        if ((open === "{" && character !== "}") || (open === "[" && character !== "]")) return undefined;
        if (!stack.length) return index + 1;
      }
    }
    return undefined;
  }
  if (first === "\"") {
    let escaped = false;
    const limit = Math.min(source.length, start + 32_768);
    for (let index = start + 1; index < limit; index += 1) {
      if (escaped) escaped = false;
      else if (source[index] === "\\") escaped = true;
      else if (source[index] === "\"") return index + 1;
    }
    return undefined;
  }
  const primitive = /(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/uy;
  primitive.lastIndex = start;
  const match = primitive.exec(source);
  return match ? start + match[0].length : undefined;
}

function compositionComplete(
  instruction: string,
  requirements: GenerationRequirements,
  kind: ArtifactSpec["kind"],
  parsed: Omit<ParsedArtifactFields, "composition" | "issues">,
  sourceDependent: boolean,
  issues: readonly string[]
): boolean {
  if (sourceDependent || issues.length || requirements.requiredHeadings.length) return false;
  const fieldSpans: InstructionSpan[] = [
    ...(parsed.language?.evidence ?? []), ...(parsed.functionName?.evidence ?? []), ...(parsed.jsonBody?.evidence ?? []),
    ...(parsed.literalBody?.evidence ?? []), ...(parsed.columns ?? []).flatMap(value => value.evidence),
    ...(parsed.rows ?? []).flatMap(row => row.flatMap(value => value.evidence)),
    ...(parsed.heading?.level?.evidence ?? []), ...(parsed.heading?.text?.evidence ?? []),
    ...(parsed.prefixHeading?.level?.evidence ?? []), ...(parsed.prefixHeading?.text?.evidence ?? []), ...(parsed.equation?.evidence ?? []),
    ...(parsed.items ?? []).flatMap(value => value.evidence), ...(parsed.count?.evidence ?? []),
    ...(parsed.graph?.nodes ?? []).flatMap(value => value.evidence),
    ...(parsed.graphDirection?.evidence ?? []),
    ...(requirements.artifact.state === "explicit" || requirements.artifact.state === "conflict" || requirements.artifact.state === "ambiguous" ? requirements.artifact.evidence : []),
    ...(requirements.display.state === "explicit" || requirements.display.state === "conflict" || requirements.display.state === "ambiguous" ? requirements.display.evidence : [])
  ];
  let residual = markSpans(instruction, fieldSpans);
  if (kind === "code" && Array.isArray(parsed.jsonBody?.value)) {
    // A root array supplies its own fixed element order. Consume only its
    // explicit output declaration and the narrow order-preservation clause;
    // later operations remain visible to the generic residual check.
    residual = residual
      .replace(/(?:只\s*)?(?:在\s*(?:文末|末尾|底部|结尾)\s*)?(?:输出|生成|返回)\s*(?:JSON\s*)?(?:数组|array)/giu, " ")
      .replace(/(?:保持|保留)(?:数组|原始|原有|原)?顺序(?:不变|一致)?|顺序(?:保持|保留)(?:不变|一致)?|\b(?:keep|preserve)(?:\s+the)?\s+order\b/giu, " ");
  }
  residual = residual
    .replace(/(?:表达|表示)\s*[^:：。！？\n]{0,32}[:：]/gu, " ")
    .replace(/在\s*(?:文末|末尾|底部|结尾|光标处)|(?:文末|末尾|底部|结尾|光标处)/giu, " ")
    .replace(/(?:新增|新建|添加|增加|插入|追加|创建|输出|制作|绘制|画出|请|一个|一份|一张|个|个?的|了|并且|并|以及|同时|然后|在|于|到|为|是|用|明确|写出|给出|内容|里面|内部|内含|其中|按顺序表示|列名|表头|行数据|数据行|清单|列表|状态|图标|有序|无序|项目|条目|代码块|代码围栏|代码|源代码|标题|级标题|格式|包裹|块|heading|level|fenced|markdown|javascript|typescript|python|json|mermaid|yaml|bash|shell|html|css|sql|rust|java|golang|code|block|format|formatted|heading|with|inside|containing|content|rows?|columns?|headers?|items?|entries|ordered|unordered|bullet|display|formula|equation|math|latex|katex|flowchart|diagram|object|fields?|属性|字段|对象|use|using|as|the|a|an|加|add|append|insert|create|generate|write|produce|define|implement|show|render|output|in|at|of|for|on|and|then|表示|流程|公式|显示)/giu, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  if (residual) return false;
  if (kind === "heading") return Boolean(parsed.heading?.level && parsed.heading.text);
  if (kind === "code") return Boolean(parsed.jsonBody || parsed.literalBody || (parsed.language?.value === "markdown" && parsed.heading?.level && parsed.heading.text));
  if (kind === "table") return Boolean(parsed.columns?.length && parsed.rows?.length);
  if (kind === "list") return Boolean(parsed.items?.length && (!parsed.count || parsed.count.value === parsed.items.length));
  if (kind === "math") return Boolean(parsed.equation);
  if (kind === "mermaid") return Boolean(parsed.graph?.nodes.length && parsed.graph.edges.length);
  return false;
}

export function isArtifactSourceDependent(instruction: string): boolean {
  return !shouldOmitArtifactGenerationSource({
    instruction, artifact: "code", operation: "insert", target: "document_end", dependency: "document"
  });
}

export function parseArtifactInstructionFields(
  instruction: string,
  requirements: GenerationRequirements,
  kind: ArtifactSpec["kind"],
  sourceDependent: boolean
): ParsedArtifactFields {
  const masked = maskQuotedInstruction(instruction, scanInstructionQuotes(instruction));
  const issues: string[] = [];
  let language: ArtifactField<string> | undefined;
  let heading: ArtifactHeading | undefined;
  let prefixHeading: ArtifactHeading | undefined;
  let functionName: ArtifactField<string> | undefined;
  let literalBody: ArtifactField<string> | undefined;
  let jsonBody: ArtifactField<unknown> | undefined;
  let structured: ParsedStructuredFields = {};

  if (kind === "code") {
    language = extractLanguage(instruction, masked, issues);
    const hasMarkdownFence = /代码(?:块|围栏)|\bcode\s*(?:block|fence)\b/iu.test(masked);
    if (language?.value === "markdown" && hasMarkdownFence) heading = resolveHeading(instruction, masked, issues);
    else prefixHeading = resolveHeading(instruction, masked, issues);
    const functionInstruction = parseCodeFunctionInstruction(instruction, masked);
    functionName = functionInstruction.functionName;
    if (functionInstruction.conflict) addIssue(issues, "conflicting_function_names");
    literalBody = compileLiteralMarkdownBody(instruction, masked, language, heading);
    if (language?.value === "json") {
      const json = findJsonLiteral(instruction, masked);
      jsonBody = json.value;
      if (json.explicit && json.invalid) addIssue(issues, "invalid_json_literal");
      if (json.ambiguous) addIssue(issues, "ambiguous_json_literal");
      if (!json.explicit && !json.ambiguous) jsonBody = parseExplicitJsonFieldPairs(instruction, masked);
    }
  } else if (kind === "heading") {
    heading = resolveHeading(instruction, masked, issues);
  } else {
    structured = parseStructuredArtifactFields(instruction, masked, kind, issues);
  }

  const partial = { language, heading, prefixHeading, functionName, literalBody, jsonBody, ...structured };
  const composition = compositionComplete(instruction, requirements, kind, partial, sourceDependent, issues) ? "complete" : "partial";
  return { ...partial, composition, issues };
}
