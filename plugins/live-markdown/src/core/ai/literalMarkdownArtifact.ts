import type { InstructionSpan } from "./intentContract";

type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;
type SlotKind = "language" | "artifact" | "heading";

interface SlotToken extends InstructionSpan {
  kind: SlotKind;
  level?: HeadingLevel;
}

export interface LiteralMarkdownHeadingContract {
  language: "markdown";
  level: HeadingLevel;
  text: string;
  evidence: {
    language: InstructionSpan;
    artifact: InstructionSpan;
    heading: InstructionSpan;
    payload: InstructionSpan;
  };
}

const LANGUAGE_TOKEN = /markdown|md/giu;
const ARTIFACT_TOKEN = /fenced\s+code\s+block|code\s+(?:block|fence)|代码(?:块|围栏)/giu;
const HEADING_TOKEN = /h\s*([1-6])|heading\s*([1-6])|([一二三四五六1-6])\s*级\s*标题|标题\s*([一二三四五六1-6])/giu;
const QUOTED_LITERAL = new Map<string, string>([
  ['"', '"'],
  ["'", "'"],
  ["“", "”"],
  ["‘", "’"],
  ["「", "」"],
  ["『", "』"]
]);
const CONNECTIVE_RESIDUE = /^(?:(?:里面|内部)(?:加(?:入|上)?|添加|新增)(?:一个|个)?|内容(?:为|是)|标题为|加(?:入|上)?(?:一个|个)?|添加(?:一个|个)?|新增(?:一个|个)?|为|是|的|[,，:：=])*$/u;
const AMBIGUOUS_LITERAL_PUNCTUATION = /[,，。！？;；:：.!?`]/u;
const ACTION_AT_START = /^(?:生成|创作|写|编写|撰写|创建|制作|添加|增加|新增|插入|追加|删除|替换|修改|更新)/iu;
const ACTION_IN_LITERAL = /生成|创作|写|编写|撰写|创建|制作|添加|增加|新增|插入|追加|删除|移除|替换|修改|更新/u;
const CHINESE_COMPOUND = /并(?:且)?|同时|然后|再|以及|和|或/u;
const SECOND_HEADING = /(?:h\s*[1-6]|heading\s*[1-6]|[一二三四五六1-6]\s*级\s*标题|标题\s*[一二三四五六1-6])/iu;
const SECOND_OPERATION = /(?:^|\s)(?:and|then|also|add|create|generate|insert|append|replace|modify|write|delete)(?:$|\s)/iu;
const SOURCE_DEPENDENT = /参考原文|根据原文|沿用原文|基于原文|结合文档|参考文档|根据文档|原文标题|原有标题|现有标题|based on (?:the )?(?:source|document|text)|from (?:the )?(?:source|document)|use (?:the )?(?:original|document)/iu;
const encoder = new TextEncoder();

function instructionSpan(source: string, from: number, to: number): InstructionSpan {
  return { from, to, raw: source.slice(from, to) };
}

function isAsciiWordCharacter(character: string | undefined): boolean {
  return Boolean(character && /[a-z0-9_]/iu.test(character));
}

function hasEnglishTokenBoundaries(source: string, from: number, to: number): boolean {
  return !isAsciiWordCharacter(source[from - 1]) && !isAsciiWordCharacter(source[to]);
}

function quoteMaskedSource(source: string): string {
  const characters = source.split("");
  for (let index = 0; index < source.length; index += 1) {
    const close = QUOTED_LITERAL.get(source[index]);
    if (!close) continue;
    const closingIndex = source.indexOf(close, index + 1);
    if (closingIndex < 0) continue;
    for (let cursor = index; cursor <= closingIndex; cursor += 1) characters[cursor] = " ";
    index = closingIndex;
  }
  return characters.join("");
}

function collectTokens(source: string, masked: string, kind: SlotKind): SlotToken[] {
  const pattern = kind === "language" ? LANGUAGE_TOKEN : kind === "artifact" ? ARTIFACT_TOKEN : HEADING_TOKEN;
  pattern.lastIndex = 0;
  const tokens: SlotToken[] = [];
  for (const match of masked.matchAll(pattern)) {
    const from = match.index ?? 0;
    const to = from + match[0].length;
    if ((kind === "language" || kind === "artifact" && /^[a-z]/iu.test(match[0])) && !hasEnglishTokenBoundaries(masked, from, to)) continue;
    if (kind === "heading" && /^[a-z]/iu.test(match[0]) && !hasEnglishTokenBoundaries(masked, from, to)) continue;
    const levelToken = match[1] ?? match[2] ?? match[3] ?? match[4];
    const level = kind === "heading" ? Number(/^[1-6]$/u.test(levelToken) ? levelToken : ["一", "二", "三", "四", "五", "六"].indexOf(levelToken) + 1) as HeadingLevel : undefined;
    tokens.push({ ...instructionSpan(source, from, to), kind, ...(level ? { level } : {}) });
  }
  return tokens;
}

function isOnlyStructuralGlue(source: string, tokens: SlotToken[]): boolean {
  const residue = source.split("");
  for (const token of tokens) {
    for (let index = token.from; index < token.to; index += 1) residue[index] = " ";
  }
  return CONNECTIVE_RESIDUE.test(residue.join("").replace(/\s+/gu, ""));
}

function hasHeadingDelimiter(source: string, heading: SlotToken, tokens: SlotToken[]): boolean {
  if (tokens.some((token) => token !== heading && token.from === heading.to)) return true;
  const next = source[heading.to];
  return Boolean(next && /[\s,，:：=的]/u.test(next));
}

function payloadStartAfterOneDelimiter(source: string, from: number): number | undefined {
  const tail = source.slice(from);
  const spacedConnector = /^\s+(?:的|是|为)\s+/u.exec(tail);
  if (spacedConnector) return from + spacedConnector[0].length;

  const whitespace = /^\s+/u.exec(tail);
  if (whitespace) return from + whitespace[0].length;

  const punctuation = /^[,，:：=]\s*/u.exec(tail);
  if (punctuation) return from + punctuation[0].length;

  if (source[from] === "的") {
    const nextCodePoint = source.codePointAt(from + 1);
    if (nextCodePoint !== undefined && /\p{Script=Han}/u.test(String.fromCodePoint(nextCodePoint))) return undefined;
    const spacing = /^\s*/u.exec(source.slice(from + 1))?.[0] ?? "";
    return from + 1 + spacing.length;
  }
  return undefined;
}

function readLiteral(payload: string): string | undefined {
  const expectedClose = QUOTED_LITERAL.get(payload[0]);
  if (expectedClose) {
    const firstClose = payload.indexOf(expectedClose, 1);
    if (payload.length < 3 || firstClose !== payload.length - 1) return undefined;
    const value = payload.slice(1, -1);
    if (!value.trim() || /[\r\n]/u.test(value) || value.includes("```") || encoder.encode(value).byteLength > 256) return undefined;
    return value;
  }

  if (!payload || payload.trim() !== payload || /[\r\n]/u.test(payload) || AMBIGUOUS_LITERAL_PUNCTUATION.test(payload)) return undefined;
  if (ACTION_AT_START.test(payload) || ACTION_IN_LITERAL.test(payload) || CHINESE_COMPOUND.test(payload) || SECOND_HEADING.test(payload) || SECOND_OPERATION.test(payload) || SOURCE_DEPENDENT.test(payload) || payload.includes("```") || encoder.encode(payload).byteLength > 256) return undefined;
  return payload;
}

