import { GFM, parser } from "@lezer/markdown";
import { computeInlineDiff, type InlineToken } from "../diffEngine";
import type { ThinProseSlot } from "./thinProseSlots";
import { normalizeOwnedProseDateSurface, normalizeProseReadonlySurface } from "./proseReadonlySurface";
import type { ProseDateOwnerFact } from "./proseDateOwnership";

const MAX_VIEW_CODEPOINTS = 512;
const MAX_LINE_CODEPOINTS = 8_192;
const MAX_MODEL_OUTPUT_CODEPOINTS = 1_024;
const MAX_OWNED_SLOTS = 128;
const MAX_AST_NODES = 8_192;
const markdownParser = parser.configure(GFM);

interface Range { from: number; to: number; }
interface AstRange extends Range { name: string; }
export interface ReadableProseWindow extends Range {}
type Segment =
  | { kind: "owned"; viewFrom: number; viewTo: number; slotId: string; slotFrom: number; slotTo: number; dateOwnerFact?: ProseDateOwnerFact }
  | { kind: "readonly"; viewFrom: number; viewTo: number; placeholder?: string };
interface Atom extends Range { kind: "code" | "image" | "math" | "html" | "escape" | "entity"; }
interface Omission extends Range { kind: "omit"; }
interface SlotEvent extends Range { kind: "slot"; slot: ThinProseSlot; }

export interface ReadableProseView {
  /** One complete physical source line, with Markdown marks removed and protected atoms hidden. */
  text: string;
  /** Unique words that the model must copy exactly once and in order. */
  readonlyPlaceholders: readonly string[];
  /** Restores only uniquely grounded readonly surface spellings before strict NLP comparison. */
  normalizeReadonlySurface(raw: string): string;
  /** Projects a raw one-line model response to every input slot; throws if any span is ambiguous or read-only. */
  decode(raw: string): Map<string, string>;
}

function codePointLength(value: string): number { return Array.from(value).length; }

function lineBounds(source: string, offset: number): Range {
  return {
    from: Math.max(source.lastIndexOf("\n", offset - 1), source.lastIndexOf("\r", offset - 1)) + 1,
    to: (() => {
      const cr = source.indexOf("\r", offset), lf = source.indexOf("\n", offset);
      const end = Math.min(cr < 0 ? source.length : cr, lf < 0 ? source.length : lf);
      return end;
    })()
  };
}

function isEscaped(text: string, index: number): boolean {
  let slashes = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === "\\"; cursor -= 1) slashes += 1;
  return slashes % 2 === 1;
}

function mathAtoms(line: string): Atom[] {
  const atoms: Atom[] = [];
  const expression = /\$\$[\s\S]*?\$\$|\$(?!\$)[^\r\n$]+?\$|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]/gu;
  for (const match of line.matchAll(expression)) {
    const from = match.index ?? 0;
    if (match[0][0] === "$" && isEscaped(line, from)) continue;
    atoms.push({ from, to: from + match[0].length, kind: "math" });
  }
  return atoms;
}

