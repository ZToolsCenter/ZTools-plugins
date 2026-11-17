import type { IntentEdit } from "./intentTypes";
import { generatedCodeCompositionRanges, generatedFunctionBehaviorRanges, generatedFunctionCreationAction } from "./codeGenerationBehavior";
import { generatedCodeGenerationActionEvidence } from "./generatedCodeTask";
import { sameAnchorSequentialInsertKeys } from "./intentCompoundPolicy";

const ENGLISH_EDIT_VERBS = ["proofread", "summarize", "translate", "rewrite", "restructure", "continue", "expand", "shorten", "replace", "remove", "removes", "removed", "removing", "append", "appends", "appended", "appending", "insert", "delete", "rename", "renamed", "renames", "renaming", "clean", "cleans", "cleaned", "cleaning", "trim", "trims", "trimmed", "trimming", "revise", "polish", "format", "move", "edit", "add"];
const CJK_EDIT_VERBS = ["追加", "添加", "增加", "插入", "润色", "校对", "总结", "替换", "删除", "移除", "移动", "改写", "重写", "续写", "扩写", "缩写", "整理", "补充", "转换", "排版", "修改", "优化", "加上", "加入", "生成", "翻译", "合并", "拆分", "修复", "加"]
  .sort((left, right) => right.length - left.length);

const ENGLISH_CONNECTORS = ["and then", "then", "also", "and"];
const CJK_CONNECTORS = ["然后", "接着", "并且", "同时", "再", "并"];
const CONNECTOR_RIGHT_BREAK = /[。！？；;\r\n]/u;

