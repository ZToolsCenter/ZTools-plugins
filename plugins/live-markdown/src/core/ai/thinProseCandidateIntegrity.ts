import { validateMarkdownAstIntegrity } from "./markdownAstIntegrity";
import { validateProseDateFactLedger } from "./proseDateOwnership";
import { validateProseReplacementFacts } from "./proseEditFactGuard";
import { bindProseRequestMarkerProofs, type ProseRequestMarkerBoundProof, type ProseRequestMarkerSourceProof } from "./proseRequestMarkerProof";
import type { ThinProseScopeContext, ThinProseSlot } from "./thinProseSlots";

interface Range { from: number; to: number; }
const MAX_CANDIDATE_BYTES = 1024 * 1024;
const ENCODER = new TextEncoder();

export interface AssembledThinProseCandidate {
  text: string;
  editableBytes: number;
  editedBytes: number;
  candidateRanges?: ReadonlyMap<string, Range>;
}

function byteLength(value: string): number { return ENCODER.encode(value).byteLength; }

export function assembleThinProseCandidate(source: string, slots: readonly ThinProseSlot[], edits: ReadonlyMap<string, string>,
  proofSlotIds: ReadonlySet<string> = new Set()): AssembledThinProseCandidate {
  const pieces: string[] = [];
  const candidateRanges = proofSlotIds.size ? new Map<string, Range>() : undefined;
  let cursor = 0, outputOffset = 0, outputBytes = 0, editableBytes = 0, editedBytes = 0;
  const append = (value: string) => {
    outputBytes += byteLength(value);
    if (outputBytes > MAX_CANDIDATE_BYTES) throw new Error("润色候选超过 1 MiB 安全上限，原文未修改。");
    pieces.push(value);
    outputOffset += value.length;
  };
  for (const slot of slots) {
    if (slot.range.from < cursor || slot.range.to > source.length) throw new Error("正文槽源码范围重叠或越界，原文未修改。");
    const replacement = edits.get(slot.id);
    if (replacement === undefined) throw new Error("正文润色未覆盖全部文本槽，原文未修改。");
    append(source.slice(cursor, slot.range.from));
    const candidateFrom = outputOffset;
    append(replacement);
    if (candidateRanges && proofSlotIds.has(slot.id)) candidateRanges.set(slot.id, { from: candidateFrom, to: outputOffset });
    cursor = slot.range.to;
    editableBytes += byteLength(slot.sourceText);
    editedBytes += byteLength(replacement);
  }
  append(source.slice(cursor));
  return { text: pieces.join(""), editableBytes, editedBytes, ...(candidateRanges ? { candidateRanges } : {}) };
}

function translatedFacts(facts: ReturnType<typeof dateFacts>, offset: number) {
  return facts.map(fact => ({
    ...fact,
    scope: { from: fact.scope.from + offset, to: fact.scope.to + offset },
    date: { ...fact.date, from: fact.date.from + offset, to: fact.date.to + offset },
    owner: { ...fact.owner, from: fact.owner.from + offset, to: fact.owner.to + offset },
    event: { ...fact.event, from: fact.event.from + offset, to: fact.event.to + offset }
  }));
}

function dateFacts(slots: readonly ThinProseSlot[]) {
  return slots.flatMap(slot => slot.dateOwnerFact ? [slot.dateOwnerFact] : [])
    .filter((fact, index, all) => all.findIndex(other => other.id === fact.id) === index);
}

export function validateThinProseCandidateIntegrity(input: {
  source: string;
  candidate: AssembledThinProseCandidate;
  slots: readonly ThinProseSlot[];
  scopeContext?: ThinProseScopeContext;
  requestMarkerProofs?: readonly ProseRequestMarkerSourceProof[];
}): void {
  const { source, candidate, slots, scopeContext, requestMarkerProofs = [] } = input;
  const facts = dateFacts(slots);
  const hasDuplicateSentenceOwnership = slots.some(slot => Boolean(slot.duplicateSentenceRun));
  if (!facts.length && !hasDuplicateSentenceOwnership && !requestMarkerProofs.length) return;

  let fullSource: string;
  let fullCandidate: string;
  let scopeOffset = 0;
  let candidateTaskRange: Range;
  if (!scopeContext) {
    fullSource = source;
    fullCandidate = candidate.text;
    candidateTaskRange = { from: 0, to: candidate.text.length };
  } else {
    const { document, range } = scopeContext;
    if (!Number.isSafeInteger(range.from) || !Number.isSafeInteger(range.to) || range.from < 0 ||
        range.from > range.to || range.to > document.length || document.slice(range.from, range.to) !== source) {
      throw new Error("校对范围与冻结文档不一致，原文未修改。");
    }
    scopeOffset = range.from;
    fullSource = document;
    fullCandidate = document.slice(0, range.from) + candidate.text + document.slice(range.to);
    candidateTaskRange = { from: range.from, to: range.from + candidate.text.length };
  }

  let boundProofs: readonly ProseRequestMarkerBoundProof[] | undefined;
  if (requestMarkerProofs.length) {
    const proofSlotIds = new Set(requestMarkerProofs.map(proof => proof.slotId));
    const sourceSlotRanges = new Map(slots.filter(slot => proofSlotIds.has(slot.id)).map(slot => [slot.id, {
      from: scopeOffset + slot.range.from, to: scopeOffset + slot.range.to
    }]));
    const candidateSlotRanges = new Map([...candidate.candidateRanges ?? []].map(([slotId, range]) => [slotId, {
      from: scopeOffset + range.from, to: scopeOffset + range.to
    }]));
    boundProofs = bindProseRequestMarkerProofs(requestMarkerProofs, {
      fullSource, fullCandidate, sourceSlotRanges, candidateSlotRanges, candidateTaskRange
    });
  }

  validateProseReplacementFacts(fullSource, fullCandidate, boundProofs
    ? { requestMarkerProofs: boundProofs, requestMarkerProofStage: "full-document" } : {});
  if (facts.length) validateProseDateFactLedger(fullSource, fullCandidate, scopeContext ? translatedFacts(facts, scopeOffset) : facts);
  validateMarkdownAstIntegrity(fullSource, fullCandidate, true);
}

export function thinProseLengthWarnings(editableBytes: number, editedBytes: number): string[] {
  if (editableBytes > 0 && editedBytes > editableBytes * 1.75 + 256) return ["润色后的正文长度明显增加，请检查是否加入了原文没有的内容。"];
  return [];
}
