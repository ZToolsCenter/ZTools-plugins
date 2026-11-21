import { GFM, parser } from "@lezer/markdown";

interface Range { from: number; to: number; }
interface TypedRange extends Range { kind: string; }
export interface ThinProseContextSlot { id: string; range: Range; text: string; }
export interface ThinProseContextPart { slotId?: string; text: string; }
export interface ThinProseContext { slotIds: readonly string[]; parts: readonly ThinProseContextPart[]; }

const MAX_CONTEXT_CODEPOINTS = 512;
const MAX_SLOT_CONTEXT_CODEPOINTS = 120;
const MAX_GROUP_SOURCE_CODEPOINTS = 192;
const CONTEXT_MARGIN_CODEPOINTS = 144;
const MAX_AST_NODES = 50_000;
const markdownParser = parser.configure(GFM);
const MARKUP_ONLY = new Set(["EmphasisMark", "StrongEmphasisMark", "StrikethroughMark", "CodeMark", "LinkMark", "LinkTitle"]);
const REDACTED = new Set(["InlineCode", "Image", "URL", "LinkReference"]);
const CONTAINERS = new Set(["InlineCode", "Image", "LinkReference"]);

function normalizeWithOffsets(source: string): { text: string; toSourceOffset(offset: number): number } {
  if (!source.includes("\r")) return { text: source, toSourceOffset: (offset) => offset };
  let text = "";
  const crlfEnds: number[] = [];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "\r") {
      text += "\n";
      if (source[index + 1] === "\n") { index += 1; crlfEnds.push(text.length); }
    } else text += source[index];
  }
  return {
    text,
    toSourceOffset(offset) {
      let low = 0, high = crlfEnds.length;
      while (low < high) {
        const middle = low + ((high - low) >> 1);
        if (crlfEnds[middle] <= offset) low = middle + 1;
        else high = middle;
      }
      return offset + low;
    }
  };
}

function astRanges(source: string): { paragraphs: Range[]; syntax: TypedRange[] } {
  const normalized = normalizeWithOffsets(source);
  const paragraphs: Range[] = [], syntax: TypedRange[] = [];
  let count = 0;
  markdownParser.parse(normalized.text).iterate({ enter(node) {
    count += 1;
    if (count > MAX_AST_NODES) throw new Error("正文语境 AST 超过扫描上限，原文未修改。");
    const range = { from: normalized.toSourceOffset(node.from), to: normalized.toSourceOffset(node.to) };
    if (node.name === "Paragraph" || node.name === "Task") paragraphs.push(range);
    if (MARKUP_ONLY.has(node.name) || REDACTED.has(node.name) || node.name === "Escape" || node.name === "HTMLTag") {
      syntax.push({ ...range, kind: node.name });
    }
  } });
  return { paragraphs, syntax };
}

function mathRanges(source: string): TypedRange[] {
  const ranges: TypedRange[] = [];
  const pattern = /\$\$[\s\S]*?\$\$|\$(?!\$)[^\r\n$]+?\$|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]/gu;
  for (const match of source.matchAll(pattern)) {
    const from = match.index ?? 0;
    let slashes = 0;
    for (let cursor = from - 1; cursor >= 0 && source[cursor] === "\\"; cursor -= 1) slashes += 1;
    if (match[0][0] === "$" && slashes % 2 === 1) continue;
    ranges.push({ from, to: from + match[0].length, kind: "Math" });
  }
  return ranges;
}

function overlaps(left: Range, right: Range): boolean { return left.from < right.to && right.from < left.to; }
function codePoints(value: string): number { return Array.from(value).length; }
function sliceCodePoints(value: string, from: number, to: number): string { return Array.from(value).slice(from, to).join(""); }

function previousPointOffset(source: string, offset: number): number {
  const last = source.charCodeAt(offset - 1), first = source.charCodeAt(offset - 2);
  return last >= 0xdc00 && last <= 0xdfff && first >= 0xd800 && first <= 0xdbff ? offset - 2 : offset - 1;
}

function nextPointOffset(source: string, offset: number): number {
  const point = source.codePointAt(offset);
  return point === undefined ? offset : offset + (point > 0xffff ? 2 : 1);
}

function pointOffset(source: string, offset: number, distance: number): number {
  if (distance < 0) {
    let result = offset;
    for (let count = 0; count < -distance && result > 0; count += 1) result = previousPointOffset(source, result);
    return result;
  }
  let result = offset;
  for (let count = 0; count < distance && result < source.length; count += 1) result = nextPointOffset(source, result);
  return result;
}

