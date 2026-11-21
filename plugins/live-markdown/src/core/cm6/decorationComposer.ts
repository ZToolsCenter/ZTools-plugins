import { RangeSetBuilder } from "@codemirror/state";
import { DecorationSet } from "@codemirror/view";
import { TextDecorationEntry } from "./textNodeDecorations";

function compareEntries(a: TextDecorationEntry, b: TextDecorationEntry): number {
  if (a.from !== b.from) return a.from - b.from;
  if (a.priority !== b.priority) return a.priority - b.priority;
  return a.to - b.to;
}

function acceptedReplacements(entries: readonly TextDecorationEntry[]): TextDecorationEntry[] {
  const replacements: TextDecorationEntry[] = [];
  let lastEnd = -1;
  for (const entry of entries) {
    if (entry.priority !== 0 || entry.from < lastEnd) continue;
    replacements.push(entry);
    lastEnd = entry.to;
  }
  return replacements;
}

function firstReplacementAfter(replacements: readonly TextDecorationEntry[], position: number): number {
  let low = 0;
  let high = replacements.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (replacements[middle].to <= position) low = middle + 1;
    else high = middle;
  }
  return low;
}

function visibleEntries(entries: readonly TextDecorationEntry[], replacements: readonly TextDecorationEntry[]): TextDecorationEntry[] {
  const accepted = new Set(replacements);
  const visible: TextDecorationEntry[] = [];
  for (const entry of entries) {
    if (entry.priority === -1 || (entry.priority === 0 && accepted.has(entry))) {
      visible.push(entry);
      continue;
    }
    if (entry.priority !== 1 || entry.from >= entry.to) continue;

    let visibleFrom = entry.from;
    const first = firstReplacementAfter(replacements, entry.from);
    for (let index = first; index < replacements.length; index++) {
      const replacement = replacements[index];
      if (replacement.from >= entry.to) break;
      if (visibleFrom < replacement.from) {
        visible.push({ ...entry, from: visibleFrom, to: Math.min(entry.to, replacement.from) });
      }
      visibleFrom = Math.max(visibleFrom, replacement.to);
      if (visibleFrom >= entry.to) break;
    }
    if (visibleFrom < entry.to) visible.push({ ...entry, from: visibleFrom });
  }
  return visible.sort(compareEntries);
}

export function composeLivePreviewDecorations(entries: TextDecorationEntry[]): DecorationSet {
  const sorted = entries.sort(compareEntries);
  const replacements = acceptedReplacements(sorted);
  const builder = new RangeSetBuilder<import("@codemirror/view").Decoration>();
  for (const entry of visibleEntries(sorted, replacements)) builder.add(entry.from, entry.to, entry.deco);
  return builder.finish();
}
