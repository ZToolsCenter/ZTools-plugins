const MAX_TEXT_LENGTH = 16_384;
const MAX_REQUESTS = 64;
const MAX_TARGET_CODEPOINTS = 48;
const MAX_TARGET_CODE_UNITS = MAX_TARGET_CODEPOINTS * 2;
const REQUEST_BOUNDARY = /(^|[\s，,。；;！？!? .：:、]|并且|同时|并|且|而)请+/gu;
const SENTENCE_END = /[。！？.!?]/u;
const MAX_REQUEST_LOOKAHEAD = 128;

interface RequestMarker {
  start: number;
  end: number;
  separatorStart: number;
  segmentEnd: number;
  clauseEnd: number;
  sentenceStart: number;
  sentenceEnd: number;
  sentenceTerminator: string;
}
interface ActionFrame {
  recipient: string;
  modifiers: string[];
  action: "decision" | "completion";
  target: string | null;
  sentenceStart: number;
  sentenceEnd: number;
  sentenceTerminator: string;
}
interface SentenceFrameGroup {
  sentenceStart: number;
  sentenceEnd: number;
  sentenceTerminator: string;
  frames: ActionFrame[];
}
interface TextAnalysis { frames: ActionFrame[]; limited: boolean; }

const explicitPersonRecipients = ["你们", "您们", "你", "您"];
const collectiveRecipients = ["所有人", "各位同事", "各位同仁", "各位同学", "诸位", "全体", "大家", "各位"];
const organization = /^(?:(?:[\p{Script=Han}]{1,8}|[A-Za-z][A-Za-z0-9_-]{0,11})?(?:项目团队|项目组|工作组|组委会|委员会|团队|小组|部门|组|项目))/u;
const modifiers = [
  ["再一次", "repeat"], ["再次", "repeat"], ["再度", "repeat"], ["重新", "redo"],
  ["首先", "first"], ["先", "first"], ["再", "single-re"]
] as const;
const lightVerbs = ["进行", "予以", "作出"] as const;
const actionVerbs = ["确定", "明确", "确认", "完成", "做完"] as const;
const decisionVerbs = new Set(["确定", "明确", "确认"]);
const sentenceBoundary = /[。！？；\r\n]/u;
const clauseBoundary = /[，,；;]/u;

function fail(): never {
  throw new Error("请求动作中的收件人、修饰、动作或目标发生变化，原文未修改。");
}

function markersOf(text: string): RequestMarker[] | undefined {
  if (text.length > MAX_TEXT_LENGTH) return undefined;
  const raw: Array<{ start: number; end: number; separatorStart: number }> = [];
  for (const match of text.matchAll(REQUEST_BOUNDARY)) {
    const index = match.index ?? 0;
    const separator = match[1];
    if ((separator === "." || separator === "!" || separator === "?") && !isSentenceBoundaryAt(text, index)) continue;
    raw.push({ start: index + match[1].length, end: index + match[0].length, separatorStart: index });
    if (raw.length > MAX_REQUESTS) return undefined;
  }

  const sentenceBoundaries: number[] = [];
  const clauseBoundaries: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const sentenceEnd = isSentenceBoundaryAt(text, index);
    if (sentenceEnd) sentenceBoundaries.push(index);
    if (sentenceEnd || clauseBoundary.test(text[index] ?? "")) clauseBoundaries.push(index);
  }
  const markers: RequestMarker[] = [];
  let boundaryIndex = 0;
  let clauseIndex = 0;
  for (let index = 0; index < raw.length; index += 1) {
    const marker = raw[index];
    if (!marker) continue;
    while ((sentenceBoundaries[boundaryIndex] ?? Number.POSITIVE_INFINITY) < marker.start) boundaryIndex += 1;
    while ((clauseBoundaries[clauseIndex] ?? Number.POSITIVE_INFINITY) < marker.end) clauseIndex += 1;
    const nextMarker = raw[index + 1];
    const sentenceBoundaryIndex = sentenceBoundaries[boundaryIndex];
    const clauseBoundaryIndex = clauseBoundaries[clauseIndex];
    const previousSentenceBoundary = sentenceBoundaries[boundaryIndex - 1];
    const segmentEnd = Math.min(sentenceBoundaryIndex ?? text.length, nextMarker?.separatorStart ?? text.length);
    markers.push({
      ...marker,
      segmentEnd,
      clauseEnd: Math.min(segmentEnd, clauseBoundaryIndex ?? text.length),
      sentenceStart: (previousSentenceBoundary ?? -1) + 1,
      sentenceEnd: sentenceBoundaryIndex === undefined ? text.length : sentenceBoundaryIndex + 1,
      sentenceTerminator: sentenceBoundaryIndex === undefined ? "" : text[sentenceBoundaryIndex] ?? ""
    });
  }
  return markers;
}