function textForSyntax(source: string, range: TypedRange): string {
  if (range.kind === "InlineCode") return " ⟦行内代码已保留⟧ ";
  if (range.kind === "Image") return " ⟦图片已保留⟧ ";
  if (range.kind === "URL") return " ⟦链接目标已保留⟧ ";
  if (range.kind === "LinkReference") return " ⟦链接已保留⟧ ";
  if (range.kind === "Math") return " ⟦公式已保留⟧ ";
  if (range.kind === "Escape") return source.slice(range.from, range.to).replace(/^\\/u, "");
  return "";
}

function slotContextText(slot: ThinProseContextSlot): string {
  const text = Array.from(slot.text);
  const visible = text.length > MAX_SLOT_CONTEXT_CODEPOINTS ? `${text.slice(0, MAX_SLOT_CONTEXT_CODEPOINTS).join("")}…` : slot.text;
  return visible;
}

function renderedLength(parts: readonly ThinProseContextPart[]): number {
  return parts.reduce((total, part) => total + codePoints(part.text) + (part.slotId ? codePoints(part.slotId) * 2 + 9 : 0), 0);
}

function lastPlainPartIndex(parts: readonly ThinProseContextPart[]): number {
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    if (!parts[index].slotId && parts[index].text.length > 0) return index;
  }
  return -1;
}

function trimToBound(parts: ThinProseContextPart[]): ThinProseContextPart[] {
  let result = parts.map((part) => ({ ...part }));
  while (renderedLength(result) > MAX_CONTEXT_CODEPOINTS) {
    const firstText = result.findIndex((part) => !part.slotId && part.text.length > 0);
    if (firstText < 0) break;
    const part = result[firstText];
    part.text = sliceCodePoints(part.text, Math.min(12, codePoints(part.text)), codePoints(part.text));
    if (!part.text) result.splice(firstText, 1);
    if (renderedLength(result) <= MAX_CONTEXT_CODEPOINTS) break;
    const lastText = lastPlainPartIndex(result);
    if (lastText < 0) break;
    const last = result[lastText];
    last.text = sliceCodePoints(last.text, 0, Math.max(0, codePoints(last.text) - 12));
    if (!last.text) result.splice(lastText, 1);
  }
  return result;
}

function slotGroups(source: string, slots: ThinProseContextSlot[]): ThinProseContextSlot[][] {
  const groups: ThinProseContextSlot[][] = [];
  let group: ThinProseContextSlot[] = [];
  let markerCodePoints = 0;
  for (const slot of slots) {
    const nextMarkerCodePoints = codePoints(slot.id) * 2 + 9;
    const spanCodePoints = group.length ? codePoints(source.slice(group[0].range.from, slot.range.to)) : codePoints(slot.text);
    if (group.length && spanCodePoints + markerCodePoints + nextMarkerCodePoints > MAX_GROUP_SOURCE_CODEPOINTS) {
      groups.push(group); group = []; markerCodePoints = 0;
    }
    group.push(slot);
    markerCodePoints += nextMarkerCodePoints;
  }
  if (group.length) groups.push(group);
  return groups;
}

function indexedRanges(ranges: TypedRange[]): { ranges: TypedRange[]; prefixMaxTo: number[] } {
  const sorted = ranges.slice().sort((left, right) => left.from - right.from || right.to - left.to);
  let maximum = -1;
  return { ranges: sorted, prefixMaxTo: sorted.map(({ to }) => (maximum = Math.max(maximum, to))) };
}

function firstIntersectingRange(index: { ranges: TypedRange[]; prefixMaxTo: number[] }, offset: number): number {
  let low = 0, high = index.prefixMaxTo.length;
  while (low < high) {
    const middle = low + ((high - low) >> 1);
    if (index.prefixMaxTo[middle] <= offset) low = middle + 1;
    else high = middle;
  }
  return low;
}

function syntaxEventsInWindow(index: { ranges: TypedRange[]; prefixMaxTo: number[] }, window: Range): Array<Range & { kind: string }> {
  const selected: TypedRange[] = [];
  const containers: TypedRange[] = [];
  const start = firstIntersectingRange(index, window.from);
  for (let i = start; i < index.ranges.length && index.ranges[i].from < window.to; i += 1) {
    const range = index.ranges[i];
    while (containers.length && containers.at(-1)!.to <= range.from) containers.pop();
    if (!overlaps(range, window) || (containers.length && range.to <= containers.at(-1)!.to)) continue;
    selected.push(range);
    if (CONTAINERS.has(range.kind)) containers.push(range);
  }
  return selected.map((range) => ({ from: Math.max(range.from, window.from), to: Math.min(range.to, window.to), kind: range.kind }));
}

