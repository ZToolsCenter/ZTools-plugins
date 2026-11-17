import type { ArtifactField, ArtifactHeading, HeadingLevel } from "./artifactSpec";
import type { InstructionSpan } from "./intentContract";
import { isNegatedMention } from "./instructionConstraints";
import { maskQuotedInstruction, scanInstructionQuotes } from "./instructionLiteralEvidence";
import { isArtifactUsageQuestion } from "./artifactQuestion";

export interface ArtifactHeadingListEvidence {
  readonly recognized: boolean;
  readonly headings: readonly ArtifactHeading[];
  readonly declaredCount?: ArtifactField<number>;
  readonly issues: readonly ("heading_count_mismatch" | "conflicting_heading_levels" | "incomplete_heading_list" | "heading_list_too_long")[];
  readonly onlyHeadings: boolean;
}

interface DescriptorMatch { from: number; to: number; count?: number; countFrom?: number; countTo?: number; level?: HeadingLevel; levelFrom?: number; levelTo?: number; }
interface TextEvidence extends ArtifactField<string> { }

const CHINESE_NUMBER: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
const ENGLISH_NUMBER: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8 };
const COUNT = "(?:\\d{1,2}|两|[一二三四五六七八九十]|one|two|three|four|five|six|seven|eight)";
const LEVEL_ATOM = "(?:H\\s*[1-6]|level\\s*[1-6]|[1-6](?:st|nd|rd|th)[ -]?level|[一二三四五六1-6]\\s*级)";
const LEVEL = `${LEVEL_ATOM}(?:\\s*(?:and|和|/|、|，|,)\\s*${LEVEL_ATOM})*`;
const DESCRIPTORS = [
  new RegExp(`(?<count>${COUNT})\\s*(?:个|条)?\\s*(?<level>${LEVEL})?\\s*(?:Markdown\\s*)?标题`, "giu"),
  new RegExp(`(?:exactly\\s+)?(?<count>${COUNT})\\s+(?:(?<level>${LEVEL})\\s+)?(?:Markdown\\s+)?headings?`, "giu")
];
const UNCOUNTED_DESCRIPTORS = [
  new RegExp(`(?<level>${LEVEL})\\s*(?:Markdown\\s*)?标题`, "giu"),
  new RegExp(`(?<level>${LEVEL})\\s+(?:Markdown\\s+)?headings?`, "giu"),
  new RegExp(`(?:with|using)\\s+(?:these|the following)\\s+(?:(?<level>${LEVEL})\\s+)?(?:sub)?headings?\\s*(?:in\\s+order\\s*)?`, "giu")
];
const CREATE_VERB = /新增|新建|添加|增加|插入|追加|创建|生成|写出|编写|add|append|insert|create|generate|write/giu;
const DIRECT_HEADING_CREATION = /新增|新建|添加|增加|插入|追加|创建|\b(?:add|append|insert|create)\b/iu;
const BODY_PROSE_CREATION = /撰写|编写|写出|起草|生成|准备|制作|创作|\b(?:write|draft|prepare|produce|generate|compose|make|create)\b/iu;
const DIRECT_HEADING_CONDITIONAL = /\b(?:if|unless|when|provided\s+that|only\s+if|only\s+when|in\s+case|subject\s+to)\b|如果|若|假如|倘若|除非|一旦/iu;
const SENTENCE_END = /[。！？.!?；;\r\n]/u;
const SEPARATOR = /(?:[、，,]|以及|和|及|并且|并|然后|接着|同时|再|\s+and\s+then\s+|\s+(?:then|also)\s+|\s+and\s+)/iu;
const BODY_ACTION = /^(?:(?:并|然后|接着|同时|再|以及|and\s+then|then|also)(?:\s*在[^\s]{0,8})?\s*)?(?:分别|各自)?\s*(?:写|写出|撰写|生成|补充|说明|解释|分析|添加|新增|创建|实现|编写|write|draft|generate|add|create|implement|explain|describe)/iu;
const OUTPUT_ONLY = /^(?:(?:只(?:需要|要|包含|写)?(?:要)?标题|仅(?:需|要|包含)?标题|标题即可|只新增标题|仅新增标题)|(?:add|include|insert|create)\s+headings?\s+only|headings?\s+only|only\s+headings?)/iu;
const ONLY_HEADINGS = /^(?:(?:只(?:需要|要|包含|写)?(?:要)?标题|仅(?:需|要|包含)?标题|标题即可|只新增标题|仅新增标题)|(?:(?:add|include|insert|create)\s+)?headings?\s+only|only\s+headings?)\s*[。.!?！？；;]*$/iu;
const ORDERED_ENGLISH_HEADING_PREFIX = new RegExp(
  `\\b(?:use|using|with)\\s+(?:(?:these|the following|the)\\s+)?(?:(?<level>${LEVEL})\\s+)?(?:sub)?headings?(?:[ \\t]*[:：][ \\t]*|[ \\t]+)`,
  "giu"
);
const ORDERED_ENGLISH_HEADING_MARKER = /[ \t]+(?:in[ \t]+(?:(?:this|that|the)[ \t]+)?order|to[ \t]+organize|to[ \t]+organise|to[ \t]+structure)\b/giu;
const ORDERED_ENGLISH_PREPOSED_MARKER = /^[ \t]*in[ \t]+(?:(?:this|that|the)[ \t]+)?order[ \t]*[:：][ \t]*/iu;
const ORDERED_ENGLISH_CONDITIONAL = /\b(?:if|unless|when|provided\s+that|only\s+if|only\s+when|in\s+case|subject\s+to)\b/iu;
const ORDERED_ENGLISH_POLITE_REQUEST = /^\s*(?:can|could|would|will)\s+you\s+(?:please\s+)?(?:append|add|insert|create|generate|write|draft|prepare|produce|include|use)\b/iu;
const ORDERED_ENGLISH_NEGATION = /\b(?:not|never|without|don't|doesn't|didn't|can't|cannot|won't|wouldn't|shouldn't|mustn't|must\s+not|do\s+not|no)\b/iu;
const ORDERED_ENGLISH_ACTION = /\b(?:append|add|insert|create|generate|write|draft|prepare|produce|include|use)\b/giu;
const HEADING_OMISSION_PREFIX = /\b(?:do\s+not|don't|must\s+not|should\s+not|never)\s+(?:include|use|add|create|append|insert|list)\s+(?:(?:the|a|an)\s+)?(?:(?:heading|section)\s+)?[\s"'“‘「『]*$/iu;
// Keep the list cue explicit; punctuation alone or arbitrary text must not open a heading list.
const COUNTED_HEADING_POSITION_CUE = "(?:at\\s+(?:the\\s+)?(?:document\\s+)?(?:end|bottom)|in\\s+order|在(?:文档)?末(?:尾)?|文末|末尾)";
const COUNTED_HEADING_ORDER_CUE = "(?:按顺序|依次)(?:\\s*(?:为|是))?";
const COUNTED_HEADING_LIST_SEPARATOR = new RegExp(
  `^\\s*(?:(?:[,，]\\s*)?(?:${COUNTED_HEADING_POSITION_CUE}|${COUNTED_HEADING_ORDER_CUE})[\\s,，]*)*[:：]\\s*`, "iu"
);

