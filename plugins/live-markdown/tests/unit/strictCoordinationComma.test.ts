import { expect, it, vi } from "vitest";
import { analyzeEnglishAgreementWithWink } from "../../src/core/ai/englishAgreementWink";
import { buildAiTaskRequest } from "../../src/core/ai/aiTaskRequest";
import {
  isStrictCoordinationCommaEligible,
  restoreStrictCoordinationComma
} from "../../src/core/ai/strictCoordinationComma";
import { EnglishAgreementTimeoutError } from "../../src/core/ai/englishAgreementService";
import type { EnglishAgreementAnalysis, EnglishAgreementInput } from "../../src/core/ai/englishAgreementTypes";
import type { ReadableProseTaskInput } from "../../src/core/ai/readableProseTask";

const strictChinese: ReadableProseTaskInput = {
  instruction: "严格校对，只修正错字和标点；正确内容必须保持原样；保留事实和格式。",
  systemPrompt: ""
};

const strictEnglish: ReadableProseTaskInput = {
  instruction: "Strictly proofread. Keep correct content unchanged. Preserve facts and formatting.",
  systemPrompt: ""
};

function agreementService() {
  return {
    analyze: vi.fn(async (input: EnglishAgreementInput) => analyzeEnglishAgreementWithWink(input))
  };
}

it("recognizes only complete strict-proofreading and preservation clauses", () => {
  expect(isStrictCoordinationCommaEligible(strictChinese)).toBe(true);
  expect(isStrictCoordinationCommaEligible(strictEnglish)).toBe(true);
  expect(isStrictCoordinationCommaEligible({
    instruction: "Strictly proofread; do not rewrite correct content; retain the original facts; keep the original formatting.",
    systemPrompt: ""
  })).toBe(true);
  expect(isStrictCoordinationCommaEligible({
    instruction: "校对语法，只修正明确错误。正确句子不改写。仅保留事实、数字、单位和原格式。",
    systemPrompt: ""
  })).toBe(true);
  expect(isStrictCoordinationCommaEligible({
    instruction: "请校对以下 Markdown 正文中的错别字、标点和中英文间距；正确内容保持原样。",
    systemPrompt: "严格校对，只修正错字、标点和间距，禁止润色、改写或扩充正确内容。保持原意与 Markdown 结构。"
  })).toBe(true);
  expect(isStrictCoordinationCommaEligible({ instruction: "严格校对。保留事实和格式。", systemPrompt: "" })).toBe(false);
});

it("recognizes the real refinement instruction with its production-built general role context", () => {
  const instruction = "校对正文，纠正明确的语法错误；保留原意、数字、单位、链接目标、代码及 Markdown 格式。正确的句子保持原样。";
  const request = buildAiTaskRequest({ source: "The release has 3 stages, and each stage needs approval.", selected: false,
    action: "proofread", userPrompt: instruction,
    config: { provider: "local", activeRoleId: "general", executionPolicy: "thin", model: "Qwen3-0.6B-Q4_K_M.gguf" } });

  expect(request.userPrompt).toBe(instruction);
  expect(request.baseSystemPrompt).toBe("你是一位高效的 Markdown 创作与排版助手。输出符合 GFM 规范的高质量文本，逻辑清晰，行文优美。");
  expect(isStrictCoordinationCommaEligible({ instruction: request.userPrompt!, systemPrompt: request.baseSystemPrompt,
    skill: request.skill })).toBe(true);
});

it("allows source-neutral polish only when correct content is explicitly preserved", async () => {
  const chinesePolish: ReadableProseTaskInput = {
    instruction: "润色正文。已经正确的句子必须保持原样，不作同义词替换。",
    systemPrompt: ""
  };
  const englishPolish: ReadableProseTaskInput = {
    instruction: "Polish the text. Keep correct content unchanged.",
    systemPrompt: ""
  };
  const source = "The release has 3 stages, and each stage needs approval.";
  const candidate = "The release has 3 stages and each stage needs approval.";

  expect(isStrictCoordinationCommaEligible(chinesePolish)).toBe(true);
  expect(isStrictCoordinationCommaEligible(englishPolish)).toBe(true);
  await expect(restoreStrictCoordinationComma({ task: chinesePolish, source, candidate,
    analyzer: agreementService() })).resolves.toBe(source);
  await expect(restoreStrictCoordinationComma({ task: englishPolish, source, candidate,
    analyzer: agreementService() })).resolves.toBe(source);

  expect(isStrictCoordinationCommaEligible({ instruction: "润色正文。", systemPrompt: "" })).toBe(false);
  expect(isStrictCoordinationCommaEligible({ instruction: "Polish the text.", systemPrompt: "" })).toBe(false);
  expect(isStrictCoordinationCommaEligible({
    instruction: "润色正文。正确内容保持原样。允许调整标点。", systemPrompt: ""
  })).toBe(false);
  const punctuationCorrection = "校对正文。正确内容保持原样。纠正明确的标点错误。";
  expect(isStrictCoordinationCommaEligible({ instruction: punctuationCorrection, systemPrompt: "" })).toBe(true);
  expect(isStrictCoordinationCommaEligible({
    instruction: `${punctuationCorrection}删除逗号。`, systemPrompt: ""
  })).toBe(false);
});

