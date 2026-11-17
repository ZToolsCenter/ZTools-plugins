import { analyzeEnglishAgreement, type EnglishAgreementAnalyzeOptions } from "./englishAgreementService";
import type { EnglishAgreementAnalysis, EnglishAgreementEdit, EnglishAgreementInput } from "./englishAgreementTypes";
import { maskQuotedInstruction, scanInstructionQuotes } from "./instructionLiteralEvidence";
import { buildReadableProsePrompts, type ReadableProseTaskInput } from "./readableProseTask";
import type { ReadableProseView } from "./readableProseView";

const ANALYSIS_TIMEOUT_MS = 1_500;
const BLOCKED_MARKUP = /[\r\n\t'"“”‘’`$*_\[\]{}()\\<>#]/u;

export type ReadableProseAgreementInput = EnglishAgreementInput & { referenceText?: string };
export type ReadableProseAgreementAnalyzer = (
  input: ReadableProseAgreementInput,
  options?: EnglishAgreementAnalyzeOptions
) => Promise<EnglishAgreementAnalysis>;

export interface PreparedReadableProseRequest {
  view: ReadableProseView;
  prompts: { prompt: string; systemPrompt: string };
}

function isSafeOpaqueList(text: string, placeholders: readonly string[]): boolean {
  if (new Set(placeholders).size !== placeholders.length) return false;
  const ranges: Array<{ from: number; to: number }> = [];
  for (const placeholder of placeholders) {
    if (typeof placeholder !== "string" || placeholder.length < 2) return false;
    const from = text.indexOf(placeholder);
    if (from < 0 || text.indexOf(placeholder, from + placeholder.length) >= 0) return false;
    ranges.push({ from, to: from + placeholder.length });
  }
  ranges.sort((left, right) => left.from - right.from);
  return ranges.every((range, index) => index === 0 || ranges[index - 1]!.to <= range.from);
}

/** Cheaply avoid loading the optional NLP bundle for Han or unsupported syntax. */
function canAnalyzeEnglish(text: string, placeholders: readonly string[]): boolean {
  if (Array.from(text).length > 256 || !text.trim() || !isSafeOpaqueList(text, placeholders)) return false;
  let visible = "";
  let cursor = 0;
  for (const placeholder of placeholders) {
    const from = text.indexOf(placeholder, cursor);
    if (from < 0) return false;
    visible += `${text.slice(cursor, from)}${" ".repeat(placeholder.length)}`;
    cursor = from + placeholder.length;
  }
  visible += text.slice(cursor);
  visible = visible.replace(/\p{Zs}+$/u, "");
  if (!visible.trim() || BLOCKED_MARKUP.test(visible) || /https?:\/\/|\bwww\./iu.test(visible)) return false;
  return /^[A-Za-z0-9 .,;:!?%-]+$/u.test(visible);
}

function numberAtoms(text: string): string[] {
  return text.match(/\p{N}+/gu) ?? [];
}

function placeholderOccurrences(text: string, placeholders: readonly string[]): boolean {
  return placeholders.every((placeholder) => {
    const first = text.indexOf(placeholder);
    return first >= 0 && text.indexOf(placeholder, first + placeholder.length) < 0;
  });
}

function isAgreementEdit(value: unknown): value is EnglishAgreementEdit {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const edit = value as Partial<EnglishAgreementEdit>;
  return typeof edit.from === "number" && typeof edit.to === "number" &&
    typeof edit.source === "string" && typeof edit.replacement === "string" &&
    typeof edit.subject === "string" && typeof edit.lemma === "string";
}

function applyValidatedSuggestions(
  text: string,
  placeholders: readonly string[],
  analysis: EnglishAgreementAnalysis
): string {
  if (!analysis || analysis.scope !== "simple-present-subject-verb-agreement" ||
      analysis.disposition !== "suggestions" || typeof analysis.outputText !== "string" ||
      !Array.isArray(analysis.edits)) return text;
  const rawEdits = Array.from(analysis.edits);
  if (rawEdits.length === 0 || rawEdits.length > 64 || !rawEdits.every(isAgreementEdit) ||
      Array.from(analysis.outputText).length > 256 || !placeholderOccurrences(analysis.outputText, placeholders) ||
      numberAtoms(text).join("\u0000") !== numberAtoms(analysis.outputText).join("\u0000")) return text;

  const edits = rawEdits.sort((left, right) => left.from - right.from || left.to - right.to);
  let previousTo = -1;
  for (const edit of edits) {
    if (!Number.isSafeInteger(edit.from) || !Number.isSafeInteger(edit.to) ||
        edit.from < 0 || edit.from >= edit.to || edit.to > text.length || edit.from < previousTo ||
        text.slice(edit.from, edit.to) !== edit.source || !/^[A-Za-z]+$/u.test(edit.source) ||
        !/^[A-Za-z]+$/u.test(edit.replacement) || typeof edit.subject !== "string" || !edit.subject ||
        typeof edit.lemma !== "string" || !edit.lemma) return text;
    if (placeholders.some((placeholder) => {
      const from = text.indexOf(placeholder);
      const to = from + placeholder.length;
      return edit.from < to && edit.to > from;
    })) return text;
    previousTo = edit.to;
  }

  let rebuilt = text;
  for (const edit of [...edits].reverse()) {
    rebuilt = `${rebuilt.slice(0, edit.from)}${edit.replacement}${rebuilt.slice(edit.to)}`;
  }
  if (rebuilt !== analysis.outputText) return text;
  return rebuilt;
}

export function requiresStrictProofreadReference(input: ReadableProseTaskInput): boolean {
  const directives = [input.instruction, input.systemPrompt, input.skill?.systemPrompt, input.skill?.userPromptTemplate]
    .filter((value): value is string => Boolean(value))
    .map(value => maskQuotedInstruction(value, scanInstructionQuotes(value))).join("\n");
  const forbidsRewrite = /(?:不要|不得|不允许|不应|禁止|避免|切勿|仅限|只(?:做|进行|允许)|不作|不做|不进行|不需要|不必)\s*(?:(?:进行|做|作|添加|使用|对|任何)\s*){0,2}(?:同义(?:词)?(?:改写|替换)|改写|重写|润色|换种说法)/u.test(directives)
    || /(?:do not|don't|must not|never|avoid|without)\s+(?:rephras(?:e|ing)|rewrit(?:e|ing)|polish(?:ing)?|paraphras(?:e|ing)|reword(?:ing)?)/iu.test(directives)
    || /\bno\s+(?:synonym\s+(?:replacement|rewriting)|paraphrasing|rewriting|polishing)\b/iu.test(directives);
  const preservesCorrect = /(?:已|已经)?正确(?:的)?(?:内容|文本|句子?|部分)(?:(?:必须|应当|要)?)?(?:保持|保留)(?:原样|不变|不修改)?|(?:(?:必须|应当|要)?(?:保持|保留))(?:已|已经)?正确(?:的)?(?:内容|文本|句子?|部分)(?:原样|不变|不修改)?|(?:已|已经)?正确(?:的)?(?:内容|文本|句子?|部分)不(?:要|得|能)?(?:改|修改|改动|更改|变动)/u
    .test(directives)
    || /\b(?:preserve|keep|leave)(?:\s+the)?(?:\s+already)?\s+correct\s+(?:content|text|sentences?|parts?)(?:\s+(?:unchanged|as[- ]is|exactly|intact|as they are))?\b/iu.test(directives)
    || /\bcorrect\s+(?:content|text|sentences?|parts?)[^.!?\n]{0,24}\b(?:unchanged|as[- ]is|exactly|intact)\b/iu.test(directives);
  const negatesPreservation = /(?:不必|无须|无需|不用|不需要|不要|不得|不能|不应|禁止)[^。！？\n]{0,8}(?:保持|保留)(?:正确(?:的)?(?:内容|文本|句子?|部分)|已正确(?:的)?(?:内容|文本|句子?|部分)?)/u.test(directives)
    || /\b(?:do not|don't|must not|need not|no need to)\s+(?:preserve|keep|leave)\s+(?:the\s+)?(?:already\s+)?correct\s+(?:content|text|sentences?|parts?)\b/iu.test(directives);
  return !negatesPreservation && (forbidsRewrite || preservesCorrect);
}

/** Returns the original text on unsupported input, non-suggestions, or optional analyzer failure. */
export async function normalizeReadableProseText(
  text: string,
  readonlyPlaceholders: readonly string[],
  signal?: AbortSignal,
  analyzer: ReadableProseAgreementAnalyzer = analyzeEnglishAgreement,
  referenceText?: string
): Promise<string> {
  if (!canAnalyzeEnglish(text, readonlyPlaceholders)) return text;
  const request: ReadableProseAgreementInput = {
    text,
    readonlyPlaceholders: [...readonlyPlaceholders],
    ...(referenceText === undefined ? {} : { referenceText })
  };
  let analysis: EnglishAgreementAnalysis;
  try {
    analysis = await analyzer(request, { signal, timeoutMs: ANALYSIS_TIMEOUT_MS });
  } catch (error) {
    if (signal?.aborted) throw error;
    return text;
  }
  if (signal?.aborted) throw new Error("English agreement analysis was cancelled.");
  if (!analysis || analysis.disposition !== "suggestions") return text;
  return applyValidatedSuggestions(text, readonlyPlaceholders, analysis);
}

export async function prepareReadableProseRequest(
  input: ReadableProseTaskInput,
  view: ReadableProseView,
  signal?: AbortSignal,
  analyzer: ReadableProseAgreementAnalyzer = analyzeEnglishAgreement
): Promise<PreparedReadableProseRequest> {
  const text = await normalizeReadableProseText(view.text, view.readonlyPlaceholders, signal, analyzer);
  const preparedView = text === view.text ? view : { ...view, text };
  return { view: preparedView, prompts: buildReadableProsePrompts(input, preparedView) };
}