function collectMarkdownRanges(line: string): { atoms: Atom[]; omissions: Omission[]; sentenceUnsafe: Range[] } | null {
  const atoms: Atom[] = [];
  const omissions: Omission[] = [];
  const sentenceUnsafe: Range[] = [];
  const links: Range[] = [];
  const urls: AstRange[] = [];
  const titles: AstRange[] = [];
  const sentenceWholeRangeKinds = new Set(["Emphasis", "StrongEmphasis", "Strikethrough", "Link"]);
  const atomKinds: Record<string, Atom["kind"]> = {
    InlineCode: "code", Image: "image", HTMLTag: "html", Escape: "escape", Entity: "entity", LinkReference: "image"
  };
  const omitKinds = new Set(["URL", "LinkTitle", "LinkMark", "EmphasisMark", "StrongEmphasisMark", "StrikethroughMark", "CodeMark"]);
  let count = 0;
  try {
    markdownParser.parse(line).iterate({ enter(node) {
      count += 1;
      if (count > MAX_AST_NODES) throw new Error("AST limit");
      const atomKind = atomKinds[node.name];
      if (atomKind) {
        atoms.push({ from: node.from, to: node.to, kind: atomKind });
        sentenceUnsafe.push({ from: node.from, to: node.to });
      } else if (omitKinds.has(node.name)) {
        omissions.push({ from: node.from, to: node.to, kind: "omit" });
        sentenceUnsafe.push({ from: node.from, to: node.to });
      }
      if (node.name === "Link") links.push({ from: node.from, to: node.to });
      if (sentenceWholeRangeKinds.has(node.name)) sentenceUnsafe.push({ from: node.from, to: node.to });
      if (node.name === "URL") {
        urls.push({ from: node.from, to: node.to, name: node.name });
        sentenceUnsafe.push({ from: node.from, to: node.to });
      }
      if (node.name === "LinkTitle") titles.push({ from: node.from, to: node.to, name: node.name });
    } });
  } catch { return null; }
  let urlIndex = 0, titleIndex = 0;
  for (const link of links) {
    while (urls[urlIndex] && urls[urlIndex].from < link.from) urlIndex += 1;
    while (titles[titleIndex] && titles[titleIndex].from < link.from) titleIndex += 1;
    const url = urls[urlIndex], title = titles[titleIndex];
    if (url && title && url.to <= title.from && /^\s+$/u.test(line.slice(url.to, title.from))) {
      omissions.push({ from: url.to, to: title.from, kind: "omit" });
    }
    if (url && url.from >= link.from && url.to <= link.to) urlIndex += 1;
    if (title && title.from >= link.from && title.to <= link.to) titleIndex += 1;
  }
  const formulas = mathAtoms(line);
  atoms.push(...formulas);
  sentenceUnsafe.push(...formulas);
  return { atoms, omissions, sentenceUnsafe };
}

function mergeAtoms(atoms: readonly Atom[]): Atom[] {
  const sorted = atoms.filter(({ from, to }) => from < to).sort((a, b) => a.from - b.from || b.to - a.to);
  const merged: Atom[] = [];
  for (const atom of sorted) {
    const previous = merged.at(-1);
    if (previous && atom.from < previous.to) previous.to = Math.max(previous.to, atom.to);
    else merged.push({ ...atom });
  }
  return merged;
}

function mergeOmissions(omissions: readonly Omission[], atoms: readonly Atom[]): Omission[] {
  const sorted = omissions.filter(({ from, to }) => from < to).sort((a, b) => a.from - b.from || a.to - b.to);
  const orderedAtoms = [...atoms].sort((a, b) => a.from - b.from || a.to - b.to);
  const merged: Omission[] = [];
  let atomIndex = 0;
  for (const omission of sorted) {
    while (orderedAtoms[atomIndex]?.to <= omission.from) atomIndex += 1;
    const atom = orderedAtoms[atomIndex];
    if (atom && atom.from < omission.to && atom.to > omission.from) continue;
    const previous = merged.at(-1);
    if (previous && omission.from <= previous.to) previous.to = Math.max(previous.to, omission.to);
    else merged.push({ ...omission });
  }
  return merged;
}

function placeholderFor(kind: Atom["kind"], index: number, prefix: string): string {
  const label: Record<Atom["kind"], string> = {
    code: "ProtectedCode", image: "ProtectedImage", math: "ProtectedMath",
    html: "ProtectedHtml", escape: "ProtectedEscape", entity: "ProtectedEntity"
  };
  return `${prefix}${label[kind]}${index}`;
}

