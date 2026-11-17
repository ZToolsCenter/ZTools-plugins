import type { ThinProseSlot } from "./thinProseSlots";
import { joinOwnedDateRange } from "./proseDateOwnership";
import { groupAuthorizedDuplicateSentenceRun, type ProseDuplicateScopeContext } from "./proseDuplicateOwnership";
import { splitHanFactCommaWindows } from "./proseClauseWindows";
import { createReadonlyCommaBoundary, type ReadonlyCommaBoundary } from "./readableClauseBoundary";
import {
  prepareReadableProse,
  readableProseSentenceWindows,
  type ReadableProseView,
  type ReadableProseWindow
} from "./readableProseView";

const MAX_JOBS = 50;
const MAX_SOURCE_SLOTS = 50_000;
const MAX_SOURCE_WINDOW_CODEPOINTS = 256;
const CONTEXT_CODEPOINTS = 48;

interface LineGroup {
  range: ReadableProseWindow;
  slots: ThinProseSlot[];
}

interface PlannedPiece {
  originId: string;
  slot: ThinProseSlot;
}

export interface ReadableProsePlanJob {
  /** Missing on older callers means a model job. */
  kind?: "model" | "literal";
  view: ReadableProseView;
  slotIds: string[];
  /** Exact source boundary from the Han fact/comma planner, never a model-proposed split. */
  commaBoundary?: ReadonlyCommaBoundary;
}

export interface ReadableProsePlan {
  /** New exact-range ownership slots; replacing their ranges reconstructs the original source. */
  slots: ThinProseSlot[];
  /** Bounded sentence or physical-line calls, each owning only its listed slots. */
  jobs: ReadableProsePlanJob[];
}

function sourceBoundarySpaces(source: string, window: ReadableProseWindow): { prefix: string; suffix: string } {
  const value = source.slice(window.from, window.to);
  return {
    prefix: value.match(/^\p{Zs}+/u)?.[0] ?? "",
    suffix: value.match(/\p{Zs}+$/u)?.[0] ?? ""
  };
}

function preserveSourceBoundarySpaces(
  view: ReadableProseView,
  spaces: { prefix: string; suffix: string }
): ReadableProseView {
  return {
    ...view,
    decode(raw) {
      if (!raw.trim()) return view.decode(raw);
      const body = raw.replace(/^\p{Zs}+/u, "").replace(/\p{Zs}+$/u, "");
      if (!body.trim()) return view.decode(raw);
      return view.decode(`${spaces.prefix}${body}${spaces.suffix}`);
    }
  };
}

function physicalLine(source: string, offset: number): ReadableProseWindow {
  const from = Math.max(source.lastIndexOf("\n", offset - 1), source.lastIndexOf("\r", offset - 1)) + 1;
  const cr = source.indexOf("\r", offset), lf = source.indexOf("\n", offset);
  return { from, to: Math.min(cr < 0 ? source.length : cr, lf < 0 ? source.length : lf) };
}

function codePointLength(value: string): number { return Array.from(value).length; }

function expandDateOwnerCandidates(source: string, slots: readonly ThinProseSlot[]): ThinProseSlot[] | null {
  const candidateGroups = new Map<string, { fact: NonNullable<ThinProseSlot["dateOwnerCandidate"]>; slots: ThinProseSlot[] }>();
  for (const slot of slots) {
    const fact = slot.dateOwnerCandidate;
    if (!fact) continue;
    const group = candidateGroups.get(fact.id) ?? { fact, slots: [] };
    if (group.fact.scope.from !== fact.scope.from || group.fact.scope.to !== fact.scope.to ||
        group.fact.date.from !== fact.date.from || group.fact.date.to !== fact.date.to ||
        group.fact.date.iso !== fact.date.iso || group.fact.owner.value !== fact.owner.value || group.fact.event.value !== fact.event.value) return null;
    group.slots.push(slot);
    candidateGroups.set(fact.id, group);
  }
  if (!candidateGroups.size) return [...slots];

  const removed = new Set<string>();
  const added: ThinProseSlot[] = [];
  for (const [id, group] of candidateGroups) {
    const parts = [...group.slots].sort((left, right) => left.range.from - right.range.from);
    if (!parts.length || parts.some(slot => slot.range.from < group.fact.scope.from || slot.range.to > group.fact.scope.to ||
        source.slice(slot.range.from, slot.range.to) !== slot.sourceText)) return null;
    const joined = joinOwnedDateRange(source, parts.map(({ range }) => range), group.fact);
    if (!joined) return null;
    const existing = slots.filter(slot => !slot.dateOwnerCandidate && slot.range.from < joined.to && slot.range.to > joined.from);
    if (existing.length) return null;
    parts.forEach(slot => removed.add(slot.id));
    added.push({
      id: `date-owner-${id}`,
      range: { from: joined.from, to: joined.to },
      sourceText: source.slice(joined.from, joined.to),
      contextBefore: parts[0]!.contextBefore,
      contextAfter: parts.at(-1)!.contextAfter,
      dateOwnerFact: group.fact
    });
  }
  return [...slots.filter(slot => !removed.has(slot.id)).map(({ dateOwnerCandidate: _candidate, ...slot }) => slot), ...added]
    .sort((left, right) => left.range.from - right.range.from || left.range.to - right.range.to);
}

