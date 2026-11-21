import type { ArtifactHeading } from "./artifactSpec";

export interface HeadingRecord { level: number; text: string; }

export interface HeadingSequenceFailure {
  readonly code: "missing_heading" | "heading_level_mismatch" | "heading_text_mismatch" | "heading_order_mismatch";
  readonly message: string;
  readonly actual?: unknown;
  readonly required?: unknown;
}

export function decodeMarkdownInlineText(value: string): string {
  return value.replace(/<br\s*\/?>/giu, "\n")
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/giu, (_entity, name: string) => {
      const chars: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " };
      return chars[name.toLowerCase()];
    })
    .replace(/&#(\d+);/gu, (_entity, decimal: string) => String.fromCodePoint(Number(decimal)))
    .replace(/&#x([\da-f]+);/giu, (_entity, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/\\([!"#$%&'()*+,\-.\/:;<=>?@\[\\\]^_`{|}~])/gu, "$1");
}

function linesOf(text: string): string[] { return text.replace(/\r\n?/gu, "\n").split("\n"); }

/** Extracts ATX headings while ignoring fenced-code examples and Markdown escapes. */
export function headingsIn(text: string): HeadingRecord[] {
  const lines = linesOf(text);
  const headings: HeadingRecord[] = [];
  let fenceCharacter = "";
  let fenceLength = 0;
  for (const line of lines) {
    const fence = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line);
    if (fence) {
      if (!fenceCharacter) { fenceCharacter = fence[1][0]; fenceLength = fence[1].length; }
      else if (fence[1][0] === fenceCharacter && fence[1].length >= fenceLength && !fence[2].trim()) {
        fenceCharacter = "";
        fenceLength = 0;
      }
      continue;
    }
    if (fenceCharacter) continue;
    const match = /^ {0,3}(#{1,6})[\t ]+(.+?)[\t ]*$/u.exec(line);
    if (!match) continue;
    const content = match[2].replace(/(?<!\\)[\t ]+#+[\t ]*$/u, "").trim();
    if (content) headings.push({ level: match[1].length, text: decodeMarkdownInlineText(content) });
  }
  return headings;
}

/** Returns the first concrete mismatch in a required ordered heading sequence. */
export function headingSequenceFailure(
  expected: readonly ArtifactHeading[],
  candidates: readonly HeadingRecord[]
): HeadingSequenceFailure | undefined {
  let cursor = 0;
  for (const [index, heading] of expected.entries()) {
    const remaining = candidates.slice(cursor);
    const textMatches = heading.text ? remaining.filter(({ text }) => text === heading.text!.value) : remaining;
    if (!textMatches.length) {
      const appearedBefore = heading.text && candidates.slice(0, cursor).some(({ text }) => text === heading.text!.value);
      if (appearedBefore) return { code: "heading_order_mismatch", message: "标题顺序与指令不一致", actual: candidates, required: expected };
      if (!candidates.length) return { code: "missing_heading", message: "缺少 Markdown 标题", actual: [], required: heading };
      if (heading.text && !candidates.some(({ text }) => text === heading.text!.value)) {
        return { code: "heading_text_mismatch", message: "标题文字与规格不一致", actual: candidates.map(({ text }) => text), required: heading.text.value };
      }
      return { code: "missing_heading", message: `缺少第 ${index + 1} 个指定标题`, actual: candidates, required: heading };
    }
    const levelMatch = heading.level
      ? textMatches.find(({ level }) => level === heading.level!.value)
      : textMatches[0];
    if (!levelMatch) {
      return { code: "heading_level_mismatch", message: "标题级别与规格不一致", actual: textMatches.map(({ level }) => level), required: heading.level?.value };
    }
    cursor = candidates.indexOf(levelMatch) + 1;
  }
  return undefined;
}
