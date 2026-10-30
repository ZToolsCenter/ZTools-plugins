export type RtfUrlCandidatesV2 = Readonly<{ complete: boolean; values: readonly string[] }>;
const MAX_CANDIDATES = 20_000;
const END_OF_URL = /[\s<>"{}]/u;

function isLetter(unit: number): boolean {
  return (unit >= 65 && unit <= 90) || (unit >= 97 && unit <= 122);
}
function isSchemeUnit(unit: number): boolean {
  return isLetter(unit) || (unit >= 48 && unit <= 57) || unit === 43 || unit === 45 || unit === 46;
}

/** Static URI candidates only. Each input unit is visited at most twice; no opening or normalization. */
export function collectRtfUrlCandidatesV2(value: string): RtfUrlCandidatesV2 {
  const values: string[] = [];
  let start = -1;
  let cursor = 0;
  while (cursor < value.length) {
    const unit = value.charCodeAt(cursor);
    if (isLetter(unit)) {
      if (start < 0) start = cursor;
    } else if (start >= 0 && isSchemeUnit(unit)) {
      // Continue the earliest possible ASCII scheme without retrying its suffixes.
    } else if (start >= 0 && unit === 58) {
      let end = cursor + 1;
      while (end < value.length && !END_OF_URL.test(value[end]!)) end++;
      if (end > cursor + 1) {
        if (values.length === MAX_CANDIDATES) return { complete: false, values };
        values.push(value.slice(start, end));
        cursor = end;
        start = -1;
        continue;
      }
      start = -1;
    } else {
      start = -1;
    }
    cursor++;
  }
  return { complete: true, values };
}