function renderView(line: string, slots: readonly ThinProseSlot[], lineStart: number, atoms: readonly Atom[], omissions: readonly Omission[], window: Range): {
  text: string; segments: Segment[]; placeholders: string[];
} | null {
  const events: Array<Atom | Omission | SlotEvent> = [
    ...atoms.filter(({ from, to }) => from >= window.from && to <= window.to),
    ...omissions.filter(({ from, to }) => from >= window.from && to <= window.to),
    ...slots.map(slot => ({ from: slot.range.from - lineStart, to: slot.range.to - lineStart, kind: "slot" as const, slot }))
  ].sort((a, b) => a.from - b.from || a.to - b.to);
  for (let index = 1; index < events.length; index += 1) {
    const previous = events[index - 1], current = events[index];
    if (previous.to > current.from && previous.kind !== "omit" && current.kind !== "omit") return null;
    if (previous.kind === "omit" && current.kind === "slot" && previous.to > current.from) return null;
    if (previous.kind === "slot" && current.kind === "omit" && previous.to > current.from) return null;
  }

  let text = "";
  let cursor = window.from;
  let eventIndex = 0;
  const segments: Segment[] = [];
  const placeholders: string[] = [];
  let prefix = "ProtectedLiveMarkdownAtom";
  let collisionCount = 0;
  while (line.includes(prefix)) {
    if (collisionCount >= 16) return null;
    prefix += "X";
    collisionCount += 1;
  }
  const appendReadonly = (value: string, placeholder?: string) => {
    if (!value) return;
    const viewFrom = text.length;
    text += value;
    segments.push({ kind: "readonly", viewFrom, viewTo: text.length, ...(placeholder ? { placeholder } : {}) });
  };

  while (cursor < window.to || eventIndex < events.length) {
    const event = events[eventIndex];
    if (!event || event.from > cursor) {
      const next = Math.min(event?.from ?? window.to, window.to);
      appendReadonly(line.slice(cursor, next));
      cursor = next;
      continue;
    }
    if (event.to <= cursor) { eventIndex += 1; continue; }
    if (event.kind === "omit") {
      cursor = event.to;
      eventIndex += 1;
      continue;
    }
    if (event.kind === "slot") {
      const sourceText = line.slice(event.from, event.to);
      if (sourceText !== event.slot.sourceText) return null;
      const viewFrom = text.length;
      text += sourceText;
      segments.push({ kind: "owned", viewFrom, viewTo: text.length, slotId: event.slot.id, slotFrom: 0, slotTo: sourceText.length,
        ...(event.slot.dateOwnerFact ? { dateOwnerFact: event.slot.dateOwnerFact } : {}) });
      cursor = event.to;
      eventIndex += 1;
      continue;
    }
    const placeholder = placeholderFor(event.kind, placeholders.length + 1, prefix);
    placeholders.push(placeholder);
    appendReadonly(placeholder, placeholder);
    cursor = event.to;
    eventIndex += 1;
  }
  return { text, segments, placeholders };
}

const sentenceEndings = new Set([".", "!", "?", "。", "！", "？"]);
const cjkSentenceEndings = new Set(["。", "！", "？"]);
const sentenceClosers = new Set(["\"", "'", "”", "’", "»", ")", "]", "}"]);
const sentenceQuoteClosers = new Set(["\"", "'", "”", "’", "»"]);
const commonAbbreviations = new Set(["dr.", "mr.", "mrs.", "ms.", "prof.", "sr.", "jr.", "st.", "vs.", "etc.", "e.g.", "i.e.", "no.", "fig.", "inc.", "ltd."]);

function isSentenceAbbreviation(line: string, end: number): boolean {
  const prefix = line.slice(0, end);
  const token = prefix.match(/(?:^|\s)([\p{L}.]+)$/u)?.[1]?.toLocaleLowerCase();
  if (token && commonAbbreviations.has(token)) return true;
  return /(?:^|\s)(?:[A-Z]\.){1,5}$/u.test(prefix);
}

function codePointEntries(text: string): Array<{ value: string; from: number; to: number }> {
  const entries: Array<{ value: string; from: number; to: number }> = [];
  let offset = 0;
  for (const value of text) {
    const to = offset + value.length;
    entries.push({ value, from: offset, to });
    offset = to;
  }
  return entries;
}

function mergedSentenceUnsafeRanges(ranges: readonly Range[]): Range[] {
  const ordered = [...ranges].filter(({ from, to }) => from < to).sort((left, right) => left.from - right.from || left.to - right.to);
  const merged: Range[] = [];
  for (const range of ordered) {
    const previous = merged.at(-1);
    if (previous && range.from < previous.to) previous.to = Math.max(previous.to, range.to);
    else merged.push({ ...range });
  }
  return merged;
}

function crossesRange(ranges: readonly Range[], from: number, to: number): boolean {
  let low = 0, high = ranges.length;
  while (low < high) {
    const middle = low + ((high - low) >> 1);
    if (ranges[middle]!.to <= from) low = middle + 1;
    else high = middle;
  }
  const candidate = ranges[low];
  return Boolean(candidate && candidate.from < to && candidate.to > from);
}

