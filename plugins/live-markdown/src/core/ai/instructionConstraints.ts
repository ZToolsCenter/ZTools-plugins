import type {
  InstructionConstraint,
  InstructionContract,
  InstructionContractContext,
  InstructionSpan
} from "./intentContract";
import type { IntentOccurrence, IntentTarget, IntentTask } from "./intentTypes";
import {
  classifyInstructionLiterals,
  maskQuotedInstruction,
  scanInstructionQuotes,
  scanUnquotedLiteralCandidates
} from "./instructionLiteralEvidence";
import type { InstructionQuote } from "./instructionLiteralEvidence";
import { applyContinuationIntentDefaults } from "./continuationIntentDefaults";
import { generatedCodeGenerationActionEvidence, generatedCodeTaskEvidence, generatedExplanatoryTextEvidence } from "./generatedCodeTask";
import { generatedCodeCompositionRanges, generatedFunctionBehaviorRanges, generatedFunctionCreationAction } from "./codeGenerationBehavior";
import { applyInstructionSpeechAct } from "./instructionSpeechAct";
import { buildInstructionHeadingEvidence, parseChineseOrdinal, type HeadingTargetEvidence } from "./instructionHeadingEvidence";
import { isSelectionScopedEditRefinement } from "./instructionOperationSemantics";
import { hasSameAnchorSequentialArtifacts, isOrdinalRangeAnchor, sameAnchorSequentialInsertKeys } from "./intentCompoundPolicy";
export { scanInstructionQuotes } from "./instructionLiteralEvidence";

function unknown<T>(): InstructionConstraint<T> {
  return { state: "unknown" };
}

function explicit<T>(value: T, evidence: InstructionSpan[]): InstructionConstraint<T> {
  return { state: "explicit", value, evidence };
}

function span(source: string, from: number, to: number): InstructionSpan {
  return { from, to, raw: source.slice(from, to) };
}

interface VerbMatch extends InstructionSpan {
  operation: "insert" | "replace_exact" | "rewrite";
  verb: string;
}

