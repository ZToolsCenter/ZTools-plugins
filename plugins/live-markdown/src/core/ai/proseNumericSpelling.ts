interface Range { from: number; to: number; }

const SMALL = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
  "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"] as const;
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"] as const;
const integerToken = /(?<![\p{L}\p{M}\p{N}.,:/+\-_])(?:0|[1-9]\d?)(?![\p{L}\p{M}\p{N}.,:/+\-_])/gu;
const NUMBER_COMPOSITION_WORDS = new Set<string>([
  ...SMALL, ...TENS, "and", "hundred", "thousand", "million", "billion", "trillion", "quadrillion", "quintillion"
].filter(Boolean));

function spellInteger(value: number): string {
  if (value < 20) return SMALL[value];
  const tens = TENS[Math.floor(value / 10)];
  const unit = value % 10;
  return unit ? `${tens} ${SMALL[unit]}` : tens;
}

function integerSpellings(segment: string): Array<{ text: string; wordFrom: number; wordTo: number }> {
  const matches = [...segment.matchAll(integerToken)];
  if (matches.length > 4) return [];
  return matches.flatMap(match => {
    const token = match[0];
    const value = Number(token);
    // Avoid changing padded values, decimals, dates, identifiers, signs, or percentages.
    if (!Number.isSafeInteger(value) || value < 0 || value > 99 || token.length > 2 ||
        segment.slice((match.index ?? 0) + token.length).match(/^\s*(?:[%％]|percent(?:age)?\b|per\s+cent\b)/iu)) return [];
    const from = match.index ?? 0;
    const spelling = spellInteger(value);
    const candidate = segment.slice(0, from) + spelling + segment.slice(from + token.length);
    const stableContext = segment.slice(0, from) + segment.slice(from + token.length);
    if ([...stableContext.matchAll(/[\p{L}]{3,}/gu)].length === 0) return [];
    return [{ text: candidate, wordFrom: from, wordTo: from + spelling.length }];
  });
}

function occurrences(text: string, value: string): number[] {
  const positions: number[] = [];
  let from = 0;
  while (from <= text.length - value.length) {
    const found = text.indexOf(value, from);
    if (found < 0) break;
    positions.push(found);
    from = found + 1;
  }
  return positions;
}

function isNumberCompositionNeighbor(text: string, from: number, to: number): boolean {
  const previous = /([a-z]+)[\s-]*$/iu.exec(text.slice(0, from))?.[1]?.toLowerCase();
  const next = /^[\s-]*([a-z]+)/iu.exec(text.slice(to))?.[1]?.toLowerCase();
  if ((previous && NUMBER_COMPOSITION_WORDS.has(previous)) || (next && NUMBER_COMPOSITION_WORDS.has(next))) return true;
  const before = previousCodePoint(text, from);
  const after = to < text.length ? String.fromCodePoint(text.codePointAt(to)!) : "";
  return /[\p{L}\p{M}\p{N}_]/u.test(before) || /[\p{L}\p{M}\p{N}_]/u.test(after);
}

function previousCodePoint(text: string, offset: number): string {
  if (offset <= 0) return "";
  const last = text.charCodeAt(offset - 1);
  const previous = offset > 1 ? text.charCodeAt(offset - 2) : 0;
  const isLowSurrogate = last >= 0xdc00 && last <= 0xdfff;
  const hasHighSurrogate = previous >= 0xd800 && previous <= 0xdbff;
  return text.slice(isLowSurrogate && hasHighSurrogate ? offset - 2 : offset - 1, offset);
}

/**
 * Restores only a uniquely located read-only segment whose sole difference is one
 * small English integer written as words. The returned text still carries the exact
 * original numeric spelling, so the existing source-preservation diff remains strict.
 */
export function restoreUniqueEnglishIntegerSpellings(
  sourceView: string,
  raw: string,
  readonlyRanges: readonly Range[]
): string {
  const ordered = [...readonlyRanges].sort((a, b) => a.from - b.from || a.to - b.to);
  let result = raw;
  for (const range of ordered) {
    if (!Number.isSafeInteger(range.from) || !Number.isSafeInteger(range.to) || range.from < 0 || range.to <= range.from || range.to > sourceView.length) continue;
    const original = sourceView.slice(range.from, range.to);
    const variants = integerSpellings(original).filter(({ text }) => text !== original);
    if (!variants.length) continue;
    const matched = variants.flatMap(variant => occurrences(result, variant.text)
      .filter(position => !isNumberCompositionNeighbor(result, position + variant.wordFrom, position + variant.wordTo))
      .map(position => ({ ...variant, position })));
    if (matched.length !== 1) continue;
    const [{ text, position }] = matched;
    result = result.slice(0, position) + original + result.slice(position + text.length);
  }
  return result;
}