function lineSentenceCuts(line: string, unsafeRanges: readonly Range[]): number[] {
  const points = codePointEntries(line);
  const cuts: number[] = [];
  for (let index = 0; index < points.length; index += 1) {
    if (!sentenceEndings.has(points[index]!.value)) continue;
    if (points[index]!.value === "." && ((points[index - 1]?.value === ".") || (points[index + 1]?.value === "."))) continue;
    let endIndex = index + 1;
    while (sentenceEndings.has(points[endIndex]?.value ?? "") && points[endIndex]?.value !== "…") endIndex += 1;
    let hasQuoteCloser = false;
    while (sentenceClosers.has(points[endIndex]?.value ?? "")) {
      hasQuoteCloser ||= sentenceQuoteClosers.has(points[endIndex]!.value);
      endIndex += 1;
    }
    const hasWhitespace = /\s/u.test(points[endIndex]?.value ?? "");
    if (!hasWhitespace && !cjkSentenceEndings.has(points[index]!.value) && !hasQuoteCloser) continue;
    let nextIndex = endIndex;
    if (hasWhitespace) while (/\s/u.test(points[nextIndex]?.value ?? "")) nextIndex += 1;
    if (nextIndex >= points.length) continue;
    const punctuationEnd = points[endIndex - 1]!.to;
    const cut = points[(hasWhitespace ? nextIndex : endIndex) - 1]!.to;
    const punctuationStart = points[index]!.from;
    if (points[index]!.value === "." && isSentenceAbbreviation(line, punctuationEnd)) continue;
    if (crossesRange(unsafeRanges, punctuationStart, cut)) continue;
    if (cuts.at(-1) !== cut) cuts.push(cut);
    index = nextIndex - 1;
  }
  return cuts;
}

/** Returns physical-line sentence windows using AST-protected ranges from the complete source line. */
export function readableProseSentenceWindows(source: string, lineRange: ReadableProseWindow): ReadableProseWindow[] | null {
  if (!Number.isSafeInteger(lineRange.from) || !Number.isSafeInteger(lineRange.to) || lineRange.from < 0 ||
      lineRange.from >= lineRange.to || lineRange.to > source.length) return null;
  const physicalLine = lineBounds(source, lineRange.from);
  if (physicalLine.from !== lineRange.from || physicalLine.to !== lineRange.to) return null;
  const line = source.slice(lineRange.from, lineRange.to);
  if (codePointLength(line) > MAX_LINE_CODEPOINTS || /[\p{Cc}\p{Zl}\p{Zp}]/u.test(line)) return null;
  const markdown = collectMarkdownRanges(line);
  if (!markdown) return null;
  const cuts = lineSentenceCuts(line, mergedSentenceUnsafeRanges(markdown.sentenceUnsafe));
  const ranges: ReadableProseWindow[] = [];
  let cursor = lineRange.from;
  for (const cut of cuts) {
    const to = lineRange.from + cut;
    if (to > cursor) ranges.push({ from: cursor, to });
    cursor = to;
  }
  if (cursor < lineRange.to) ranges.push({ from: cursor, to: lineRange.to });
  return ranges.length ? ranges : [lineRange];
}

