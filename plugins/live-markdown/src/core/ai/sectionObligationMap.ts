import type { InstructionSpan } from "./intentContract";

export interface EvidencedHeading {
  text: string;
  evidence: readonly InstructionSpan[];
}

export interface SectionObligationSection {
  heading: string;
  headingEvidence: readonly InstructionSpan[];
  requirements: readonly InstructionSpan[];
}

export interface SectionObligationMap {
  sections: readonly SectionObligationSection[];
  shared: readonly InstructionSpan[];
}

const MAX_INSTRUCTION_BYTES = 16_384;
const MAX_HEADINGS = 8;
const MAX_HEADING_LENGTH = 64;
const MAX_EVIDENCE_SPANS = 64;
const MAX_SENTENCES = 256;
const MAX_CLAUSES = 512;
const encoder = new TextEncoder();

type SectionRole = "steps" | "risks" | "acceptance";
interface TextSpan extends InstructionSpan {}
interface ValidatedHeading extends EvidencedHeading {
  role?: SectionRole;
  evidence: readonly InstructionSpan[];
}

const ROLE_BY_HEADING = new Map<string, SectionRole>([
  ["step", "steps"], ["steps", "steps"], ["步骤", "steps"],
  ["risk", "risks"], ["risks", "risks"], ["风险", "risks"],
  ["acceptance", "acceptance"], ["acceptance criteria", "acceptance"], ["验收标准", "acceptance"]
]);
const INVALID_CONTROLS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u;
const SENTENCE_END = new Set(["。", "！", "？", "!", "?", "."]);
const CLOSING_QUOTES = new Set(["”", "’", "」", "』", "»", '"', "'"]);
const CLAUSE_END = new Set(["，", ",", "；", ";"]);
const NEGATIVE = /不要|不要求|不需要|不得|不能|不应|不必|不可|没有|未提供|无需|禁止|避免|并非|不是|不假称|\b(?:not|no|never|without|mustn['’]t|shouldn['’]t)\b/iu;
const QUESTION = /[？?]|是否|能否|可否|吗|么|\b(?:whether|can|could|should|would)\b/iu;
const CONDITIONAL = /如果|若|假如|倘若|要是|只要|除非|只有|仅当|一旦|否则|前提\s*(?:是|为|下)|(?:当|在)[^。！？；;\n]{1,64}(?:时|情况下|条件下|模式下)|[^。！？；;\n]{1,64}时(?=[，,；;])|\bonly\s+(?:if|when)\b|\bif\b|\bunless\b|\bwhen\b|\bprovided\s+that\b|\bon\s+(?:the\s+)?condition\s+that\b|\bas\s+long\s+as\b|\bin\s+case\b|\bsubject\s+to\b/iu;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every(key => actual.includes(key));
}

function validSpan(instruction: string, value: unknown): value is InstructionSpan {
  if (!isRecord(value) || !exactKeys(value, ["from", "to", "raw"])) return false;
  return Number.isSafeInteger(value.from) && Number.isSafeInteger(value.to) &&
    (value.from as number) >= 0 && (value.from as number) < (value.to as number) &&
    (value.to as number) <= instruction.length && typeof value.raw === "string" &&
    instruction.slice(value.from as number, value.to as number) === value.raw;
}

function normalizedHeading(text: string): string {
  return text.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-US");
}

function headingsWithEvidence(instruction: string, headings: readonly EvidencedHeading[]): ValidatedHeading[] | undefined {
  if (!Array.isArray(headings) || headings.length === 0 || headings.length > MAX_HEADINGS) return undefined;
  let evidenceCount = 0;
  let lastEvidenceFrom = -1;
  const seen = new Set<string>();
  const normalized: ValidatedHeading[] = [];
  for (const heading of headings) {
    if (!isRecord(heading) || !exactKeys(heading, ["text", "evidence"]) || typeof heading.text !== "string" ||
        !heading.text.trim() || heading.text !== heading.text.trim() || heading.text.length > MAX_HEADING_LENGTH ||
        INVALID_CONTROLS.test(heading.text) || !Array.isArray(heading.evidence) || heading.evidence.length === 0 ||
        heading.evidence.length > 8) return undefined;
    const key = normalizedHeading(heading.text);
    if (seen.has(key)) return undefined;
    seen.add(key);
    const spans: InstructionSpan[] = [];
    for (const item of heading.evidence) {
      evidenceCount += 1;
      if (evidenceCount > MAX_EVIDENCE_SPANS || !validSpan(instruction, item) ||
          !item.raw.toLocaleLowerCase("en-US").includes(heading.text.toLocaleLowerCase("en-US"))) return undefined;
      if (item.from < lastEvidenceFrom) return undefined;
      lastEvidenceFrom = item.from;
      spans.push(Object.freeze({ from: item.from, to: item.to, raw: item.raw }));
    }
    normalized.push({ text: heading.text, role: ROLE_BY_HEADING.get(key), evidence: Object.freeze(spans) });
  }
  return normalized;
}

