export type ApprovalStateKind = "required" | "recommended" | "completed" | "pending" | "opaque";

export interface ApprovalStateMarker {
  from: number;
  to: number;
  state: ApprovalStateKind;
  /** Exact sentence retained when a construction cannot be classified safely. */
  raw?: string;
}

interface StateRule {
  state: Exclude<ApprovalStateKind, "opaque">;
  expression: RegExp;
}

const STATE_RULES: readonly StateRule[] = [
  { state: "pending", expression: /\bpending\s+approvals?\b/giu },
  { state: "pending", expression: /\bapprovals?\s+(?:(?:is|are)\s+)?pending\b/giu },
  { state: "pending", expression: /\bawait(?:s|ed|ing)?\s+approvals?\b/giu },
  { state: "pending", expression: /\bwait(?:s|ed|ing)?\s+for\s+approvals?\b/giu },
  { state: "required", expression: /\b(?:need(?:s)?|require(?:s)?)\s+approvals?\b/giu },
  { state: "required", expression: /\b(?:need(?:s)?|require(?:s)?)\s+to\s+be\s+approved\b/giu },
  { state: "required", expression: /\bmust\s+be\s+approved\b/giu },
  { state: "required", expression: /\b(?:has|have)\s+to\s+be\s+approved\b/giu },
  { state: "required", expression: /\b(?:is|are)\s+required\s+to\s+be\s+approved\b/giu },
  { state: "recommended", expression: /\bshould\s+be\s+approved\b/giu },
  { state: "recommended", expression: /\bought\s+to\s+be\s+approved\b/giu },
  { state: "recommended", expression: /\bshould\s+have\s+approvals?\b/giu },
  { state: "recommended", expression: /\bought\s+to\s+have\s+approvals?\b/giu },
  { state: "completed", expression: /\b(?:is|are|was|were)\s+(?:already\s+)?approved\b/giu },
  { state: "completed", expression: /\b(?:has|have)\s+(?:already\s+)?been\s+approved\b/giu },
  { state: "completed", expression: /\balready\s+approved\b/giu }
];

const APPROVAL_CUE = /\bapprovals?\b|\bapproved\b/giu;
const APPROVAL_CUE_PRESENT = /\bapprovals?\b|\bapproved\b/iu;
const APPROVAL_CUE_IN_PHRASE = /approvals?|approved/iu;
const UNSUPPORTED_GOVERNOR = /\b(?:can|could|may|might|will|would|must|should|ought|shall|do|does|did)\b|\b(?:need(?:s)?|has|have|had)\s+to\b/giu;
const CONDITIONAL = /\b(?:if|when|whenever|unless|until|provided|assuming|in\s+case)\b/iu;
const NEGATION = /\b(?:not|never|no|none|nothing|neither|nobody|no\s+one|cannot|can't|don't|doesn't|didn't|won't|wouldn't|shouldn't|mustn't|isn't|aren't|wasn't|weren't|hasn't|haven't|without)\b/iu;
const NEGATION_SPANS = new RegExp(NEGATION.source, "giu");
const INTERROGATIVE = /\?\s*$/u;
const SENTENCE_BOUNDARY = /[.!?](?=\s|$)|\r\n|\r|\n/gu;
const CLAUSE_BOUNDARY = /[,;:，；：—–]/gu;

interface SentenceRange {
  from: number;
  to: number;
  raw: string;
}

interface RuleMatch extends ApprovalStateMarker {
  state: Exclude<ApprovalStateKind, "opaque">;
  cueFrom: number;
  cueTo: number;
}

interface TextSpan {
  from: number;
  to: number;
}

interface SentenceIndex {
  from: number;
  clauseBoundaries: readonly TextSpan[];
  negations: readonly TextSpan[];
  unconsumedGovernors: readonly number[];
}

function sentenceRanges(text: string): SentenceRange[] {
  const ranges: SentenceRange[] = [];
  let cursor = 0;
  for (const match of text.matchAll(SENTENCE_BOUNDARY)) {
    const boundaryFrom = match.index ?? cursor;
    const boundaryTo = boundaryFrom + match[0].length;
    if (boundaryTo > cursor) ranges.push({ from: cursor, to: boundaryTo, raw: text.slice(cursor, boundaryTo) });
    cursor = boundaryTo;
  }
  if (cursor < text.length) ranges.push({ from: cursor, to: text.length, raw: text.slice(cursor) });
  return ranges;
}

function matchesForSentence(sentence: SentenceRange): RuleMatch[] {
  const matches: RuleMatch[] = [];
  for (const rule of STATE_RULES) {
    for (const match of sentence.raw.matchAll(rule.expression)) {
      const from = sentence.from + (match.index ?? 0);
      const cue = APPROVAL_CUE_IN_PHRASE.exec(match[0]);
      if (!cue || cue.index === undefined) continue;
      const cueFrom = from + cue.index;
      matches.push({ from, to: from + match[0].length, state: rule.state,
        cueFrom, cueTo: cueFrom + cue[0].length });
    }
  }
  return matches;
}

