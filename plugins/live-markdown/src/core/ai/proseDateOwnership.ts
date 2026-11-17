import { proseEditProtectedRanges } from "./proseEditProtectedRanges";
import { restoreUniqueEquivalentIsoDate, scanProseDateSurfaces, type ReadonlyProseSpan } from "./proseFactSurface";

export interface ProseDateOwnerFact {
  readonly id: string;
  readonly scope: ReadonlyProseSpan;
  readonly date: ReadonlyProseSpan & { readonly iso: string; readonly sourceSurface: string };
  readonly owner: ReadonlyProseSpan & { readonly value: string; readonly relation: "responsible-attributive" };
  readonly event: ReadonlyProseSpan & { readonly value: string };
}

export interface ProseDateOwnerViewFact {
  readonly fact: ProseDateOwnerFact;
  readonly slotId: string;
  readonly dateViewRange: ReadonlyProseSpan;
}

export interface ProseDateOwnedRange extends ReadonlyProseSpan {
  readonly fact: ProseDateOwnerFact;
}

const MAX_OWNER_SCOPE_CODEPOINTS = 256;
const OWNER_RELATION = /(?:由[\t ]*)?(?<name>[\p{Script=Han}]{2,4})[\t ]*负责的/gu;
const EVENT_DATE_CUE = /^(?<event>[\p{Script=Han}]{1,24}?)(?:日期|时间)(?:是|为|[:：])?\p{Zs}*$/u;
const SOURCE_NEGATION_OR_STATUS = /不(?=\p{Script=Han})|没(?=\p{Script=Han})|未(?=\p{Script=Han})|不能|不可|无法|禁止|严禁|并非|不是|无|完成|做完|通过|失败|成功|取消|批准|上线|离线|待定|已/u;
const AMBIGUOUS_OWNER_LEAD = /^(?:请|让|使|要求|安排|委托|指定)[\p{Script=Han}]{2,4}负责的/u;
const RESPONSIBILITY_ACTION = /(?<lead>由|交给|交由)?[\p{Script=Han}]{2,4}[\t ]*(?:负责|担任|承接|承担|主责|主办|经办|跟进|处理|审核|复核|检查|执行|管理|维护|协调)/gu;
const QUOTE_OR_INLINE_SYNTAX = /[`*_~\[\]{}<>\\$|“”‘’「」『』《》〈〉"']/u;
const BLOCK_MARKDOWN = /^\s{0,3}(?:#{1,6}(?:\s|$)|>|[-+*]\s|\d+[.)]\s|\|.*\|\s*$|(?:```|~~~))/u;
const CLAUSE_PUNCTUATION = /[，,。；;！？!?]/u;

function codePointLength(text: string): number { return Array.from(text).length; }

function isHorizontalSpaceOnly(text: string): boolean { return /^\p{Zs}*$/u.test(text); }

function trimHorizontalSpace(text: string): string {
  return text.replace(/^\p{Zs}+|\p{Zs}+$/gu, "");
}

function overlaps(left: ReadonlyProseSpan, right: ReadonlyProseSpan): boolean {
  return left.from < right.to && left.to > right.from;
}

function ownerRelations(text: string): Array<{ from: number; to: number; value: string }> {
  OWNER_RELATION.lastIndex = 0;
  return [...text.matchAll(OWNER_RELATION)].map(match => ({
    from: match.index ?? 0,
    to: (match.index ?? 0) + match[0].length,
    value: match.groups!.name!
  }));
}

function exactSourceRange(source: string, range: ReadonlyProseSpan): boolean {
  return Number.isSafeInteger(range.from) && Number.isSafeInteger(range.to) &&
    range.from >= 0 && range.from < range.to && range.to <= source.length;
}

/** Expands only across a complete date atom already enclosed by one source-plan slot. */
export function joinOwnedDateRange(
  source: string,
  parts: readonly ReadonlyProseSpan[],
  fact: ProseDateOwnerFact
): ProseDateOwnedRange | null {
  let beforeIndex = -1;
  let afterIndex = -1;
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index]!;
    if (part.to <= fact.date.from) beforeIndex = index;
    if (afterIndex < 0 && part.from >= fact.date.to) afterIndex = index;
  }
  if (beforeIndex < 0) return null;
  const before = parts[beforeIndex]!;
  if (!/^\p{Zs}*$/u.test(source.slice(before.to, fact.date.from))) return null;
  if (afterIndex >= 0) {
    const after = parts[afterIndex]!;
    if (afterIndex !== beforeIndex + 1 || !/^\p{Zs}*$/u.test(source.slice(fact.date.to, after.from))) return null;
    return { from: before.from, to: after.to, fact };
  }
  return { from: before.from, to: fact.date.to, fact };
}

