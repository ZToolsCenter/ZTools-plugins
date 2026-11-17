import type { InstructionLiteralEvidence, InstructionSpan } from "./intentContract";

export interface InstructionQuote extends InstructionLiteralEvidence {
  role: "unknown";
  open: string;
  close: string;
}

export interface LiteralOperationEvidence extends InstructionSpan {
  operation: "insert" | "replace_exact" | "rewrite";
  verb: string;
}

const QUOTE_PAIRS = new Map<string, string>([
  ["“", "”"], ["‘", "’"], ["「", "」"], ["『", "』"], ["《", "》"],
  ["\"", "\""], ["'", "'"], ["`", "`"]
]);

function isEscaped(source: string, index: number): boolean {
  let slashes = 0;
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === "\\"; cursor -= 1) slashes += 1;
  return slashes % 2 === 1;
}

function isEnglishApostrophe(source: string, index: number): boolean {
  return index > 0 && index + 1 < source.length &&
    /[\p{L}\p{N}]/u.test(source[index - 1]) && /[\p{L}\p{N}]/u.test(source[index + 1]);
}

/** Scans quote pairs once and returns exact UTF-16 payload ranges without decoding escapes. */
export function scanInstructionQuotes(source: string): InstructionQuote[] {
  const quotes: InstructionQuote[] = [];
  for (let index = 0; index < source.length; index += 1) {
    const open = source[index];
    const close = QUOTE_PAIRS.get(open);
    if (!close || isEscaped(source, index) || (open === "'" && isEnglishApostrophe(source, index))) continue;

    let end = index + 1;
    while (end < source.length) {
      if (source[end] === close && !isEscaped(source, end)) break;
      end += 1;
    }
    if (end >= source.length) continue;

    const from = index + 1;
    const raw = source.slice(from, end);
    quotes.push({ role: "unknown", from, to: end, raw, value: raw, open, close });
    index = end;
  }
  return quotes;
}

export function scanUnquotedLiteralCandidates(source: string, quotes: InstructionQuote[]): InstructionLiteralEvidence[] {
  const candidates: InstructionLiteralEvidence[] = [];
  const spans = /[^\p{Script=Han}]+/gu;
  for (const match of source.matchAll(spans)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (quotes.some((quote) => start <= quote.to && end >= quote.from - 1)) continue;
    if (!/[\p{L}\p{N}]/u.test(match[0])) continue;
    let from = start;
    let to = end;
    while (from < to && /\s/u.test(source[from])) from += 1;
    while (to > from && /\s/u.test(source[to - 1])) to -= 1;
    if (from === to) continue;

    const before = source.slice(0, from);
    const after = source.slice(to);
    const value = source.slice(from, to);
    if (/^\d{1,4}$/u.test(value) && /第\s*$/u.test(before) && /^\s*(?:处|个|次|项|条|段)/u.test(after)) continue;
    const qualifier = /^(?:last|first|second|third|fourth|fifth|the)\s+/iu.exec(value);
    if (qualifier && /\b(?:replace|append|insert|add)\b/iu.test(source)) {
      from += qualifier[0].length;
      if (from === to) continue;
    }
    candidates.push({ role: "unknown", from, to, raw: source.slice(from, to), value: source.slice(from, to) });
  }
  return candidates;
}

export function maskQuotedInstruction(source: string, quotes: InstructionQuote[]): string {
  const chars = source.split("");
  for (const quote of quotes) {
    const openAt = quote.from - 1;
    const closeAt = quote.to;
    for (let index = openAt; index <= closeAt; index += 1) {
      if (chars[index] !== "\n" && chars[index] !== "\r") chars[index] = " ";
    }
  }
  return chars.join("");
}

function evidence(source: string, role: InstructionLiteralEvidence["role"], from: number, to: number): InstructionLiteralEvidence {
  return { role, from, to, raw: source.slice(from, to), value: source.slice(from, to) };
}

function trimmedEvidence(source: string, role: "find" | "write", from: number, to: number): InstructionLiteralEvidence | undefined {
  while (from < to && /\s/u.test(source[from])) from += 1;
  while (to > from && /\s/u.test(source[to - 1])) to -= 1;
  return from < to ? evidence(source, role, from, to) : undefined;
}