function skipSpaces(text: string, cursor: number, end: number): number {
  while (cursor < end && /\s/u.test(text[cursor] ?? "")) cursor += 1;
  return cursor;
}

function startsWithWithin(text: string, token: string, cursor: number, end: number): boolean {
  return cursor + token.length <= end && text.startsWith(token, cursor);
}

function readRecipient(text: string, cursor: number, end: number): { value: string; next: number } | undefined {
  for (const recipient of explicitPersonRecipients) {
    if (startsWithWithin(text, recipient, cursor, end)) {
      return { value: `person:${recipient}`, next: cursor + recipient.length };
    }
  }
  for (const recipient of collectiveRecipients) {
    if (startsWithWithin(text, recipient, cursor, end)) return { value: "collective", next: cursor + recipient.length };
  }
  const prefixEnd = Math.min(end, cursor + 24);
  const match = organization.exec(text.slice(cursor, prefixEnd));
  if (match?.[0]) return { value: `organization:${match[0].replace(/\s+/gu, "")}`, next: cursor + match[0].length };
  return undefined;
}

function isClearRequestAfter(text: string, punctuation: number): boolean {
  const limit = Math.min(text.length, punctuation + 1 + MAX_REQUEST_LOOKAHEAD);
  let cursor = punctuation + 1;
  if (!startsWithWithin(text, "请", cursor, limit)) return false;
  while (startsWithWithin(text, "请", cursor, limit)) cursor += 1;
  cursor = skipSpaces(text, cursor, limit);
  const recipient = readRecipient(text, cursor, limit);
  if (recipient) cursor = skipSpaces(text, recipient.next, limit);
  while (cursor < limit) {
    const token = modifiers.find(([surface]) => startsWithWithin(text, surface, cursor, limit));
    if (!token) break;
    cursor = skipSpaces(text, cursor + token[0].length, limit);
  }
  const lightVerb = lightVerbs.find(verb => startsWithWithin(text, verb, cursor, limit));
  if (lightVerb) cursor = skipSpaces(text, cursor + lightVerb.length, limit);
  return actionVerbs.some(verb => startsWithWithin(text, verb, cursor, limit));
}

function isSentenceBoundaryAt(text: string, index: number): boolean {
  const character = text[index] ?? "";
  if (sentenceBoundary.test(character)) return true;
  if (character !== "." && character !== "!" && character !== "?") return false;
  const nextIndex = index + 1;
  if (nextIndex >= text.length || /\s/u.test(text[nextIndex] ?? "")) return true;
  return isClearRequestAfter(text, index);
}

function readTarget(text: string, cursor: number, end: number): string | null {
  let start = cursor, finish = end;
  while (start < finish && /\s/u.test(text[start] ?? "")) start += 1;
  while (finish > start && /\s/u.test(text[finish - 1] ?? "")) finish -= 1;
  if (finish - start > MAX_TARGET_CODE_UNITS) return null;
  const target = text.slice(start, finish).replace(/[ \t\f\v]+/gu, " ");
  if (Array.from(target).length > MAX_TARGET_CODEPOINTS) return null;
  return target;
}

function parseFrame(text: string, marker: RequestMarker): ActionFrame | undefined {
  let cursor = skipSpaces(text, marker.end, marker.clauseEnd);
  const recipient = readRecipient(text, cursor, marker.clauseEnd);
  let recipientFact = "collective";
  if (recipient) { recipientFact = recipient.value; cursor = skipSpaces(text, recipient.next, marker.clauseEnd); }

  const modifierFacts: string[] = [];
  while (cursor < marker.clauseEnd) {
    const token = modifiers.find(([surface]) => startsWithWithin(text, surface, cursor, marker.clauseEnd));
    if (!token) break;
    modifierFacts.push(token[1]);
    cursor = skipSpaces(text, cursor + token[0].length, marker.clauseEnd);
  }

  const lightVerb = lightVerbs.find(verb => startsWithWithin(text, verb, cursor, marker.clauseEnd));
  if (lightVerb) cursor = skipSpaces(text, cursor + lightVerb.length, marker.clauseEnd);
  const action = actionVerbs.find(verb => startsWithWithin(text, verb, cursor, marker.clauseEnd));
  if (!action) return undefined;
  cursor += action.length;
  const target = readTarget(text, cursor, marker.clauseEnd);
  return {
    recipient: recipientFact, modifiers: modifierFacts,
    action: decisionVerbs.has(action) ? "decision" : "completion", target,
    sentenceStart: marker.sentenceStart, sentenceEnd: marker.sentenceEnd,
    sentenceTerminator: marker.sentenceTerminator
  };
}