function shortContext(source: string, window: ReadableProseWindow, from: number, to: number): { before: string; after: string } {
  const before = source.slice(window.from, from);
  const after = source.slice(to, window.to);
  return {
    before: Array.from(before).slice(-CONTEXT_CODEPOINTS).join("").trim(),
    after: Array.from(after).slice(0, CONTEXT_CODEPOINTS).join("").trim()
  };
}

function validateSourceSlots(source: string, slots: readonly ThinProseSlot[]): LineGroup[] | null {
  if (!slots.length || slots.length > MAX_SOURCE_SLOTS) return null;
  const ids = new Set<string>();
  const groups = new Map<string, LineGroup>();
  let previousEnd = -1;
  for (const slot of slots) {
    if (!slot.id || ids.has(slot.id) || !Number.isSafeInteger(slot.range.from) || !Number.isSafeInteger(slot.range.to) ||
        slot.range.from < 0 || slot.range.from >= slot.range.to || slot.range.to > source.length || slot.range.from < previousEnd ||
        source.slice(slot.range.from, slot.range.to) !== slot.sourceText || /[\r\n]/u.test(slot.sourceText)) return null;
    ids.add(slot.id);
    previousEnd = slot.range.to;
    const range = physicalLine(source, slot.range.from);
    if (slot.range.to > range.to) return null;
    const key = `${range.from}:${range.to}`;
    const group = groups.get(key) ?? { range, slots: [] };
    group.slots.push(slot);
    groups.set(key, group);
  }
  return [...groups.values()].sort((left, right) => left.range.from - right.range.from);
}

function makePieces(
  source: string,
  window: ReadableProseWindow,
  sourceSlots: readonly ThinProseSlot[],
  jobIndex: number,
  usedIds: Set<string>
): PlannedPiece[] | null {
  const pieces: PlannedPiece[] = [];
  let low = 0, high = sourceSlots.length;
  while (low < high) {
    const middle = low + ((high - low) >> 1);
    if (sourceSlots[middle]!.range.to <= window.from) low = middle + 1;
    else high = middle;
  }
  for (let index = low; index < sourceSlots.length && sourceSlots[index]!.range.from < window.to; index += 1) {
    const original = sourceSlots[index]!;
    const from = Math.max(original.range.from, window.from);
    const to = Math.min(original.range.to, window.to);
    if (from >= to) continue;
    const id = `readable-plan-${jobIndex + 1}-${pieces.length + 1}-${original.id}`;
    if (usedIds.has(id)) return null;
    usedIds.add(id);
    const context = shortContext(source, window, from, to);
    const slot: ThinProseSlot = {
      id,
      range: { from, to },
      sourceText: source.slice(from, to),
      contextBefore: context.before,
      contextAfter: context.after,
      ...(original.dateOwnerFact && original.dateOwnerFact.date.from >= from && original.dateOwnerFact.date.to <= to
        ? { dateOwnerFact: original.dateOwnerFact }
        : {})
    };
    if (original.duplicateSentenceRun) {
      if (from !== original.range.from || to !== original.range.to) return null;
      slot.duplicateSentenceRun = original.duplicateSentenceRun;
    }
    if (original.dateOwnerFact && original.dateOwnerFact.date.from < to && original.dateOwnerFact.date.to > from &&
        !(original.dateOwnerFact.date.from >= from && original.dateOwnerFact.date.to <= to)) return null;
    pieces.push({ originId: original.id, slot });
  }
  return pieces;
}