function spans(source: string, from: number, to: number): InstructionSpan[] {
  return from < to ? [{ from, to, raw: source.slice(from, to) }] : [];
}

function maskRange(chars: string[], source: string, from: number, to: number): void {
  for (let index = from; index < to; index += 1) {
    if (source[index] !== "\n" && source[index] !== "\r") chars[index] = " ";
  }
}

function maskMarkdownCodeSamples(source: string): string {
  const chars = source.split("");
  let offset = 0;
  while (offset < source.length) {
    const lineEnd = source.indexOf("\n", offset);
    const end = lineEnd < 0 ? source.length : lineEnd;
    const line = source.slice(offset, end).replace(/\r$/u, "");
    const opening = /^ {0,3}(`{3,}|~{3,})/u.exec(line);
    if (!opening) { offset = lineEnd < 0 ? source.length : lineEnd + 1; continue; }
    const marker = opening[1];
    const character = marker[0];
    let closeStart = lineEnd < 0 ? source.length : lineEnd + 1;
    let closeEnd = source.length;
    while (closeStart < source.length) {
      const nextEnd = source.indexOf("\n", closeStart);
      const nextLineEnd = nextEnd < 0 ? source.length : nextEnd;
      const nextLine = source.slice(closeStart, nextLineEnd).replace(/\r$/u, "");
      const closing = new RegExp(`^ {0,3}${character}{${marker.length},}[\\t ]*$`, "u").test(nextLine);
      if (closing) { closeEnd = nextEnd < 0 ? nextLineEnd : nextEnd + 1; break; }
      if (nextEnd < 0) break;
      closeStart = nextEnd + 1;
    }
    maskRange(chars, source, offset, closeEnd);
    offset = closeEnd;
  }

  const fencedMasked = chars.join("");
  let cursor = 0;
  while (cursor < fencedMasked.length) {
    if (fencedMasked[cursor] !== "`") { cursor += 1; continue; }
    let runEnd = cursor + 1;
    while (fencedMasked[runEnd] === "`") runEnd += 1;
    const marker = fencedMasked.slice(cursor, runEnd);
    let search = runEnd;
    let close = -1;
    while (search < fencedMasked.length) {
      const candidate = fencedMasked.indexOf("`", search);
      if (candidate < 0) break;
      let candidateEnd = candidate + 1;
      while (fencedMasked[candidateEnd] === "`") candidateEnd += 1;
      if (candidateEnd - candidate === marker.length) { close = candidateEnd; break; }
      search = candidateEnd;
    }
    if (close < 0) { cursor = runEnd; continue; }
    maskRange(chars, source, cursor, close);
    cursor = close;
  }
  return chars.join("");
}

function numberValue(raw: string): number | undefined {
  const value = raw.toLocaleLowerCase();
  return /^\d+$/u.test(value) ? Number(value) : CHINESE_NUMBER[value] ?? ENGLISH_NUMBER[value];
}

function levelValue(raw: string): HeadingLevel | undefined {
  const match = /(?:H\s*([1-6])|level\s*([1-6])|([1-6])(?:st|nd|rd|th)[ -]?level|([一二三四五六1-6])\s*级)/iu.exec(raw);
  if (!match) return undefined;
  const value = match.slice(1).find(Boolean)!;
  const level = /^\d$/u.test(value) ? Number(value) : CHINESE_NUMBER[value];
  return level >= 1 && level <= 6 ? level as HeadingLevel : undefined;
}

function isUnpermittedHeadingQuestion(masked: string, sentenceStart: number): boolean {
  const sentenceEnd = sentenceLimit(masked, sentenceStart);
  const sentence = masked.slice(sentenceStart, Math.min(masked.length, sentenceEnd + 1));
  return /[?？]/u.test(sentence) &&
    (!ORDERED_ENGLISH_POLITE_REQUEST.test(sentence) || ORDERED_ENGLISH_NEGATION.test(sentence));
}

function descriptorMatches(masked: string): DescriptorMatch[] {
  const found: DescriptorMatch[] = [];
  for (const pattern of [...DESCRIPTORS, ...UNCOUNTED_DESCRIPTORS]) {
    pattern.lastIndex = 0;
    for (const match of masked.matchAll(pattern)) {
      const rawCount = match.groups?.count;
      const from = match.index ?? 0;
      const to = from + match[0].length;
      let clauseStart = 0;
      for (const boundary of masked.slice(0, from).matchAll(/[。！？.!?；;\r\n]/gu)) {
        clauseStart = (boundary.index ?? 0) + boundary[0].length;
      }
      const prefix = masked.slice(clauseStart, from);
      const actionRegex = new RegExp(CREATE_VERB.source, "giu");
      const actionMatches = [...prefix.matchAll(actionRegex)];
      const action = actionMatches.at(-1);
      if (!action || isNegatedMention(masked, from, to) || isArtifactUsageQuestion(masked) ||
          DIRECT_HEADING_CONDITIONAL.test(prefix) || isUnpermittedHeadingQuestion(masked, clauseStart)) continue;
      const verbFrom = clauseStart + (action.index ?? 0);
      const verbTo = verbFrom + action[0].length;
      if (isNegatedMention(masked, verbFrom, verbTo)) continue;

      const levelRaw = match.groups?.level;
      const countFrom = rawCount ? from + match[0].indexOf(rawCount) : undefined;
      const levelFrom = levelRaw ? from + match[0].indexOf(levelRaw, rawCount ? match[0].indexOf(rawCount) + rawCount.length : 0) : undefined;
      const count = rawCount ? numberValue(rawCount) : undefined;
      if ((count !== undefined && count < 2) || (rawCount && count === undefined) ||
          (!levelRaw && countFrom !== undefined && /H$/iu.test(masked.slice(Math.max(0, countFrom - 1), countFrom)))) continue;
      found.push({ from, to, ...(count !== undefined ? { count } : {}),
        ...(countFrom !== undefined && rawCount ? { countFrom, countTo: countFrom + rawCount.length } : {}),
        ...(levelRaw && levelFrom !== undefined ? { level: levelValue(levelRaw), levelFrom, levelTo: levelFrom + levelRaw.length } : {}) });
    }
  }
  return found.sort((a, b) => a.from - b.from || a.to - b.to);
}

function sentenceLimit(masked: string, from: number): number {
  for (let index = from; index < masked.length; index += 1) if (SENTENCE_END.test(masked[index])) return index;
  return masked.length;
}

function sentenceLimitOutsideQuotes(source: string, from: number, quotes: ReturnType<typeof scanInstructionQuotes>): number {
  for (let index = from; index < source.length; index += 1) {
    const quote = quotes.find(item => index >= item.from - 1 && index < item.to + 1);
    if (quote) { index = quote.to; continue; }
    if (SENTENCE_END.test(source[index])) return index;
  }
  return source.length;
}

function firstUnquotedOrderMarker(
  source: string,
  from: number,
  quotes: ReturnType<typeof scanInstructionQuotes>
): RegExpExecArray | undefined {
  const limit = sentenceLimitOutsideQuotes(source, from, quotes);
  const pattern = new RegExp(ORDERED_ENGLISH_HEADING_MARKER.source, "giu");
  pattern.lastIndex = from;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) && match.index < limit) {
    const end = match.index + match[0].length;
    if (end <= limit && !quotes.some(quote => match!.index < quote.to + 1 && end > quote.from - 1)) return match;
  }
  return undefined;
}