/**
 * Compiles a fully specified, source-independent Markdown heading brief into
 * explicit semantic slots. Unrecognized text is rejected instead of ignored.
 */
export function compileLiteralMarkdownHeading(contentBrief: string): LiteralMarkdownHeadingContract | undefined {
  if (!contentBrief || encoder.encode(contentBrief).byteLength > 512 || /[\r\n]/u.test(contentBrief)) return undefined;

  const masked = quoteMaskedSource(contentBrief);
  const language = collectTokens(contentBrief, masked, "language");
  const artifact = collectTokens(contentBrief, masked, "artifact");
  const heading = collectTokens(contentBrief, masked, "heading");
  if (language.length !== 1 || artifact.length !== 1 || heading.length !== 1) return undefined;

  const tokens = [...language, ...artifact, ...heading].sort((left, right) => left.from - right.from);
  if (heading[0].level === undefined || !hasHeadingDelimiter(contentBrief, heading[0], tokens)) return undefined;
  const tailStart = Math.max(...tokens.map(({ to }) => to));
  if (!isOnlyStructuralGlue(contentBrief.slice(0, tailStart), tokens)) return undefined;

  const payloadStart = payloadStartAfterOneDelimiter(contentBrief, tailStart);
  if (payloadStart === undefined) return undefined;
  const payloadSource = contentBrief.slice(payloadStart);
  const text = readLiteral(payloadSource);
  if (text === undefined) return undefined;

  return {
    language: "markdown",
    level: heading[0].level,
    text,
    evidence: {
      language: instructionSpan(contentBrief, language[0].from, language[0].to),
      artifact: instructionSpan(contentBrief, artifact[0].from, artifact[0].to),
      heading: instructionSpan(contentBrief, heading[0].from, heading[0].to),
      payload: instructionSpan(contentBrief, payloadStart, contentBrief.length)
    }
  };
}

/** Renders a closed literal heading contract as a fenced Markdown code block. */
export function createLiteralMarkdownArtifact(contentInstruction: string): string | undefined {
  const contract = compileLiteralMarkdownHeading(contentInstruction);
  if (!contract) return undefined;
  return ["```markdown", `${"#".repeat(contract.level)} ${contract.text}`, "```"].join("\n");
}
