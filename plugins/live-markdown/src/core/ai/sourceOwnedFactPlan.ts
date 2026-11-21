import type { IntentTask } from "./intentTypes";
import { joinOwnedDateRange, validateProseDateOwnerReplacement, type ProseDateOwnerFact } from "./proseDateOwnership";
import { sourceOwnedFactAuthorization, type SourceOwnedFactAuthorization, type SourceOwnedFactAuthority } from "./sourceOwnedFactAuthority";
import { verifiedThinProseSlotBatch, type SourceOwnedCandidateGroup } from "./thinProseSlotBatchProvenance";
import type { ReadableProsePlan } from "./readableProsePlan";
import type { ThinProseScopeContext, ThinProseSlot } from "./thinProseSlots";
import type { ReadableProseTaskInput } from "./readableProseTask";

const MAX_PROGRAM_FACTS = 50;

export interface SourceOwnedFactPlanInput {
  readonly authority?: SourceOwnedFactAuthority;
  readonly source: string;
  readonly instruction: string;
  readonly systemPrompt: string;
  readonly skill?: ReadableProseTaskInput["skill"];
  readonly task?: IntentTask;
  readonly scopeContext?: ThinProseScopeContext;
  readonly originalSlots: readonly ThinProseSlot[];
  readonly readablePlan: ReadableProsePlan | null;
}

export interface SourceOwnedFactDecision {
  readonly authorization: SourceOwnedFactAuthorization;
  readonly task: "polish" | "proofread";
  readonly slotId: string;
  readonly sourceRange: Readonly<{ from: number; to: number }>;
  readonly sourceText: string;
  readonly outputText: string;
  readonly formatter: "explicit-routine-style-source-copy" | "polish-preserve-source-bytes" |
    "proofread-ascii-space-after-copula" | "proofread-preserve-fullwidth-colon";
  readonly fact: ProseDateOwnerFact;
}

export interface PreparedSourceOwnedFactPlan {
  readonly plan: ReadableProsePlan;
  readonly decisions: readonly SourceOwnedFactDecision[];
}

export interface SourceOwnedReadableInput extends ReadableProseTaskInput {
  readonly source: string;
  readonly task?: IntentTask;
  readonly scopeContext?: ThinProseScopeContext;
  readonly sourceOwnedFactAuthority?: SourceOwnedFactAuthority;
}

interface ProgramEntry {
  readonly decision: SourceOwnedFactDecision;
  readonly factShape: string;
}

export interface PreparedSourceOwnedFactBinding {
  readonly plan: ReadableProsePlan;
  readonly entries: readonly ProgramEntry[];
  readonly source: string;
  readonly instruction: string;
  readonly task: "polish" | "proofread";
  readonly systemPrompt: string;
  readonly skillShape: string;
  readonly scopeShape: string;
  readonly authorization: SourceOwnedFactAuthorization;
  readonly authority: SourceOwnedFactAuthority;
}

const preparedBindings = new WeakMap<object, PreparedSourceOwnedFactBinding>();

function sameFact(left: ProseDateOwnerFact, right: ProseDateOwnerFact): boolean {
  return factShape(left) === factShape(right);
}

function factShape(fact: ProseDateOwnerFact): string {
  return JSON.stringify({ id: fact.id, scope: fact.scope, date: fact.date, owner: fact.owner, event: fact.event });
}

function immutableFact(fact: ProseDateOwnerFact): ProseDateOwnerFact {
  return Object.freeze({ id: fact.id, scope: Object.freeze({ ...fact.scope }),
    date: Object.freeze({ ...fact.date }), owner: Object.freeze({ ...fact.owner }),
    event: Object.freeze({ ...fact.event }) });
}

function skillShape(skill: ReadableProseTaskInput["skill"]): string {
  return JSON.stringify(skill ? { id: skill.id, category: skill.category, systemPrompt: skill.systemPrompt,
    userPromptTemplate: skill.userPromptTemplate } : null);
}

function scopeShape(scope?: ThinProseScopeContext): string {
  return scope ? JSON.stringify({ document: scope.document, range: scope.range }) : "implicit-full-document";
}