function slotEventsInWindow(slots: readonly ThinProseContextSlot[], window: Range): ThinProseContextSlot[] {
  let low = 0, high = slots.length;
  while (low < high) {
    const middle = low + ((high - low) >> 1);
    if (slots[middle].range.to <= window.from) low = middle + 1;
    else high = middle;
  }
  const result: ThinProseContextSlot[] = [];
  for (let index = low; index < slots.length && slots[index].range.from < window.to; index += 1) {
    if (overlaps(slots[index].range, window)) result.push(slots[index]);
  }
  return result;
}

function buildWindowParts(source: string, window: Range, syntax: { ranges: TypedRange[]; prefixMaxTo: number[] }, slots: readonly ThinProseContextSlot[]): ThinProseContextPart[] {
  const syntaxEvents = syntaxEventsInWindow(syntax, window);
  const slotEvents = slotEventsInWindow(slots, window);
  const events: Array<(Range & { kind: string }) | (Range & { id: string; text: string; slot: true })> = [
    ...syntaxEvents,
    ...slotEvents.map((slot) => ({ ...slot.range, id: slot.id, text: slotContextText(slot), slot: true as const }))
  ].sort((left, right) => left.from - right.from || right.to - left.to);
  const parts: ThinProseContextPart[] = [];
  let cursor = window.from;
  for (const event of events) {
    if (event.from < cursor || event.to <= event.from || event.to > window.to) continue;
    if (event.from > cursor) parts.push({ text: source.slice(cursor, event.from) });
    if ("slot" in event) parts.push({ slotId: event.id, text: event.text });
    else {
      const text = textForSyntax(source, event);
      if (text) parts.push({ text });
    }
    cursor = event.to;
  }
  if (cursor < window.to) parts.push({ text: source.slice(cursor, window.to) });
  return parts;
}

function contextWindow(source: string, paragraph: Range, group: ThinProseContextSlot[]): Range {
  const first = group[0].range.from, last = group.at(-1)!.range.to;
  const from = Math.max(paragraph.from, pointOffset(source, first, -CONTEXT_MARGIN_CODEPOINTS));
  const to = Math.min(paragraph.to, pointOffset(source, last, CONTEXT_MARGIN_CODEPOINTS));
  return { from, to };
}

/** Builds bounded, read-only visible prose context for exact source-owned text slots. */
export function buildThinProseContexts(source: string, slots: readonly ThinProseContextSlot[]): ThinProseContext[] {
  if (!slots.length) return [];
  const { paragraphs, syntax } = astRanges(source);
  const protectedRanges = indexedRanges([...syntax, ...mathRanges(source)]);
  const orderedSlots = slots.slice().sort((left, right) => left.range.from - right.range.from);
  const contexts: ThinProseContext[] = [];
  let slotIndex = 0;
  for (const paragraph of paragraphs) {
    while (slotIndex < orderedSlots.length && orderedSlots[slotIndex].range.to <= paragraph.from) slotIndex += 1;
    let endIndex = slotIndex;
    while (endIndex < orderedSlots.length && orderedSlots[endIndex].range.from < paragraph.to && orderedSlots[endIndex].range.to <= paragraph.to) endIndex += 1;
    const paragraphSlots = orderedSlots.slice(slotIndex, endIndex);
    for (const group of slotGroups(source, paragraphSlots)) {
      const window = contextWindow(source, paragraph, group);
      const parts = trimToBound(buildWindowParts(source, window, protectedRanges, group));
      const slotIds = group.map(({ id }) => id).filter((id) => parts.some((part) => part.slotId === id));
      if (slotIds.length) contexts.push({ slotIds, parts });
    }
    slotIndex = endIndex;
  }
  return contexts;
}

export function renderThinProseContexts(contexts: readonly ThinProseContext[], batchIds: ReadonlySet<string>): Array<{ ownedSlotIds: string[]; text: string }> {
  return contexts.flatMap((context) => {
    const ownedSlotIds = context.slotIds.filter((id) => batchIds.has(id));
    if (!ownedSlotIds.length) return [];
    const text = context.parts.map(({ text: partText }) => partText).join("");
    return [{ ownedSlotIds, text }];
  });
}
