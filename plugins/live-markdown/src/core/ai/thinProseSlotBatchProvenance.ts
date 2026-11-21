import type { ProseDateOwnerFact } from "./proseDateOwnership";
import type { ThinProseScopeContext, ThinProseSlot } from "./thinProseSlots";

const MAX_OWNED_FACTS = 50;
const MAX_FACT_SLOT_PARTS = 4;

export interface ThinProseSlotBatchInput {
  readonly source: string;
  readonly instruction: string;
  readonly systemContext: string;
  readonly scopeContext?: ThinProseScopeContext;
  readonly fullDocumentAstValidated: boolean;
}

export interface SourceOwnedCandidateGroup {
  readonly fact: ProseDateOwnerFact;
  readonly parts: readonly Readonly<{ id: string; from: number; to: number; sourceText: string; hasDuplicateOwnership: boolean }>[];
}

interface BatchRecord extends ThinProseSlotBatchInput {
  readonly candidates: readonly SourceOwnedCandidateGroup[];
  readonly scopeFrom: 0;
  readonly scopeTo: number;
}

const batches = new WeakMap<readonly ThinProseSlot[], BatchRecord>();

function cloneFact(fact: ProseDateOwnerFact): ProseDateOwnerFact {
  return Object.freeze({ id: fact.id,
    scope: Object.freeze({ ...fact.scope }),
    date: Object.freeze({ ...fact.date }),
    owner: Object.freeze({ ...fact.owner }),
    event: Object.freeze({ ...fact.event }) });
}

function factShape(fact: ProseDateOwnerFact): string {
  return JSON.stringify({ id: fact.id, scope: fact.scope, date: fact.date, owner: fact.owner, event: fact.event });
}

function wholeScope(source: string, scope?: ThinProseScopeContext): boolean {
  return scope === undefined || scope.document === source && scope.range.from === 0 && scope.range.to === source.length;
}

function candidateGroups(slots: readonly ThinProseSlot[], source: string): SourceOwnedCandidateGroup[] | undefined {
  const groups = new Map<string, { fact: ProseDateOwnerFact; parts: Array<{
    id: string; from: number; to: number; sourceText: string; hasDuplicateOwnership: boolean
  }> }>();
  for (const slot of slots) {
    const fact = slot.dateOwnerCandidate;
    if (!fact) continue;
    if (!slot.id || slot.dateOwnerFact || !Number.isSafeInteger(slot.range.from) || !Number.isSafeInteger(slot.range.to) ||
        slot.range.from < 0 || slot.range.from >= slot.range.to || slot.range.to > source.length ||
        source.slice(slot.range.from, slot.range.to) !== slot.sourceText ||
        slot.range.from < fact.scope.from || slot.range.to > fact.scope.to) return undefined;
    const group = groups.get(fact.id) ?? { fact, parts: [] };
    if (factShape(group.fact) !== factShape(fact)) return undefined;
    group.parts.push({ id: slot.id, from: slot.range.from, to: slot.range.to, sourceText: slot.sourceText,
      hasDuplicateOwnership: Boolean(slot.duplicateSentenceRun) });
    groups.set(fact.id, group);
    if (groups.size > MAX_OWNED_FACTS || group.parts.length > MAX_FACT_SLOT_PARTS) return undefined;
  }
  return [...groups.values()].map(({ fact, parts }) => Object.freeze({
    fact: cloneFact(fact),
    parts: Object.freeze(parts.sort((left, right) => left.from - right.from).map(part => Object.freeze({ ...part })))
  }));
}

/** Registers only bounded date-owner candidate evidence on the slots array that owns it. */
export function registerThinProseSlotBatch(slots: readonly ThinProseSlot[], input: ThinProseSlotBatchInput): void {
  if (!slots.length || !input.fullDocumentAstValidated || !wholeScope(input.source, input.scopeContext)) return;
  const candidates = candidateGroups(slots, input.source);
  if (!candidates?.length) return;
  const record: BatchRecord = Object.freeze({ source: input.source, instruction: input.instruction,
    systemContext: input.systemContext, fullDocumentAstValidated: true,
    ...(input.scopeContext ? { scopeContext: Object.freeze({ document: input.source,
      range: Object.freeze({ from: 0, to: input.source.length }) }) } : {}),
    scopeFrom: 0, scopeTo: input.source.length, candidates: Object.freeze(candidates) });
  batches.set(slots, record);
}

/** Returns the immutable AST-bound candidate evidence only if every candidate slot still matches. */
export function verifiedThinProseSlotBatch(
  slots: readonly ThinProseSlot[],
  input: Omit<ThinProseSlotBatchInput, "fullDocumentAstValidated">
): readonly SourceOwnedCandidateGroup[] | undefined {
  const record = batches.get(slots);
  if (!record || record.source !== input.source || record.instruction !== input.instruction ||
      record.systemContext !== input.systemContext || input.source.length !== record.scopeTo ||
      !wholeScope(input.source, input.scopeContext)) return undefined;
  const actual = candidateGroups(slots, input.source);
  if (!actual || actual.length !== record.candidates.length) return undefined;
  for (let index = 0; index < actual.length; index += 1) {
    const before = record.candidates[index]!, after = actual[index]!;
    if (factShape(before.fact) !== factShape(after.fact) || before.parts.length !== after.parts.length) return undefined;
    for (let part = 0; part < before.parts.length; part += 1) {
      const left = before.parts[part]!, right = after.parts[part]!;
      if (left.id !== right.id || left.from !== right.from || left.to !== right.to || left.sourceText !== right.sourceText ||
          left.hasDuplicateOwnership !== right.hasDuplicateOwnership) return undefined;
    }
  }
  return record.candidates;
}