function englishReplacementPair(source: string, verbs: LiteralOperationEvidence[]): InstructionLiteralEvidence[] {
  const replace = verbs.filter(({ operation, verb }) => operation === "replace_exact" && /^(?:replace|change)$/iu.test(verb));
  if (replace.length !== 1) return [];
  const verb = replace[0];
  const tail = source.slice(verb.to);
  const prefix = /^\s*(?:(?:only|just)\s+)?(?:(?:the\s+)?(?:all|last|first|second|third|fourth|fifth)\s+)?(?:exact(?:ly)?\s+)?/iu.exec(tail)?.[0];
  if (prefix === undefined) return [];
  const bodyFrom = verb.to + prefix.length;
  const body = source.slice(bodyFrom);
  const connector = verb.verb.toLocaleLowerCase() === "change" ? /\s+to\s+/iu : /\s+with\s+/iu;
  const split = connector.exec(body);
  if (!split || split.index === undefined) return [];
  const find = trimmedEvidence(source, "find", bodyFrom, bodyFrom + split.index);
  const writeFrom = bodyFrom + split.index + split[0].length;
  let writeTo = source.length;
  // A separately stated destination is a clause, not part of the replacement text.
  const destination = /\s+(?:in\s+(?:the\s+)?(?:document|file|article)\b|at\s+(?:the\s+)?(?:end|bottom)(?:\s+of\s+(?:the\s+)?(?:document|file|article)\b)?)/iu.exec(source.slice(writeFrom));
  if (destination?.index !== undefined) writeTo = writeFrom + destination.index;
  const write = trimmedEvidence(source, "write", writeFrom, writeTo);
  return find && write ? [find, write] : [];
}

function chineseReplacementPair(
  source: string,
  quotes: InstructionQuote[],
  verbs: LiteralOperationEvidence[]
): InstructionLiteralEvidence[] {
  const result: InstructionLiteralEvidence[] = [];
  for (const verb of verbs.filter(({ operation, verb: raw }) => operation === "replace_exact" && /[替换换改]/u.test(raw))) {
    const clauseStart = Math.max(source.lastIndexOf("，", verb.from), source.lastIndexOf(",", verb.from),
      source.lastIndexOf("。", verb.from), source.lastIndexOf("\n", verb.from)) + 1;
    const prefix = source.slice(clauseStart, verb.from);
    const marker = /(?:把|将)\s*/gu;
    let markerMatch: RegExpExecArray | null = null;
    for (const match of prefix.matchAll(marker)) markerMatch = match as RegExpExecArray;
    if (!markerMatch) continue;
    const findFrom = clauseStart + markerMatch.index + markerMatch[0].length;
    if (quotes.some((quote) => quote.from < verb.from && quote.to > findFrom)) continue;
    const unquotedFind = source.slice(findFrom, verb.from);
    const occurrenceQualifier = /^(?:(?:所有|全部|每个|每一(?:处|个|次))|(?:最后\s*(?:(?:一)?(?:处|个|次))?)|(?:第\s*(?:[0-9]{1,4}|[零〇一二两三四五六七八九十百千万]+)\s*(?:处|个|次|项|条|段)))\s*/u.exec(unquotedFind);
    const find = trimmedEvidence(source, "find", findFrom + (occurrenceQualifier?.[0].length ?? 0), verb.from);
    if (!find || /^(?:所有|全部|最后|仅|只|当前|选区|选中)$/u.test(find.value)) continue;

    let writeTo = source.length;
    const suffix = source.slice(verb.to);
    const clause = /[,，;；\n]/u.exec(suffix);
    if (clause?.index !== undefined) writeTo = verb.to + clause.index;
    const write = trimmedEvidence(source, "write", verb.to, writeTo);
    if (write) result.push(find, write);
  }
  return result;
}

function payloadAfterColon(source: string, candidate: InstructionLiteralEvidence): InstructionLiteralEvidence | undefined {
  const delimiter = /^[:：](?:\s|\u00a0)*/u.exec(candidate.raw);
  if (!delimiter) return undefined;
  return trimmedEvidence(source, "write", candidate.from + delimiter[0].length, candidate.to);
}

function exactEnglishInsertion(source: string, verb: LiteralOperationEvidence): InstructionLiteralEvidence | undefined {
  if (!/^(?:add|append|insert|write)$/iu.test(verb.verb)) return undefined;
  const tail = source.slice(verb.to);
  const prefix = /^\s*(?:(?:exactly|verbatim|literally)\s+|(?:exactly|verbatim|literally)\s*:\s*)/iu.exec(tail);
  if (!prefix) return undefined;
  return trimmedEvidence(source, "write", verb.to + prefix[0].length, source.length);
}

function instructionClauseBoundary(source: string): number | undefined {
  const match = /([.!?。！？,，;；]\s*)(?:并|然后|再|同时|以及|\band(?:\s+then)?\b|\bthen\b|\balso\b)\s*(?=(?:.{0,20})?(?:解释|说明|分析|总结|生成|写|添加|增加|补充|检查|核对|给.{0,8}加|explain|describe|analy[sz]e|summari[sz]e|generate|write|add|check|verify))/iu.exec(source);
  if (match?.index === undefined) return undefined;
  return /[,，;；]/u.test(match[1]) ? match.index : match.index + match[1].length;
}

function selectedScopeMentioned(source: string): boolean {
  return /(?:当前)?(?:选区|选中(?:的)?(?:片段|内容|文字|文本|部分)|所选(?:片段|内容|文字|文本|部分)|selected\s+(?:text|selection))/iu.test(source);
}

