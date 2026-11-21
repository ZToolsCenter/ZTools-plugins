import type { IntentTask } from "./intentTypes";
import { isRoutineStyleCanonicalAuthority, type RoutineStyleCanonicalAuthority } from "./proseRoutineStyleContext";

export interface RoutineStyleTaskRange {
  readonly from: number;
  readonly to: number;
}

export interface RoutineStyleAuthorizationInput {
  readonly instruction: string;
  readonly document: string;
  readonly taskRange: RoutineStyleTaskRange;
  readonly taskSource: string;
  readonly task: IntentTask;
  readonly canonicalAuthority?: RoutineStyleCanonicalAuthority;
}

const MAX_INSTRUCTION_CHARS = 2048;
const CN_ITEM = "(?:日期|负责人|负责团队|项目名称|人名|名称|金额|数字|事实|原意|核对事项|结构|格式|拼写|语法|数据|结论|观点)";
const CN_ITEM_LIST = `${CN_ITEM}(?:(?:和|及|、)${CN_ITEM})*`;
const EN_ITEM = "(?:owner names?|owners?|dates?|project names?|names?|amounts?|numbers?|facts?|original meaning|meaning|structure|format|spelling|grammar|data|conclusions?|claims?)";
const EN_ITEM_LIST = `${EN_ITEM}(?:\\s*,\\s*${EN_ITEM})*(?:\\s*,?\\s*(?:and|or)\\s+${EN_ITEM})?`;
const CN_ACTION = /^(?:请)?(?:润色|校对|修改措辞|优化表达|改进表达)(?:一下)?(?:正文|文本|内容|措辞|语言|表达)?(?:使(?:其|表达|文字|语言|内容)?(?:更|更加|更为)?(?:清晰|清楚|简洁|通顺|自然)(?:、?(?:清晰|清楚|简洁|通顺|自然))*)?$/u;
const CN_STYLE_DETAIL = /^(?:使|让)(?:其|表达|文字|语言|内容)?(?:更|更加|更为)(?:清晰|清楚|简洁|通顺|自然)(?:、?(?:清晰|清楚|简洁|通顺|自然))*$/u;
const CN_DIRECT_STYLE = /^(?:请)?让(?:文字|表达|语言|内容)(?:更|更加|更为)(?:清晰|清楚|简洁|通顺|自然){1,3}$/u;
const CN_PRESERVE = new RegExp(`^(?:请)?(?:保留|保持|维持)(?:(?:原样|不变))?${CN_ITEM_LIST}$`, "u");
const CN_PROTECT = new RegExp(`^(?:不|不要|不得|不可)(?:添加|新增|修改|改动|改变|更改|删改|删掉|删除|移除)(?:任何)?${CN_ITEM_LIST}$`, "u");
const EN_ACTION = /^(?:please\s+)?(?:(?:polish|proofread|copy\s*edit|copyedit)\s+(?:(?:the\s+)?(?:text|document|writing|wording)|for\s+(?:grammar|clarity|concision|readability|spelling)(?:\s+and\s+(?:grammar|clarity|concision|readability|spelling)){0,3})(?:\s+for\s+(?:grammar|clarity|concision|readability|spelling)(?:\s+and\s+(?:grammar|clarity|concision|readability|spelling)){0,3})?|correct\s+(?:the\s+)?(?:spelling|grammar|typos?)(?:\s+and\s+(?:spelling|grammar|typos?))*)$/iu;
const EN_PRESERVE = new RegExp(`^(?:(?:while\\s+)?(?:preserve|preserving|keep|retain)\\s+(?:the\\s+)?${EN_ITEM_LIST})$`, "iu");
const EN_PROTECT = new RegExp(`^(?:(?:but\\s+)?(?:do not|don't|must not|should not)\\s+(?:add|change|edit|alter|modify|remove|delete)\\s+(?:any\\s+)?${EN_ITEM_LIST}(?:(?:\\s*,?\\s*(?:or|and)\\s+)(?:(?:do not|don't|must not|should not)\\s+)?(?:add|change|edit|alter|modify|remove|delete)\\s+(?:any\\s+)?${EN_ITEM_LIST})*)$`, "iu");
const QUESTION = /[?？]|是否|能否|可否|(?:吗|么)(?:[。！!；;\s]|$)|\b(?:whether|if|can\s+you|could\s+you|would\s+you|should\s+you)\b/iu;
const CONDITIONAL = /如果|若|假如|倘若|要是|只要|除非|一旦|如有必要|如有需要|需要时|视情况|在[^。！？；;\n]{1,32}情况下|当[^。！？；;\n]{1,32}时|\b(?:if|unless|when|whenever|provided\s+that|only\s+if)\b/iu;

