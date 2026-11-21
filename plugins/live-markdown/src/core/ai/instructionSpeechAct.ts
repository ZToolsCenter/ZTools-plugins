import type { InstructionConstraint, InstructionContract, InstructionContractContext, InstructionSpan } from "./intentContract";

const EDITING_TERMS = /润色|校对|续写|总结|改写|修改|编辑|排版|增加|添加|新增|插入|追加|\bpolish(?:ing)?\b|\bproofread(?:ing)?\b|\bcontinue\b|\bsummar(?:y|ize|ise|izing|ising)\b|\brewrite\b|\bedit(?:ing)?\b|\badd(?:ing)?\b|\binsert(?:ing)?\b/iu;
const DIRECT_ANSWER_REQUEST = /^\s*(?:(?:请\s*)?(?:不要|别|勿|无需|无须|不需要|不必|不能|不可|禁止|不得|do\s+not|don't|must\s+not)\s*(?:修改|编辑|改动|更改|新增|添加|增加|插入|追加|加上|edit|modify|add|insert|create|generate)(?:文稿|文档|正文|内容|代码块|the\s+document)?\s*[，,;；。]\s*)?(?:(?:请问|请|please)\s*)?(?:(?:只|仅|only)\s*)?(?:(?:基于|根据|依据|结合|based\s+on|from)\s*(?:全文|整篇|全篇|文稿|文档|文章|原文|文本|选区|所选内容|当前选区|the\s+(?:whole\s+)?document|the\s+selection|selection)\s*)?(?:回答(?:我)?|答复(?:我)?|解释(?:一下)?|说明(?:一下)?|讲解(?:一下)?|answer|respond|explain|describe)(?=$|[\s,，:：?？。！“‘「『"`])/iu;
const STANDALONE_NEGATED_EDIT = /^\s*(?:请\s*)?(?:不要|别|勿|无需|无须|不需要|不必|不能|不可|禁止|不得|do\s+not|don't|must\s+not)\s*(?:只|仅)?\s*(?:修改|编辑|改动|更改|新增|添加|增加|插入|追加|加上|加|创建|生成|写入|edit|modify|add|insert|append|create|generate)(?=$|[\s,，;；。！？]|[\p{Script=Han}])[\s\S]*$/iu;
const FRONT_QUESTION = /^\s*(?:请问\s*)?(?:(?:帮我\s*)?(?:告诉我|解释一下|说明一下|请解释|讲讲|介绍一下)\s*)?(?:如何|怎么(?:样)?|怎样|为什么|为何|什么是|how\b|why\b|what\s+(?:does|is|are)\b|what\s+is\s+the\s+meaning\b)[^\r\n]*$/iu;
const ENGLISH_EXPLAIN = /^\s*(?:please\s+)?(?:(?:tell\s+me|explain|describe)\s+)?(?:how|why|what\s+(?:does|is|are)\b)[^\r\n]*$/iu;
const CHINESE_TASK_QUESTION = /^\s*(?:请问[，,]?\s*)?(?:润色|校对|续写|总结|改写|修改|编辑|排版)(?:全文|整篇|这段(?:话|文字)?|这篇文章|选区)?\s*(?:(?:的\s*)?(?:标准|方法|技巧|定义|含义|用途)\s*是什么|(?:有)?(?:哪些|什么)(?:\s*(?:方法|技巧|标准|定义|含义))?|(?:的\s*)?(?:标准|方法|技巧|定义|含义|用途)\s*[?？])(?:呢)?\s*[?？]?\s*$/iu;
const ENGLISH_TASK_QUESTION = /^\s*(?:polishing|proofreading|continuation|summari[sz]ation|editing)\s+(?:standards?|methods?|tips?|definition|meaning)\s*[?？]?\s*$/iu;
const SECOND_EDIT_CLAUSE = /^(?:\s*(?:并且|并|然后|接着|同时|再|此外|而且|and\s+then|and|but|however|then|also|please|请帮我|帮我|请|再|then|also)\s*)*(?:(?:在|于|到|将|把|at|in|to)\s*(?:(?:全文|文末|文档|文章|文件|结尾|底部|末尾|the\s+document|the\s+end)\s*)?)*(?:润色|校对|续写|总结|改写|修改|编辑|排版|删除|移除|替换|新增|添加|插入|追加|写入|创建|生成|编写|撰写|\bpolish(?:ing)?\b|\bproofread(?:ing)?\b|\bcontinue\b|\bsummar(?:y|ize|ise|izing|ising)\b|\brewrite\b|\bedit(?:ing)?\b|\bdelete\b|\breplace\b|\badd(?:ing)?\b|\binsert(?:ing)?\b|\bappend\b|\bcreate\b|\bgenerate\b|\bwrite\b|\bproduce\b)/iu;
const CLAUSE_JOINER = /[?？。！；;,，\n]|然后|接着|并且|并|同时|再|以及|此外|而且|\b(?:then|also|and\s+then|and|but|however)\b/giu;

interface MetaQuestionParts {
  question: InstructionSpan;
  additionalEdits: InstructionSpan[];
}

function trimmedSpan(source: string, from: number, to: number): InstructionSpan | undefined {
  const value = source.slice(from, to);
  const start = value.search(/\S/u);
  if (start < 0) return undefined;
  const end = value.trimEnd().length;
  return { from: from + start, to: from + end, raw: source.slice(from + start, from + end) };
}

function isMetaQuestion(masked: string): boolean {
  return Boolean(FRONT_QUESTION.test(masked) || ENGLISH_EXPLAIN.test(masked)
    || CHINESE_TASK_QUESTION.test(masked) || ENGLISH_TASK_QUESTION.test(masked));
}

function clauseBoundaries(source: string): Array<{ from: number; to: number }> {
  CLAUSE_JOINER.lastIndex = 0;
  return [...source.matchAll(CLAUSE_JOINER)].map((match) => {
    const from = match.index ?? 0;
    return { from, to: from + match[0].length };
  });
}

function additionalEditAfter(source: string, boundaries: Array<{ from: number; to: number }>, after: number): InstructionSpan[] {
  const result: InstructionSpan[] = [];
  for (let index = 0; index < boundaries.length; index += 1) {
    const boundary = boundaries[index];
    if (boundary.from < after) continue;
    const next = boundaries[index + 1];
    const clause = trimmedSpan(source, boundary.to, next?.from ?? source.length);
    if (clause && SECOND_EDIT_CLAUSE.test(clause.raw)) result.push(clause);
  }
  return result;
}

function classifyDirectAnswerRequest(instruction: string, masked: string): MetaQuestionParts | undefined {
  if (!instruction || masked.length !== instruction.length) return undefined;
  const match = DIRECT_ANSWER_REQUEST.exec(masked);
  if (!match) return undefined;
  const question = trimmedSpan(instruction, 0, match[0].length);
  if (!question) return undefined;
  const boundaries = clauseBoundaries(masked);
  const additionalEdits = additionalEditAfter(masked, boundaries, match[0].length);
  return { question, additionalEdits };
}

/**
 * Classifies an editing question at the start of the utterance and preserves any
 * separate edit clause as evidence. It intentionally recognizes speech-act shape,
 * not every operation the editor can perform.
 */
function classifyEditingMetaQuestion(instruction: string, masked: string): MetaQuestionParts | undefined {
  if (!instruction || masked.length !== instruction.length || !EDITING_TERMS.test(masked)) return undefined;
  const boundaries = clauseBoundaries(masked);

  for (const boundary of boundaries) {
    const question = trimmedSpan(masked, 0, boundary.from);
    if (!question || !isMetaQuestion(question.raw)) continue;
    const additionalEdits = additionalEditAfter(masked, boundaries, boundary.from);
    if (additionalEdits.length) {
      return {
        question: { ...question, raw: instruction.slice(question.from, question.to) },
        additionalEdits: additionalEdits.map(({ from, to }) => ({ from, to, raw: instruction.slice(from, to) }))
      };
    }
    // The suffix scan above covered every later clause; later question prefixes
    // cannot reveal an edit that this first recognized prefix did not contain.
    break;
  }

  if (!isMetaQuestion(masked)) return undefined;
  const question = trimmedSpan(instruction, 0, instruction.length);
  return question ? { question, additionalEdits: [] } : undefined;
}

/**
 * Recognizes only a whole utterance that asks how/why an editing task works.
 * Returns source offsets so callers can attach auditable contract evidence.
 * Mixed question-and-edit requests deliberately return undefined.
 */
export function detectEditingMetaQuestion(instruction: string, masked = instruction): InstructionSpan | undefined {
  const parts = classifyEditingMetaQuestion(instruction, masked);
  return parts && parts.additionalEdits.length === 0 ? parts.question : undefined;
}

function unknown<T>(): InstructionConstraint<T> {
  return { state: "unknown" };
}

function explicit<T>(value: T, evidence: InstructionSpan[]): InstructionConstraint<T> {
  return { state: "explicit", value, evidence };
}

/** Applies speech-act semantics before continuation defaults and output-schema projection. */
export function applyInstructionSpeechAct(
  contract: InstructionContract,
  instruction: string,
  masked: string,
  context: InstructionContractContext = {}
): void {
  const directAnswer = classifyDirectAnswerRequest(instruction, masked);
  const parts = directAnswer ?? classifyEditingMetaQuestion(instruction, masked);
  if (!parts) {
    const negativeEdit = STANDALONE_NEGATED_EDIT.exec(masked);
    if (negativeEdit && contract.operation.state === "unknown" &&
        !(contract.effect.state === "explicit" && contract.effect.value === "answer")) {
      const evidence = trimmedSpan(instruction, negativeEdit[0].indexOf(negativeEdit[0].trim()),
        negativeEdit[0].indexOf(negativeEdit[0].trim()) + negativeEdit[0].trim().length);
      contract.effect = explicit("no_edit", evidence ? [evidence] : []);
      contract.issues = contract.issues.filter(({ code }) => code !== "missing_operation");
    }
    return;
  }

  if (directAnswer && !parts.additionalEdits.length) {
    contract.effect = explicit("answer", [parts.question]);
    contract.operation = unknown();
    contract.target = unknown();
    contract.occurrence = unknown();
    contract.layout = unknown();
    contract.heading = unknown();
    contract.literals = contract.literals.map((literal) => ({ ...literal, role: "unknown" }));
    contract.preconditions.cursorRequired = false;
    contract.generationTasks = explicit(["custom"], [parts.question]);
    // Keep scope and selection preconditions intact so an unavailable selection
    // cannot silently turn an answer over selected text into a whole-document answer.
    contract.issues = contract.issues.filter(({ code }) => code !== "missing_operation");
    return;
  }

  const evidence = [parts.question, ...parts.additionalEdits];
  const scope = contract.scope.state === "explicit" &&
    (contract.scope.value === "document" || contract.scope.value === "selection" && context.hasSelection === true)
    ? contract.scope : unknown<"document" | "selection">();

  contract.operation = unknown();
  contract.target = unknown();
  contract.scope = parts.additionalEdits.length ? unknown<"document" | "selection">() : scope;
  contract.occurrence = unknown();
  contract.layout = unknown();
  contract.heading = unknown();
  contract.literals = contract.literals.map((literal) => ({ ...literal, role: "unknown" }));
  contract.preconditions = { selectionRequired: false, cursorRequired: false };

  if (parts.additionalEdits.length) {
    contract.effect = { state: "ambiguous", alternatives: ["answer", "edit"], evidence };
    contract.operation = { state: "ambiguous", alternatives: ["insert", "replace_exact", "rewrite"], evidence };
    contract.generationTasks = undefined;
    contract.issues = [{ code: "compound", evidence }];
    return;
  }

  contract.effect = explicit("answer", [parts.question]);
  contract.generationTasks = explicit(["custom"], [parts.question]);
  contract.issues = [];
}
