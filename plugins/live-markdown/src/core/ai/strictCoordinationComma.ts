import { ENGLISH_AGREEMENT_MAX_CODE_POINTS } from "./englishAgreementEngine";
import type { EnglishAgreementAnalysis } from "./englishAgreementTypes";
import type { EnglishAgreementService } from "./englishAgreementService";
import type { ReadableProseTaskInput } from "./readableProseTask";
import { ROLE_PRESETS } from "./agentOrchestrator";

const MAX_INSTRUCTION_CODE_UNITS = 2_048;
const MAX_TEXT_CODE_POINTS = ENGLISH_AGREEMENT_MAX_CODE_POINTS;
const CONDITIONAL_OR_QUESTION = /[?？]|\b(?:if|unless|whether|provided\s+that|only\s+if|only\s+when)\b|如果|若|除非|即使|只有.{0,12}才|凡是/iu;
const QUOTED_OR_MARKDOWN = /["'`“”‘’«»#*_[\]{}<>\\]|^\s*(?:[-+*]|\d+[.)])\s/um;
const CLAUSE_SEPARATOR = /[,，;；.。!！:：\n\r]+/u;
const ROLE_CLAUSE = /^(?:请)?(?:(?:严格|只)?校对(?:正文|文本|语法|拼写|错字|错别字|标点|中英文间距)?|润色(?:正文|文本|文章|文稿)|校对以下\s+Markdown\s+正文中的错别字、标点和中英文间距|(?:strictly\s+)?proofread(?:\s+(?:(?:the\s+)?(?:text|content|prose|grammar|spelling))?)?|polish\s+(?:(?:the\s+)?(?:text|content|prose))|you\s+are\s+(?:a\s+)?(?:strict\s+)?proofreader)$/iu;
const CORRECTION_CLAUSE = /^(?:(?:只|仅)?(?:修正|纠正)(?:(?:(?:明确|明显|确定)(?:的)?(?:错字|错别字|语法|拼写|标点|空格|间距)(?:错误|问题)?|(?:明确|明显|确定)?(?:的)?(?:错误|问题))|(?:错字|错别字|语法|拼写|标点|空格|间距)(?:[、和及\s]*(?:错字|错别字|语法|拼写|标点|空格|间距))*(?:错误|问题)?)|(?:correct|fix)\s+(?:only\s+)?(?:(?:clear|obvious)\s+)?(?:grammar|spelling|typos?|punctuation|spacing)(?:\s*,?\s*(?:and\s+)?(?:grammar|spelling|typos?|punctuation|spacing))*\s+errors?(?:\s+only)?|proofread\s+only\s+(?:(?:clear|obvious)\s+)?errors?)$/iu;
const KEEP_CORRECT_PATTERNS = [
  /^(?:(?:已经|已)?正确(?:的)?(?:内容|句子|文本|部分)?(?:必须|请)?(?:保持|保留)(?:原样|不变|原文)|正确(?:的)?(?:内容|句子|文本)(?:必须)?(?:不(?:改写|改动|改变)|保持原样|不得改变))$/u,
  /^keep\s+(?:(?:the\s+)?(?:already\s+)?correct\s+(?:content|text|sentences?)|correct\s+(?:content|text|sentences?))\s+(?:unchanged|as\s+is|verbatim)$/iu,
  /^leave\s+(?:(?:the\s+)?(?:already\s+)?correct\s+(?:content|text|sentences?))\s+(?:unchanged|as\s+is)$/iu,
  /^do\s+not\s+(?:rewrite|rephrase|substitute\s+synonyms\s+for)\s+(?:(?:the\s+)?(?:already\s+)?correct\s+(?:content|text|sentences?))$/iu,
  /^(?:禁止|不得|不要)(?:(?:润色|改写|扩写|扩充|替换|同义词替换)(?:(?:、|或|和)(?:润色|改写|扩写|扩充|替换|同义词替换))*)(?:正确的?(?:内容|句子|文本))?$/u,
  /^(?:不(?:作|要|得)(?:进行)?(?:同义词替换|改写)(?:正确内容)?|no\s+synonym\s+substitution\s+for\s+correct\s+(?:content|text|sentences?))$/iu,
  /^do\s+not\s+(?:polish|expand)\s+(?:(?:the\s+)?correct\s+(?:content|text|sentences?))$/iu
];
const PRESERVABLE_ITEM = "(?:原意|意义|事实|数字|单位|日期|姓名|链接\\s*目标|代码|Markdown\\s*(?:格式|结构)|原格式|格式|结构)";
const PRESERVE_CHINESE_LIST = new RegExp(`^(?:仅|只)?(?:保留|保持)(?<items>${PRESERVABLE_ITEM}(?:\\s*(?:、|和|与|及)\\s*${PRESERVABLE_ITEM})*)(?:原样|不变)?$`, "iu");
const CHINESE_PRESERVABLE_ITEM = new RegExp(PRESERVABLE_ITEM, "giu");
const PRESERVE_ENGLISH_FACT_AND_FORMAT = /^(?:preserve|retain|keep)\s+(?:(?:the\s+)?(?:original\s+)?(?:facts?|meaning|numbers?|units?|dates?|names?))\s*(?:,|and|&)\s*(?:the\s+)?(?:original\s+)?(?:format|formatting|structure|markdown\s+(?:format|structure))$/iu;
const PRESERVE_ENGLISH_FACT = /^(?:preserve|retain|keep)\s+(?:(?:the\s+)?(?:original\s+)?(?:facts?|meaning|numbers?|units?|dates?|names?))$/iu;
const PRESERVE_ENGLISH_FORMAT = /^(?:preserve|retain|keep)\s+(?:the\s+)?(?:original\s+)?(?:format|formatting|structure|markdown(?:\s+(?:format|structure))?)$/iu;

export interface StrictCoordinationCommaInput {
  task: ReadableProseTaskInput;
  source: string;
  candidate: string;
  analyzer: Pick<EnglishAgreementService, "analyze">;
  signal?: AbortSignal;
  timeoutMs?: number;
}

interface PreservationProfile {
  role: boolean;
  correctContent: boolean;
  facts: boolean;
  format: boolean;
  clauseCount: number;
}

function isValidTaskText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_INSTRUCTION_CODE_UNITS
    && !QUOTED_OR_MARKDOWN.test(value) && !CONDITIONAL_OR_QUESTION.test(value);
}