function scanSpans(text: string, expression: RegExp, offset: number): TextSpan[] {
  return [...text.matchAll(expression)].map((match) => {
    const from = offset + (match.index ?? 0);
    return { from, to: from + match[0].length };
  });
}

function collectUnconsumedGovernors(sentence: SentenceRange, matches: readonly RuleMatch[]): number[] {
  const governors = scanSpans(sentence.raw, UNSUPPORTED_GOVERNOR, sentence.from);
  const orderedMatches = [...matches].sort((left, right) => left.from - right.from || left.to - right.to);
  const unconsumed: number[] = [];
  let matchIndex = 0;
  let furthestMatchedEnd = -1;
  for (const governor of governors) {
    while (matchIndex < orderedMatches.length && orderedMatches[matchIndex]!.from <= governor.from) {
      furthestMatchedEnd = Math.max(furthestMatchedEnd, orderedMatches[matchIndex]!.to);
      matchIndex += 1;
    }
    if (furthestMatchedEnd < governor.to) unconsumed.push(governor.from);
  }
  return unconsumed;
}

function buildSentenceIndex(sentence: SentenceRange, matches: readonly RuleMatch[]): SentenceIndex {
  return {
    from: sentence.from,
    clauseBoundaries: scanSpans(sentence.raw, CLAUSE_BOUNDARY, sentence.from),
    negations: scanSpans(sentence.raw, NEGATION_SPANS, sentence.from),
    unconsumedGovernors: collectUnconsumedGovernors(sentence, matches)
  };
}

function lastSpanEndingBefore(spans: readonly TextSpan[], offset: number): TextSpan | undefined {
  let low = 0;
  let high = spans.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (spans[middle]!.to <= offset) low = middle + 1;
    else high = middle;
  }
  return low > 0 ? spans[low - 1] : undefined;
}

function hasGoverningNegation(match: RuleMatch, index: SentenceIndex): boolean {
  const clauseFrom = lastSpanEndingBefore(index.clauseBoundaries, match.from)?.to ?? index.from;
  const negation = lastSpanEndingBefore(index.negations, match.from);
  return Boolean(negation && negation.from >= clauseFrom);
}

function hasUnconsumedGoverningWord(match: RuleMatch, index: SentenceIndex): boolean {
  let low = 0;
  let high = index.unconsumedGovernors.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (index.unconsumedGovernors[middle]! < match.from) low = middle + 1;
    else high = middle;
  }
  return low > 0;
}

function opaqueMarker(sentence: SentenceRange, cues: readonly RegExpMatchArray[]): ApprovalStateMarker {
  const first = cues[0];
  const last = cues[cues.length - 1];
  const from = sentence.from + (first?.index ?? 0);
  const to = sentence.from + (last?.index ?? 0) + (last?.[0].length ?? 0);
  return { from, to, state: "opaque", raw: sentence.raw };
}

/**
 * Extracts only narrowly supported English approval constructions. An
 * ambiguous, conditional, or negated construction is retained as its exact
 * sentence so edits cannot silently change its modality or scope.
 */
export function extractApprovalStateMarkers(text: string): readonly ApprovalStateMarker[] {
  if (!text || !APPROVAL_CUE_PRESENT.test(text)) return [];
  const markers: ApprovalStateMarker[] = [];
  for (const sentence of sentenceRanges(text)) {
    const cues = [...sentence.raw.matchAll(APPROVAL_CUE)];
    if (!cues.length) continue;

    const matches = matchesForSentence(sentence);
    const matchesByCue = new Map<number, RuleMatch[]>();
    for (const match of matches) {
      const candidates = matchesByCue.get(match.cueFrom) ?? [];
      candidates.push(match);
      matchesByCue.set(match.cueFrom, candidates);
    }
    const matchedCues = cues.map((cue) => {
      const cueFrom = sentence.from + (cue.index ?? 0);
      const cueTo = cueFrom + cue[0].length;
      return (matchesByCue.get(cueFrom) ?? []).filter((match) => match.cueTo === cueTo)
        .sort((left, right) => (right.to - right.from) - (left.to - left.from))[0];
    });
    const sentenceIndex = buildSentenceIndex(sentence, matches);
    const unsupported = matchedCues.some((match) => !match) || CONDITIONAL.test(sentence.raw) || INTERROGATIVE.test(sentence.raw) ||
      matchedCues.some((match) => match && (hasGoverningNegation(match, sentenceIndex) ||
        hasUnconsumedGoverningWord(match, sentenceIndex)));
    if (unsupported) {
      markers.push(opaqueMarker(sentence, cues));
      continue;
    }

    const seen = new Set<string>();
    for (const match of matchedCues) {
      if (!match) continue;
      const key = `${match.from}:${match.to}:${match.state}`;
      if (seen.has(key)) continue;
      seen.add(key);
      markers.push({ from: match.from, to: match.to, state: match.state });
    }
  }
  return markers.sort((left, right) => left.from - right.from || left.to - right.to);
}