function separatorAt(source: string, index: number, end: number): number {
  const match = new RegExp(SEPARATOR.source, "iy");
  match.lastIndex = index;
  const found = match.exec(source.slice(0, end));
  return found?.[0].length ?? 0;
}

function headingText(source: string, from: number, to: number): TextEvidence | undefined {
  let start = from;
  let end = to;
  while (start < end && /\s/u.test(source[start])) start += 1;
  while (end > start && /\s/u.test(source[end - 1])) end -= 1;
  if (start >= end) return undefined;
  const raw = source.slice(start, end);
  const quote = scanInstructionQuotes(raw)[0];
  if (quote && quote.from === 1 && quote.to === raw.length - 1) {
    return { value: quote.value, evidence: [{ from: start, to: end, raw }] };
  }
  const value = raw.replace(/^(?:and|以及|和|及)\s*/iu, "").replace(/\s*(?:and|以及|和|及)$/iu, "").trim();
  if (!value || BODY_ACTION.test(value)) return undefined;
  const offset = raw.indexOf(value);
  return { value, evidence: [{ from: start + offset, to: start + offset + value.length, raw: value }] };
}

function listValues(source: string, masked: string, start: number, quotes: ReturnType<typeof scanInstructionQuotes>, listLimit?: number): { values: TextEvidence[]; end: number; trailingAction: boolean } {
  const limit = Math.min(sentenceLimit(masked, start), listLimit ?? masked.length);
  const values: TextEvidence[] = [];
  let cursor = start;
  let trailingAction = false;
  while (cursor < limit) {
    while (cursor < limit && /\s/u.test(source[cursor])) {
      const separator = separatorAt(source, cursor, limit);
      if (separator) { cursor += separator; break; }
      cursor += 1;
    }
    if (OUTPUT_ONLY.test(source.slice(cursor, limit).trimStart())) break;
    let length = separatorAt(source, cursor, limit);
    if (length) { cursor += length; continue; }
    const nextQuote = quotes.find(quote => quote.from - 1 >= cursor && quote.from - 1 < limit);
    const quoteStart = nextQuote ? nextQuote.from - 1 : limit;
    let delimiter = quoteStart;
    let separatorLength = 0;
    for (let index = cursor; index < quoteStart; index += 1) {
      if (SENTENCE_END.test(source[index])) { delimiter = index; break; }
      const found = separatorAt(source, index, limit);
      if (found) { delimiter = index; separatorLength = found; break; }
    }
    if (cursor === quoteStart && nextQuote) {
      const text = headingText(source, quoteStart, nextQuote.to + 1);
      if (text) values.push(text);
      cursor = nextQuote.to + 1;
      continue;
    }
    const token = headingText(source, cursor, delimiter);
    if (!token) {
      const between = source.slice(cursor, delimiter);
      if (BODY_ACTION.test(between.trim())) { trailingAction = true; break; }
      if (!values.length && between.trim()) return { values, end: delimiter, trailingAction: false };
      cursor = separatorLength ? delimiter + separatorLength : delimiter;
      if (cursor >= limit) break;
      continue;
    }
    if (BODY_ACTION.test(token.value)) {
      trailingAction = true;
      break;
    }
    values.push(token);
    cursor = separatorLength ? delimiter + separatorLength : delimiter;
    if (!separatorLength) break;
  }
  return { values, end: cursor, trailingAction };
}

