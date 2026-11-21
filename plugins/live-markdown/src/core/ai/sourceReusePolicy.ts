import { isNegatedMention } from "./instructionConstraints";
import { maskQuotedInstruction, scanInstructionQuotes } from "./instructionLiteralEvidence";

const STRUCTURED_SOURCE = "(?:(?:原有|已有|现有|原|这段|这份|这张|该|此)\\s*)?(?:代码(?:块|片段)?|配置(?:项|内容)?|表格|公式|流程图|关系图|示意图|mermaid(?:图|代码)?)";
const ENGLISH_STRUCTURED_SOURCE = "(?:(?:the|this|that)\\s+)?(?:(?:existing|original|current)\\s+)?(?:source\\s+)?(?:code(?:\\s+(?:block|snippet))?|configuration(?:\\s+(?:item|block))?|table|formula|diagram|flowchart|mermaid(?:\\s+diagram)?)";
const REUSE_ACTION = "(?:复用|重用|沿用|引用|reuse|re-use|quote|cite|carry\\s+over)";
const PRESERVE_ACTION = "(?:保留|retain|preserve|keep)";
const SOURCE_REUSE_PATTERNS = [
  new RegExp(`${REUSE_ACTION}\\s*${STRUCTURED_SOURCE}`, "giu"),
  new RegExp(`${STRUCTURED_SOURCE}\\s*${REUSE_ACTION}`, "giu"),
  new RegExp(`${REUSE_ACTION}\\s*${ENGLISH_STRUCTURED_SOURCE}`, "giu"),
  new RegExp(`${ENGLISH_STRUCTURED_SOURCE}\\s*${REUSE_ACTION}`, "giu")
];
const PRESERVATION_PATTERNS = [
  new RegExp(`${PRESERVE_ACTION}\\s*${STRUCTURED_SOURCE}`, "giu"),
  new RegExp(`${STRUCTURED_SOURCE}\\s*${PRESERVE_ACTION}`, "giu"),
  new RegExp(`${PRESERVE_ACTION}\\s*${ENGLISH_STRUCTURED_SOURCE}`, "giu"),
  new RegExp(`${ENGLISH_STRUCTURED_SOURCE}\\s*${PRESERVE_ACTION}`, "giu")
];
const ADDITIONAL_CONSUMPTION = /(?:补充|增加|添加|新增|扩展|完善|补上|加上|校验|验证|检查|实现|改造|调整|更新|\b(?:add|include|extend|supplement|validate|check|implement|update)\b)/giu;
const READ_ONLY_PRESERVATION = /不变|不(?:要|得|可)?(?:再)?(?:修改|改动|改变|更改)|保持原样|\b(?:unchanged|unmodified|intact|as\s+is|without\s+(?:any\s+)?(?:changes?|modifications?))\b/iu;
const CLAUSE_BREAK = /[,，。！？；;.!?\n]|(?:但是|不过|然而|而是|只不过|rather\s+than|but|however)/giu;
const DIRECTIVE_BOUNDARY = /[,，。！？；;.!?\n]/u;
const ADDITIONAL_NEGATION = /(?:请勿|切勿|切忌|勿|莫|严禁|\b(?:never|avoid|no|can['’]t|won['’]t|mustn['’]t|shouldn['’]t|don['’]t|doesn['’]t)\b)[^，,。！？；;\n]{0,32}$/iu;
const REUSE_MENTIONS = new RegExp(REUSE_ACTION, "giu");

/** Exemptions require an affirmative directive; an unexplained prefix is not permission. */
function hasAffirmativePrefix(source: string, from: number): boolean {
  const prefix = (source.slice(0, from).split(DIRECTIVE_BOUNDARY).at(-1) ?? "").trim();
  if (/^(?:(?:请(?:你)?|麻烦(?:你)?|可以|允许|可|需要|帮我|帮忙)(?:帮我|帮忙)?\s*)?(?:(?:在|于)(?:新|新增|该|指定的)?(?:代码块|表格|公式|流程图|产物)(?:内|里|中)\s*)?$/iu.test(prefix)) return true;
  if (/^(?:please|kindly|you\s+(?:can|may)|(?:could|can|would|will)\s+you(?:\s+please)?|i\s+(?:want|would\s+like)\s+you\s+to)?\s*(?:in\s+(?:the\s+)?(?:new\s+)?(?:code\s+block|table|formula|diagram))?$/iu.test(prefix)) return true;
  if (/^(?:请\s*)?(?:新增|创建|生成|插入|追加)(?:一个|一份|一张)?\s*(?:[a-z][\w+.-]*\s*)?(?:代码块|表格|公式|流程图|产物)(?:并|且|同时|中|里)\s*$/iu.test(prefix)) return true;
  return /^(?:please\s+)?(?:add|create|generate|insert|append)\s+(?:(?:a|an|the|new)\s+)*(?:[\w+-]+\s+)?(?:code\s+block|table|formula|diagram)\s+(?:and|then)\s*$/iu.test(prefix);
}

function isNegatedReuse(source: string, from: number, to: number): boolean {
  const prefix = source.slice(0, from).split(DIRECTIVE_BOUNDARY).at(-1) ?? "";
  const start = from - prefix.length;
  const nextBoundary = source.slice(to).search(DIRECTIVE_BOUNDARY);
  const clause = source.slice(start, nextBoundary < 0 ? source.length : to + nextBoundary);
  return isNegatedMention(clause, from - start, to - start) || ADDITIONAL_NEGATION.test(prefix.slice(-64));
}

function hasAdditionalConsumption(source: string, after: number): boolean {
  CLAUSE_BREAK.lastIndex = after;
  const end = CLAUSE_BREAK.exec(source)?.index ?? source.length;
  const tail = source.slice(after, end);
  if (READ_ONLY_PRESERVATION.test(tail)) return false;
  ADDITIONAL_CONSUMPTION.lastIndex = 0;
  for (const match of tail.matchAll(ADDITIONAL_CONSUMPTION)) {
    const from = after + (match.index ?? 0);
    if (!isNegatedReuse(source, from, from + match[0].length)) return true;
  }
  return false;
}

function inspectPermission(source: string, patterns: RegExp[], preservation: boolean): { allowed: boolean; veto: boolean } {
  let allowed = false;
  let veto = false;
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    for (const match of source.matchAll(pattern)) {
      const from = match.index ?? 0;
      const to = from + match[0].length;
      if (isNegatedReuse(source, from, to) || !hasAffirmativePrefix(source, from)) {
        veto = true;
        continue;
      }
      if (!preservation || hasAdditionalConsumption(source, to)) allowed = true;
    }
  }
  return { allowed, veto };
}

/** True only when an unquoted, non-negated instruction explicitly reuses structured source material. */
export function hasExplicitSourceReusePermission(instruction: string): boolean {
  const masked = maskQuotedInstruction(instruction, scanInstructionQuotes(instruction));
  const reuse = inspectPermission(masked, SOURCE_REUSE_PATTERNS, false);
  const preservation = inspectPermission(masked, PRESERVATION_PATTERNS, true);
  REUSE_MENTIONS.lastIndex = 0;
  const explicitVeto = [...masked.matchAll(REUSE_MENTIONS)].some(match => {
    const from = match.index ?? 0;
    return isNegatedReuse(masked, from, from + match[0].length);
  });
  return !explicitVeto && !reuse.veto && !preservation.veto && (reuse.allowed || preservation.allowed);
}
