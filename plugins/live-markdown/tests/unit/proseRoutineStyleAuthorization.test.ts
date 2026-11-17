import { describe, expect, it } from "vitest";
import {
  authorizeRoutineStyleRequestMarkerRepair,
  type RoutineStyleAuthorizationInput
} from "../../src/core/ai/proseRoutineStyleAuthorization";
import {
  createProseRequestMarkerSourceProof,
  normalizeProseRequestMarkerAnchorSource,
  prepareProseRequestMarkerProofScope,
  prepareRoutineStyleRequestMarkerProofScope,
  suggestProseRequestMarkerSourceRepair,
  type ProseRequestMarkerProofScope
} from "../../src/core/ai/proseRequestMarkerProof";
import type { IntentTask } from "../../src/core/ai/intentTypes";

const source = "请请项目组再次确认。";
const repaired = "请项目组再次确认。";
const routineInstruction = "润色正文，保留日期和负责人，不添加事实。";

function authInput(instruction = routineInstruction, task: IntentTask = "polish", document = source,
  taskRange = { from: 0, to: document.length }): RoutineStyleAuthorizationInput {
  return { instruction, task, document, taskRange, taskSource: document.slice(taskRange.from, taskRange.to) };
}

function styleScope(document: string, instruction = routineInstruction, task: IntentTask = "polish",
  taskRange = { from: 0, to: document.length }) {
  return prepareRoutineStyleRequestMarkerProofScope(authInput(instruction, task, document, taskRange));
}

describe("routine style request-marker authorization", () => {
  it.each([
    ["polish", "润色正文，保留日期和负责人，不添加事实。"],
    ["proofread", "校对正文，使表达更简洁；保留原意和负责人。"],
    ["polish", "请让文字更清楚简洁，保留日期和负责团队。"],
    ["proofread", "Please proofread for grammar and clarity while preserving dates, owners, and facts."],
    ["polish", "Please polish the wording for clarity and concision; do not change dates or owner names."],
    ["proofread", "Correct spelling and grammar, but do not add facts or change names."],
    ["polish", "润色正文使其简洁，不改变日期和负责人。"]
  ] as const)("authorizes ordinary %s with explicit style intent: %s", (task, instruction) => {
    expect(authorizeRoutineStyleRequestMarkerRepair(authInput(instruction, task))).toBe(true);
    expect(styleScope(source, instruction, task)).toBeDefined();
  });

  it.each([
    ["wrong task: summarize", "polish", "summarize"],
    ["wrong task: custom", "润色正文。", "custom"],
    ["no style operation", "检查日期和负责人。", "polish"],
    ["question", "是否润色正文并修正文字？", "polish"],
    ["conditional", "如果合适，请润色正文。", "polish"],
    ["conditional English", "If appropriate, polish the wording.", "polish"],
    ["quoted request", "请按“润色正文”的要求处理。", "polish"],
    ["ASCII quoted request", "Please follow \"polish the wording\".", "polish"],
    ["preserve repeated wording", "润色正文，保留重复的请求用词。", "polish"],
    ["preserve a literal duplicate marker", "润色正文，勿删除请请。", "polish"],
    ["explicitly do not delete duplicates", "校对正文，不要删除重复字词。", "proofread"],
    ["do not change any wording", "润色正文，但不要改字。", "polish"],
    ["preserve the text exactly", "Polish the text, but do not change anything.", "polish"],
    ["negated style request", "Do not polish this text.", "polish"],
    ["English duplicate preservation", "Proofread the text, but preserve repeated request wording.", "proofread"],
    ["only punctuation", "只改标点，不改其他文字。", "proofread"],
    ["only inspect facts", "仅检查日期和负责人，不改措辞。", "polish"],
    ["conflicting operation", "润色正文并总结成三点。", "polish"],
    ["forbid wording edits", "Polish the text, but do not change any wording.", "polish"],
    ["not needed", "无需润色正文。", "polish"],
    ["not required", "不需要润色正文。", "polish"],
    ["not necessary", "不必润色正文。", "polish"],
    ["please do not polish", "请勿润色正文。", "polish"],
    ["conditional time", "需要时再润色正文。", "polish"],
    ["conditional discretion", "视情况润色正文。", "polish"],
    ["instruction to refrain from changing", "润色正文，但不要改。", "polish"],
    ["preserve duplicate polite wording", "润色正文，保留重复的礼貌用语。", "polish"],
    ["do not delete duplicate request word", "润色正文，但不要删掉重复的请求词。", "polish"],
    ["empty instruction", "", "polish"]
  ] as const)("abstains for %s", (_case, instruction, task) => {
    expect(authorizeRoutineStyleRequestMarkerRepair(authInput(instruction, task as IntentTask))).toBe(false);
    expect(styleScope(source, instruction, task as IntentTask)).toBeUndefined();
  });

  it("requires the complete task source to match its document range", () => {
    const input = authInput();
    expect(authorizeRoutineStyleRequestMarkerRepair({ ...input, taskSource: "别的文本" })).toBe(false);
    expect(authorizeRoutineStyleRequestMarkerRepair({ ...input, taskRange: { from: 1, to: input.document.length } })).toBe(false);
    expect(prepareRoutineStyleRequestMarkerProofScope({ ...input,
      taskRange: { from: 1, to: input.document.length }, taskSource: "别的文本" })).toBeUndefined();
    expect(authorizeRoutineStyleRequestMarkerRepair({ ...input, taskRange: null } as unknown as RoutineStyleAuthorizationInput)).toBe(false);
  });

  it("rejects over-budget instructions without rejecting the surrounding task", () => {
    const instruction = `请润色正文。${"说明".repeat(1100)}`;
    expect(authorizeRoutineStyleRequestMarkerRepair(authInput(instruction))).toBe(false);
    expect(styleScope(source, instruction)).toBeUndefined();
  });
});