/** Returns a narrow date-owner fact only for one complete, ordinary source-planned slot. */
export function findEligibleProseDateOwner(input: {
  source: string;
  sourcePlanRange: ReadonlyProseSpan;
  astSyntaxRanges: readonly ReadonlyProseSpan[];
}): ProseDateOwnerFact | null {
  const { source, sourcePlanRange } = input;
  if (!exactSourceRange(source, sourcePlanRange)) return null;
  const text = source.slice(sourcePlanRange.from, sourcePlanRange.to);
  if (/[\r\n\p{Cc}\p{Zl}\p{Zp}]/u.test(text) || codePointLength(text) > MAX_OWNER_SCOPE_CODEPOINTS) return null;
  if (BLOCK_MARKDOWN.test(text) || QUOTE_OR_INLINE_SYNTAX.test(text) ||
      /[\p{Script=Latin}\p{Script=Greek}\p{Extended_Pictographic}\p{S}]/u.test(text) ||
      SOURCE_NEGATION_OR_STATUS.test(text)) return null;
  if (input.astSyntaxRanges.some(range => overlaps(range, sourcePlanRange))) return null;

  const dates = scanProseDateSurfaces(text, sourcePlanRange.from);
  if (dates.length !== 1 || dates[0]!.format !== "iso" || !dates[0]!.safe) return null;
  const date = dates[0]!;
  // The scope is capped at 256 code points; never rescan the complete document once per slot.
  const protectedFacts = proseEditProtectedRanges(text, sourcePlanRange.from);
  if (protectedFacts.length !== 1 || protectedFacts[0]!.from !== date.from || protectedFacts[0]!.to !== date.to) return null;

  const relations = ownerRelations(text);
  if (relations.length !== 1) return null;
  const relation = relations[0]!;
  RESPONSIBILITY_ACTION.lastIndex = 0;
  for (const match of text.matchAll(RESPONSIBILITY_ACTION)) {
    const isPrimaryOwner = match.index === relation.from &&
      match[0].replace(/^(?:由|交给|交由)/u, "").startsWith(relation.value);
    if (!isPrimaryOwner) return null;
  }
  if (AMBIGUOUS_OWNER_LEAD.test(text)) return null;
  const ownerRange = { from: sourcePlanRange.from + relation.from, to: sourcePlanRange.from + relation.to };
  if (ownerRange.to > date.from || !/^\p{Zs}*$/u.test(source.slice(sourcePlanRange.from, ownerRange.from))) return null;
  const relationSurface = source.slice(ownerRange.to, date.from);
  const eventCue = EVENT_DATE_CUE.exec(relationSurface);
  if (!eventCue?.groups?.event || CLAUSE_PUNCTUATION.test(relationSurface)) return null;
  const event = eventCue.groups.event;
  const eventFrom = ownerRange.to;

  return {
    id: `prose-date-owner:${sourcePlanRange.from}:${date.from}:${date.to}`,
    scope: { ...sourcePlanRange },
    date: { from: date.from, to: date.to, iso: date.iso, sourceSurface: date.text },
    owner: { ...ownerRange, value: relation.value, relation: "responsible-attributive" },
    event: { from: eventFrom, to: eventFrom + event.length, value: event }
  };
}

function rejectDateOwnerChange(): never {
  throw new Error("正文日期、负责人或事件关系发生变化，原文未修改。");
}

function punctuationOutsideDate(text: string, dates: readonly { from: number; to: number }[]): string[] {
  let value = text;
  for (const date of [...dates].sort((left, right) => right.from - left.from)) {
    value = value.slice(0, date.from) + value.slice(date.to);
  }
  return [...value.matchAll(/[\p{P}\p{S}]/gu)].map(([token]) => token);
}

