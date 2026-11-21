const encoder = new TextEncoder();
type Literal = { id: string; text: string };

/** Supplies raw data only. The planner, never this extractor, decides its role or operation. */
export function extractIntentLiterals(instruction: string): Literal[] {
  const pairs = new Map<string, string>([["\"", "\""], ["'", "'"], ["“", "”"], ["‘", "’"], ["「", "」"], ["『", "』"]]);
  const texts: string[] = [];
  for (let index = 0; index < instruction.length; index += 1) {
    const close = pairs.get(instruction[index]);
    if (!close || isEscaped(instruction, index)) continue;
    let end = index + 1;
    while (end < instruction.length && (instruction[end] !== close || isEscaped(instruction, end))) end += 1;
    if (end >= instruction.length) continue;
    const text = instruction.slice(index + 1, end);
    if (text.trim()) texts.push(text);
    index = end;
  }
  if (texts.length) return assignIds(texts);
  const start = instruction.search(/[A-Za-z0-9]/u);
  if (start < 0 || !/\p{Script=Han}/u.test(instruction.slice(0, start))) return [];
  const spans = [...instruction.matchAll(/[^\p{Script=Han}]+/gu)]
    .filter((match) => {
      if (!/[A-Za-z0-9]/u.test(match[0])) return false;
      // Ordinal syntax is a qualifier, not an old/new text candidate.
      const numeric = /^\s*[0-9]{1,4}\s*$/u.test(match[0]);
      const before = instruction.slice(0, match.index);
      const after = instruction.slice(match.index + match[0].length);
      return !(numeric && /第\s*$/u.test(before) && /^(?:处|个|次|项|条|段)/u.test(after));
    });
  const tail = spans.at(-1);
  // Preserve a complete final data span: Markdown prefixes belong to the payload too.
  // Only an initial colon/whitespace separates an unquoted instruction from its data.
  if (tail && tail.index + tail[0].length === instruction.length && spans.length === 1) {
    const text = tail[0].replace(/^\s*[:：]?\s*/u, "");
    return encoder.encode(text).byteLength <= 256 ? assignIds([text]) : [];
  }
  // Han-separated ASCII spans supply both sides of requests such as “v1.2改为v2.0”.
  // Whitespace adjacent to the instruction words is a delimiter; quote significant edge spaces.
  const pieces = spans.map((match) => match[0].trim());
  if (pieces.length < 2 || pieces.length > 16 || pieces.some((text) => encoder.encode(text).byteLength > 256)) return [];
  return assignIds(pieces);
}

function assignIds(texts: string[]): Literal[] {
  return texts.map((text, index) => ({ id: `literal-${index + 1}`, text }));
}

function isEscaped(source: string, index: number): boolean {
  if (/[“”‘’「」『』]/u.test(source[index])) return false;
  let slashes = 0;
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === "\\"; cursor -= 1) slashes += 1;
  return slashes % 2 === 1;
}
