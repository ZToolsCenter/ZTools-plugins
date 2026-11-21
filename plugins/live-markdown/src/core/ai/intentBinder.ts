import type { AiDocumentSnapshot } from "../../types/aiEditing";
import type { IntentCandidates, IntentEdit, IntentOccurrence, ValidatedIntent } from "./intentTypes";
import { assertSafeMarkdownRange, getMarkdownBodyStart, isSafeMarkdownBoundary, readIntentHeadingRanges, type IntentHeadingRange } from "./intentTargets";
import { assertSingleEditOperation, assertVerbatimWriteUsesLiteral } from "./intentConstraints";
import type { InstructionContract } from "./intentContract";
import { validatePlannedIntent } from "./intentPlanValidation";
import { validateHeadingTarget } from "./intentHeadingConstraint";

export interface BoundIntentRange {
  from: number;
  to: number;
  expectedText: string;
}

export interface BoundIntent {
  contract?: InstructionContract;
  intent: ValidatedIntent;
  range: BoundIntentRange;
  /** Context supplied to a later generation call; insertion ranges remain empty. */
  source: string;
  /** Frozen full text used only to construct a range-checked final patch. */
  documentContent: string;
  summary: string;
  dependency: "document" | "selection" | "cursor";
  literalText?: string;
  matches?: Array<{ from: number; to: number }>;
}

export interface BoundIntentPatch extends BoundIntentRange {
  insertText: string;
}

interface SourceRange { from: number; to: number; }

function clarification(reason: Extract<ValidatedIntent, { kind: "clarify" | "unsupported" }>['reason']): never {
  const messages = {
    missing_operation: "请说明要对文档执行什么操作，或补充你希望 AI 回答的问题。",
    missing_target: "请说明修改位置，例如文末、某个标题后或当前选区。",
    missing_content: "请提供要插入或替换的内容，或明确说明需要 AI 创作。",
    ambiguous_anchor: "找到多个可能的位置，请指定标题、匹配内容或第几处。",
    scope_conflict: "当前选区与指令范围不明确，请明确处理全文还是选区。",
    compound: "这条指令包含多个操作，请拆成一条指令后再发送。",
    conflicting_constraints: "指令中的要求互相冲突，请修改后重新发送。",
    unsupported_operation: "当前暂不支持这个编辑操作，请改为插入或改写内容。"
  };
  throw new Error(messages[reason]);
}

function selectionRange(snapshot: AiDocumentSnapshot): SourceRange {
  if (snapshot.selectionValid === false || !snapshot.selection) {
    throw new Error("无法准确定位当前选区，请重新选择内容后重试。");
  }
  assertSafeMarkdownRange(snapshot.content, snapshot.selection.from, snapshot.selection.to);
  return snapshot.selection;
}

function makeRange(source: string, from: number, to: number): BoundIntentRange {
  assertSafeMarkdownRange(source, from, to);
  return { from, to, expectedText: source.slice(from, to) };
}

function countMatches(scopeText: string, find: string, offset: number, source: string, occurrence: IntentOccurrence = "single"): Array<{ from: number; to: number }> {
  if (!find) throw new Error("精确定位内容不能为空。");
  const matches: Array<{ from: number; to: number }> = [];
  let cursor = 0;
  while (cursor <= scopeText.length - find.length) {
    const local = scopeText.indexOf(find, cursor);
    if (local < 0) break;
    const match = { from: offset + local, to: offset + local + find.length };
    if (!isSafeMarkdownBoundary(source, match.from) || !isSafeMarkdownBoundary(source, match.to)) {
      throw new Error("匹配内容跨越了 CRLF 或 Unicode 字符边界，无法安全定位。");
    }
    if (occurrence === "last") matches[0] = match;
    else {
      matches.push(match);
      if (occurrence === "all" && matches.length > 1000) throw new Error("匹配数量超过 1000 处的安全上限，请缩小替换范围。");
      if (occurrence === "single" && matches.length === 2 || typeof occurrence === "number" && matches.length >= occurrence) break;
    }
    cursor = local + find.length;
  }
  return matches;
}

