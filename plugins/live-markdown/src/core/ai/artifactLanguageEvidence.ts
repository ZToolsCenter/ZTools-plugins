import type { ArtifactField } from "./artifactSpec";
import { maskQuotedInstruction, scanInstructionQuotes } from "./instructionLiteralEvidence";

const LANGUAGE_ALIASES = new Map([
  ["markdown", "markdown"], ["md", "markdown"], ["python", "python"],
  ["javascript", "javascript"], ["js", "javascript"], ["ecmascript", "javascript"],
  ["typescript", "typescript"], ["ts", "typescript"], ["json", "json"],
  ["mermaid", "mermaid"], ["yaml", "yaml"], ["yml", "yaml"],
  ["bash", "bash"], ["shell", "bash"], ["sh", "bash"], ["html", "html"],
  ["css", "css"], ["sql", "sql"], ["rust", "rust"], ["java", "java"], ["golang", "go"], ["go", "go"]
]);

const RECOGNIZED_LANGUAGE_PATTERNS: Array<{ value: string; pattern: RegExp }> = [
  { value: "markdown", pattern: /\b(?:markdown|md)\b/giu },
  { value: "python", pattern: /\bpython\b/giu },
  { value: "javascript", pattern: /\b(?:javascript|js|ecmascript)\b/giu },
  { value: "typescript", pattern: /\b(?:typescript|ts)\b/giu },
  { value: "json", pattern: /\bjson\b/giu },
  { value: "mermaid", pattern: /\bmermaid\b/giu },
  { value: "yaml", pattern: /\b(?:yaml|yml)\b/giu },
  { value: "bash", pattern: /\b(?:bash|shell|sh)\b/giu },
  { value: "html", pattern: /\bhtml\b/giu },
  { value: "css", pattern: /\bcss\b/giu },
  { value: "sql", pattern: /\bsql\b/giu },
  { value: "rust", pattern: /\brust\b/giu },
  { value: "java", pattern: /\bjava\b/giu },
  { value: "go", pattern: /\bgolang\b/giu }
];

const QUOTE_LANGUAGE_ROLE = /(?:语言\s*(?:为|是|[:：=])?|language\s*(?:(?:is|[:：=])\s*)?|使用|采用|用|using|in)\s*$/iu;
const MARKDOWN_HEADING_QUALIFIER = /^\s*(?:h\s*[1-6]\b|level\s*[1-6]\b|(?:[一二三四五六1-6]\s*级\s*)?(?:标题|heading|title|header)|(?:heading|title|header)\s*(?:(?:level\s*)?[1-6])?\b)/iu;

export function normalizeArtifactLanguage(value: string): string {
  const normalized = value.trim().toLowerCase();
  return LANGUAGE_ALIASES.get(normalized) ?? normalized;
}

function sourceField(source: string, from: number, to: number, value: string): ArtifactField<string> {
  return { value, evidence: [{ from, to, raw: source.slice(from, to) }] };
}

function isMarkdownHeadingFormatMention(masked: string, to: number): boolean {
  return MARKDOWN_HEADING_QUALIFIER.test(masked.slice(to, Math.min(masked.length, to + 40)));
}

function explicitRoleLanguages(source: string): ArtifactField<string>[] {
  const token = "([A-Za-z][A-Za-z0-9_+#.-]{0,31})";
  const codeMarker = "(?:代码(?:块|围栏)?|\\bcode(?:\\s*(?:block|fence))?\\b)";
  const codeOrFunctionMarker = `(?:${codeMarker}|函数|\\bfunction\\b)`;
  const masked = maskQuotedInstruction(source, scanInstructionQuotes(source));
  const aliases = [...LANGUAGE_ALIASES.keys()].sort((left, right) => right.length - left.length)
    .map((alias) => alias.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")).join("|");
  const patterns = [
    new RegExp(`(?<![A-Za-z0-9_])${token}(?![A-Za-z0-9_])\\s*(?:language\\s*)?(?:的\\s*)?${codeOrFunctionMarker}`, "giu"),
    new RegExp(`${codeOrFunctionMarker}\\s*(?:使用|采用|用|语言(?:为|是|[:：=])?|language(?:\\s*(?:is|[:：=]))?|using|in)\\s*${token}(?![A-Za-z0-9_])`, "giu"),
    new RegExp(`${codeMarker}\\s*(${aliases})(?![A-Za-z0-9_])(?:\\s*(?:格式|language))?`, "giu"),
    new RegExp(`${codeMarker}\\s+(${token})(?![A-Za-z0-9_])\\s*(?:格式|language)`, "giu")
  ];
  const fields = patterns.flatMap((pattern) => [...masked.matchAll(pattern)].flatMap((match) => {
    const raw = match[1];
    const from = (match.index ?? 0) + match[0].indexOf(raw);
    return [sourceField(source, from, from + raw.length, normalizeArtifactLanguage(raw))];
  }));

  const codeMarkerPattern = /(?:代码(?:块|围栏)?|\bcode(?:\s*(?:block|fence))?\b)/iu;
  for (const { from, to, raw } of scanInstructionQuotes(source)) {
    if (!/^[A-Za-z][A-Za-z0-9_+#.-]{0,31}$/u.test(raw)) continue;
    const sentenceStart = Math.max(
      source.lastIndexOf("。", from - 1), source.lastIndexOf("！", from - 1),
      source.lastIndexOf("？", from - 1), source.lastIndexOf(";", from - 1),
      source.lastIndexOf("\n", from - 1), source.lastIndexOf(".", from - 1),
      source.lastIndexOf("!", from - 1), source.lastIndexOf("?", from - 1)
    ) + 1;
    const prefix = source.slice(sentenceStart, from - 1);
    if (!QUOTE_LANGUAGE_ROLE.test(prefix) || !codeMarkerPattern.test(prefix)) continue;
    fields.push(sourceField(source, from, to, normalizeArtifactLanguage(raw)));
  }

  const unique = new Map<string, ArtifactField<string>>();
  for (const field of fields) {
    const evidence = field.evidence[0];
    unique.set(`${field.value}\u0000${evidence.from}\u0000${evidence.to}`, field);
  }
  return [...unique.values()];
}

/** Role-bound values for planner hints, including explicitly quoted language arguments. */
export function extractExplicitArtifactLanguages(source: string): ArtifactField<string>[] {
  return explicitRoleLanguages(source);
}

/** Preserves the resolver's recognized alias scan and adds quoted role-bound aliases. */
export function extractRecognizedArtifactLanguages(source: string, masked: string): ArtifactField<string>[] {
  const fields = RECOGNIZED_LANGUAGE_PATTERNS.flatMap(({ value, pattern }) => {
    pattern.lastIndex = 0;
    return [...masked.matchAll(pattern)].map((match) => {
      const from = match.index ?? 0;
      return sourceField(source, from, from + match[0].length, value);
    }).filter((field) => field.value !== "markdown" || !isMarkdownHeadingFormatMention(masked, field.evidence[0].to));
  });
  const supportedValues = new Set(RECOGNIZED_LANGUAGE_PATTERNS.map(({ value }) => value));
  for (const field of explicitRoleLanguages(source)) {
    if (supportedValues.has(field.value)) fields.push(field);
  }
  const unique = new Map<string, ArtifactField<string>>();
  for (const field of fields) {
    const evidence = field.evidence[0];
    unique.set(`${field.value}\u0000${evidence.from}\u0000${evidence.to}`, field);
  }
  return [...unique.values()];
}