const OPERATION_PATTERNS: Array<{ operation: VerbMatch["operation"]; pattern: RegExp }> = [
  { operation: "replace_exact", pattern: /替换(?:成|为)?|换成|改成|改为|\breplace\b|\bchange\b/giu },
  { operation: "insert", pattern: /追加|添加|增加|新增|新建|插入|加入|写入|放入|加上|加|补上|(?<!改|重|续|扩|缩)写(?=一个|一段|一份|一篇|段落|一行|一条|一则|[“‘「『"`])|\bappend(?:ed|ing|s)?\b|\binsert(?:ed|ing|s)?\b|\badd(?:ed|ing|s)?\b|\bwrite\b/giu },
  { operation: "rewrite", pattern: /润色|校对|总结|续写|改写|重写|扩写|缩写|整理|补充|修改|优化|删除|移除|翻译|排版|转换(?:成|为)?|转成|转为|\bconvert(?:ed|ing|s)?\b|\bclean(?:ed|ing|s)?\b|\btrim(?:med|ming|s)?\b|\bremov(?:e|es|ed|ing)\b|\brename(?:d|s)?\b|\bpolish\b|\bproofread\b|\bsummari[sz]e\b|\brewrite\b|\bcontinue\b|\bexpand\b|\bshorten\b|\bedit\b|\bdelete\b/giu }
];

const CLAUSE_BREAKS = /[,，。！？；;\n]|(?:但是|不过|然而|而是|只不过|rather\s+than|but|however)/giu;
const CONNECTORS = /(?:然后|接着|并且|同时|再|以及|并|\band\s+then\b|\bthen\b|\balso\b|\band\b)/giu;
const CONNECTOR_SCOPE_BREAK = /[。！？；;\r\n]|(?:但是|不过|然而|而是|只不过|rather\s+than|but|however)/iu;
const NEGATED_CODE_CREATION = /(?:不要|别|勿|不应|do\s+not|don't|must\s+not|never)[^，,。！？；;\n]{0,20}(?:新增|新建|添加|增加|插入|写入|生成|定义|创建|实现|编写|提供|add|append|insert|write|create|generate|define|implement|provide)[^，,。！？；;\n]{0,32}(?:代码|代码块|代码围栏|函数|\bcode\b|\bfunction\b|\bfence\b)/iu;
const CODE_INSERTION_POSITION = /(?:文末|文档(?:的)?(?:末尾|末端|底部|结尾)|文章(?:的)?(?:末尾|末端|底部|结尾)|文件(?:的)?(?:末尾|末端|底部|结尾)|全文(?:的)?(?:末尾|末端|结尾)|正文(?:的)?(?:开头|开始|起始|最前面)|选区(?:的)?(?:末尾|末端|结束)|底部|末尾|末端|(?:at|to)\s+(?:the\s+)?(?:end|bottom)|(?:beginning|start)\s+of\s+(?:the\s+)?body|(?:end|end\s+of)\s+(?:the\s+)?section|(?:at|near|next\s+to)\s+(?:the\s+)?(?:current\s+)?(?:cursor|caret))/giu;
const NEGATIVE = /(?:不要(?!忘记)|别|无需|无须|不需要|不必|不能|不可|禁止|不得|避免|不(?!要忘记|但|仅|只)|don't|do\s+not|must\s+not|without|not)[^，,。！？；;\n]{0,10}$/iu;
const NEGATIVE_MENTION = /(?:不要(?!忘记)|别|无需|无须|不需要|不必|不能|不可|禁止|不得|避免|不(?!要忘记|但|仅|只)|don't|do\s+not|must\s+not|without|not)[^，,。！？；;\n]{0,32}$/iu;
const ANSWER_ONLY = /(?:只回答|仅回答|只给(?:出)?答案|仅给(?:出)?答案|只回复|仅回复|(?<!不要)(?<!别)(?<!不需要)(?<!不必)(?<!不能)(?<!不可)(?<!禁止)(?<!不得)(?<!无需)(?<!无须)(?<!不)(?:只|仅)(?:告诉我|告知我)\s*(?:如何|怎么|怎样|方法)|answer\s+only|respond\s+only)/iu;

function operationMatches(masked: string, source: string): VerbMatch[] {
  if (ANSWER_ONLY.test(masked)) return [];
  const matches: VerbMatch[] = [];
  for (const { operation, pattern } of OPERATION_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of masked.matchAll(pattern)) {
      const from = match.index ?? 0;
      const beforeClause = masked.slice(lastClauseBoundary(masked, from), from);
      if (NEGATIVE.test(beforeClause.slice(-32))) continue;
      const to = from + match[0].length;
      const literalContext = masked.slice(Math.max(0, from - 40), from);
      const literalFollowup = masked.slice(to, Math.min(masked.length, to + 32));
      if (/(?:引号中的|引号内的|字面标记|字面词|quoted\s+(?:token|string)|literal\s+(?:token|string))\s*["“‘]?\s*$/iu.test(literalContext) &&
          /^\s*(?:["”’]\s*)?(?:是|为|作为|表示|代表|is|means|represents)\s*(?:数据|字面值|标记|内容|data|a\s+literal\b)/iu.test(literalFollowup)) continue;
      // English identifiers such as add(a, b) are code parameters, not document commands.
      if (/^[a-z]+$/iu.test(match[0]) && /^\s*\(/u.test(masked.slice(to))) continue;
      matches.push({ operation, verb: match[0], from, to, raw: source.slice(from, to) });
    }
  }
  return matches.filter((verb) => {
    const prefix = masked.slice(lastClauseBoundary(masked, verb.from), verb.from);
    if (verb.operation === "insert" && /(?:只|仅)?输出\s*$/u.test(prefix)) return false;
    if (verb.verb !== "总结") return true;
    return !/(?:新增|添加|增加|写|写入|加入|插入|加)(?:\s*(?:一段|一篇|一个|一则|一条|段落))?\s*$/u.test(prefix);
  }).sort((left, right) => left.from - right.from || left.to - right.to);
}

function includeGeneratedCodeInsertion(source: string, masked: string, candidates: VerbMatch[]): VerbMatch[] {
  if (NEGATED_CODE_CREATION.test(masked)) return candidates;
  const insertionAction = /^(?:新增|新建|追加|添加|增加|插入|加入|写入|生成|编写|提供|定义|实现|创建|\b(?:add|append|insert|write|create|generate|define|implement|provide)\b)$/iu;
  const actions = generatedCodeGenerationActionEvidence(source, masked)
    .filter(({ raw }) => insertionAction.test(raw))
    .sort((left, right) => left.from - right.from);
  if (!actions.length) {
    const fallback = generatedFunctionCreationAction(source, masked);
    if (fallback && insertionAction.test(source.slice(fallback.from, fallback.to))) actions.push({ ...fallback, raw: source.slice(fallback.from, fallback.to) });
  }
  if (!generatedCodeTaskEvidence(source, masked).length && !actions.length) return candidates;
  CODE_INSERTION_POSITION.lastIndex = 0;
  const positionedActions = actions.filter((action) => [...masked.matchAll(CODE_INSERTION_POSITION)].some((position) => {
    const from = position.index ?? 0;
    const to = from + position[0].length;
    return Math.abs(action.from - from) <= 160 && !isNegatedMention(masked, from, to) && !isPreservedPositionMention(masked, from, to);
  }));
  if (!positionedActions.length) return candidates;
  if (positionedActions.some(({ from, to }) => candidates.some((candidate) => candidate.from === from && candidate.to === to))) return candidates;
  const action = positionedActions[0];
  const candidate: VerbMatch = { operation: "insert", verb: action.raw, from: action.from, to: action.to, raw: action.raw };
  return [...candidates, candidate]
    .sort((left, right) => left.from - right.from || left.to - right.to);
}

function normalizeSelectedLiteralReplacement(masked: string, quotes: InstructionQuote[], verbs: VerbMatch[]): VerbMatch[] {
  const replacement = verbs.find(({ operation }) => operation === "replace_exact");
  const directSelectionReplacement = /(?:当前)?(?:选区|选中(?:的)?(?:内容|文字|文本|部分)|所选(?:内容|文字|文本|部分))\s*(?:整体)?(?:替换|换成|改成)(?:成|为)?/u.test(masked);
  if (quotes.length === 0 && directSelectionReplacement && replacement && verbs.length === 1) {
    return verbs.map((verb) => verb === replacement ? { ...verb, operation: "rewrite" } : verb);
  }
  if (quotes.length !== 1 || !/(?:当前)?(?:选中(?:的)?(?:片段|内容|文字|文本|部分)|所选(?:片段|内容|文字|文本|部分))/u.test(masked)) return verbs;
  const quotedReplacement = verbs.find(({ operation }) => operation === "replace_exact");
  if (!quotedReplacement || quotes[0].from < quotedReplacement.to) return verbs;
  // The selected range is the old text; the sole quoted value is the new text.
  return verbs.map((verb) => verb === quotedReplacement ? { ...verb, operation: "rewrite" } : verb);
}

function lastClauseBoundary(source: string, position: number): number {
  CLAUSE_BREAKS.lastIndex = 0;
  let boundary = 0;
  for (const match of source.slice(0, position).matchAll(CLAUSE_BREAKS)) boundary = (match.index ?? 0) + match[0].length;
  return boundary;
}

export function isNegatedMention(source: string, from: number, to: number): boolean {
  const start = lastClauseBoundary(source, from);
  CLAUSE_BREAKS.lastIndex = to;
  const endMatch = CLAUSE_BREAKS.exec(source);
  const end = endMatch?.index ?? source.length;
  const prefix = source.slice(start, from).slice(-32);
  if (NEGATIVE_MENTION.test(prefix)) return true;

  const suffix = source.slice(to, end).slice(0, 32);
  if (/(?:其他|其它|其余|别处|anything\s+else|other(?:\s+\w+)*)/iu.test(suffix)) return false;
  return /(?:不要|别|不需要|不必|不能|不可|不|don't|do\s+not|must\s+not)[^，,。！？；;\n]{0,12}(?:修改|编辑|改动|处理|替换|删除|添加|插入|动|改(?:成|为|写)?|edit|modify|touch|replace|delete|write)/iu.test(suffix);
}

function makeContract(): InstructionContract {
  return {
    effect: unknown(), operation: unknown(), target: unknown(), scope: unknown(), occurrence: unknown(), layout: unknown(),
    literals: [], heading: unknown(), issues: [],
    preconditions: { selectionRequired: false, cursorRequired: false }
  };
}

function buildOperationConstraint(source: string, matches: VerbMatch[], masked: string, contract: InstructionContract): void {
  if (!matches.length) return;
  const evidence = matches.map(({ from, to }) => span(source, from, to));
  const unique = [...new Set(matches.map(({ operation }) => operation))];
  CONNECTORS.lastIndex = 0;
  const hasConnectedEdits = [...masked.matchAll(CONNECTORS)].some((connector) => {
    const position = connector.index ?? 0;
    const left = matches.filter((item) => item.to <= position).sort((a, b) => b.to - a.to)[0];
    const right = matches.filter((item) => item.from >= position + connector[0].length).sort((a, b) => a.from - b.from)[0];
    if (!left || !right) return false;
    return !CONNECTOR_SCOPE_BREAK.test(masked.slice(position + connector[0].length, right.from));
  });

  if (matches.length > 1 && hasConnectedEdits) {
    contract.operation = { state: "ambiguous", alternatives: unique, evidence };
    contract.effect = { state: "ambiguous", alternatives: ["edit", "no_edit"], evidence };
    contract.issues.push({ code: "compound", evidence });
    return;
  }
  if (unique.length > 1) {
    if (isSelectionScopedEditRefinement(masked, matches)) {
      const find = contract.literals.filter(({ role }) => role === "find");
      const write = contract.literals.filter(({ role }) => role === "write");
      const replacement = matches.filter(({ operation }) => operation === "replace_exact");
      contract.operation = find.length === 1 && write.length === 1 && replacement.length === 1
        ? explicit("replace_exact", replacement.map(({ from, to }) => span(source, from, to)))
        : unknown();
      contract.effect = explicit("edit", evidence);
      return;
    }
    contract.operation = { state: "conflict", alternatives: unique, evidence };
    contract.issues.push({ code: "conflicting_constraints", evidence });
    return;
  }
  contract.operation = explicit(unique[0], evidence);
  contract.effect = explicit("edit", evidence);
}

function buildOccurrenceConstraint(
  source: string,
  masked: string,
  verbs: VerbMatch[],
  contract: InstructionContract,
  headingEvidence: Array<{ targetEvidence: InstructionSpan; ordinalEvidence?: InstructionSpan }>
): void {
  const matches: Array<{ value: IntentOccurrence; from: number; to: number }> = [];
  const overlapsHeadingPosition = (from: number, to: number) => headingEvidence.some(({ targetEvidence }) =>
    from < targetEvidence.to && to > targetEvidence.from);
  const overlapsHeadingOrdinal = (from: number, to: number) => headingEvidence.some(({ ordinalEvidence }) =>
    ordinalEvidence && from < ordinalEvidence.to && to > ordinalEvidence.from);
  const patterns: Array<{ value: IntentOccurrence; pattern: RegExp }> = [
    { value: "all", pattern: /全部|所有|每一(?:处|个|次)|\ball\s+(?:occurrences?|matches?)\b|\b(?:replace|change)\s+(?:only\s+)?all\b/giu },
    { value: "last", pattern: /最后\s*(?:一|1)?\s*(?:处|个|次)|最后一个|最后(?:的)?(?=\s*[\p{L}\p{N}])|末尾(?:的)?(?=\s*[\p{L}\p{N}])|\blast\s+(?:occurrence|match)\b/giu },
    { value: "single", pattern: /唯一(?:一)?(?:处|个|次)|\bonly\s+(?:one|single)\s+(?:occurrence|match)\b/giu }
  ];
  for (const { value, pattern } of patterns) {
    for (const match of masked.matchAll(pattern)) {
      const from = match.index ?? 0;
      if (!isNegatedMention(masked, from, from + match[0].length) && !overlapsHeadingPosition(from, from + match[0].length)) {
        matches.push({ value, from, to: from + match[0].length });
      }
    }
  }
  const ordinal = /(?<![0-9、,，]\s*)第\s*([0-9]{1,4}|[零〇一二两三四五六七八九十]+)\s*(?:处|个|次|项|条|段)|\b(?:the\s+)?([0-9]{1,4})(?:st|nd|rd|th)\s+(?:occurrence|match|draft)\b/giu;
  for (const match of masked.matchAll(ordinal)) {
    const value = parseChineseOrdinal(match[1] ?? match[2] ?? "");
    if (value !== null && value >= 1 && value <= 1000) {
      const from = match.index ?? 0;
      if (isOrdinalRangeAnchor(masked, from + match[0].length)) continue;
      if (!isNegatedMention(masked, from, from + match[0].length) && !overlapsHeadingOrdinal(from, from + match[0].length)) {
        matches.push({ value, from, to: from + match[0].length });
      }
    }
  }
  // In an explicit English replacement, "last" qualifies the source literal
  // (for example, "replace the last status with active"). Keep this generic;
  // the find/write spans are grounded separately from the replacement pair.
  for (const verb of verbs.filter(({ operation }) => operation === "replace_exact")) {
    const clauseEnd = lastClauseBoundary(masked, masked.length) || masked.length;
    const tail = masked.slice(verb.to, clauseEnd);
    const qualifier = /^\s+(?:(?:only|just)\s+)?(?:the\s+)?last(?=[^\r\n;；]{1,160}\s+(?:with|by)\b)/iu.exec(tail);
    if (qualifier) {
      const lastOffset = qualifier[0].lastIndexOf("last");
      const from = verb.to + qualifier.index + lastOffset;
      if (!isNegatedMention(masked, from, from + 4)) matches.push({ value: "last", from, to: from + 4 });
    }
  }
  if (!matches.length) return;
  matches.sort((left, right) => left.from - right.from);
  const values = [...new Set(matches.map(({ value }) => value))];
  const evidence = matches.map(({ from, to }) => span(source, from, to));
  contract.occurrence = values.length === 1
    ? explicit(values[0], evidence)
    : { state: "conflict", alternatives: values, evidence };
  if (values.length > 1) contract.issues.push({ code: "conflicting_constraints", evidence });
}

interface TargetMatch extends InstructionSpan {
  value: IntentTarget;
}

function regexMatches(source: string, pattern: RegExp, target: IntentTarget): TargetMatch[] {
  pattern.lastIndex = 0;
  return [...source.matchAll(pattern)].map((match) => {
    const from = match.index ?? 0;
    const to = from + match[0].length;
    return { value: target, from, to, raw: source.slice(from, to) };
  });
}

function isPreservedPositionMention(source: string, from: number, to: number): boolean {
  const start = lastClauseBoundary(source, from);
  const after = source.slice(to).search(/[,，。！？；;\n]/u);
  const end = after < 0 ? source.length : to + after;
  const prefix = source.slice(start, from);
  const clause = source.slice(start, end);
  return /保留|保持|原样|\b(?:preserve|keep)\b/iu.test(prefix) &&
    /标记|标识|格式|结构|原样|不变|\b(?:markers?|format|structure|unchanged)\b/iu.test(source.slice(from, end)) &&
    !/新增|追加|插入|移到|移动|加上|\b(?:append|insert|move|add)\b/iu.test(clause);
}

function buildTargetAndScope(
  instruction: string,
  masked: string,
  verbs: VerbMatch[],
  contract: InstructionContract,
  headingEvidence: HeadingTargetEvidence[],
  context?: InstructionContractContext
): void {
  const targets: TargetMatch[] = [
    ...regexMatches(masked, /(?:当前)?(?:选区|所选(?:内容|文字|文本|部分)?)(?:的)?(?:末尾|末端|结束|最后)|(?:end|at\s+the\s+end\s+of)\s+(?:the\s+)?selection/giu, "selection_end"),
    ...regexMatches(masked, /正文(?:的)?(?:开头|开始|起始|最前面|前面)|(?:beginning|start)\s+of\s+(?:the\s+)?body/giu, "body_start"),
    ...regexMatches(masked, /(?:当前)?(?:光标|插入点)(?:位置|处|旁边|后面|前面)?|(?:at|near|next\s+to|where)\s+(?:(?:the|my|your)\s+)?(?:current\s+)?(?:cursor|caret)\b/giu, "cursor"),
    ...regexMatches(masked, /(?:文末|文档(?:的)?(?:最)?(?:末尾|末端|底部|底端|最后|结尾)|文章(?:的)?(?:最)?(?:末尾|末端|底部|底端|最后|结尾)|文件(?:的)?(?:最)?(?:末尾|末端|底部|底端|最后|结尾)|全文(?:的)?(?:最)?(?:末尾|末端|底部|底端|结尾)|底部|末尾|末端|(?:at|to)\s+(?:the\s+)?(?:end\s+of\s+(?:the\s+)?(?:document|file|article)|bottom|end))/giu, "document_end")
  ];
  const positiveHeadingEvidence = headingEvidence.filter(({ evidence }) => !isNegatedMention(masked, evidence.from, evidence.to));
  const distinctHeadings = [...new Map(positiveHeadingEvidence.map(({ value, evidence }) => {
    const normalizedText = value.text.normalize("NFC").trim().replace(/\s+/gu, " ");
    const key = `${normalizedText}\u0000${value.relation}\u0000${value.ordinalScope ?? ""}\u0000${value.ordinal ?? ""}`;
    return [key, { value, evidence }];
  })).values()];
  if (distinctHeadings.length > 1) {
    const evidence = distinctHeadings.map(({ evidence: item }) => item);
    contract.heading = { state: "ambiguous", alternatives: distinctHeadings.map(({ value }) => value), evidence };
    contract.issues.push({ code: "compound", evidence });
  } else if (distinctHeadings.length === 1) {
    const heading = distinctHeadings[0];
    contract.heading = explicit(heading.value, [heading.evidence]);
  }
  for (const { value, targetEvidence } of positiveHeadingEvidence) {
    targets.push({ value: value.relation, ...targetEvidence });
  }
  const sectionEnd = regexMatches(masked, /(?:标题|章节|本节|这一节)(?:的)?(?:末尾|结尾|结束|末端)|(?:end|end\s+of)\s+(?:the\s+)?section/giu, "section_end")
    .filter(({ from, to }) => !isNegatedMention(masked, from, to));
  for (const item of sectionEnd) {
    if (!positiveHeadingEvidence.length) contract.issues.push({ code: "ambiguous_anchor", evidence: [item] });
    targets.push(item);
  }
  const selectionMentions = regexMatches(masked, /当前选区|选区(?:内|中的|里)?|所选(?:内容|文字|文本|部分)?|选中(?:的)?(?:内容|文字|文本|部分)?|\bselected\s+(?:text|content|range)\b|\bselection\b/giu, "selection");
  const documentMentions = regexMatches(masked, /全文|原文|整篇|全篇|通篇|整份(?:文档|文件|文章)|整个(?:当前)?(?:文档|文件|文章)|(?:this|whole|entire|full)\s+(?:document|file|article|doc)|\b(?:in|within|throughout)\s+(?:the|this|current)\s+(?:document|file|article|doc)\b/giu, "document")
    .filter(mention => !(context?.hasSelection && mention.raw === "原文") && !isPreservedPositionMention(masked, mention.from, mention.to));

  const specificPositions = targets.filter(({ value }) => value === "selection_end" || value === "heading_end" || value === "section_end");
  const positiveTargets = targets.filter(({ value, from, to }) =>
    !isNegatedMention(masked, from, to) && !isPreservedPositionMention(masked, from, to) &&
    !(value === "document_end" && specificPositions.some((position) => from < position.to && to > position.from))
  );
  const uniqueTargets = [...new Set(positiveTargets.map(({ value }) => value))];
  if (uniqueTargets.length === 1) {
    const target = uniqueTargets[0];
    contract.target = explicit(target, positiveTargets.filter(({ value }) => value === target).map(({ from, to }) => span(instruction, from, to)));
    if (target === "selection" || target === "selection_end") selectionMentions.push(...positiveTargets.filter((item) => item.value === target));
    if (target === "document_end" || target === "body_start") documentMentions.push(...positiveTargets.filter((item) => item.value === target));
  } else if (uniqueTargets.length > 1) {
    const evidence = positiveTargets.map(({ from, to }) => span(instruction, from, to));
    contract.target = { state: "conflict", alternatives: uniqueTargets, evidence };
    contract.issues.push({ code: "conflicting_constraints", evidence });
  }

  const positiveScopeMentions = (scopeMentions: TargetMatch[]) => scopeMentions.filter((mention) => !isNegatedMention(masked, mention.from, mention.to));
  const selections = positiveScopeMentions(selectionMentions);
  const documents = positiveScopeMentions(documentMentions);
  const hasSelection = selections.length > 0 || uniqueTargets.includes("selection_end");
  const hasDocument = documents.length > 0 || uniqueTargets.includes("document_end") || uniqueTargets.includes("body_start");
  if (hasSelection && hasDocument) {
    const evidence = [...selections, ...documents].map(({ from, to }) => span(instruction, from, to));
    contract.scope = { state: "conflict", alternatives: ["document", "selection"], evidence };
    contract.issues.push({ code: "scope_conflict", evidence });
  } else if (hasSelection) {
    contract.scope = explicit("selection", selections.map(({ from, to }) => span(instruction, from, to)));
  } else if (hasDocument) {
    contract.scope = explicit("document", documents.map(({ from, to }) => span(instruction, from, to)));
  }

  // A document-end anchor on a replacement means the last matching occurrence
  // in the document, not a zero-width insertion at EOF. Insertions keep the
  // document_end target unchanged.
  if (contract.target.state === "explicit" && contract.target.value === "document_end" &&
      verbs.some(({ operation }) => operation === "replace_exact")) {
    const evidence = contract.target.evidence;
    contract.target = explicit("document", evidence);
    contract.scope = explicit("document", evidence);
    if (contract.occurrence.state === "unknown") contract.occurrence = explicit("last", evidence);
  }

  if (contract.scope.state === "explicit" && contract.target.state === "unknown" && verbs.some(({ operation }) => operation === "rewrite" || operation === "replace_exact")) {
    contract.target = explicit(contract.scope.value, contract.scope.evidence);
  }
  const targetNeedsSelection = contract.target.state === "explicit" && (contract.target.value === "selection" || contract.target.value === "selection_end");
  const scopeNeedsSelection = contract.scope.state === "explicit" && contract.scope.value === "selection";
  contract.preconditions.selectionRequired = targetNeedsSelection || scopeNeedsSelection;
  contract.preconditions.cursorRequired = contract.target.state === "explicit" && contract.target.value === "cursor";
  if (context?.hasSelection !== undefined) contract.preconditions.selectionAvailable = context.hasSelection;
  if (context?.hasCursor !== undefined) contract.preconditions.cursorAvailable = context.hasCursor;
  if (contract.preconditions.selectionRequired && context?.hasSelection === false) {
    const evidence = contract.scope.state === "explicit" ? contract.scope.evidence : contract.target.state === "explicit" ? contract.target.evidence : [];
    contract.issues.push({ code: "missing_target", evidence });
  }
  if (contract.preconditions.cursorRequired && context?.hasCursor === false) {
    contract.issues.push({ code: "missing_target", evidence: contract.target.state === "explicit" ? contract.target.evidence : [] });
  }
}

function buildLayoutConstraint(source: string, masked: string, contract: InstructionContract): void {
  const explicitInsert = contract.operation.state === "explicit" && contract.operation.value === "insert";
  const implicitCursorInsert = contract.operation.state === "unknown" && contract.target.state === "explicit" &&
    (contract.target.value === "cursor" || contract.target.value === "selection_end");
  if (!explicitInsert && !implicitCursorInsert) return;

  const inline = regexMatches(masked, /紧接|行内|同一行|inline|on\s+the\s+same\s+line/giu, "cursor");
  const block = regexMatches(masked, /新段落|另起(?:一)?段|新的一行|单独一行|换行|新增一段|新建一段|新增段落|新建段落|插入(?:一|一个)?(?:新)?(?:段|段落)|写一段|写段落|代码(?:块|围栏)|\bcode\s*(?:block|fence)\b|block|new\s+paragraph|new\s+line/giu, "cursor");
  if (inline.length && block.length) {
    const evidence = [...inline, ...block].map(({ from, to }) => span(source, from, to));
    contract.layout = { state: "conflict", alternatives: ["inline", "block"], evidence };
    contract.issues.push({ code: "conflicting_constraints", evidence });
  } else if (inline.length) contract.layout = explicit("inline", inline.map(({ from, to }) => span(source, from, to)));
  else if (block.length) contract.layout = explicit("block", block.map(({ from, to }) => span(source, from, to)));
  else if (contract.layout.state === "unknown" && contract.target.state === "explicit" &&
      (contract.target.value === "cursor" || contract.target.value === "selection_end")) {
    contract.layout = explicit("inline", contract.target.evidence);
  }
}

function completeSelectedRefinementOccurrence(source: string, masked: string, verbs: VerbMatch[], contract: InstructionContract): void {
  if (contract.operation.state !== "explicit" || contract.operation.value !== "replace_exact" ||
      contract.scope.state !== "explicit" || contract.scope.value !== "selection" ||
      contract.occurrence.state !== "unknown" || !isSelectionScopedEditRefinement(masked, verbs)) return;
  const find = contract.literals.filter(({ role }) => role === "find");
  const write = contract.literals.filter(({ role }) => role === "write");
  if (find.length !== 1 || write.length !== 1) return;
  contract.occurrence = explicit("single", [
    span(source, find[0].from, find[0].to), span(source, write[0].from, write[0].to)
  ]);
}

/** Extracts only high-confidence instruction constraints; unresolved language stays unknown. */
export function deriveInstructionContract(
  instruction: string,
  context?: InstructionContractContext
): InstructionContract {
  const contract = makeContract();
  if (!instruction.trim()) return contract;

  const quotes = scanInstructionQuotes(instruction);
  const masked = maskQuotedInstruction(instruction, quotes);
  const answerOnlyMatch = ANSWER_ONLY.exec(masked);
  const operationCandidates = includeGeneratedCodeInsertion(instruction, masked, operationMatches(masked, instruction));
  const functionBehavior = new Set([...generatedFunctionBehaviorRanges(instruction, masked, operationCandidates), ...generatedCodeCompositionRanges(instruction, masked, operationCandidates)]);
  const nonBehaviorVerbs = operationCandidates.filter(({ from, to }) => !functionBehavior.has(`${from}:${to}`));
  const sameAnchorInserts = sameAnchorSequentialInsertKeys(masked, nonBehaviorVerbs.filter(({ operation }) => operation === "insert"), nonBehaviorVerbs);
  const verbs = normalizeSelectedLiteralReplacement(masked, quotes, nonBehaviorVerbs.filter(({ from, to }) => !sameAnchorInserts.has(`${from}:${to}`)));
  const unquoted = scanUnquotedLiteralCandidates(instruction, quotes);
  const headingEvidence = buildInstructionHeadingEvidence(instruction, masked, quotes);
  contract.literals = classifyInstructionLiterals(quotes, unquoted, verbs, instruction, masked);
  buildOperationConstraint(instruction, verbs, masked, contract);
  buildOccurrenceConstraint(instruction, masked, verbs, contract, headingEvidence);
  buildTargetAndScope(instruction, masked, verbs, contract, headingEvidence, context);
  completeSelectedRefinementOccurrence(instruction, masked, verbs, contract);
  const codeGenerationActions = generatedCodeGenerationActionEvidence(instruction, masked);
  const functionCreationAction = generatedFunctionCreationAction(instruction, masked);
  const codeCreationEvidence = codeGenerationActions.length === 1 ? codeGenerationActions : functionCreationAction
    ? [span(instruction, functionCreationAction.from, functionCreationAction.to)] : [];
  const target = contract.target.state === "explicit" ? contract.target.value : undefined;
  const isInsertionTarget = target !== undefined && ["document_end", "body_start", "cursor", "selection_end", "heading_end", "section_end"].includes(target);
  const editEffect = contract.effect.state === "unknown" || contract.effect.state === "explicit" && contract.effect.value === "edit";
  if (contract.operation.state === "unknown" && editEffect && isInsertionTarget && codeCreationEvidence.length === 1 && !contract.issues.length) {
    contract.effect = explicit("edit", codeCreationEvidence);
    contract.operation = explicit("insert", codeCreationEvidence);
  }
  if (verbs.length === 1 && /^(?:总结|summari[sz]e)$/iu.test(verbs[0].raw) &&
      (contract.target.state === "unknown" || contract.target.state === "explicit" && ["document", "selection"].includes(contract.target.value))) {
    contract.effect = explicit("answer", [span(instruction, verbs[0].from, verbs[0].to)]);
    contract.operation = unknown();
  }
  const taskWords: Array<{ expression: RegExp; tasks: IntentTask[] }> = [
    { expression: /^(?:润色|polish)$/iu, tasks: ["polish", "academic-polish"] },
    { expression: /^(?:校对|proofread)$/iu, tasks: ["proofread", "polish"] },
    { expression: /^(?:总结|summari[sz]e)$/iu, tasks: ["summarize"] },
    { expression: /^(?:续写|continue)$/iu, tasks: ["continue"] },
    { expression: /技术方案$/u, tasks: ["tech-spec"] },
    { expression: /(?:mermaid|流程图|架构图|图表)$/iu, tasks: ["diagram"] }
  ];
  const taskEvidence = [...masked.matchAll(/润色|校对|总结|续写|(?:生成|撰写|编写|整理)\s*(?:一份|一个)?\s*技术方案|(?:生成|创建|绘制|画)\s*(?:一个|一张)?\s*(?:mermaid\s*)?(?:流程图|架构图|图表)|\b(?:polish|proofread|summari[sz]e|continue)\b/giu)].flatMap(match => {
    const from = match.index ?? 0;
    if (isNegatedMention(masked, from, from + match[0].length)) return [];
    const rule = taskWords.find(({ expression }) => expression.test(match[0]));
    return rule ? [{ tasks: rule.tasks, evidence: span(instruction, from, from + match[0].length) }] : [];
  });
  if (contract.operation.state === "explicit" && contract.operation.value === "insert") {
    const codeEvidence = generatedCodeTaskEvidence(instruction, masked);
    for (const evidence of [...(hasSameAnchorSequentialArtifacts(masked) ? codeEvidence.slice(0, 1) : codeEvidence), ...generatedExplanatoryTextEvidence(instruction, masked)]) taskEvidence.push({ tasks: ["custom"], evidence });
    if (!taskEvidence.length && functionCreationAction) {
      taskEvidence.push({ tasks: ["custom"], evidence: span(instruction, functionCreationAction.from, functionCreationAction.to) });
    }
  }
  if (taskEvidence.length) {
    const groups = [...new Map(taskEvidence.map(({ tasks }) => [tasks.join("\u0000"), tasks])).values()];
    const evidence = taskEvidence.map(({ evidence: item }) => item);
    if (groups.length === 1) contract.generationTasks = explicit(groups[0], evidence);
    else {
      contract.generationTasks = { state: "conflict", alternatives: groups, evidence };
      contract.issues.push({ code: "compound", evidence });
    }
  }

  if (!answerOnlyMatch && contract.operation.state === "unknown" && !verbs.length && /(?:不要(?!忘记)|别|无需|无须|不需要|不必|不能|不可|禁止|不得|避免|不(?!要忘记|但|仅|只)).{0,32}(?:修改|编辑|改动|生成|添加|插入|追加|加|写入|删除|移除|替换)|(?:do\s+not|don't|must\s+not|without).{0,32}(?:edit|modify|add|insert|append|replace|delete)/iu.test(masked)) {
    const negation = /(?:不要(?!忘记)|别|无需|无须|不需要|不必|不能|不可|禁止|不得|避免|不(?!要忘记|但|仅|只)|do\s+not|don't|must\s+not|without)/iu.exec(masked);
    const evidence = negation ? [span(instruction, negation.index, negation.index + negation[0].length)] : [];
    contract.effect = explicit("no_edit", evidence);
    contract.issues.push({ code: "missing_operation", evidence });
  }
  if (answerOnlyMatch || !verbs.length && /(?:什么意思|是什么意思|含义|解释一下|请解释|what\s+does\s+.+\s+mean|meaning\s+of)/iu.test(masked)) {
    const match = answerOnlyMatch ?? /(?:什么意思|是什么意思|含义|解释一下|请解释|what\s+does\s+.+\s+mean|meaning\s+of)/iu.exec(masked);
    const evidence = match ? [span(instruction, match.index, match.index + match[0].length)] : [];
    contract.effect = explicit("answer", evidence);
  }

  applyInstructionSpeechAct(contract, instruction, masked, context);

  applyContinuationIntentDefaults(contract, context ?? {}, instruction, masked);
  buildLayoutConstraint(instruction, masked, contract);

  return contract;
}

// Keep this target type visible here so TS consumers can narrow contract.target without re-declaring it.
export type { IntentTarget, IntentOccurrence };