function chooseMatch(matches: Array<{ from: number; to: number }>, occurrence: IntentOccurrence, allowAll: boolean): Array<{ from: number; to: number }> {
  if (matches.length === 0) throw new Error("没有找到指令中的精确匹配内容，请检查原文或缩小范围。");
  if (occurrence === "all") {
    if (!allowAll) throw new Error("插入操作不能使用“全部匹配”位置，请指定唯一位置或具体序号。");
    if (matches.length > 1000) throw new Error("匹配数量超过 1000 处的安全上限，请缩小替换范围。");
    return matches;
  }
  if (occurrence === "single") {
    if (matches.length !== 1) throw new Error(`找到 ${matches.length} 处匹配内容，请指定第几处。`);
    return [matches[0]];
  }
  if (occurrence === "last") {
    if (!allowAll) throw new Error("插入操作不能使用“最后一处”匹配位置。");
    return [matches[matches.length - 1]];
  }
  if (!Number.isInteger(occurrence) || occurrence < 1 || occurrence > 1000) throw new Error("匹配序号必须是 1 到 1000 之间的正整数。");
  const selected = matches[occurrence - 1];
  if (!selected) throw new Error(`只找到 ${matches.length} 处匹配内容，不存在第 ${occurrence} 处。`);
  return [selected];
}

function getScope(snapshot: AiDocumentSnapshot, scope: "document" | "selection"): SourceRange {
  return scope === "document" ? { from: 0, to: snapshot.content.length } : selectionRange(snapshot);
}

function sectionEnd(headings: IntentHeadingRange[], heading: IntentHeadingRange, sourceLength: number): number {
  const next = headings.find((item) => item.from > heading.from && item.level <= heading.level);
  return next?.lineFrom ?? sourceLength;
}

function insertOffset(intent: Extract<IntentEdit, { operation: "insert" }>, snapshot: AiDocumentSnapshot, candidates: IntentCandidates, instruction: string): { from: number; dependency: BoundIntent["dependency"]; source: string; summary: string } {
  const { content } = snapshot;
  switch (intent.target) {
    case "body_start":
      return { from: getMarkdownBodyStart(content), dependency: "document", source: content, summary: "正文开头" };
    case "document_end":
      return { from: content.length, dependency: "document", source: content, summary: "全文末尾" };
    case "selection_end": {
      const range = selectionRange(snapshot);
      return { from: range.to, dependency: "selection", source: content.slice(range.from, range.to), summary: "当前选区末尾" };
    }
    case "cursor": {
      const from = snapshot.cursor;
      if (from === null) throw new Error("当前编辑器没有可用光标位置，请先在文档中放置光标。");
      assertSafeMarkdownRange(content, from, from);
      return { from, dependency: "cursor", source: content, summary: "当前光标处" };
    }
    case "heading_end":
    case "section_end": {
      if (!intent.targetId) throw new Error("缺少标题定位标识，请重新发送指令。");
      const headings = readIntentHeadingRanges(content);
      const heading = validateHeadingTarget(intent.targetId, candidates, headings, instruction);
      const endOfSection = sectionEnd(headings, heading, content.length);
      const from = intent.target === "heading_end" ? heading.lineTo : endOfSection;
      return {
        from,
        dependency: "document",
        source: content.slice(heading.lineFrom, endOfSection),
        summary: `“${heading.text}”${intent.target === "heading_end" ? "标题后" : "章节末尾"}`
      };
    }
    case "exact_match": {
      if (!intent.find || !intent.occurrence || !intent.matchScope) throw new Error("精确插入计划缺少匹配范围或序号。");
      const scope = getScope(snapshot, intent.matchScope);
      const matches = countMatches(content.slice(scope.from, scope.to), intent.find, scope.from, content, intent.occurrence);
      const [match] = chooseMatch(matches, intent.occurrence, false);
      return {
        from: match.to,
        dependency: intent.matchScope,
        source: intent.matchScope === "selection" ? content.slice(scope.from, scope.to) : content,
        summary: `在“${intent.find}”后${matches.length > 1 ? `（第 ${typeof intent.occurrence === "number" ? intent.occurrence : 1} 处）` : ""}`
      };
    }
  }
}

function rewriteRange(target: "document" | "selection", snapshot: AiDocumentSnapshot): SourceRange {
  return target === "document" ? { from: 0, to: snapshot.content.length } : selectionRange(snapshot);
}