function escapeRegExp(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"); }

type FactFormatter = SourceOwnedFactDecision["formatter"];

function exactClosedFactWindow(source: string, slot: ThinProseSlot, candidate: SourceOwnedCandidateGroup): boolean {
  const fact = slot.dateOwnerFact;
  if (!fact || !sameFact(fact, candidate.fact) || slot.range.from < fact.scope.from || slot.range.to > fact.scope.to ||
      source.slice(slot.range.from, slot.range.to) !== slot.sourceText ||
      candidate.parts.some(part => part.hasDuplicateOwnership)) return false;
  const joined = joinOwnedDateRange(source, candidate.parts.map(part => ({ from: part.from, to: part.to })), candidate.fact);
  if (!joined || joined.from > slot.range.from || joined.to < slot.range.to) return false;
  const range = slot.range;
  if (fact.owner.from < range.from || fact.owner.to > fact.date.from || fact.event.from !== fact.owner.to ||
      fact.event.to > fact.date.from || fact.date.from < range.from || fact.date.to > range.to ||
      source.slice(fact.date.from, fact.date.to) !== fact.date.sourceSurface ||
      !/^\d{4}-\d{2}-\d{2}$/u.test(fact.date.iso) || fact.date.iso !== fact.date.sourceSurface) return false;
  const ownerSurface = source.slice(fact.owner.from, fact.owner.to);
  const owner = new RegExp(`^(?:由\\p{Zs}*)?${escapeRegExp(fact.owner.value)}\\p{Zs}*负责的$`, "u");
  if (!owner.test(ownerSurface) || !/^\p{Zs}*$/u.test(source.slice(range.from, fact.owner.from))) return false;
  const eventSurface = source.slice(fact.event.from, fact.event.to);
  if (eventSurface !== fact.event.value || !/^\p{Script=Han}{1,24}$/u.test(eventSurface)) return false;
  const between = source.slice(fact.owner.to, fact.date.from);
  const structure = new RegExp(`^\\p{Zs}*(?:由\\p{Zs}*)?${escapeRegExp(fact.owner.value)}\\p{Zs}*负责的` +
    `${escapeRegExp(eventSurface)}(?:日期|时间)(?:是|为|[:：])\\p{Zs}*${escapeRegExp(fact.date.iso)}` +
    `\\p{Zs}*[。！？!?]?\\p{Zs}*$`, "u");
  return structure.test(slot.sourceText) && between.startsWith(eventSurface) &&
    /^\p{Zs}*[。！？!?]?\p{Zs}*$/u.test(source.slice(fact.date.to, range.to));
}

function copyOrFormatFact(sourceText: string, slot: ThinProseSlot, task: "polish" | "proofread",
  authorization: SourceOwnedFactAuthorization, fact: ProseDateOwnerFact): { outputText: string; formatter: FactFormatter } | undefined {
  if (authorization === "explicit-routine-style-source-copy") {
    try {
      if (validateProseDateOwnerReplacement(fact, sourceText, sourceText) !== sourceText) return undefined;
      return { outputText: sourceText, formatter: "explicit-routine-style-source-copy" };
    } catch { return undefined; }
  }
  if (task === "polish") return { outputText: sourceText, formatter: "polish-preserve-source-bytes" };
  const dateOffset = fact.date.from - slot.range.from;
  const beforeDate = sourceText.slice(0, dateOffset);
  const copula = /(?<mark>是|为|:|：)\p{Zs}*$/u.exec(beforeDate);
  if (!copula?.groups?.mark) return undefined;
  const mark = copula.groups.mark;
  const useSpace = mark !== "：";
  const replacement = useSpace
    ? `${beforeDate.slice(0, beforeDate.length - copula[0].length)}${mark} ${sourceText.slice(dateOffset)}`
    : sourceText;
  try {
    if (validateProseDateOwnerReplacement(fact, sourceText, replacement) !== replacement) return undefined;
  } catch { return undefined; }
  return { outputText: replacement, formatter: useSpace
    ? "proofread-ascii-space-after-copula" : "proofread-preserve-fullwidth-colon" };
}

function wholeDocument(scope: ThinProseScopeContext | undefined, source: string): boolean {
  return scope === undefined || scope.document === source && scope.range.from === 0 && scope.range.to === source.length;
}

/** Builds sidecar source-owned edits from the already-validated slot batch and readable plan. */
export function prepareSourceOwnedFactPlan(input: SourceOwnedFactPlanInput): PreparedSourceOwnedFactPlan | undefined {
  try {
  const task = input.task;
  if (!input.readablePlan || !input.authority || (task !== "polish" && task !== "proofread") ||
      !wholeDocument(input.scopeContext, input.source) || input.originalSlots.length === 0) return undefined;
  const authorization = sourceOwnedFactAuthorization(input.authority, { source: input.source,
    instruction: input.instruction, task, effectiveSystemPrompt: input.systemPrompt,
    skill: input.skill, scopeContext: input.scopeContext });
  if (!authorization) return undefined;
  const candidates = verifiedThinProseSlotBatch(input.originalSlots, { source: input.source,
    instruction: input.instruction, systemContext: `${input.systemPrompt}\n${input.skill?.systemPrompt ?? ""}`,
    scopeContext: input.scopeContext });
  if (!candidates?.length || candidates.length > MAX_PROGRAM_FACTS) return undefined;

  const planned = input.readablePlan.slots.filter(slot => slot.dateOwnerFact);
  if (planned.length !== candidates.length || planned.some(slot => {
    const candidate = candidates.find(item => item.fact.id === slot.dateOwnerFact?.id);
    return !candidate || !exactClosedFactWindow(input.source, slot, candidate);
  })) return undefined;
  const entries: ProgramEntry[] = [];
  for (const slot of planned) {
    const plannedFact = slot.dateOwnerFact!;
    const group = candidates.find(candidate => candidate.fact.id === plannedFact.id);
    if (!group || !sameFact(group.fact, plannedFact) || entries.some(entry => entry.decision.slotId === slot.id)) return undefined;
    const fact = immutableFact(group.fact);
    const owners = input.readablePlan.jobs.filter(job => job.slotIds.includes(slot.id));
    if (owners.length !== 1) return undefined;
    const owner = owners[0]!;
    if (owner.kind === "literal" || owner.slotIds.length !== 1 || owner.slotIds[0] !== slot.id ||
        owner.view.text !== slot.sourceText || owner.view.readonlyPlaceholders.length ||
        owner.view.decode(owner.view.text).get(slot.id) !== slot.sourceText) return undefined;
    const output = copyOrFormatFact(slot.sourceText, slot, task, authorization, fact);
    if (!output) return undefined;
    const decision = Object.freeze({ authorization, task, slotId: slot.id,
      sourceRange: Object.freeze({ ...slot.range }), sourceText: slot.sourceText,
      outputText: output.outputText, formatter: output.formatter, fact });
    entries.push(Object.freeze({ decision, factShape: factShape(fact) }));
  }
  if (!entries.length || input.readablePlan.jobs.some(job => job.slotIds.some(id =>
      entries.some(entry => entry.decision.slotId === id) && job.slotIds.length !== 1))) return undefined;
  const programIds = new Set(entries.map(entry => entry.decision.slotId));
  const hasOrdinaryModelJob = input.readablePlan.jobs.some(job => job.kind !== "literal" && !job.slotIds.some(id => programIds.has(id)));
  if (!hasOrdinaryModelJob) return undefined;

  const prepared = Object.freeze({ plan: input.readablePlan,
    decisions: Object.freeze(entries.map(entry => entry.decision)) });
  preparedBindings.set(prepared, Object.freeze({ plan: input.readablePlan, entries: Object.freeze(entries),
    source: input.source, instruction: input.instruction, task, systemPrompt: input.systemPrompt,
    skillShape: skillShape(input.skill), scopeShape: scopeShape(input.scopeContext), authorization,
    authority: input.authority }));
  return prepared;
  } catch {
    return undefined;
  }
}

export function readPreparedSourceOwnedFactBinding(prepared: PreparedSourceOwnedFactPlan): PreparedSourceOwnedFactBinding | undefined {
  return prepared && (typeof prepared === "object" || typeof prepared === "function")
    ? preparedBindings.get(prepared) : undefined;
}
