/** Shared source-preserving paragraph typography; syntax ownership stays with each renderer. */
export function isRawHardBreak(line: string): boolean {
  if (/ {2,}$/.test(line)) return true;
  let slashes = 0;
  for (let index = line.length - 1; index >= 0 && line[index] === "\\"; index--) slashes++;
  return slashes % 2 === 1;
}

export function needsWordSpace(leftText: string, rightText: string): boolean {
  const left = lastCodePoint(stripEdgeFormatting(leftText, false));
  const right = firstCodePoint(stripEdgeFormatting(rightText, true));
  if (!left || !right) return false;
  const leftCode = left.codePointAt(0)!;
  const rightCode = right.codePointAt(0)!;
  if (isCjkCodePoint(leftCode) && isCjkCodePoint(rightCode)) return false;
  if (/^[,.;:!?%)\]}，。；：！？、）》】」』]$/u.test(right)) return false;
  if (/^[([{（《【「『]$/u.test(left)) return false;
  return true;
}

function stripEdgeFormatting(value: string, leading: boolean): string {
  const trimmed = value.trim();
  return leading
    ? trimmed.replace(/^(?:(?:\*\*|__|~~)|[*_~`])+/, "")
    : trimmed.replace(/(?:(?:\*\*|__|~~)|[*_~`])+$/, "");
}

export function firstCodePoint(value: string): string { return value ? String.fromCodePoint(value.codePointAt(0)!) : ""; }

function lastCodePoint(value: string): string {
  if (!value) return "";
  const last = value.charCodeAt(value.length - 1);
  const from = last >= 0xDC00 && last <= 0xDFFF && value.length > 1 ? value.length - 2 : value.length - 1;
  return String.fromCodePoint(value.codePointAt(from)!);
}

export function isCjkCodePoint(code: number): boolean {
  return (code >= 0x2E80 && code <= 0xA4CF) || (code >= 0xAC00 && code <= 0xD7AF)
    || (code >= 0xF900 && code <= 0xFAFF) || (code >= 0xFE30 && code <= 0xFE4F)
    || (code >= 0xFF00 && code <= 0xFFEF) || (code >= 0x20000 && code <= 0x323AF);
}