function quoteRanges(text: string): { ranges: TextSpan[]; uncertain: boolean } {
  const pairs = new Map([["“", "”"], ["‘", "’"], ["「", "」"], ["『", "』"], ["«", "»"]]);
  const closers = new Set([...pairs.values()]);
  const symmetric = new Set(["\"", "`", "'"]);
  const stack: Array<{ close: string; from: number }> = [];
  const ranges: TextSpan[] = [];
  let uncertain = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (symmetric.has(char)) {
      if (char === "'" && /[\p{L}\p{N}]/u.test(text[index - 1] ?? "") && /[\p{L}\p{N}]/u.test(text[index + 1] ?? "")) continue;
      if (stack.at(-1)?.close === char) {
        const opening = stack.pop()!;
        ranges.push({ from: opening.from, to: index + 1, raw: text.slice(opening.from, index + 1) });
      } else stack.push({ close: char, from: index });
      continue;
    }
    if (pairs.has(char)) {
      stack.push({ close: pairs.get(char)!, from: index });
      continue;
    }
    if (closers.has(char)) {
      if (stack.at(-1)?.close === char) {
        const opening = stack.pop()!;
        ranges.push({ from: opening.from, to: index + 1, raw: text.slice(opening.from, index + 1) });
      } else uncertain = true;
    }
  }
  if (stack.length) {
    const first = stack[0];
    ranges.push({ from: first.from, to: text.length, raw: text.slice(first.from) });
    uncertain = true;
  }
  return { ranges, uncertain };
}

function overlaps(left: InstructionSpan, right: InstructionSpan): boolean {
  return left.from < right.to && right.from < left.to;
}

function sentenceSpans(text: string, quotedRanges: readonly InstructionSpan[]): TextSpan[] | undefined {
  const result: TextSpan[] = [];
  const quotedCoverage = new Uint8Array(text.length);
  for (const range of quotedRanges) quotedCoverage.fill(1, range.from, range.to);
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "\r" || char === "\n") {
      const end = char === "\r" && text[index + 1] === "\n" ? index + 2 : index + 1;
      result.push({ from: start, to: end, raw: text.slice(start, end) });
      start = end;
      index = end - 1;
      if (result.length > MAX_SENTENCES) return undefined;
      continue;
    }
    if (!SENTENCE_END.has(char) || quotedCoverage[index]) continue;
    if (char === "." && /\d/u.test(text[index - 1] ?? "") && /\d/u.test(text[index + 1] ?? "")) continue;
    let end = index + 1;
    while (end < text.length && CLOSING_QUOTES.has(text[end])) end += 1;
    while (end < text.length && /\s/u.test(text[end])) end += 1;
    result.push({ from: start, to: end, raw: text.slice(start, end) });
    start = end;
    index = end - 1;
    if (result.length > MAX_SENTENCES) return undefined;
  }
  if (start < text.length) result.push({ from: start, to: text.length, raw: text.slice(start) });
  return result.length <= MAX_SENTENCES ? result : undefined;
}

function clauseSpans(sentence: InstructionSpan): TextSpan[] {
  const result: TextSpan[] = [];
  let start = sentence.from;
  for (let index = sentence.from; index < sentence.to; index += 1) {
    if (!CLAUSE_END.has(sentence.raw[index - sentence.from])) continue;
    const end = index + 1;
    result.push({ from: start, to: end, raw: sentence.raw.slice(start - sentence.from, end - sentence.from) });
    start = end;
  }
  if (start < sentence.to) result.push({ from: start, to: sentence.to, raw: sentence.raw.slice(start - sentence.from) });
  return result;
}

function stripLeadingHeadingPrefix(clause: string, headings: readonly EvidencedHeading[]): string {
  let remaining = clause.trimStart();
  const candidates = headings.map(({ text }) => text).sort((left, right) => right.length - left.length);
  for (let consumed = 0; consumed < headings.length; consumed += 1) {
    let matched = false;
    for (const heading of candidates) {
      if (!remaining.toLocaleLowerCase("en-US").startsWith(heading.toLocaleLowerCase("en-US"))) continue;
      const delimiter = /^\s*(?:and\b\s*|&\s*|[、，,;/|]\s*|[:：–—-]\s*)/iu.exec(remaining.slice(heading.length));
      if (!delimiter) continue;
      remaining = remaining.slice(heading.length + delimiter[0].length).trimStart();
      matched = true;
      break;
    }
    if (!matched) break;
  }
  return remaining;
}