function same<T>(left: readonly T[], right: readonly T[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/** Validates an owner/date slot, allowing only source spelling, copula, or exact event/date reordering. */
export function validateProseDateOwnerReplacement(
  fact: ProseDateOwnerFact,
  sourceView: string,
  replacementView: string
): string {
  const sourceDates = scanProseDateSurfaces(sourceView);
  if (sourceDates.length !== 1 || !sourceDates[0]!.safe || sourceDates[0]!.iso !== fact.date.iso ||
      sourceDates[0]!.text !== fact.date.sourceSurface) return rejectDateOwnerChange();
  const sourceOwners = ownerRelations(sourceView);
  if (sourceOwners.length !== 1 || sourceOwners[0]!.value !== fact.owner.value) return rejectDateOwnerChange();
  const sourceOwner = sourceOwners[0]!;
  const sourceBeforeDate = sourceView.slice(sourceOwner.to, sourceDates[0]!.from);
  const sourceConstruction = new RegExp(`^${escapeRegExp(fact.event.value)}(?:日期|时间)(?:是|为|[:：])?\\p{Zs}*$`, "u");
  if (!sourceConstruction.test(sourceBeforeDate)) return rejectDateOwnerChange();

  const normalized = restoreUniqueEquivalentIsoDate(sourceView, replacementView, [sourceDates[0]!]);
  const candidateDates = scanProseDateSurfaces(normalized);
  const candidateOwners = ownerRelations(normalized);
  if (candidateDates.length !== 1 || !candidateDates[0]!.safe || candidateDates[0]!.iso !== fact.date.iso ||
      candidateOwners.length !== 1 || candidateOwners[0]!.value !== fact.owner.value) return rejectDateOwnerChange();
  const candidateDate = candidateDates[0]!;
  const candidateOwner = candidateOwners[0]!;
  const sourceClauseEnd = sourceView.slice(sourceDates[0]!.to).search(CLAUSE_PUNCTUATION);
  const candidateClauseEnd = normalized.slice(candidateDate.to).search(CLAUSE_PUNCTUATION);
  const sourceSuffix = sourceClauseEnd < 0 ? "" : sourceView.slice(sourceDates[0]!.to + sourceClauseEnd);
  const candidateSuffix = candidateClauseEnd < 0 ? "" : normalized.slice(candidateDate.to + candidateClauseEnd);
  if (sourceSuffix !== candidateSuffix) return rejectDateOwnerChange();
  if (candidateOwner.from !== sourceOwner.from || candidateOwner.to > candidateDate.from ||
      normalized.slice(0, candidateOwner.from) !== sourceView.slice(0, sourceOwner.from)) return rejectDateOwnerChange();

  const clauseSuffix = candidateClauseEnd < 0 ? normalized.slice(candidateDate.to)
    : normalized.slice(candidateDate.to, candidateDate.to + candidateClauseEnd);
  const beforeDate = normalized.slice(candidateOwner.to, candidateDate.from);
  const sourceCopula = sourceBeforeDate.match(/(?:日期|时间)(是|为|[:：])?\p{Zs}*$/u)?.[1] ?? "";
  const candidateCopula = beforeDate.match(/(?:日期|时间)(是|为|[:：])?\p{Zs}*$/u)?.[1] ?? "";
  const sourceOrderKeepsCopula = sourceCopula === "" ? candidateCopula === ""
    : sourceCopula === "是" || sourceCopula === "为" ? candidateCopula === "是" || candidateCopula === "为"
      : candidateCopula === sourceCopula;
  const exactSourceOrder = sourceConstruction.test(beforeDate) && isHorizontalSpaceOnly(clauseSuffix);
  const eventBeforeDate = trimHorizontalSpace(beforeDate) === fact.event.value && isHorizontalSpaceOnly(clauseSuffix);
  const eventAfterDate = isHorizontalSpaceOnly(beforeDate) && trimHorizontalSpace(clauseSuffix) === fact.event.value;
  if (!((exactSourceOrder && sourceOrderKeepsCopula) || eventBeforeDate || eventAfterDate)) return rejectDateOwnerChange();
  if (!same(punctuationOutsideDate(sourceView, sourceDates), punctuationOutsideDate(normalized, candidateDates))) {
    return rejectDateOwnerChange();
  }
  return normalized;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/** Preserves the full document's ordered date values and every non-owned spelling. */
export function validateProseDateFactLedger(
  source: string,
  candidate: string,
  ownedFacts: readonly ProseDateOwnerFact[]
): void {
  if (!ownedFacts.length) return;
  const sourceDates = scanProseDateSurfaces(source);
  const candidateDates = scanProseDateSurfaces(candidate);
  if (sourceDates.length !== candidateDates.length) return rejectDateOwnerChange();
  for (let index = 0; index < sourceDates.length; index += 1) {
    const before = sourceDates[index]!;
    const after = candidateDates[index]!;
    if (before.iso !== after.iso) return rejectDateOwnerChange();
    const owned = ownedFacts.some(fact => fact.date.from === before.from && fact.date.to === before.to);
    if (!owned && before.text !== after.text) return rejectDateOwnerChange();
  }
  if (ownedFacts.some(fact => !sourceDates.some(date => date.from === fact.date.from && date.to === fact.date.to))) {
    return rejectDateOwnerChange();
  }
}