describe("source-derived one-character request repair", () => {
  it("proposes only deletion of the second 请 and carries the existing source proof", () => {
    const document = "2026-11-03 周宁负责；请请项目组再次确认。";
    const scope = styleScope(document)!;
    const suggestion = suggestProseRequestMarkerSourceRepair(scope, "full-sentence",
      { from: 0, to: document.length }, document);
    expect(suggestion).toBeDefined();
    expect(suggestion!.text).toBe("2026-11-03 周宁负责；请项目组再次确认。");
    expect(suggestion!.text.length).toBe(document.length - 1);
    expect(suggestion!.proof).toBeDefined();
    expect(normalizeProseRequestMarkerAnchorSource(document, suggestion!.text, [suggestion!.proof], "slot"))
      .toBe(suggestion!.text);
  });

  it("keeps the deterministic suggestion path distinct from explicit-delete authorization", () => {
    const instruction = "润色正文，删去明显重复的请求用词；保留日期和负责人。";
    const scope = prepareProseRequestMarkerProofScope({ instruction, document: source,
      taskRange: { from: 0, to: source.length }, taskSource: source });
    expect(createProseRequestMarkerSourceProof(scope, "explicit", { from: 0, to: source.length }, source, repaired)).toBeDefined();
    expect(suggestProseRequestMarkerSourceRepair(scope, "explicit", { from: 0, to: source.length }, source)).toBeUndefined();
  });

  it.each([
    ["triple 请", "请请请项目组再次确认。"],
    ["stacked light verbs", "请请项目组再次进行予以确认。"],
    ["customer noun", "请请客。"],
    ["mother reduplication", "妈妈请请客。"],
    ["thanks reduplication", "谢谢请请客。"],
    ["ordinary reduplication", "妈妈常常看看。"]
  ] as const)("does not collapse %s", (_case, document) => {
    const scope = styleScope(document)!;
    expect(suggestProseRequestMarkerSourceRepair(scope, "slot", { from: 0, to: document.length }, document)).toBeUndefined();
  });

  it.each([
    ["quotation", `“${source}”`, source],
    ["inline code", `\`${source}\``, source],
    ["fenced code", `\`\`\`text\n${source}\n\`\`\``, source],
    ["list item", `- ${source}`, `- ${source}`],
    ["front matter", `---\nrequest: ${source}\n---\n正文。`, source]
  ] as const)("abstains inside %s", (_case, document, target) => {
    const from = document.indexOf(target);
    const scope = styleScope(document)!;
    expect(suggestProseRequestMarkerSourceRepair(scope, "slot", { from, to: from + target.length }, target)).toBeUndefined();
  });

  it("does not repair a paragraph cut by the task selection", () => {
    const document = `前文 ${source} 后文`;
    const from = document.indexOf(source);
    const range = { from, to: from + source.length };
    const scope = styleScope(document, routineInstruction, "polish", range);
    expect(scope).toBeDefined();
    expect(suggestProseRequestMarkerSourceRepair(scope!, "selected", range, source)).toBeUndefined();
  });

  it("allows a selection that exactly covers the complete request paragraph", () => {
    const document = `前文。\n\n${source}\n\n尾注。`;
    const from = document.indexOf(source);
    const range = { from, to: from + source.length };
    const scope = styleScope(document, routineInstruction, "polish", range);
    expect(scope).toBeDefined();
    expect(suggestProseRequestMarkerSourceRepair(scope!, "selected-full-paragraph", range, source)?.text).toBe(repaired);
  });

  it("requires exact source range and a runtime-issued scope", () => {
    const scope = styleScope(source)!;
    expect(suggestProseRequestMarkerSourceRepair(scope, "slot", { from: 1, to: source.length }, source)).toBeUndefined();
    expect(suggestProseRequestMarkerSourceRepair(scope, "", { from: 0, to: source.length }, source)).toBeUndefined();
    const forged = {} as ProseRequestMarkerProofScope;
    expect(suggestProseRequestMarkerSourceRepair(forged, "slot", { from: 0, to: source.length }, source)).toBeUndefined();
    expect(createProseRequestMarkerSourceProof(forged, "slot", { from: 0, to: source.length }, source, repaired)).toBeUndefined();
  });
});
