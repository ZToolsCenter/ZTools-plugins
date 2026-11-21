interface ProtectedRange { from: number; to: number; }

function mergeRanges(ranges: ProtectedRange[]): ProtectedRange[] {
  const sorted = ranges.filter(({ from, to }) => from < to).sort((left, right) => left.from - right.from || left.to - right.to);
  const merged: ProtectedRange[] = [];
  for (const range of sorted) {
    const previous = merged.at(-1);
    if (!previous || range.from > previous.to) merged.push({ ...range });
    else previous.to = Math.max(previous.to, range.to);
  }
  return merged;
}

/** Source spans that must stay intact while nearby prose is edited. */
export function proseEditProtectedRanges(text: string, sourceOffset: number): ProtectedRange[] {
  const ranges: ProtectedRange[] = [];
  const number = /[+\-]?(?:\d+(?:[.,:/\-]\d+)*)%?/gu;
  const quantity = /(?:(?:[$€£¥￥]|(?<![A-Za-z])[A-Z]{3}(?![A-Za-z])|人民币|美元|欧元|日元|英镑)\s*)?[+\-]?\d+(?:[.,:/\-]\d+)*(?:\s?(?:[%％]|[A-Za-zµμ°][A-Za-z0-9µμ°²³]*|万元|亿元|元|万|亿|个|件|人|次|天|周|月|年|日|小时|分钟|秒))?/gu;
  const mixedIdentifier = /[A-Za-z0-9]+(?:[._:/+\-][A-Za-z0-9]+)*/gu;
  const typoraScriptAtom = /(?<![\p{Script=Latin}\p{Script=Greek}\p{N}_])[\p{Script=Latin}\p{Script=Greek}\p{N}]+(?:(?:~[^~\s]+~|\^[^^\s]+\^)[\p{Script=Latin}\p{Script=Greek}\p{N}]*)+/gu;
  const emoji = /(?:\p{Regional_Indicator}{2}|[#*0-9]\uFE0F?\u20E3|\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier}|\u200D\p{Extended_Pictographic})*)/gu;
  const addMatches = (pattern: RegExp) => {
    for (const match of text.matchAll(pattern)) {
      const from = sourceOffset + (match.index ?? 0);
      ranges.push({ from, to: from + match[0].length });
    }
  };
  addMatches(number);
  addMatches(quantity);
  for (const match of text.matchAll(mixedIdentifier)) {
    if (/\d/.test(match[0]) && /[A-Za-z]/.test(match[0])) {
      const from = sourceOffset + (match.index ?? 0);
      ranges.push({ from, to: from + match[0].length });
    }
  }
  addMatches(typoraScriptAtom);
  addMatches(emoji);
  return mergeRanges(ranges);
}
