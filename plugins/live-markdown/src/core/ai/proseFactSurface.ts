export interface ReadonlyProseSpan {
  readonly from: number;
  readonly to: number;
}

interface CalendarDate {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

export interface ProseDateSurface extends CalendarDate {
  readonly from: number;
  readonly to: number;
  readonly text: string;
  readonly format: "iso" | "chinese";
  readonly iso: string;
  readonly safe: boolean;
}

const ISO_DATE = /(?<![\p{Script=Latin}\p{Script=Greek}\p{N}_])(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})(?![\p{N}_])/gu;
const CHINESE_DATE = /(?<![\p{Script=Latin}\p{Script=Greek}\p{N}_])(?<year>\d{4})年(?<month>\d{1,2})月(?<day>\d{1,2})日(?![\p{N}_])/gu;

function isGregorianDate({ year, month, day }: CalendarDate): boolean {
  if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthLengths = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= monthLengths[month - 1]!;
}

function hasTimeZoneOrRange(text: string, from: number, to: number): boolean {
  const before = text.slice(Math.max(0, from - 32), from);
  const after = text.slice(to, to + 32);
  if (/[+-]$/u.test(before) || /^[+-]/u.test(after)) return true;
  if (/^[\p{Zs}]*(?:至今|至今日|至目前|到目前(?:为止)?|截至目前|截至今日|迄今|(?:to|through|until)[\p{Zs}]+(?:present|today|date))(?![\p{L}])/iu.test(after)) return true;
  if (/(?:[-‐‑‒–—−~～/]|至|到|\b(?:to|through|until))[\p{Zs}]*$/iu.test(before) ||
      /^[\p{Zs}]*(?:[-‐‑‒–—−~～/]|至|到|\b(?:to|through|until))[\p{Zs}]*\d/iu.test(after)) return true;
  return /^(?:[Zz](?![\p{L}])|[Tt]\d{1,2}:\d{2}|\d{1,2}:\d{2}|[\p{Zs}]+\d{1,2}:\d{2}|[\p{Zs}]*[+-]\d{1,2}(?::?\d{2})?(?!\d)|[\p{Zs}]*(?:UTC|GMT|[A-Z]{2,5})(?![\p{L}])|[\p{Zs}]*(?:[A-Za-z_+-]+\/[A-Za-z_+-]+))/iu.test(after);
}

function collectDateSurfaces(text: string): ProseDateSurface[] {
  const matches: ProseDateSurface[] = [];
  const collect = (pattern: RegExp, format: ProseDateSurface["format"]) => {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const groups = match.groups;
      if (!groups) continue;
      const from = match.index ?? 0;
      const token = match[0];
      const to = from + token.length;
      const date = {
        year: Number(groups.year),
        month: Number(groups.month),
        day: Number(groups.day)
      };
      matches.push({
        ...date,
        from,
        to,
        text: token,
        format,
        iso: `${String(date.year).padStart(4, "0")}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`,
        safe: isGregorianDate(date) && !hasTimeZoneOrRange(text, from, to)
      });
    }
  };
  collect(ISO_DATE, "iso");
  collect(CHINESE_DATE, "chinese");
  return matches.sort((left, right) => left.from - right.from || left.to - right.to);
}

/** Returns source-backed calendar surfaces with offsets relative to the supplied text. */
export function scanProseDateSurfaces(text: string, sourceOffset = 0): ProseDateSurface[] {
  if (!Number.isSafeInteger(sourceOffset) || sourceOffset < 0) return [];
  return collectDateSurfaces(text).map(date => ({ ...date, from: date.from + sourceOffset, to: date.to + sourceOffset }));
}

function sameCalendarDate(left: CalendarDate, right: CalendarDate): boolean {
  return left.year === right.year && left.month === right.month && left.day === right.day;
}

/** Restores one unique Chinese date spelling to its trusted, read-only ISO source token. */
export function restoreUniqueEquivalentIsoDate(
  sourceView: string,
  modelView: string,
  readonlySpans: readonly ReadonlyProseSpan[]
): string {
  const sourceDates = collectDateSurfaces(sourceView);
  const modelDates = collectDateSurfaces(modelView);
  if (sourceDates.length !== 1 || modelDates.length !== 1) return modelView;

  const sourceDate = sourceDates[0]!;
  const modelDate = modelDates[0]!;
  const trustedReadonlySource = readonlySpans.some(span => sourceDate.from >= span.from && sourceDate.to <= span.to);
  if (!trustedReadonlySource || !sourceDate.safe || sourceDate.format !== "iso" ||
      !modelDate.safe || modelDate.format !== "chinese" || !sameCalendarDate(sourceDate, modelDate)) return modelView;

  return modelView.slice(0, modelDate.from) + sourceDate.text + modelView.slice(modelDate.to);
}