function classifyClause(clause: string): Pick<PreservationProfile, "role" | "correctContent" | "facts" | "format"> | null {
  const value = clause.trim().replace(/\s+/gu, " ");
  if (!value) return null;
  if (ROLE_CLAUSE.test(value)) return { role: true, correctContent: false, facts: false, format: false };
  if (CORRECTION_CLAUSE.test(value)) return { role: false, correctContent: false, facts: false, format: false };
  if (KEEP_CORRECT_PATTERNS.some(pattern => pattern.test(value))) return { role: false, correctContent: true, facts: false, format: false };
  const preserveItems = PRESERVE_CHINESE_LIST.exec(value)?.groups?.items;
  if (preserveItems) {
    const items = preserveItems.match(CHINESE_PRESERVABLE_ITEM) ?? [];
    return { role: false, correctContent: false,
      facts: items.some(item => /^(?:原意|意义|事实|数字|单位|日期|姓名)$/iu.test(item)),
      format: items.some(item => /(?:格式|结构)$/iu.test(item)) };
  }
  if (PRESERVE_ENGLISH_FACT_AND_FORMAT.test(value)) return { role: false, correctContent: false, facts: true, format: true };
  if (PRESERVE_ENGLISH_FACT.test(value)) return { role: false, correctContent: false, facts: true, format: false };
  if (PRESERVE_ENGLISH_FORMAT.test(value)) return { role: false, correctContent: false, facts: false, format: true };
  return null;
}

function preservationProfile(value: string): PreservationProfile | null {
  if (!isValidTaskText(value)) return null;
  const clauses = value.split(CLAUSE_SEPARATOR).map(clause => clause.trim()).filter(Boolean);
  if (!clauses.length) return null;
  const profile: PreservationProfile = { role: false, correctContent: false, facts: false, format: false, clauseCount: clauses.length };
  for (const clause of clauses) {
    const classified = classifyClause(clause);
    if (!classified) return null;
    profile.role ||= classified.role;
    profile.correctContent ||= classified.correctContent;
    profile.facts ||= classified.facts;
    profile.format ||= classified.format;
  }
  return profile;
}