function reconstructHunks(oldText: string, newText: string, oldTokens: InlineToken[], newTokens: InlineToken[]): Array<{ from: number; to: number; replacement: string }> {
  if (oldTokens.map(token => token.text).join("") !== oldText || newTokens.map(token => token.text).join("") !== newText) {
    throw new Error("单行文本差异无法可靠定位，原文未修改。");
  }
  let oldIndex = 0, newIndex = 0, oldInner = 0, newInner = 0, oldOffset = 0;
  let hunkStart: number | undefined;
  let inserted = "";
  const hunks: Array<{ from: number; to: number; replacement: string }> = [];
  const tokenAt = (tokens: InlineToken[], index: number) => tokens[index];
  const advance = (tokens: InlineToken[], index: number, inner: number) => {
    const token = tokens[index];
    if (!token) return { index, inner };
    const next = inner + 1;
    return next >= token.text.length ? { index: index + 1, inner: 0 } : { index, inner: next };
  };
  const finish = () => {
    if (hunkStart === undefined) return;
    hunks.push({ from: hunkStart, to: oldOffset, replacement: inserted });
    hunkStart = undefined; inserted = "";
  };
  while (oldIndex < oldTokens.length || newIndex < newTokens.length) {
    const oldToken = tokenAt(oldTokens, oldIndex), newToken = tokenAt(newTokens, newIndex);
    if (oldToken?.type === "unchanged" && newToken?.type === "unchanged") {
      const oldRemaining = oldToken.text.slice(oldInner), newRemaining = newToken.text.slice(newInner);
      const width = Math.min(oldRemaining.length, newRemaining.length);
      if (oldRemaining.slice(0, width) !== newRemaining.slice(0, width)) throw new Error("差异锚点不一致，原文未修改。");
      finish();
      oldOffset += width;
      const nextOld = advance(oldTokens, oldIndex, oldInner + width - 1);
      const nextNew = advance(newTokens, newIndex, newInner + width - 1);
      oldIndex = nextOld.index; oldInner = nextOld.inner;
      newIndex = nextNew.index; newInner = nextNew.inner;
      continue;
    }
    if (oldToken?.type === "deleted" || newToken?.type === "added") {
      if (hunkStart === undefined) hunkStart = oldOffset;
      if (oldToken?.type === "deleted") {
        const value = oldToken.text.slice(oldInner);
        oldOffset += value.length;
        oldIndex += 1; oldInner = 0;
      }
      if (newToken?.type === "added") {
        inserted += newToken.text.slice(newInner);
        newIndex += 1; newInner = 0;
      }
      continue;
    }
    throw new Error("差异令牌无法配对，原文未修改。");
  }
  finish();
  return hunks;
}

function projectHunks(text: string, raw: string, segments: readonly Segment[], slotIds: readonly string[]): Map<string, string> {
  const restoredRaw = normalizeProseReadonlySurface(text, raw, segments, MAX_MODEL_OUTPUT_CODEPOINTS);
  const diff = computeInlineDiff(text, restoredRaw);
  const edits = new Map<string, Array<{ from: number; to: number; text: string }>>();
  const hunks = reconstructHunks(text, restoredRaw, diff.oldTokens, diff.newTokens);
  for (const hunk of hunks) {
    const candidates = segments.filter(segment => segment.kind === "owned" &&
      (hunk.from === hunk.to
        ? hunk.from > segment.viewFrom && hunk.from < segment.viewTo
        : hunk.from >= segment.viewFrom && hunk.to <= segment.viewTo));
    const boundaryWhitespace = hunk.from === hunk.to && /^\p{Zs}+$/u.test(hunk.replacement);
    const boundaryCandidates = hunk.from === hunk.to ? segments.filter(segment => segment.kind === "owned" &&
      (boundaryWhitespace || segment.dateOwnerFact) && (hunk.from === segment.viewFrom || hunk.from === segment.viewTo)) : [];
    const owners = candidates.length ? candidates : boundaryCandidates;
    if (owners.length !== 1) throw new Error("模型修改了只读内容或跨越多个正文槽，原文未修改。");
    const owner = owners[0] as Extract<Segment, { kind: "owned" }>;
    const slotEdits = edits.get(owner.slotId) ?? [];
    const slotFrom = hunk.from <= owner.viewFrom ? owner.slotFrom
      : hunk.from >= owner.viewTo ? owner.slotTo
        : owner.slotFrom + hunk.from - owner.viewFrom;
    slotEdits.push({
      from: slotFrom,
      to: hunk.from === hunk.to ? slotFrom : owner.slotFrom + hunk.to - owner.viewFrom,
      text: hunk.replacement
    });
    edits.set(owner.slotId, slotEdits);
  }
  const decoded = new Map<string, string>();
  for (const id of slotIds) {
    const owner = segments.find(segment => segment.kind === "owned" && segment.slotId === id);
    if (!owner || owner.kind !== "owned") throw new Error("只读视图缺少已授权正文槽，原文未修改。");
    let value = text.slice(owner.viewFrom, owner.viewTo);
    for (const edit of (edits.get(id) ?? []).sort((a, b) => b.from - a.from || b.to - a.to)) {
      value = value.slice(0, edit.from) + edit.text + value.slice(edit.to);
    }
    if (!value.trim()) throw new Error("正文校对清空了已有文本范围，原文未修改。");
    decoded.set(id, value);
  }
  return decoded;
}

