import type { InstructionSpan } from "./intentContract";

const CODE_ARTIFACT = /代码块|代码围栏|源代码|代码|函数|\bcode\s*(?:block|fence)\b|\bfunction\b|\b(?:python|javascript|typescript)\b/giu;
const GENERATION_ACTION = /追加|新增|添加|增加|插入|写入|输出|实现|定义|编写|撰写|创建|生成|提供|\b(?:append|add|insert|write|output|implement|define|create|generate|provide)\b/giu;
const CLAUSE_BREAK = /[,，。！？；;\n]|(?:但是|不过|然而|而是|只不过|\bbut\b|\bhowever\b)/giu;
const NEGATIVE_PREFIX = /(?:不要|别|无需|无须|不需要|不必|不能|不可|禁止|不得|避免|不|don't|do\s+not|must\s+not|without|not)[^，,。！？；;\n]{0,20}$/iu;
const CODE_TOPIC = /代码|程序|函数|\b(?:python|javascript|typescript|code|program|function)\b/iu;
const EXPLANATORY_TEXT = /(?:解释|说明|介绍|描述|阐述|explain(?:ing|ation)?|describ(?:e|ing|tion))[^，,。！？；;\n]{0,80}(?:用途|作用|功能|含义|文字|文本|段落|prose|paragraph)|(?:用途|作用|功能|含义)[^，,。！？；;\n]{0,32}(?:文字|文本|段落|prose|paragraph)|(?:文字|文本|段落|prose|paragraph)[^，,。！？；;\n]{0,40}(?:解释|说明|介绍|描述|阐述|explain|describ)/giu;

function clauseStart(source: string, from: number): number {
  CLAUSE_BREAK.lastIndex = 0;
  let start = 0;
  for (const match of source.slice(0, from).matchAll(CLAUSE_BREAK)) start = (match.index ?? 0) + match[0].length;
  return start;
}

function clauseEnd(source: string, from: number): number {
  CLAUSE_BREAK.lastIndex = from;
  return CLAUSE_BREAK.exec(source)?.index ?? source.length;
}

function hasPositiveGenerationAction(clause: string): boolean {
  GENERATION_ACTION.lastIndex = 0;
  for (const match of clause.matchAll(GENERATION_ACTION)) {
    const from = match.index ?? 0;
    if (!NEGATIVE_PREFIX.test(clause.slice(0, from))) return true;
  }
  return false;
}

function positiveActionsBeforeArtifact(clause: string, artifactOffset: number): Array<{ from: number; to: number }> {
  const prefix = clause.slice(0, artifactOffset);
  GENERATION_ACTION.lastIndex = 0;
  return [...prefix.matchAll(GENERATION_ACTION)].flatMap((match) => {
    const from = match.index ?? 0;
    const to = from + match[0].length;
    if (NEGATIVE_PREFIX.test(prefix.slice(0, from)) || /(?:只|仅)?输出\s*$/u.test(prefix.slice(0, from))) return [];
    return artifactOffset - to <= 64 ? [{ from, to }] : [];
  });
}

/** True when code is the subject of requested prose, rather than the produced artifact. */
export function isExplanatoryTextAboutCode(masked: string, from: number): boolean {
  const start = clauseStart(masked, from);
  const end = clauseEnd(masked, from);
  const clause = masked.slice(start, end);
  if (!CODE_TOPIC.test(clause)) return false;
  EXPLANATORY_TEXT.lastIndex = 0;
  return EXPLANATORY_TEXT.test(clause);
}

/** Resolves an explicit text-generation task that explains code without forcing a code artifact format. */
export function generatedExplanatoryTextEvidence(instruction: string, masked: string): InstructionSpan[] {
  EXPLANATORY_TEXT.lastIndex = 0;
  const evidence: InstructionSpan[] = [];
  for (const match of masked.matchAll(EXPLANATORY_TEXT)) {
    const from = match.index ?? 0;
    const to = from + match[0].length;
    if (!isExplanatoryTextAboutCode(masked, from)) continue;
    const start = clauseStart(masked, from);
    const end = clauseEnd(masked, to);
    if (!hasPositiveGenerationAction(masked.slice(start, end))) continue;
    evidence.push({ from, to, raw: instruction.slice(from, to) });
  }
  return evidence;
}

/** Returns one affirmative creation verb only when it directly introduces a code artifact. */
export function generatedCodeGenerationActionEvidence(instruction: string, masked: string): InstructionSpan[] {
  CODE_ARTIFACT.lastIndex = 0;
  const evidence: InstructionSpan[] = [];
  for (const match of masked.matchAll(CODE_ARTIFACT)) {
    const artifactFrom = match.index ?? 0;
    if (isExplanatoryTextAboutCode(masked, artifactFrom)) continue;
    const start = clauseStart(masked, artifactFrom);
    const end = clauseEnd(masked, artifactFrom + match[0].length);
    const clause = masked.slice(start, end);
    const actions = positiveActionsBeforeArtifact(clause, artifactFrom - start);
    for (const action of actions) {
      const from = start + action.from;
      const to = start + action.to;
      if (!evidence.some((item) => item.from === from && item.to === to)) {
        evidence.push({ from, to, raw: instruction.slice(from, to) });
      }
    }
  }
  return evidence;
}

/** Returns source evidence only when an affirmative edit explicitly asks to create code. */
export function generatedCodeTaskEvidence(instruction: string, masked: string): InstructionSpan[] {
  CODE_ARTIFACT.lastIndex = 0;
  const evidence: InstructionSpan[] = [];
  for (const match of masked.matchAll(CODE_ARTIFACT)) {
    const from = match.index ?? 0;
    const to = from + match[0].length;
    const start = clauseStart(masked, from);
    const end = clauseEnd(masked, to);
    if (isExplanatoryTextAboutCode(masked, from)) continue;
    if (!positiveActionsBeforeArtifact(masked.slice(start, end), from - start).length) continue;
    if (!evidence.some(({ from: existingFrom, to: existingTo }) => existingFrom === from && existingTo === to)) {
      evidence.push({ from, to, raw: instruction.slice(from, to) });
    }
  }
  return evidence;
}