it("restores one omitted coordination comma only after both clauses have no supported agreement edits", async () => {
  const service = agreementService();
  const source = "The release has 3 stages, and each stage needs approval.";
  const candidate = "The release has 3 stages and each stage needs approval.";

  await expect(restoreStrictCoordinationComma({ task: strictChinese, source, candidate, analyzer: service }))
    .resolves.toBe(source);
  expect(service.analyze).toHaveBeenCalledTimes(2);
  expect(service.analyze).toHaveBeenNthCalledWith(1, { text: "The release has 3 stages" }, expect.anything());
  expect(service.analyze).toHaveBeenNthCalledWith(2, { text: "each stage needs approval." }, expect.anything());
});

it("can restore a correct but-clause while leaving unsupported coordinators untouched", async () => {
  const source = "The release has 3 stages, but each stage needs approval.";
  const candidate = "The release has 3 stages but each stage needs approval.";
  await expect(restoreStrictCoordinationComma({
    task: strictEnglish, source, candidate, analyzer: agreementService()
  })).resolves.toBe(source);

  for (const conjunction of ["or", "so", "yet"]) {
    const text = `The release has 3 stages ${conjunction} each stage needs approval.`;
    await expect(restoreStrictCoordinationComma({
      task: strictEnglish, source: text.replace(` ${conjunction} `, `, ${conjunction} `), candidate: text,
      analyzer: agreementService()
    })).resolves.toBe(text);
  }
});

it("preserves numeric and unit text byte-for-byte while restoring only the comma", async () => {
  const source = "The launch has 3 phases, and each phase needs 2 weeks.";
  const candidate = "The launch has 3 phases and each phase needs 2 weeks.";
  const service = agreementService();
  await expect(restoreStrictCoordinationComma({ task: strictEnglish, source, candidate, analyzer: service }))
    .resolves.toBe(source);
  expect(service.analyze).toHaveBeenNthCalledWith(1, { text: "The launch has 3 phases" }, expect.anything());
  expect(service.analyze).toHaveBeenNthCalledWith(2, { text: "each phase needs 2 weeks." }, expect.anything());
});

it.each([
  ["The release has 3 stages, and each stage needs approval.", "The release has 3 stages, and each stage need approval."],
  ["The release have 3 stages, and each stage needs approval.", "The release have 3 stages and each stage needs approval."],
  ["The release has 3 stages, and each stage needs approval.", "The release has 3 stages, and each stage needs approval, too."],
  ["The release has 3 stages, 2 teams, and each stage needs approval.", "The release has 3 stages, 2 teams and each stage needs approval."],
  ["The release has 3 stages, and each stage needs approval and records status.", "The release has 3 stages and each stage needs approval and records status."],
  ["The release has 3 stages, and each stage needs approval.", "The release has 4 stages and each stage needs approval."],
  ["The release has 3 stages, and each stage needs approval.", "The release has 3 stages, and each stage needs approval"],
  ["The `release` has 3 stages, and each stage needs approval.", "The `release` has 3 stages and each stage needs approval."],
  ["The \"release\" has 3 stages, and each stage needs approval.", "The \"release\" has 3 stages and each stage needs approval."]
])("leaves source/candidate pairs outside the one-comma simple-clause boundary unchanged", async (source, candidate) => {
  await expect(restoreStrictCoordinationComma({
    task: strictEnglish, source, candidate, analyzer: agreementService()
  })).resolves.toBe(candidate);
});

it.each([
  { ...strictEnglish, instruction: "Strictly proofread. Keep correct content unchanged. Preserve facts and formatting. Also rewrite the final paragraph." },
  { ...strictEnglish, instruction: "Strictly proofread. Keep correct content unchanged. Preserve facts and formatting. Remove commas." },
  { ...strictEnglish, instruction: "Strictly proofread. Keep correct content unchanged. Preserve facts and formatting. Rewrite only the punctuation." },
  { ...strictEnglish, instruction: "Do not strictly proofread. Keep correct content unchanged. Preserve facts and formatting." },
  { ...strictEnglish, instruction: "If content is correct, keep it unchanged. Strictly proofread. Preserve facts and formatting." },
  { ...strictEnglish, instruction: "Should correct content remain unchanged? Strictly proofread. Preserve facts and formatting." },
  { ...strictEnglish, instruction: "Strictly proofread. ‘Keep correct content unchanged.’ Preserve facts and formatting." },
  { ...strictEnglish, instruction: "Strictly proofread. Keep correct content unchanged. Preserve facts and formatting.", skill: { id: "rewrite", name: "rewrite", description: "Rewrite", icon: "edit", category: "writing" as const, userPromptTemplate: "Rewrite for style: {{content}}", systemPrompt: "Rewrite freely." } },
  { ...strictEnglish, instruction: `${"Strictly proofread. Keep correct content unchanged. Preserve facts and formatting. ".repeat(40)}` }
])("does not authorize comma restoration for ambiguous or expanded task instructions", task => {
  expect(isStrictCoordinationCommaEligible(task)).toBe(false);
});