/** Builds a bounded readable line; null means the caller must select its existing slot protocol pre-inference. */
export function prepareReadableProse(
  source: string,
  slots: readonly ThinProseSlot[],
  sourceWindow?: ReadableProseWindow
): ReadableProseView | null {
  if (!slots.length || slots.length > MAX_OWNED_SLOTS) return null;
  const ids = new Set<string>();
  let previousEnd = -1;
  for (const slot of slots) {
    if (!slot.id || ids.has(slot.id) || !Number.isSafeInteger(slot.range.from) || !Number.isSafeInteger(slot.range.to) ||
      slot.range.from < 0 || slot.range.from >= slot.range.to || slot.range.to > source.length || slot.range.from < previousEnd ||
      source.slice(slot.range.from, slot.range.to) !== slot.sourceText) return null;
    ids.add(slot.id);
    previousEnd = slot.range.to;
  }
  const first = lineBounds(source, slots[0].range.from);
  const last = lineBounds(source, slots.at(-1)!.range.to);
  if (first.from !== last.from || first.to !== last.to || slots.some(slot => slot.range.from < first.from || slot.range.to > first.to)) return null;
  const line = source.slice(first.from, first.to);
  if (line.length > MAX_LINE_CODEPOINTS * 2) return null;
  if (codePointLength(line) > MAX_LINE_CODEPOINTS || /[\p{Cc}\p{Zl}\p{Zp}]/u.test(line)) return null;
  const window = sourceWindow ?? first;
  if (!Number.isSafeInteger(window.from) || !Number.isSafeInteger(window.to) || window.from < first.from ||
      window.from >= window.to || window.to > first.to || slots.some(slot => slot.range.from < window.from || slot.range.to > window.to)) return null;
  const relativeWindow = { from: window.from - first.from, to: window.to - first.from };
  if ([relativeWindow.from, relativeWindow.to].some(offset => offset > 0 && offset < line.length &&
      line.charCodeAt(offset) >= 0xdc00 && line.charCodeAt(offset) <= 0xdfff &&
      line.charCodeAt(offset - 1) >= 0xd800 && line.charCodeAt(offset - 1) <= 0xdbff)) return null;

  const markdown = collectMarkdownRanges(line);
  if (!markdown) return null;
  const atoms = mergeAtoms(markdown.atoms);
  const omissions = mergeOmissions(markdown.omissions, atoms);
  if (markdown.sentenceUnsafe.some(({ from, to }) =>
    (from < relativeWindow.from && to > relativeWindow.from) || (from < relativeWindow.to && to > relativeWindow.to))) return null;
  const rendered = renderView(line, slots, first.from, atoms, omissions, relativeWindow);
  if (!rendered || codePointLength(rendered.text) > MAX_VIEW_CODEPOINTS) return null;
  const ownedSegments = rendered.segments.filter((segment): segment is Extract<Segment, { kind: "owned" }> => segment.kind === "owned");
  if (ownedSegments.length !== slots.length || ownedSegments.some(segment => segment.slotTo - segment.slotFrom !== segment.viewTo - segment.viewFrom)) return null;

  const dateOwnerSlots = slots.filter(slot => slot.dateOwnerFact);
  if (dateOwnerSlots.length && (dateOwnerSlots.length !== 1 || slots.length !== 1 || rendered.placeholders.length ||
      rendered.text !== dateOwnerSlots[0]!.sourceText)) return null;
  const dateOwnerFact = dateOwnerSlots[0]?.dateOwnerFact;
  const normalizeSurface = (raw: string) => dateOwnerFact
    ? normalizeOwnedProseDateSurface(rendered.text, raw, rendered.segments, MAX_MODEL_OUTPUT_CODEPOINTS, dateOwnerFact)
    : normalizeProseReadonlySurface(rendered.text, raw, rendered.segments, MAX_MODEL_OUTPUT_CODEPOINTS);

  return {
    text: rendered.text,
    readonlyPlaceholders: rendered.placeholders,
    normalizeReadonlySurface(raw) { return normalizeSurface(raw); },
    decode(raw) { return projectHunks(rendered.text, normalizeSurface(raw), rendered.segments, slots.map(({ id }) => id)); }
  };
}