function hasExplicitDocumentPosition(instruction: string): boolean {
  return /全文|整篇|全篇|通篇|文末|全文末尾|整篇末尾|全篇末尾|(?:当前)?(?:文档|文件|文章)(?:的)?(?:最)?(?:末尾|末端|最后|底部|底端|开头|起始|最前面|首部)|正文(?:开头|起始|最前面)|(?:第\s*)?[0-9零〇一二两三四五六七八九十]+(?:[、,，和及与-]|到)(?:第\s*)?[0-9零〇一二两三四五六七八九十]+\s*(?:条|项|行|段|点|节)?(?:之间|中间)|(?:whole|entire)\s+(?:the\s+)?(?:document|file|article|doc)|(?:at|to|in)\s+(?:(?:the|this|current)\s+)?(?:end|bottom|beginning|start)\s+of\s+(?:(?:the|this|current)\s+)?(?:document|file|article|doc)|(?:the\s+)?(?:document|file|article|doc)(?:'s)?\s+(?:end|bottom|beginning|start)/iu.test(instruction);
}

function hasExplicitWholeDocumentScope(instruction: string): boolean {
  return /全文|整篇|全篇|通篇|整份(?:文档|文件|文章)|整个(?:当前)?(?:文档|文件|文章)|(?:whole|entire|full)\s+(?:the\s+)?(?:document|file|article|doc)|all\s+of\s+(?:the\s+)?(?:document|file|article|doc)|entirety\s+of\s+(?:the\s+)?(?:document|file|article|doc)/iu.test(instruction);
}

function rejectUnsafeDocumentWidening(intent: IntentEdit, snapshot: AiDocumentSnapshot, instruction: string): void {
  const selection = snapshot.selection;
  if (!selection || selection.from === selection.to) return;
  if (intent.operation === "rewrite" || intent.operation === "replace_exact") {
    if (intent.target === "document" && !hasExplicitWholeDocumentScope(instruction)) {
      throw new Error("检测到当前选区，但指令未明确要求处理全文。请明确“全文/整篇”，或改为处理当前选区。");
    }
    return;
  }
  if ((intent.target === "document_end" || intent.target === "body_start") && !hasExplicitDocumentPosition(instruction)) {
    throw new Error("检测到当前选区，但“底部/开头”没有明确指向全文。请说明“文档末尾/正文开头”或“选区末尾”。");
  }
  if (intent.target === "exact_match" && intent.matchScope === "document" && !hasExplicitDocumentPosition(instruction)) {
    throw new Error("检测到当前选区，但指令没有明确要求在全文查找。请说明全文范围或改为选区范围。");
  }
}

function resolveLiteral(intent: IntentEdit, candidates: IntentCandidates, instruction: string): string | undefined {
  if (intent.content.mode !== "literal") return undefined;
  const literal = intent.content as { mode: "literal"; text?: string; literalId?: string };
  let text: string | undefined;
  if (typeof literal.text === "string") text = literal.text;
  else if (typeof literal.literalId === "string") {
    text = candidates.literals.find((candidate) => candidate.id === literal.literalId)?.text;
  }
  if (text === undefined || !text || !instruction.includes(text)) throw new Error("字面内容无法从原始指令中还原，请重新引用要插入或替换的文字。");
  return text;
}

export function prepareIntentInsertion(source: string, from: number, text: string, layout: "block" | "inline"): string {
  assertSafeMarkdownRange(source, from, from);
  if (!text) throw new Error("待插入内容不能为空。");
  if (layout === "inline") return text;
  const prefix = source.slice(0, from);
  const suffix = source.slice(from);
  const separator = lineEndingNear(source, from);
  const afterFrontMatter = from > 0 && getMarkdownBodyStart(source) === from;
  let insertion = text;
  if (prefix) {
    const existing = trailingBreakCount(prefix) + leadingBreakCount(insertion);
    const required = afterFrontMatter ? 1 : 2;
    if (existing < required) insertion = separator.repeat(required - existing) + insertion;
  }
  if (suffix) {
    const existing = trailingBreakCount(insertion) + leadingBreakCount(suffix);
    if (existing < 2) insertion += separator.repeat(2 - existing);
  }
  return insertion;
}

function lineEndingNear(source: string, from: number): string {
  const before = source.slice(0, from).match(/(\r\n|\r|\n)$/)?.[1];
  if (before) return before;
  const after = source.slice(from).match(/^(\r\n|\r|\n)/)?.[1];
  if (after) return after;
  return source.match(/\r\n|\r|\n/)?.[0] ?? "\n";
}

function trailingBreakCount(text: string): number {
  return (text.match(/(?:\r\n|\r|\n)+$/)?.[0].match(/\r\n|\r|\n/g) ?? []).length;
}

function leadingBreakCount(text: string): number {
  return (text.match(/^(?:\r\n|\r|\n)+/)?.[0].match(/\r\n|\r|\n/g) ?? []).length;
}

/** Resolves a validated intent to an immutable UTF-16 source range and readable action summary. */
export function bindAiIntent(intent: ValidatedIntent, snapshot: AiDocumentSnapshot, instruction: string, candidates: IntentCandidates, contract?: InstructionContract): BoundIntent {
  if (contract) validatePlannedIntent(intent, contract, snapshot, candidates, instruction);
  if (intent.kind !== "answer") assertSingleEditOperation(instruction);
  if (intent.kind === "edit") assertVerbatimWriteUsesLiteral(intent, instruction);
  if (intent.kind === "clarify" || intent.kind === "unsupported") clarification(intent.reason);
  if (snapshot.readOnly && intent.kind === "edit") throw new Error("当前文档为只读状态，不能创建编辑计划。");

  if (intent.kind === "answer") {
    const range = intent.target === "document" ? { from: 0, to: snapshot.content.length } : selectionRange(snapshot);
    const bound = makeRange(snapshot.content, range.from, range.to);
    return { intent, contract, range: bound, source: bound.expectedText, documentContent: snapshot.content, summary: intent.target === "selection" ? "回答当前选区问题" : "回答全文问题", dependency: intent.target === "selection" ? "selection" : "document" };
  }

  rejectUnsafeDocumentWidening(intent, snapshot, instruction);
  const literalText = resolveLiteral(intent, candidates, instruction);
  if (intent.operation === "insert") {
    const target = insertOffset(intent, snapshot, candidates, instruction);
    const range = makeRange(snapshot.content, target.from, target.from);
    return {
      intent,
      contract,
      range,
      source: target.source,
      documentContent: snapshot.content,
      summary: `${target.summary}插入${intent.layout === "block" ? "段落" : "行内内容"}`,
      dependency: target.dependency,
      ...(literalText === undefined ? {} : { literalText })
    };
  }

  const scope = rewriteRange(intent.target, snapshot);
  let range: BoundIntentRange;
  let matches: Array<{ from: number; to: number }> | undefined;
  if (intent.operation === "replace_exact") {
    if (!intent.find || !intent.occurrence) throw new Error("精确替换计划缺少匹配内容或序号。");
    matches = chooseMatch(countMatches(snapshot.content.slice(scope.from, scope.to), intent.find, scope.from, snapshot.content, intent.occurrence), intent.occurrence, true);
    range = makeRange(snapshot.content, matches[0].from, matches[matches.length - 1].to);
  } else range = makeRange(snapshot.content, scope.from, scope.to);
  return {
    intent,
    contract,
    range,
    source: range.expectedText,
    documentContent: snapshot.content,
    summary: intent.operation === "rewrite"
      ? intent.target === "document" ? "改写全文" : "改写当前选区"
      : `${intent.target === "document" ? "在全文" : "在当前选区"}${intent.occurrence === "all" ? "替换所有匹配" : intent.occurrence === "last" ? "替换最后一处匹配" : "替换匹配内容"}`,
    dependency: intent.target === "selection" ? "selection" : "document",
    ...(literalText === undefined ? {} : { literalText }),
    ...(matches ? { matches } : {})
  };
}

/** Builds the one explicit proposal patch after literal resolution or content generation. */
export function buildBoundIntentPatch(bound: BoundIntent, text: string): BoundIntentPatch {
  if (bound.intent.kind !== "edit") throw new Error("回答计划不能生成文档补丁。");
  if (!text) throw new Error("生成结果为空，未创建可应用的文档补丁。");
  const { intent } = bound;
  let insertText = text;
  if (intent.operation === "insert") insertText = prepareIntentInsertion(bound.documentContent, bound.range.from, text, intent.layout);
  if (intent.operation === "replace_exact" && intent.occurrence === "all") {
    const matches = bound.matches;
    if (!matches?.length) throw new Error("批量替换计划缺少已绑定的精确位置。");
    let cursor = bound.range.from;
    let preserved = "";
    for (const match of matches) {
      preserved += bound.range.expectedText.slice(cursor - bound.range.from, match.from - bound.range.from) + text;
      cursor = match.to;
    }
    insertText = preserved + bound.range.expectedText.slice(cursor - bound.range.from);
  }
  return { ...bound.range, insertText };
}

export const createIntentPatch = buildBoundIntentPatch;
