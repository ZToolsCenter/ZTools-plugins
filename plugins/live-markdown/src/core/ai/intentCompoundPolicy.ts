/**
 * Distinguishes safe single-anchor sequential block insertions (for example,
 * "insert A and below it insert B" at one position) from genuinely conflicting
 * multi-location or multi-operation compound edits (for example, "append A, then
 * polish the first paragraph").
 */

export interface SpanLike {
  from: number;
  to: number;
}

const SAME_ANCHOR_SEQUENCE =
  /^\s*(?:并|并且|同时|以及|且|然后|接着|再|\band(?:\s+then)?\b|\bthen\b|\balso\b)?\s*(?:在\s*)?(?:其|它|该[^\s，,。！？；;\n]{0,8}|上面|前面|上方)?(?:下面|下方|底下|底部|后面|之后|紧接着|下面一点|下一行|下边|below(?:\s+it)?|under(?:\s+it)?|underneath|after(?:\s+it)?|followed\s+by)\s*(?:再|也|继续|顺便|同时)?\s*$/iu;

const EXPLICIT_LOCATION_TOKEN =
  /(?:文末|文档末尾|全文末尾|文档底部|文章末尾|文件末尾|正文开头|文档开头|全文开头|当前选区|选区末尾|选区|所选|光标|第\s*[0-9零〇一二两三四五六七八九十]+\s*(?:个|处|段|行|条|节|章)|#{1,6}\s+\S+|标题|章节|small|first\s+paragraph|last\s+paragraph|beginning\s+of|end\s+of\s+(?:the\s+)?(?:document|file|article|selection))/iu;

/**
 * Returns the subset of edit-verb keys (`${from}:${to}`) that represent follow-up
 * sequential insertions sharing the preceding insertion anchor, so compound-edit
 * guards treat the whole sequence as one block insertion at a single anchor.
 */
export function sameAnchorSequentialInsertKeys(
  maskedInstruction: string,
  insertOperations: readonly SpanLike[],
  allOperations: readonly SpanLike[]
): Set<string> {
  const absorbed = new Set<string>();
  if (insertOperations.length < 2) return absorbed;
  if (allOperations.some((op) => !insertOperations.some((ins) => ins.from === op.from && ins.to === op.to))) {
    return absorbed;
  }

  const ordered = [...insertOperations].sort((a, b) => a.from - b.from || a.to - b.to);
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];
    const between = maskedInstruction.slice(previous.to, current.from);
    if (!/[。！？；;]/u.test(between) && !EXPLICIT_LOCATION_TOKEN.test(between)) {
      const connectorTail = between.match(/(?:并|并且|同时|以及|且|然后|接着|再|\band(?:\s+then)?\b|\bthen\b|\balso\b)([^。！？；;\n]*)$/iu);
      if (connectorTail && SAME_ANCHOR_SEQUENCE.test(connectorTail[0])) {
        absorbed.add(`${current.from}:${current.to}`);
        continue;
      }
      if (SAME_ANCHOR_SEQUENCE.test(between.replace(/^[^，,]*[，,]\s*/u, ""))) {
        absorbed.add(`${current.from}:${current.to}`);
      }
    }
  }
  return absorbed;
}

/**
 * Detects whether an instruction asks to insert multiple artifacts sequentially
 * at the same anchor (for example, an equation followed below by a Rust code block).
 */
export function hasSameAnchorSequentialArtifacts(maskedInstruction: string): boolean {
  return /(?:并|并且|同时|以及|且|然后|接着|再|\band(?:\s+then)?\b|\bthen\b|\balso\b)\s*(?:在\s*)?(?:其|它|该[^\s，,。！？；;\n]{0,8})?(?:下面|下方|底下|后面|之后|紧接着|下一行|below(?:\s+it)?|under(?:\s+it)?|after(?:\s+it)?|followed\s+by)/iu.test(
    maskedInstruction
  );
}

/**
 * Detects whether an instruction asks to insert at a natural-language anchor not
 * yet resolved by deterministic contract rules (for example, "4、5条中间" or
 * "between paragraph 1 and 2"), so thinTaskBinding delegates to the planner
 * instead of defaulting to `document_end`.
 */
export function hasUnresolvedRelativeAnchor(maskedInstruction: string): boolean {
  return /(?:[0-9零〇一二两三四五六七八九十]+(?:[、,，和及与-]|到)(?:第\s*)?[0-9零〇一二两三四五六七八九十]+\s*(?:条|项|行|段|点|节|部分|句)?\s*(?:之间|中间)|在\s*[^\s，,。！？；;\n]{1,16}(?:的)?(?:前面|后面|上面|下面|上方|下方|旁边|附近|之间|中间)|\bbetween\b[^.!?;\n]{1,40}\band\b|\b(?:before|after|above|below|under)\s+(?:the\s+)?(?:item|line|paragraph|section|equation|table|block))/iu.test(
    maskedInstruction
  );
}

/** True when an ordinal token starts an interval like "第4、5条中间" rather than a single occurrence. */
export function isOrdinalRangeAnchor(maskedInstruction: string, ordinalEnd: number): boolean {
  return /^\s*(?:[、,，和及与-]|到)\s*(?:第\s*)?(?:[0-9]{1,4}|[零〇一二两三四五六七八九十]+)\s*(?:处|个|次|项|条|段)?\s*(?:之间|中间)/u.test(
    maskedInstruction.slice(ordinalEnd)
  );
}