function isSafeOrderedEnglishList(masked: string, from: number, to: number, listFrom: number, listTo: number): boolean {
  const controlsOnly = `${masked.slice(0, listFrom)}${" ".repeat(listTo - listFrom)}${masked.slice(listTo)}`;
  let sentenceStart = 0;
  let sentenceEnd = controlsOnly.length;
  const boundaries = /[。！？.!?；;\r\n]/gu;
  for (const match of controlsOnly.matchAll(boundaries)) {
    const index = match.index ?? 0;
    const end = index + match[0].length;
    if (end <= from) sentenceStart = end;
    else if (index >= to) { sentenceEnd = end; break; }
  }

  const sentence = controlsOnly.slice(sentenceStart, sentenceEnd);
  if (ORDERED_ENGLISH_CONDITIONAL.test(sentence)) return false;
  const question = /[?？]/u.test(sentence);
  if (question && (!ORDERED_ENGLISH_POLITE_REQUEST.test(sentence) || ORDERED_ENGLISH_NEGATION.test(sentence))) return false;

  const prefix = controlsOnly.slice(sentenceStart, from);
  const action = [...prefix.matchAll(new RegExp(ORDERED_ENGLISH_ACTION.source, "giu"))].at(-1);
  const actionFrom = action ? sentenceStart + (action.index ?? 0) : from;
  const actionTo = action ? actionFrom + action[0].length : to;
  return !isNegatedMention(controlsOnly, actionFrom, actionTo);
}