function requirementRoles(clause: string, headings: readonly EvidencedHeading[]): SectionRole[] {
  const trimmed = stripLeadingHeadingPrefix(clause, headings).trim();
  if (!trimmed || NEGATIVE.test(trimmed) || QUESTION.test(trimmed) || /理由|原因|为什么|\b(?:why|reason|rationale)\b/iu.test(trimmed)) return [];
  const roles: SectionRole[] = [];
  const stepsZh = /^(?:(?:每个|每項|每项|各个|每一)\s*)?步骤[\s\S]{0,48}动作[\s\S]{0,48}(?:检查点|检查结果|检查项)/u.test(trimmed);
  const risksZh = /^(?:(?:每个|每項|每项|各个|每一)\s*)?风险[\s\S]{0,64}(?:触发条件|触发)[\s\S]{0,48}(?:应对|响应)/u.test(trimmed);
  const acceptanceZh = /^验收标准[\s\S]{0,48}(?:可验证|可核验|逐条核验|通过条件)/u.test(trimmed);
  const stepsEn = /^include\b[\s\S]{0,64}\bexecutable\s+steps\b/iu.test(trimmed);
  const risksEn = /^include\b[\s\S]{0,96}\bconcrete\s+risk\s+scenarios\b/iu.test(trimmed);
  const acceptanceEn = /^(?:acceptance\s+criteria[\s\S]{0,64}\b(?:verifiable|checkable)\b|make\s+acceptance\s+criteria\s+(?:verifiable|checkable)\b)/iu.test(trimmed);
  if (stepsZh || stepsEn) roles.push("steps");
  if (risksZh || risksEn) roles.push("risks");
  if (acceptanceZh || acceptanceEn) roles.push("acceptance");
  return roles;
}

function outputSpan(span: InstructionSpan): InstructionSpan {
  return Object.freeze({ from: span.from, to: span.to, raw: span.raw });
}

/** Projects only exact, positive source requirements to uniquely evidenced headings. */
export function buildSectionObligationMap(
  instruction: string,
  headings: readonly EvidencedHeading[]
): SectionObligationMap | undefined {
  if (typeof instruction !== "string" || !instruction.trim() || encoder.encode(instruction).byteLength > MAX_INSTRUCTION_BYTES ||
      INVALID_CONTROLS.test(instruction)) return undefined;
  const validatedHeadings = headingsWithEvidence(instruction, headings);
  const quotes = quoteRanges(instruction);
  const sentences = sentenceSpans(instruction, quotes.ranges);
  if (!validatedHeadings || !sentences || quotes.uncertain) return undefined;

  const roleIndices = new Map<SectionRole, number[]>();
  for (let index = 0; index < validatedHeadings.length; index += 1) {
    const role = validatedHeadings[index].role;
    if (!role) continue;
    const indices = roleIndices.get(role) ?? [];
    indices.push(index);
    roleIndices.set(role, indices);
  }
  const uniqueRoleIndex = new Map([...roleIndices].filter(([, indices]) => indices.length === 1).map(([role, indices]) => [role, indices[0]]));
  const requirements: InstructionSpan[][] = validatedHeadings.map(() => []);
  const shared: InstructionSpan[] = [];
  let clauseCount = 0;

  for (const sentence of sentences) {
    const containsQuote = quotes.ranges.some(range => overlaps(range, sentence));
    const isQuestion = QUESTION.test(sentence.raw);
    const isConditional = CONDITIONAL.test(sentence.raw);
    let hasUnmappedClause = containsQuote || isQuestion || isConditional;
    const clauses = clauseSpans(sentence);
    clauseCount += clauses.length;
    if (clauseCount > MAX_CLAUSES) return undefined;
    for (const clause of clauses) {
      const roles = containsQuote || isQuestion || isConditional ? [] : requirementRoles(clause.raw, validatedHeadings);
      const targets = roles.map(role => uniqueRoleIndex.get(role)).filter((index): index is number => index !== undefined);
      const sourceSpan = outputSpan(clause);
      if (!roles.length || targets.length !== roles.length) hasUnmappedClause = true;
      else for (const index of targets) requirements[index].push(sourceSpan);
    }
    if (hasUnmappedClause || containsQuote || isQuestion || isConditional) shared.push(outputSpan(sentence));
  }

  return Object.freeze({
    sections: Object.freeze(validatedHeadings.map((heading, index) => Object.freeze({
      heading: heading.text,
      headingEvidence: heading.evidence,
      requirements: Object.freeze(requirements[index])
    }))),
    shared: Object.freeze(shared)
  });
}