function coalesceSentenceWindows(
  source: string,
  sentenceWindows: readonly ReadableProseWindow[],
  slots: readonly ThinProseSlot[]
): ReadableProseWindow[] | null {
  const result: ReadableProseWindow[] = [];
  let current: ReadableProseWindow | undefined;
  let currentLength = 0;
  let slotIndex = 0;
  const flush = () => {
    if (current) result.push(current);
    current = undefined;
    currentLength = 0;
  };

  for (const window of sentenceWindows) {
    while (slotIndex < slots.length && slots[slotIndex]!.range.to <= window.from) slotIndex += 1;
    const candidate = slots[slotIndex];
    const ownsText = Boolean(candidate && candidate.range.from < window.to && candidate.range.to > window.from);
    if (!ownsText) { flush(); continue; }
    const length = codePointLength(source.slice(window.from, window.to));
    if (length > MAX_SOURCE_WINDOW_CODEPOINTS) return null;
    if (current && current.to === window.from && currentLength + length <= MAX_SOURCE_WINDOW_CODEPOINTS) {
      current.to = window.to;
      currentLength += length;
      continue;
    }
    flush();
    current = { ...window };
    currentLength = length;
  }
  flush();
  return result.length ? result : null;
}

function hasExactCoverage(originalSlots: readonly ThinProseSlot[], pieces: readonly PlannedPiece[], source: string): boolean {
  const piecesByOrigin = new Map<string, ThinProseSlot[]>();
  for (const { originId, slot } of pieces) {
    const owned = piecesByOrigin.get(originId) ?? [];
    owned.push(slot);
    piecesByOrigin.set(originId, owned);
  }
  for (const original of originalSlots) {
    const owned = (piecesByOrigin.get(original.id) ?? []).sort((left, right) => left.range.from - right.range.from);
    if (!owned.length || owned[0]!.range.from !== original.range.from || owned.at(-1)!.range.to !== original.range.to) return false;
    for (let index = 0; index < owned.length; index += 1) {
      const slot = owned[index]!;
      if (slot.sourceText !== source.slice(slot.range.from, slot.range.to) ||
          (index > 0 && owned[index - 1]!.range.to !== slot.range.from)) return false;
    }
    if (original.dateOwnerFact) {
      const factPieces = pieces.filter(({ originId, slot }) => originId === original.id && slot.dateOwnerFact?.id === original.dateOwnerFact!.id);
      if (factPieces.length !== 1 || factPieces[0]!.slot.range.from > original.dateOwnerFact.date.from ||
          factPieces[0]!.slot.range.to < original.dateOwnerFact.date.to) return false;
    }
  }
  return pieces.length > 0;
}

function buildWindowJobs(
  source: string,
  windows: readonly (ReadableProseWindow & { kind?: "model" | "literal" })[],
  sourceSlots: readonly ThinProseSlot[],
  jobOffset: number,
  usedIds: ReadonlySet<string>,
  attachCommaBoundaries = false
): { jobs: ReadableProsePlanJob[]; pieces: PlannedPiece[]; usedIds: Set<string> } | null {
  const jobs: ReadableProsePlanJob[] = [];
  const pieces: PlannedPiece[] = [];
  const nextUsedIds = new Set(usedIds);
  for (const [index, window] of windows.entries()) {
    const jobPieces = makePieces(source, window, sourceSlots, jobOffset + jobs.length, nextUsedIds);
    if (!jobPieces) return null;
    if (!jobPieces.length) continue;
    const jobSlots = jobPieces.map(({ slot }) => slot);
    const baseView = prepareReadableProse(source, jobSlots, window);
    if (!baseView) return null;
    const kind = window.kind ?? "model";
    const nextWindow = windows[index + 1];
    const commaBoundary = attachCommaBoundaries && kind === "model" && nextWindow?.kind === "literal"
      ? createReadonlyCommaBoundary(source, window, nextWindow) : undefined;
    jobs.push({ kind, view: preserveSourceBoundarySpaces(baseView, sourceBoundarySpaces(source, window)),
      slotIds: jobSlots.map(({ id }) => id), ...(commaBoundary ? { commaBoundary } : {}) });
    pieces.push(...jobPieces);
  }
  return { jobs, pieces, usedIds: nextUsedIds };
}