/** Authorizes only fully understood strict proofreading/preservation instructions. */
export function isStrictCoordinationCommaEligible(input: ReadableProseTaskInput): boolean {
  if (!input || typeof input.instruction !== "string" || typeof input.systemPrompt !== "string" || input.skill) return false;
  const instruction = preservationProfile(input.instruction);
  if (!instruction) return false;
  const systemText = input.systemPrompt.trim();
  const system = systemText ? preservationProfile(input.systemPrompt) : null;
  const knownRole = ROLE_PRESETS.some(role => role.systemPrompt === input.systemPrompt);
  if (systemText && !system && !knownRole) return false;
  const profiles = [instruction, ...(system ? [system] : [])];
  // The restoration path already proves the sole difference is one comma;
  // explicit preservation of correct content is the required task constraint.
  return profiles.some(item => item.role) && profiles.some(item => item.correctContent);
}

function singleCommaDeletion(source: string, candidate: string): number | null {
  if (source.length !== candidate.length + 1) return null;
  const comma = source.indexOf(",");
  if (comma < 0 || comma !== source.lastIndexOf(",") || comma === 0 || /\s/u.test(source[comma - 1])) return null;
  return source.slice(0, comma) + source.slice(comma + 1) === candidate ? comma : null;
}

function splitSimpleCoordination(source: string, comma: number): [string, string] | null {
  const afterComma = source.slice(comma + 1);
  const match = /^ +(?:(and|but)) +/iu.exec(afterComma);
  if (!match) return null;
  const left = source.slice(0, comma);
  const right = afterComma.slice(match[0].length);
  if (!left.trim() || !right.trim() || left !== left.trim() || right !== right.trim()) return null;
  if (/\b(?:and|but|or|so|yet)\b/iu.test(left) || /\b(?:and|but|or|so|yet)\b/iu.test(right)) return null;
  if (/[^A-Za-z0-9\s.,%\-]/u.test(`${left}${right}`) || /[,;:!?]/u.test(`${left}${right}`)) return null;
  return [left, right];
}

function isUnchangedSupportedClause(analysis: EnglishAgreementAnalysis, text: string): boolean {
  return Boolean(analysis && typeof analysis === "object"
    && analysis.scope === "simple-present-subject-verb-agreement"
    && analysis.disposition === "no-supported-edit"
    && typeof analysis.outputText === "string" && analysis.outputText === text
    && Array.isArray(analysis.edits) && analysis.edits.length === 0);
}

/**
 * Restores a deleted comma only when the entire source/candidate difference is that comma,
 * the instruction grants strict preservation, and both resulting simple clauses are
 * independently unchanged by the existing bounded SVA analyzer. Any uncertainty returns
 * the model candidate verbatim; this is not a sentence-correctness proof.
 */
export async function restoreStrictCoordinationComma(input: StrictCoordinationCommaInput): Promise<string> {
  const { source, candidate, task, analyzer, signal } = input;
  if (typeof source !== "string" || typeof candidate !== "string" || !analyzer?.analyze
    || signal?.aborted || !isStrictCoordinationCommaEligible(task)) return candidate;
  if ([...source].length > MAX_TEXT_CODE_POINTS || [...candidate].length > MAX_TEXT_CODE_POINTS) return candidate;
  if (/[\r\n\t]/u.test(source) || /[\r\n\t]/u.test(candidate)) return candidate;
  const comma = singleCommaDeletion(source, candidate);
  if (comma === null) return candidate;
  const clauses = splitSimpleCoordination(source, comma);
  if (!clauses) return candidate;
  if (input.timeoutMs !== undefined && (!Number.isFinite(input.timeoutMs) || input.timeoutMs <= 0)) return candidate;

  try {
    const options = { ...(signal ? { signal } : {}), ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }) };
    for (const text of clauses) {
      if (signal?.aborted) return candidate;
      const analysis = await analyzer.analyze({ text }, options);
      if (!isUnchangedSupportedClause(analysis, text)) return candidate;
    }
    return signal?.aborted ? candidate : source;
  } catch {
    return candidate;
  }
}
