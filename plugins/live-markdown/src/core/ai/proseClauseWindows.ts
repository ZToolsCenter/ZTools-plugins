import { proseEditProtectedRanges } from "./proseEditProtectedRanges";
import type { ThinProseSlot } from "./thinProseSlots";
import { prepareReadableProse, type ReadableProseView, type ReadableProseWindow } from "./readableProseView";

interface Range extends ReadableProseWindow {}
export interface ProseClauseWindow {
  kind: "model" | "literal";
  range: ReadableProseWindow;
}

interface DelimiterRange extends Range {}
interface DelimiterOpen { from: number; closesWith: string; }

const MAX_FACT_DISTANCE = 48;
const MAX_SEPARATOR_CODEPOINTS = 16;
const DEPENDENT_CLAUSE_CUES = /(?:除非|否则|不然|只有|才|虽然|但是|但|不过|可是|然而|即使|即便|纵使|纵然|尽管|哪怕|如果|假如|假使|要是|若|只要|一旦|当|由于|因为|既然|凡|不是|并非|并不是|不但|不仅|不光|不只|非但|无论|不论|不管|而是|反而|因此|所以|于是)/u;
const PAIRED_DELIMITERS = new Map([
  ["(", ")"], ["（", "）"], ["[", "]"], ["［", "］"], ["{", "}"], ["｛", "｝"],
  ["【", "】"], ["〔", "〕"], ["〖", "〗"],
  ["“", "”"], ["‘", "’"], ["「", "」"], ["『", "』"], ["《", "》"], ["〈", "〉"], ["«", "»"]
]);
const PAIRED_CLOSERS = new Set(PAIRED_DELIMITERS.values());
const SYMMETRIC_QUOTES = new Set(["\"", "'"]);

function codePointLength(value: string): number { return Array.from(value).length; }

function overlaps(left: Range, right: Range): boolean { return left.from < right.to && left.to > right.from; }

function slotsInWindow(source: string, slots: readonly ThinProseSlot[], window: ReadableProseWindow): ThinProseSlot[] {
  return slots.flatMap((slot, index) => {
    const from = Math.max(slot.range.from, window.from), to = Math.min(slot.range.to, window.to);
    if (from >= to) return [];
    return [{
      id: `clause-check-${index + 1}`,
      range: { from, to },
      sourceText: source.slice(from, to),
      contextBefore: "",
      contextAfter: "",
      ...(slot.dateOwnerFact && slot.dateOwnerFact.date.from >= from && slot.dateOwnerFact.date.to <= to
        ? { dateOwnerFact: slot.dateOwnerFact }
        : {})
    }];
  });
}

function balancedDelimiterRanges(source: string, line: ReadableProseWindow): DelimiterRange[] | null {
  const ranges: DelimiterRange[] = [];
  const stack: DelimiterOpen[] = [];
  const text = source.slice(line.from, line.to);
  const escaped = (index: number) => {
    let slashes = 0;
    for (let cursor = index - 1; cursor >= 0 && text[cursor] === "\\"; cursor -= 1) slashes += 1;
    return slashes % 2 === 1;
  };
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (escaped(index)) continue;
    if (SYMMETRIC_QUOTES.has(char)) {
      const top = stack.at(-1);
      if (top?.closesWith === char) {
        stack.pop();
        ranges.push({ from: line.from + top.from, to: line.from + index + 1 });
      } else stack.push({ from: index, closesWith: char });
      continue;
    }
    const close = PAIRED_DELIMITERS.get(char);
    if (close) { stack.push({ from: index, closesWith: close }); continue; }
    if (PAIRED_CLOSERS.has(char)) {
      const top = stack.at(-1);
      if (!top || top.closesWith !== char) return null;
      stack.pop();
      ranges.push({ from: line.from + top.from, to: line.from + index + 1 });
    }
  }
  return stack.length ? null : ranges;
}

