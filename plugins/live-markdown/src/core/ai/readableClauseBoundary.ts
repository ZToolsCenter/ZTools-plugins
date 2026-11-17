interface Range { readonly from: number; readonly to: number; }

export interface ReadonlyCommaBoundary {
  readonly sourceDocument: string;
  readonly sourceRange: Range;
  readonly separatorRange: Range;
  readonly sourceText: string;
  readonly separatorText: string;
}

const MAX_WINDOW_CODEPOINTS = 256;
const MAX_SEPARATOR_CODEPOINTS = 16;
const MAX_RAW_CHARS = 32_768;
const issuedBoundaries = new WeakSet<ReadonlyCommaBoundary>();

function validRange(range: Range, length: number): boolean {
  return Boolean(range) && Number.isSafeInteger(range.from) && Number.isSafeInteger(range.to) &&
    range.from >= 0 && range.from < range.to && range.to <= length;
}

/** Only the already-planned Han clause path can attach this exact source/separator pair. */
export function createReadonlyCommaBoundary(source: string, sourceRange: Range, separatorRange: Range): ReadonlyCommaBoundary | undefined {
  if (!validRange(sourceRange, source.length) || !validRange(separatorRange, source.length) ||
      sourceRange.to !== separatorRange.from) return undefined;
  const sourceText = source.slice(sourceRange.from, sourceRange.to);
  const separatorText = source.slice(separatorRange.from, separatorRange.to);
  if (!/\p{Script=Han}/u.test(sourceText) || /[\r\n]/u.test(sourceText) ||
      /[。！？.!?][\p{Zs}]*$/u.test(sourceText) || Array.from(sourceText).length > MAX_WINDOW_CODEPOINTS ||
      !/^[\p{Zs}]*，[\p{Zs}]*$/u.test(separatorText) || Array.from(separatorText).length > MAX_SEPARATOR_CODEPOINTS) return undefined;
  const boundary = Object.freeze({ sourceDocument: source, sourceRange: Object.freeze({ ...sourceRange }),
    separatorRange: Object.freeze({ ...separatorRange }), sourceText, separatorText });
  issuedBoundaries.add(boundary);
  return boundary;
}

/** Recover one model-added sentence terminator, keeping the original literal comma and all other text. */
export function restoreReadonlyCommaBoundary(source: string, boundary: ReadonlyCommaBoundary | undefined, raw: string): string {
  if (!boundary || !issuedBoundaries.has(boundary) || source !== boundary.sourceDocument || raw.length > MAX_RAW_CHARS || /[\r\n\t]/u.test(raw) ||
      !validRange(boundary.sourceRange, source.length) || !validRange(boundary.separatorRange, source.length) ||
      boundary.sourceRange.to !== boundary.separatorRange.from ||
      source.slice(boundary.sourceRange.from, boundary.sourceRange.to) !== boundary.sourceText ||
      source.slice(boundary.separatorRange.from, boundary.separatorRange.to) !== boundary.separatorText ||
      !/^[\p{Zs}]*，[\p{Zs}]*$/u.test(boundary.separatorText)) return raw;
  const tail = /。([\p{Zs}]*)$/u.exec(raw);
  if (!tail || tail.index === 0 || /[。！？.!?]/u.test(raw[tail.index - 1]!)) return raw;
  return raw.slice(0, tail.index) + tail[1];
}