function isStructuralParameter(masked: string, from: number, to: number, operationEnd: number): boolean {
  const context = masked.slice(Math.max(operationEnd, from - 64), Math.min(masked.length, to + 64));
  return /标题|heading|代码块|代码围栏|code\s*(?:block|fence)|语言|language|列表项|清单|列表|list\s+item|列名|表头|表格|table|公式|equation|函数名|function\s+name|流程图|mermaid/iu.test(context);
}

export function isCompleteFencedCodeLiteral(value: string): boolean {
  const literal = value.trim();
  return /^(`{3,}|~{3,})[^\r\n]*\r?\n[\s\S]*\r?\n\1\s*$/u.test(literal);
}

export function classifyInstructionLiterals(
  quotes: InstructionQuote[],
  unquoted: InstructionLiteralEvidence[],
  verbs: LiteralOperationEvidence[],
  source: string,
  masked: string
): InstructionLiteralEvidence[] {
  const quoted = (): InstructionLiteralEvidence[] => quotes.map(({ role, from, to, raw, value }) => ({ role, from, to, raw, value }));
  const result: InstructionLiteralEvidence[] = [...quoted(), ...unquoted];
  const englishPair = quotes.length === 0 ? englishReplacementPair(source, verbs) : [];
  if (englishPair.length) return [...quoted(), ...englishPair].sort((left, right) => left.from - right.from);

  const chinesePair = chineseReplacementPair(source, quotes, verbs);
  if (chinesePair.length) {
    result.push(...chinesePair);
    return result.sort((left, right) => left.from - right.from);
  }

  for (const verb of verbs.filter(({ operation, verb: raw }) => operation === "replace_exact" ||
    operation === "rewrite" && /(?:替换|换成|改成|改为|replace|change)/iu.test(raw))) {
    const followingQuotes = result.filter(({ role, from }) => role === "unknown" && from >= verb.to);
    const connector = /\b(?:with|to)\b|(?:成|为)/giu;
    connector.lastIndex = verb.to;
    const pairConnector = connector.exec(masked);
    if (followingQuotes.length >= 2 && pairConnector && pairConnector.index >= followingQuotes[0].to && pairConnector.index < followingQuotes[1].from) {
      const findQuote = followingQuotes[0];
      const writeQuote = followingQuotes.find(({ from }) => from > pairConnector.index);
      if (writeQuote) {
        findQuote.role = "find";
        writeQuote.role = "write";
        continue;
      }
    }
    const after = result.find(({ from }) => from >= verb.to);
    const selectedReplacement = selectedScopeMentioned(masked) &&
      /(?:替换|换成|改成|改为|replace|change)/iu.test(verb.verb);
    if (selectedReplacement && after) {
      after.role = "write";
      continue;
    }
    const before = result.filter(({ role, to }) => role === "unknown" && to <= verb.from).at(-1);
    if (before && after && before !== after) {
      before.role = "find";
      after.role = "write";
    }
  }
  const firstWrite = verbs.find(({ operation }) => operation === "insert");
  if (firstWrite) {
    const following = result.find(({ from }) => from >= firstWrite.to && from > firstWrite.from);
    const quotedPayload = following && quotes.some(quote => quote.from === following.from && quote.to === following.to);
    // Unquoted language names and parameters inside a generation request are not fixed payloads.
    const unquotedTail = following && !source.slice(following.to).trim();
    if (following?.role === "unknown" && quotedPayload &&
      (isCompleteFencedCodeLiteral(following.value) || !isStructuralParameter(masked, following.from, following.to, firstWrite.to))) {
      following.role = "write";
    }
    else if (following?.role === "unknown" || !following) {
      const colonPayload = following ? payloadAfterColon(source, following) : undefined;
      const exactEnglish = exactEnglishInsertion(source, firstWrite);
      const extracted = colonPayload ?? exactEnglish;
      if (extracted && !isStructuralParameter(masked, extracted.from, extracted.to, firstWrite.to)) {
        const clause = instructionClauseBoundary(source.slice(extracted.from));
        const payloadEnd = clause === undefined ? extracted.to : Math.min(extracted.to, extracted.from + clause);
        const payload = trimmedEvidence(source, "write", extracted.from, payloadEnd);
        if (payload) {
          const index = following ? result.indexOf(following) : -1;
          if (index >= 0) result[index] = payload;
          else result.push(payload);
        }
      } else if (following?.role === "unknown" && unquotedTail &&
        !isStructuralParameter(masked, following.from, following.to, firstWrite.to)) {
        const clause = instructionClauseBoundary(following.value);
        if (clause !== undefined) {
          const payload = trimmedEvidence(source, "write", following.from, following.from + clause);
          const index = result.indexOf(following);
          if (payload && index >= 0) result[index] = payload;
        } else following.role = "write";
      }
    }
  }
  return result.sort((left, right) => left.from - right.from);
}