function orderedEnglishHeadingList(
  instruction: string,
  codeMasked: string,
  masked: string,
  quotes: ReturnType<typeof scanInstructionQuotes>
): ArtifactHeadingListEvidence | undefined {
  const prefixes = new RegExp(ORDERED_ENGLISH_HEADING_PREFIX.source, "giu");
  for (const prefix of codeMasked.matchAll(prefixes)) {
    const from = prefix.index ?? 0;
    const prefixEnd = from + prefix[0].length;
    if (quotes.some(quote => from < quote.to + 1 && prefixEnd > quote.from - 1)) continue;
    const initialListStart = prefixEnd;
    const preposedCandidate = ORDERED_ENGLISH_PREPOSED_MARKER.exec(codeMasked.slice(initialListStart));
    const preposedEnd = preposedCandidate ? initialListStart + preposedCandidate[0].length : initialListStart;
    const preposedQuoted = preposedCandidate && quotes.some(quote =>
      initialListStart < quote.to + 1 && preposedEnd > quote.from - 1);
    const preposed = preposedCandidate && !preposedQuoted ? preposedCandidate : undefined;
    const marker = preposed ? undefined : firstUnquotedOrderMarker(codeMasked, initialListStart, quotes);
    if (!preposed && !marker) continue;

    const listStart = preposed ? preposedEnd : initialListStart;
    const parsed = listValues(instruction, masked, listStart, quotes, marker?.index);
    const listEnd = preposed ? parsed.end : marker!.index;
    const to = preposed ? parsed.end : listEnd + marker![0].length;
    const safe = isSafeOrderedEnglishList(masked, from, to, listStart, listEnd);
    if (!safe) continue;
    if (parsed.values.length < 2 || parsed.values.some(({ value }) => value.length > 64 || /[\r\n#`<>]/u.test(value))) continue;

    const levelRaw = prefix.groups?.level;
    const levelOffset = levelRaw ? prefix[0].indexOf(levelRaw) : -1;
    const levelFrom = levelOffset >= 0 ? from + levelOffset : undefined;
    const level = levelRaw ? levelValue(levelRaw) : undefined;
    const levelTokens = [...masked.slice(Math.max(0, from - 24), listStart).matchAll(/(?:H\s*[1-6]|level\s*[1-6]|[1-6](?:st|nd|rd|th)[ -]?level|[一二三四五六1-6]\s*级)/giu)]
      .map(match => levelValue(match[0])).filter((value): value is HeadingLevel => value !== undefined);
    const levelConflict = new Set(levelTokens).size > 1;
    const issues: ArtifactHeadingListEvidence["issues"][number][] = [];
    if (levelConflict) issues.push("conflicting_heading_levels");
    if (parsed.values.length > 8) issues.push("heading_list_too_long");
    const headings = parsed.values.map(text => ({
      ...(level !== undefined && levelFrom !== undefined
        ? { level: { value: level, evidence: spans(instruction, levelFrom, levelFrom + levelRaw!.length) } } : {}),
      text
    }));
    return {
      recognized: true,
      headings,
      issues,
      onlyHeadings: !parsed.trailingAction && onlyHeadings(masked, to, levelConflict)
    };
  }
  return undefined;
}

function hasExplicitHeadingOmission(instruction: string, masked: string, headings: readonly ArtifactHeading[]): boolean {
  for (const heading of headings) {
    const text = heading.text;
    if (!text) continue;
    const escaped = text.value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const labelPattern = new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, "giu");
    for (const match of instruction.matchAll(labelPattern)) {
      const from = match.index ?? 0;
      if (HEADING_OMISSION_PREFIX.test(masked.slice(Math.max(0, from - 96), from))) return true;
    }
  }
  return false;
}

function directlyCreatesHeadings(masked: string, descriptor: DescriptorMatch): boolean {
  if (descriptor.count === undefined) return false;
  let clauseStart = 0;
  for (const boundary of masked.slice(0, descriptor.from).matchAll(/[。！？.!?；;\r\n]/gu)) {
    clauseStart = (boundary.index ?? 0) + boundary[0].length;
  }
  const prefix = masked.slice(clauseStart, descriptor.from);
  const action = [...prefix.matchAll(new RegExp(DIRECT_HEADING_CREATION.source, "giu"))].at(-1);
  if (!action) return false;
  const actionFrom = clauseStart + (action.index ?? 0);
  const actionTo = actionFrom + action[0].length;
  if (prefix.slice(actionTo - clauseStart).trim() || isNegatedMention(masked, actionFrom, actionTo)) return false;
  if (BODY_PROSE_CREATION.test(masked.slice(0, actionFrom))) return false;
  return !DIRECT_HEADING_CONDITIONAL.test(prefix) && !isUnpermittedHeadingQuestion(masked, clauseStart);
}

function onlyHeadings(masked: string, listEnd: number, levelConflict: boolean, directCreation = false): boolean {
  if (levelConflict) return false;
  const suffix = masked.slice(listEnd).trim().replace(/^[,，、;；.。\s]+/u, "");
  if (suffix) return ONLY_HEADINGS.test(suffix);
  return directCreation;
}

/** Parses an explicitly created, counted heading list while retaining the original spans. */
export function resolveArtifactHeadingList(instruction: string): ArtifactHeadingListEvidence {
  const codeMasked = maskMarkdownCodeSamples(instruction);
  const quotes = scanInstructionQuotes(codeMasked);
  const masked = maskQuotedInstruction(codeMasked, quotes);
  const orderedEnglish = orderedEnglishHeadingList(instruction, codeMasked, masked, quotes);
  if (orderedEnglish) {
    if (hasExplicitHeadingOmission(instruction, masked, orderedEnglish.headings)) {
      return { recognized: false, headings: [], issues: [], onlyHeadings: false };
    }
    return orderedEnglish;
  }
  const descriptor = descriptorMatches(masked)[0];
  if (!descriptor) return { recognized: false, headings: [], issues: [], onlyHeadings: false };

  let listStart = descriptor.to;
  const separator = COUNTED_HEADING_LIST_SEPARATOR.exec(codeMasked.slice(listStart));
  if (!separator) return { recognized: false, headings: [], issues: [], onlyHeadings: false };
  listStart += separator[0].length;
  const parsed = listValues(instruction, masked, listStart, quotes);
  const headings: ArtifactHeading[] = parsed.values.map(text => ({
    ...(descriptor.level !== undefined && descriptor.levelFrom !== undefined && descriptor.levelTo !== undefined
      ? { level: { value: descriptor.level, evidence: spans(instruction, descriptor.levelFrom, descriptor.levelTo) } } : {}),
    text
  }));
  const issues: ArtifactHeadingListEvidence["issues"][number][] = [];
  const levelTokens = [...masked.slice(Math.max(0, descriptor.from - 24), descriptor.to).matchAll(/(?:H\s*[1-6]|level\s*[1-6]|[一二三四五六1-6]\s*级)/giu)]
    .map(match => levelValue(match[0])).filter((value): value is HeadingLevel => value !== undefined);
  const levelConflict = new Set(levelTokens).size > 1;
  if (levelConflict) issues.push("conflicting_heading_levels");
  if (headings.length > 8 || (descriptor.count ?? 0) > 8) issues.push("heading_list_too_long");
  if (descriptor.count !== undefined && !headings.length) issues.push("incomplete_heading_list");
  else if (descriptor.count !== undefined && descriptor.count !== headings.length) issues.push("heading_count_mismatch");
  if (descriptor.count === undefined && headings.length < 2) return { recognized: false, headings: [], issues: [], onlyHeadings: false };
  const declaredCount = descriptor.count !== undefined && descriptor.countFrom !== undefined && descriptor.countTo !== undefined
    ? { value: descriptor.count, evidence: spans(instruction, descriptor.countFrom, descriptor.countTo) } : undefined;
  if (hasExplicitHeadingOmission(instruction, masked, headings)) {
    return { recognized: false, headings: [], issues: [], onlyHeadings: false };
  }
  return {
    recognized: true,
    headings,
    ...(declaredCount ? { declaredCount } : {}),
    issues,
    onlyHeadings: !parsed.trailingAction && onlyHeadings(masked, parsed.end, levelConflict,
      directlyCreatesHeadings(masked, descriptor))
  };
}