function isOrdinaryBodyLine(source: string, line: ReadableProseWindow): boolean {
  const text = source.slice(line.from, line.to).trimStart();
  return !/^(?:#{1,6}(?:\s|$)|>|(?:[-+*]|\d+[.)])\s|```|~~~|\|.*\|$)/u.test(text);
}

function isHanOnlyProse(view: ReadableProseView): boolean {
  let text = view.text;
  for (const placeholder of view.readonlyPlaceholders) text = text.replaceAll(placeholder, " ");
  const letters = [...text.matchAll(/\p{L}/gu)].map(match => match[0]);
  return letters.length > 0 && letters.every(letter => /\p{Script=Han}/u.test(letter));
}

function hasDependentClauseCue(view: ReadableProseView): boolean {
  let text = view.text;
  for (const placeholder of view.readonlyPlaceholders) text = text.replaceAll(placeholder, " ");
  return DEPENDENT_CLAUSE_CUES.test(text);
}

function hasVisibleReadonlyFact(source: string, line: ReadableProseWindow, slots: readonly ThinProseSlot[], view: ReadableProseView): boolean {
  const lineText = source.slice(line.from, line.to);
  return proseEditProtectedRanges(lineText, line.from).some(fact => {
    const ownedDate = slots.some(slot => slot.dateOwnerFact && slot.dateOwnerFact.date.from === fact.from && slot.dateOwnerFact.date.to === fact.to);
    if (!ownedDate && slots.some(slot => overlaps(slot.range, fact))) return false;
    const value = source.slice(fact.from, fact.to);
    return /\p{N}/u.test(value) && view.text.includes(value);
  });
}

function factNearComma(source: string, commaFrom: number, commaTo: number, facts: readonly Range[]): boolean {
  return facts.some(fact => {
    if (fact.to <= commaFrom) return codePointLength(source.slice(fact.to, commaFrom)) <= MAX_FACT_DISTANCE;
    if (fact.from >= commaTo) return codePointLength(source.slice(commaTo, fact.from)) <= MAX_FACT_DISTANCE;
    return false;
  });
}

function hasHanLettersInEditableSlots(view: ReadableProseView, slots: readonly ThinProseSlot[]): boolean {
  const editable = slots.map(slot => slot.sourceText).join("");
  return /\p{Script=Han}/u.test(editable) && isHanOnlyProse(view);
}

/** Splits only ordinary Han prose around safe Chinese commas near visible readonly facts. */
export function splitHanFactCommaWindows(
  source: string,
  line: ReadableProseWindow,
  slots: readonly ThinProseSlot[],
  windows: readonly ReadableProseWindow[],
  maxModelCodepoints: number
): ProseClauseWindow[] | null {
  if (!isOrdinaryBodyLine(source, line)) return null;
  const lineSlots = slotsInWindow(source, slots, line);
  if (!lineSlots.length) return null;
  const lineView = prepareReadableProse(source, lineSlots, line);
  if (!lineView || !isHanOnlyProse(lineView) || hasDependentClauseCue(lineView)) return null;

  const lineText = source.slice(line.from, line.to);
  const sourceFacts = proseEditProtectedRanges(lineText, line.from).filter(fact => {
    const ownedDate = slots.some(slot => slot.dateOwnerFact && slot.dateOwnerFact.date.from === fact.from && slot.dateOwnerFact.date.to === fact.to);
    if (!ownedDate && slots.some(slot => overlaps(slot.range, fact))) return false;
    const value = source.slice(fact.from, fact.to);
    return /\p{N}/u.test(value) && lineView.text.includes(value);
  });
  const facts = [...sourceFacts, ...slots.flatMap(slot => slot.dateOwnerFact ? [slot.dateOwnerFact.date] : [])]
    .filter((fact, index, all) => all.findIndex(other => other.from === fact.from && other.to === fact.to) === index);
  if (!facts.length || !hasVisibleReadonlyFact(source, line, slots, lineView)) return null;

  const delimiters = balancedDelimiterRanges(source, line);
  if (!delimiters) return null;
  const parts: ProseClauseWindow[] = [];
  let splitCount = 0;
  for (const window of windows) {
    let cursor = window.from;
    for (let index = window.from; index < window.to; index += 1) {
      if (source[index] !== "，") continue;
      const commaFrom = index, commaTo = index + 1;
      if (!factNearComma(source, commaFrom, commaTo, facts)) continue;
      if (delimiters.some(delimiter => delimiter.from < commaTo && delimiter.to > commaFrom)) return null;

      let literalFrom = commaFrom, literalTo = commaTo;
      while (literalFrom > cursor && /\p{Zs}/u.test(source[literalFrom - 1]!)) literalFrom -= 1;
      while (literalTo < window.to && /\p{Zs}/u.test(source[literalTo]!)) literalTo += 1;
      if (literalFrom <= cursor || codePointLength(source.slice(literalFrom, literalTo)) > MAX_SEPARATOR_CODEPOINTS) return null;
      parts.push({ kind: "model", range: { from: cursor, to: literalFrom } });
      parts.push({ kind: "literal", range: { from: literalFrom, to: literalTo } });
      cursor = literalTo;
      splitCount += 1;
      index = literalTo - 1;
    }
    if (cursor < window.to) parts.push({ kind: "model", range: { from: cursor, to: window.to } });
  }
  if (!splitCount) return null;

  let modelParts = 0;
  for (const part of parts) {
    const partLength = codePointLength(source.slice(part.range.from, part.range.to));
    if (part.kind === "model" && partLength > maxModelCodepoints) return null;
    if (part.kind === "literal" && !/^[\p{Zs}]*，[\p{Zs}]*$/u.test(source.slice(part.range.from, part.range.to))) return null;
    const pieceSlots = slotsInWindow(source, slots, part.range);
    if (!pieceSlots.length) continue;
    const view = prepareReadableProse(source, pieceSlots, part.range);
    if (!view) return null;
    if (part.kind === "model") {
      if (!hasHanLettersInEditableSlots(view, pieceSlots)) return null;
      modelParts += 1;
    }
  }
  return modelParts > 1 ? parts : null;
}