it("leaves the candidate unchanged if agreement analysis is unsupported, edits, aborts, or fails", async () => {
  const source = "The release has 3 stages, and each stage needs approval.";
  const candidate = "The release has 3 stages and each stage needs approval.";
  const abstained = { analyze: vi.fn(async ({ text }: EnglishAgreementInput) => ({
    scope: "simple-present-subject-verb-agreement" as const, disposition: "abstained" as const,
    reason: "unsupported", outputText: text, edits: []
  })) };
  await expect(restoreStrictCoordinationComma({ task: strictEnglish, source, candidate, analyzer: abstained }))
    .resolves.toBe(candidate);

  const edited = { analyze: vi.fn(async ({ text }: EnglishAgreementInput) => ({
    scope: "simple-present-subject-verb-agreement" as const, disposition: "suggestions" as const,
    reason: "agreement edit required", outputText: text.replace("has", "have"), edits: [{ from: 12, to: 15,
      source: "has", replacement: "have", subject: "release", lemma: "have" }]
  })) };
  await expect(restoreStrictCoordinationComma({ task: strictEnglish, source, candidate, analyzer: edited }))
    .resolves.toBe(candidate);

  const failed = { analyze: vi.fn(async () => { throw new EnglishAgreementTimeoutError(); }) };
  await expect(restoreStrictCoordinationComma({ task: strictEnglish, source, candidate, analyzer: failed }))
    .resolves.toBe(candidate);

  const tampered = { analyze: vi.fn(async ({ text }: EnglishAgreementInput) => ({
    scope: "simple-present-subject-verb-agreement" as const, disposition: "no-supported-edit" as const,
    reason: "no edits", outputText: `${text}!`, edits: []
  })) };
  await expect(restoreStrictCoordinationComma({ task: strictEnglish, source, candidate, analyzer: tampered }))
    .resolves.toBe(candidate);

  const wrongScope = { analyze: vi.fn(async ({ text }: EnglishAgreementInput) => ({
    scope: "whole-document-correctness" as never, disposition: "no-supported-edit" as const,
    reason: "tampered scope", outputText: text, edits: []
  })) };
  await expect(restoreStrictCoordinationComma({ task: strictEnglish, source, candidate, analyzer: wrongScope }))
    .resolves.toBe(candidate);

  const nonArrayEdits = { analyze: vi.fn(async ({ text }: EnglishAgreementInput) => ({
    scope: "simple-present-subject-verb-agreement" as const, disposition: "no-supported-edit" as const,
    reason: "malformed edits", outputText: text, edits: { length: 0 }
  } as unknown as EnglishAgreementAnalysis)) };
  await expect(restoreStrictCoordinationComma({ task: strictEnglish, source, candidate, analyzer: nonArrayEdits }))
    .resolves.toBe(candidate);

  const controller = new AbortController();
  controller.abort();
  const cancelled = agreementService();
  await expect(restoreStrictCoordinationComma({ task: strictEnglish, source, candidate,
    analyzer: cancelled, signal: controller.signal })).resolves.toBe(candidate);
  expect(cancelled.analyze).not.toHaveBeenCalled();

  const inFlight = new AbortController();
  const cancelledAfterFirstClause = { analyze: vi.fn(async ({ text }: EnglishAgreementInput) => {
    inFlight.abort();
    return { scope: "simple-present-subject-verb-agreement" as const, disposition: "no-supported-edit" as const,
      reason: "unchanged", outputText: text, edits: [] };
  }) };
  await expect(restoreStrictCoordinationComma({ task: strictEnglish, source, candidate,
    analyzer: cancelledAfterFirstClause, signal: inFlight.signal })).resolves.toBe(candidate);
  expect(cancelledAfterFirstClause.analyze).toHaveBeenCalledTimes(1);
});

it("does not analyze overlong content or an invalid task context", async () => {
  const service = agreementService();
  const base = "The release has 3 stages, and each stage needs approval.";
  const long = `${base} ${"word ".repeat(70)}`;
  await expect(restoreStrictCoordinationComma({ task: strictEnglish, source: long,
    candidate: long.replace(",", ""), analyzer: service })).resolves.toBe(long.replace(",", ""));
  await expect(restoreStrictCoordinationComma({ task: strictEnglish, source: base,
    candidate: base.replace(",", ""), analyzer: service, timeoutMs: 0 })).resolves.toBe(base.replace(",", ""));
  expect(service.analyze).not.toHaveBeenCalled();
});