function sameFrame(left: ActionFrame, right: ActionFrame): boolean {
  return left.recipient === right.recipient && left.action === right.action && left.target === right.target &&
    left.modifiers.length === right.modifiers.length && left.modifiers.every((value, index) => value === right.modifiers[index]);
}

function preservesSourceFrame(source: ActionFrame, candidate: ActionFrame): boolean {
  const samePrefix = source.recipient === candidate.recipient && source.action === candidate.action &&
    source.modifiers.length === candidate.modifiers.length &&
    source.modifiers.every((value, index) => value === candidate.modifiers[index]);
  return samePrefix && (source.target === null || candidate.target === source.target);
}

function groupSentenceFrames(frames: ActionFrame[]): SentenceFrameGroup[] {
  const groups: SentenceFrameGroup[] = [];
  for (const frame of frames) {
    const previous = groups.at(-1);
    if (previous && previous.sentenceStart === frame.sentenceStart && previous.sentenceEnd === frame.sentenceEnd) {
      previous.frames.push(frame);
    } else {
      groups.push({ sentenceStart: frame.sentenceStart, sentenceEnd: frame.sentenceEnd,
        sentenceTerminator: frame.sentenceTerminator, frames: [frame] });
    }
  }
  return groups;
}

function sameFrameSequence(left: ActionFrame[], right: ActionFrame[]): boolean {
  return left.length === right.length && left.every((frame, index) => sameFrame(frame, right[index]!));
}

function collapseExactSentenceRuns(text: string, frames: ActionFrame[]): ActionFrame[] {
  const result: SentenceFrameGroup[] = [];
  let previousInput: SentenceFrameGroup | undefined;
  for (const group of groupSentenceFrames(frames)) {
    const exactRepeatedRun = previousInput !== undefined && previousInput.sentenceEnd === group.sentenceStart &&
      SENTENCE_END.test(previousInput.sentenceTerminator) && SENTENCE_END.test(group.sentenceTerminator) &&
      previousInput.sentenceEnd - previousInput.sentenceStart === group.sentenceEnd - group.sentenceStart &&
      text.slice(previousInput.sentenceStart, previousInput.sentenceEnd) ===
        text.slice(group.sentenceStart, group.sentenceEnd) &&
      sameFrameSequence(previousInput.frames, group.frames);
    if (!exactRepeatedRun) result.push(group);
    previousInput = group;
  }
  return result.flatMap(group => group.frames);
}

function analyze(text: string): TextAnalysis {
  const markers = markersOf(text);
  if (!markers) return { frames: [], limited: true };
  const frames: ActionFrame[] = [];
  for (const marker of markers) {
    const frame = parseFrame(text, marker);
    if (frame) frames.push(frame);
  }
  return { frames: collapseExactSentenceRuns(text, frames), limited: false };
}

/**
 * Protects bounded lexical facts only when the source has a recognized request
 * frame. Unknown source shapes abstain and remain subject to existing guards.
 * The action target stops at the first comma, semicolon, or sentence boundary;
 * comma lists and other unknown clause semantics are not parsed here.
 * Long targets are opaque while recipient/modifier/action facts stay bound;
 * complete sentence bytes are compared lazily within the text budget.
 * Exact adjacent duplicate full sentences share one frame; this compatibility
 * does not prove the intended count of repeated actions in other forms.
 */
export function validateProseRequestActionFacts(source: string, replacement: string): void {
  if (source === replacement) return;
  const original = analyze(source);
  if (original.limited || original.frames.length === 0) return;
  const candidate = analyze(replacement);
  if (candidate.limited || candidate.frames.length !== original.frames.length ||
      candidate.frames.some((frame, index) => !preservesSourceFrame(original.frames[index]!, frame))) fail();
}
