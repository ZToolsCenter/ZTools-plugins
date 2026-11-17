import { restoreUniqueEnglishIntegerSpellings } from "./proseNumericSpelling";
import { restoreUniqueEquivalentIsoDate } from "./proseFactSurface";
import { restoreSourceTerminalMark } from "./proseReadonlyTrivia";
import { validateProseDateOwnerReplacement, type ProseDateOwnerFact } from "./proseDateOwnership";

export interface ProseSurfaceSegment {
  readonly kind: "owned" | "readonly";
  readonly viewFrom: number;
  readonly viewTo: number;
  readonly placeholder?: string;
}

function codePointLength(value: string): number { return Array.from(value).length; }
function numericAtoms(value: string): string[] { return value.match(/\p{N}+/gu) ?? []; }

/** Canonicalizes only source-backed readonly spellings before strict NLP comparison. */
export function normalizeProseReadonlySurface(
  sourceView: string,
  raw: string,
  segments: readonly ProseSurfaceSegment[],
  maxCodePoints: number
): string {
  if (!raw.trim() || raw.length > maxCodePoints * 2 || codePointLength(raw) > maxCodePoints || /[\p{Cc}\p{Zl}\p{Zp}]/u.test(raw)) {
    throw new Error("模型必须只返回长度受限的一行普通文本，原文未修改。");
  }
  let previous = -1;
  for (const placeholder of segments.flatMap(segment => segment.kind === "readonly" && segment.placeholder ? [segment.placeholder] : [])) {
    const first = raw.indexOf(placeholder);
    if (first < 0 || first !== raw.lastIndexOf(placeholder) || first <= previous) {
      throw new Error("模型改变了受保护内容占位词，原文未修改。");
    }
    previous = first;
  }

  const readonlySegments = segments.filter(segment => segment.kind === "readonly");
  const factReadonlyRanges = readonlySegments.flatMap(segment =>
    segment.placeholder ? [] : [{ from: segment.viewFrom, to: segment.viewTo }]);
  const withSourceTrivia = restoreSourceTerminalMark(sourceView, raw, readonlySegments);
  const withSourceDate = restoreUniqueEquivalentIsoDate(sourceView, withSourceTrivia, factReadonlyRanges);
  const withSourceNumbers = restoreUniqueEnglishIntegerSpellings(sourceView, withSourceDate, factReadonlyRanges);
  const sourceNumbers = numericAtoms(sourceView).join("\u0000");
  const normalizedNumbers = numericAtoms(withSourceNumbers).join("\u0000");
  const normalized = sourceNumbers === normalizedNumbers ? withSourceNumbers : withSourceDate;
  if (codePointLength(normalized) > maxCodePoints) {
    throw new Error("模型必须只返回长度受限的一行普通文本，原文未修改。");
  }
  return normalized;
}

/** Restores an equivalent date spelling only after the source-bound owner/event relation matches. */
export function normalizeOwnedProseDateSurface(
  sourceView: string,
  raw: string,
  segments: readonly ProseSurfaceSegment[],
  maxCodePoints: number,
  fact: ProseDateOwnerFact
): string {
  const normalized = normalizeProseReadonlySurface(sourceView, raw, segments, maxCodePoints);
  return validateProseDateOwnerReplacement(fact, sourceView, normalized);
}