function hasQuotedContent(instruction: string): boolean {
  for (let index = 0; index < instruction.length; index += 1) {
    const char = instruction[index];
    if ((char === "'" || char === "’") && /[\p{Script=Latin}\p{N}]/u.test(instruction[index - 1] ?? "") &&
        /[\p{Script=Latin}\p{N}]/u.test(instruction[index + 1] ?? "")) continue;
    if ('"“”‘’「」『』«»`'.includes(char)) return true;
  }
  return false;
}

function validTaskRange(input: RoutineStyleAuthorizationInput): boolean {
  if (!input.taskRange || typeof input.taskRange !== "object") return false;
  const { taskRange, document, taskSource } = input;
  return typeof document === "string" && typeof taskSource === "string" && taskSource.length > 0 &&
    Number.isSafeInteger(taskRange.from) && Number.isSafeInteger(taskRange.to) &&
    taskRange.from >= 0 && taskRange.from <= taskRange.to && taskRange.to <= document.length &&
    document.slice(taskRange.from, taskRange.to) === taskSource;
}

function isChinese(text: string): boolean { return /\p{Script=Han}/u.test(text); }

function isChineseConstraint(clause: string): boolean {
  return CN_PRESERVE.test(clause) || CN_PROTECT.test(clause);
}

function isEnglishConstraint(clause: string): boolean {
  return EN_PRESERVE.test(clause) || EN_PROTECT.test(clause);
}

function parseChineseSentence(sentence: string): number | undefined {
  const clauses = sentence.split(/[，,]/u).map(clause => clause.trim()).filter(Boolean);
  let actionCount = 0;
  let canUseStyleDetail = false;
  for (const clause of clauses) {
    if (CN_ACTION.test(clause) || CN_DIRECT_STYLE.test(clause)) {
      actionCount += 1;
      canUseStyleDetail = true;
    } else if (canUseStyleDetail && CN_STYLE_DETAIL.test(clause)) {
      canUseStyleDetail = false;
    } else if (isChineseConstraint(clause)) {
      canUseStyleDetail = false;
    } else return undefined;
  }
  return actionCount;
}

function parseEnglishSentence(sentence: string): number | undefined {
  const clauses: string[] = [];
  const whileIndex = sentence.search(/\s+while\s+/iu);
  if (whileIndex >= 0) {
    clauses.push(sentence.slice(0, whileIndex).trim(), `while ${sentence.slice(whileIndex).replace(/^\s*while\s+/iu, "").trim()}`);
  } else {
    const comma = sentence.search(/,\s*(?=(?:(?:but\s+)?(?:do not|don't|must not|should not)\b))/iu);
    if (comma >= 0) clauses.push(sentence.slice(0, comma).trim(), sentence.slice(comma + 1).trim());
    else clauses.push(sentence.trim());
  }
  let actionCount = 0;
  for (const clause of clauses) {
    if (EN_ACTION.test(clause)) actionCount += 1;
    else if (!isEnglishConstraint(clause)) return undefined;
  }
  return actionCount;
}

function parseInstruction(instruction: string): boolean {
  const sentences = instruction.trim().split(/(?:[。！？!?；;\r\n]+|\.(?=\s|$)\s*)/u).map(part => part.trim()).filter(Boolean);
  if (!sentences.length) return false;
  let actionCount = 0;
  for (const sentence of sentences) {
    const count = isChinese(sentence) ? parseChineseSentence(sentence) : parseEnglishSentence(sentence);
    if (count === undefined) return false;
    actionCount += count;
    if (actionCount > 1) return false;
  }
  return actionCount === 1;
}

/** Allows only one explicit routine style clause plus narrowly recognized preservation constraints. */
export function authorizeRoutineStyleRequestMarkerRepair(input: RoutineStyleAuthorizationInput): boolean {
  if (!input || typeof input.instruction !== "string" || input.instruction.length === 0 ||
      input.instruction.length > MAX_INSTRUCTION_CHARS || !validTaskRange(input) ||
      (input.task !== "polish" && input.task !== "proofread")) return false;
  if (isRoutineStyleCanonicalAuthority(input.canonicalAuthority, input.instruction, input.task)) return true;
  const instruction = input.instruction.trim();
  if (!instruction || hasQuotedContent(instruction) || QUESTION.test(instruction) || CONDITIONAL.test(instruction)) return false;
  return parseInstruction(instruction);
}