/** Pre-plans complete, bounded prose calls before inference; unsafe or over-budget input returns null. */
function buildReadableProsePlan(source: string, slots: readonly ThinProseSlot[]): ReadableProsePlan | null {
  const candidateGroups = validateSourceSlots(source, slots);
  if (!candidateGroups) return null;
  const sourceSlots = expandDateOwnerCandidates(source, slots);
  if (!sourceSlots) return null;
  const groups = validateSourceSlots(source, sourceSlots);
  if (!groups) return null;

  const jobs: ReadableProsePlanJob[] = [];
  const pieces: PlannedPiece[] = [];
  const usedIds = new Set<string>();
  for (const group of groups) {
    const sentenceWindows = readableProseSentenceWindows(source, group.range);
    if (!sentenceWindows) return null;
    const wholeLine = prepareReadableProse(source, group.slots);
    const splitLine = sentenceWindows.length > 1 && (!wholeLine || wholeLine.readonlyPlaceholders.length > 0);
    const windows = splitLine
      ? wholeLine ? sentenceWindows : coalesceSentenceWindows(source, sentenceWindows, group.slots)
      : [group.range];
    if (!windows) return null;
    const clauseWindows = splitHanFactCommaWindows(source, group.range, group.slots, windows, MAX_SOURCE_WINDOW_CODEPOINTS);
    const candidateWindows = clauseWindows?.map(({ kind, range }) => ({ ...range, kind }));
    const candidate = candidateWindows && jobs.length + candidateWindows.length <= MAX_JOBS
      ? buildWindowJobs(source, candidateWindows, group.slots, jobs.length, usedIds, true)
      : null;
    const planned = candidate ?? buildWindowJobs(source, windows, group.slots, jobs.length, usedIds);
    if (!planned) return null;
    jobs.push(...planned.jobs);
    pieces.push(...planned.pieces);
    usedIds.clear();
    for (const id of planned.usedIds) usedIds.add(id);
    if (jobs.length > MAX_JOBS) return null;
  }

  if (!jobs.length || !hasExactCoverage(sourceSlots, pieces, source)) return null;
  const plannedSlots = pieces.map(({ slot }) => slot).sort((left, right) => left.range.from - right.range.from);
  if (plannedSlots.some((slot, index) => index > 0 && plannedSlots[index - 1]!.range.to > slot.range.from)) return null;
  if (plannedSlots.some(({ sourceText }) => codePointLength(sourceText) === 0)) return null;
  return { slots: plannedSlots, jobs };
}

export interface ReadableProsePlanOptions {
  instruction?: string;
  scopeContext?: ProseDuplicateScopeContext;
}

/** Pre-plans complete, bounded prose calls; explicit duplicate removal adds one source-proven logical slot. */
export function planReadableProse(
  source: string,
  slots: readonly ThinProseSlot[],
  options?: ReadableProsePlanOptions
): ReadableProsePlan | null {
  const originalPlan = buildReadableProsePlan(source, slots);
  if (!originalPlan || !options?.instruction) return originalPlan;
  const grouped = groupAuthorizedDuplicateSentenceRun(source, slots, options.instruction, options.scopeContext);
  if (!grouped) return originalPlan;
  const groupedPlan = buildReadableProsePlan(source, grouped);
  if (!groupedPlan) return originalPlan;
  const groupedSlots = grouped.filter(slot => slot.duplicateSentenceRun);
  for (const slot of groupedSlots) {
    const planned = groupedPlan.slots.filter(piece => piece.duplicateSentenceRun?.sourceRange.from === slot.range.from &&
      piece.duplicateSentenceRun.sourceRange.to === slot.range.to);
    const owners = groupedPlan.jobs.filter(job => job.slotIds.some(id => planned.some(piece => piece.id === id)));
    if (planned.length !== 1 || owners.length !== 1 ||
        owners[0]!.view.decode(owners[0]!.view.text).get(planned[0]!.id) !== slot.sourceText) return originalPlan;
  }
  return groupedPlan;
}
