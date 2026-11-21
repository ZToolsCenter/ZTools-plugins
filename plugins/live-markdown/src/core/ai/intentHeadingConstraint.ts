import type { IntentCandidates } from "./intentTypes";
import type { IntentHeadingRange } from "./intentTargets";

const ORDINALS: Record<string, number> = {
  一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10
};

function ordinalValue(value: string): number | null {
  if (/^\d+$/u.test(value)) return Number(value);
  if (value === "十") return 10;
  const tens = value.indexOf("十");
  if (tens < 0) return ORDINALS[value] ?? null;
  const leading = tens === 0 ? 1 : ORDINALS[value.slice(0, tens)];
  const trailing = tens === value.length - 1 ? 0 : ORDINALS[value.slice(tens + 1)];
  return leading === undefined || trailing === undefined ? null : leading * 10 + trailing;
}

function cleanText(value: string): string {
  return value
    .replace(/\[([^\]]+)\]\([^)]+\)/gu, "$1")
    .replace(/[*_~`]/gu, "")
    .replace(/[\s"“”‘’「」『』《》]/gu, "")
    .toLocaleLowerCase();
}

function titleOrdinal(instruction: string, title: string): number | null {
  const normalizedTitle = cleanText(title);
  const chinese = /第\s*(\d+|[一二两三四五六七八九十]+)\s*(?:个|处)\s*(?:同名)?/gu;
  for (const match of instruction.matchAll(chinese)) {
    const suffix = cleanText(instruction.slice((match.index ?? 0) + match[0].length));
    if (suffix.startsWith(normalizedTitle)) return ordinalValue(match[1]);
  }

  const englishOrdinal: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5 };
  const english = /\b(first|second|third|fourth|fifth|\d+(?:st|nd|rd|th))\s+(?:occurrence\s+of\s+)?/giu;
  for (const match of instruction.matchAll(english)) {
    const suffix = cleanText(instruction.slice((match.index ?? 0) + match[0].length));
    if (!suffix.startsWith(normalizedTitle)) continue;
    const value = match[1].toLowerCase();
    return englishOrdinal[value] ?? Number.parseInt(value, 10);
  }
  return null;
}

function globalHeadingOrdinal(instruction: string): number | null {
  const chinese = /第\s*(\d+|[一二两三四五六七八九十]+)\s*(?:个|处)?\s*(?:同名)?\s*(?:候选(?:标题)?|标题|章节|小节|heading|section)/iu.exec(instruction);
  if (chinese) return ordinalValue(chinese[1]);
  const englishOrdinal: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5 };
  const english = /\b(first|second|third|fourth|fifth|\d+(?:st|nd|rd|th))\s+(?:heading|section)\b/iu.exec(instruction);
  if (!english) return null;
  const value = english[1].toLowerCase();
  return englishOrdinal[value] ?? Number.parseInt(value, 10);
}

function titleIsMentioned(instruction: string, title: string): boolean {
  const normalizedTitle = cleanText(title);
  return normalizedTitle.length > 0 && cleanText(instruction).includes(normalizedTitle);
}

function clarification(message: string): never {
  throw new Error(`${message}请明确标题名称，或说明第几个标题；原文尚未修改。`);
}

/** Confirms a planner-selected heading is explicitly identified by instruction and AST order. */
export function validateHeadingTarget(
  id: string,
  candidates: IntentCandidates,
  headings: IntentHeadingRange[],
  instruction: string
): IntentHeadingRange {
  const candidate = candidates.headings.find((heading) => heading.id === id);
  if (!candidate) throw new Error("指定标题不在当前文档候选列表中，请重新发送指令。");
  const heading = headings.find((item) => item.id === id);
  if (!heading || heading.text !== candidate.text || heading.level !== candidate.level) {
    throw new Error("标题位置已失效，请重新规划目标后再试。");
  }

  const matching = headings.filter((item) => cleanText(item.text) === cleanText(heading.text));
  const titleMentioned = titleIsMentioned(instruction, heading.text);
  const requestedTitleOrdinal = titleMentioned ? titleOrdinal(instruction, heading.text) : null;
  const requestedGlobalOrdinal = globalHeadingOrdinal(instruction);
  const astOrdinal = headings.findIndex((item) => item.id === heading.id) + 1;
  const sameTitleOrdinal = matching.findIndex((item) => item.id === heading.id) + 1;

  if (requestedGlobalOrdinal !== null && requestedGlobalOrdinal !== astOrdinal) {
    clarification(`第 ${requestedGlobalOrdinal} 个 AST 标题与模型选择的标题不一致。`);
  }
  if (!titleMentioned && requestedGlobalOrdinal === null) {
    clarification("无法从指令确认模型选择的标题。 ");
  }
  if (matching.length > 1 && requestedTitleOrdinal === null && requestedGlobalOrdinal === null) {
    clarification(`“${heading.text}”标题重复，无法确定是第几个。`);
  }
  if (requestedTitleOrdinal !== null && requestedTitleOrdinal !== sameTitleOrdinal) {
    clarification(`“${heading.text}”第 ${requestedTitleOrdinal} 个匹配标题与模型选择的标题不一致。`);
  }
  if (requestedTitleOrdinal !== null && requestedTitleOrdinal > matching.length) {
    clarification(`文档中只有 ${matching.length} 个“${heading.text}”标题。`);
  }
  return heading;
}