const QUOTED_PAYLOADS = /“[^”]*”|‘[^’]*’|「[^」]*」|『[^』]*』|《[^》]*》|"(?:\\.|[^"\\])*"|(?<![\p{L}\p{N}])'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/gu;
const NEGATIVE_PREFIX = /(?:不要|不能|无需|无须|禁止|不得|别|避免|没有|不|未|do\s+not|don't|must\s+not|cannot|can't|not(?!\s+only))[^，,。！？；;\n]{0,18}$/iu;
const NEGATED_CODE_CREATION = /(?:不要|别|勿|不应|do\s+not|don't|must\s+not|never)[^，,。！？；;\n]{0,20}(?:新增|新建|添加|增加|插入|写入|生成|定义|创建|实现|编写|提供|add|append|insert|write|create|generate|define|implement|provide)[^，,。！？；;\n]{0,32}(?:代码|代码块|代码围栏|函数|\bcode\b|\bfunction\b|\bfence\b)/iu;

function maskQuotedPayloads(instruction: string): string {
  return instruction.replace(QUOTED_PAYLOADS, (payload) => " ".repeat(payload.length));
}

function hasOneQuotedPayload(instruction: string): boolean {
  return Array.from(instruction.matchAll(QUOTED_PAYLOADS)).length === 1;
}

function requestsVerbatimWrite(instruction: string): boolean {
  const verbs = "(?:添加|插入|追加|加入|增加|替换|写入|放入|加|append|insert|add|replace)";
  const markers = "(?:原样|逐字|照原文|保持原样|verbatim|exactly\\s+as\\s+written|as\\s+is)";
  return new RegExp(`(?:${markers})\\s*(?:地\\s*)?${verbs}|${verbs}[^，,。！？；;\\n]{0,24}${markers}`, "iu").test(instruction);
}

function positiveEditRanges(text: string): Array<{ from: number; to: number; operation: "insert" | "other" }> {
  const ranges: Array<{ from: number; to: number; operation: "insert" | "other" }> = [];
  const english = ENGLISH_EDIT_VERBS.join("|");
  const cjk = CJK_EDIT_VERBS.join("|");
  const insertVerbs = /^(?:append(?:ed|ing|s)?|insert(?:ed|ing|s)?|add(?:ed|ing|s)?|追加|添加|增加|插入|加上|加入|加)$/iu;
  const verbs = new RegExp(`(?<![\\p{L}\\p{N}])(?:${english})(?![\\p{L}\\p{N}])|(?:${cjk})`, "giu");
  for (const match of text.matchAll(verbs)) {
    const from = match.index ?? 0;
    const prefix = text.slice(Math.max(0, from - 12), from);
    if (!NEGATIVE_PREFIX.test(prefix)) {
      ranges.push({
        from,
        to: from + match[0].length,
        operation: insertVerbs.test(match[0]) ? "insert" : "other"
      });
    }
  }
  return ranges;
}

function generatedCodeCreationRanges(instruction: string, masked: string): Array<{ from: number; to: number; operation: "insert" }> {
  if (NEGATED_CODE_CREATION.test(masked)) return [];
  const creationVerb = /^(?:新增|新建|追加|添加|增加|插入|写入|加入|生成|定义|实现|创建|编写|提供|\b(?:add|append|insert|write|create|generate|define|implement|provide)\b)$/iu;
  const action = generatedCodeGenerationActionEvidence(instruction, masked)
    .filter(({ raw }) => creationVerb.test(raw))
    .sort((left, right) => left.from - right.from)[0];
  const fallback = action ?? generatedFunctionCreationAction(instruction, masked);
  if (!fallback || !creationVerb.test(instruction.slice(fallback.from, fallback.to))) return [];
  return [{ from: fallback.from, to: fallback.to, operation: "insert" }];
}

/** Rejects only explicit connector-linked edit sequences; quoted payloads are treated as data. */
export function assertSingleEditOperation(instruction: string): void {
  const text = maskQuotedPayloads(instruction);
  const editCandidates = [...new Map([
    ...positiveEditRanges(text),
    ...generatedCodeCreationRanges(instruction, text)
  ].map((range) => [`${range.from}:${range.to}`, range])).values()];
  const codeBehavior = new Set([...generatedFunctionBehaviorRanges(instruction, text, editCandidates), ...generatedCodeCompositionRanges(instruction, text, editCandidates)]);
  const remaining = editCandidates.filter(({ from, to }) => !codeBehavior.has(`${from}:${to}`));
  const sameAnchorInserts = sameAnchorSequentialInsertKeys(
    text,
    remaining.filter((item) => item.operation === "insert"),
    remaining
  );
  const edits = remaining.filter(({ from, to }) => !sameAnchorInserts.has(`${from}:${to}`));
  const connectors = new RegExp(`(?<![\\p{L}\\p{N}])(?:${ENGLISH_CONNECTORS.join("|")})(?![\\p{L}\\p{N}])|(?:${CJK_CONNECTORS.join("|")})`, "giu");

  for (const match of text.matchAll(connectors)) {
    const position = match.index ?? 0;
    const right = edits.filter((edit) => edit.from >= position + match[0].length).sort((left, rightEdit) => left.from - rightEdit.from)[0];
    const leftHasEdit = edits.some((edit) => edit.from < position);
    const rightIsConnected = right && !CONNECTOR_RIGHT_BREAK.test(text.slice(position + match[0].length, right.from));
    if (leftHasEdit && rightIsConnected) {
      throw new Error("检测到这条指令包含多个编辑操作，请拆分成单条指令后再发送。原文尚未修改。");
    }
  }
}

/** Prevents a generative plan from silently replacing a literal, explicitly verbatim write. */
export function assertVerbatimWriteUsesLiteral(intent: IntentEdit, instruction: string): void {
  if ((intent.operation !== "insert" && intent.operation !== "replace_exact") || intent.content.mode !== "generate") return;
  if (!hasOneQuotedPayload(instruction) || !requestsVerbatimWrite(instruction)) return;
  throw new Error("你要求原样插入或替换引用内容，但当前计划需要 AI 创作，原文尚未修改。请保留引用内容并重新规划。");
}
