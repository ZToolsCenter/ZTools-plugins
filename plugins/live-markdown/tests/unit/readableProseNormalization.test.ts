import { expect, it, vi } from "vitest";
import type { EnglishAgreementAnalysis } from "../../src/core/ai/englishAgreementTypes";
import type { ReadableProseView } from "../../src/core/ai/readableProseView";
import {
  normalizeReadableProseText,
  prepareReadableProseRequest,
  requiresStrictProofreadReference,
  type ReadableProseAgreementAnalyzer
} from "../../src/core/ai/readableProseNormalization";

const instruction = "Correct grammar only. Do not paraphrase or polish; preserve correct content unchanged.";
const text = "The release notes needs 2026 review ProtectedCode1.";
const placeholders = ["ProtectedCode1"];
const input = { instruction, systemPrompt: "Keep the user's scope." };

function view(source = text, readonlyPlaceholders: readonly string[] = placeholders): ReadableProseView {
  return { text: source, readonlyPlaceholders, normalizeReadonlySurface: raw => raw, decode: raw => new Map([["slot", raw]]) };
}

function suggestion(source: string, replacement = "need"): EnglishAgreementAnalysis {
  const from = source.indexOf("needs");
  const outputText = `${source.slice(0, from)}${replacement}${source.slice(from + 5)}`;
  return {
    scope: "simple-present-subject-verb-agreement", disposition: "suggestions", reason: "test suggestion",
    outputText,
    edits: [{ from, to: from + 5, source: "needs", replacement, subject: "notes", lemma: "need" }]
  };
}

function analyzerFor(result: EnglishAgreementAnalysis): ReadableProseAgreementAnalyzer {
  return vi.fn(async () => result);
}

it("uses only exact, non-overlapping source-mapped suggestions and preserves prompt directives", async () => {
  const analyzer = analyzerFor(suggestion(text));
  const skill = { id: "proofread", category: "writing" as const, systemPrompt: "Retain the proofread voice.", userPromptTemplate: "Proofread only this: {{content}}" };
  const originalView = view();
  const decode = vi.spyOn(originalView, "decode");

  const prepared = await prepareReadableProseRequest({ ...input, skill }, originalView, undefined, analyzer);

  expect(prepared.view.text).toBe("The release notes need 2026 review ProtectedCode1.");
  expect(prepared.prompts.prompt).toContain(instruction);
  expect(prepared.prompts.prompt).toContain("Proofread only this: The release notes need 2026 review ProtectedCode1.");
  expect(prepared.prompts.systemPrompt).toContain(input.systemPrompt);
  expect(prepared.prompts.systemPrompt).toContain(skill.systemPrompt);
  expect(originalView.text).toBe(text);
  expect(decode).not.toHaveBeenCalled();
  expect(analyzer).toHaveBeenCalledWith({ text, readonlyPlaceholders: placeholders }, expect.objectContaining({ timeoutMs: 1500 }));
});

it.each([
  ["misaligned source range", (source: string) => ({ ...suggestion(source), edits: [{ ...suggestion(source).edits[0]!, from: 0 }] })],
  ["number change", (source: string) => ({ ...suggestion(source), outputText: suggestion(source).outputText.replace("2026", "2027") })],
  ["opaque atom change", (source: string) => ({ ...suggestion(source), outputText: suggestion(source).outputText.replace("ProtectedCode1", "ProtectedCode2") })],
  ["overlapping edits", (source: string) => ({ ...suggestion(source), edits: [
    suggestion(source).edits[0]!, { ...suggestion(source).edits[0]!, from: suggestion(source).edits[0]!.from + 1 }
  ] })]
])("rejects %s and keeps the original request text", async (_label, makeAnalysis) => {
  const analyzer = analyzerFor(makeAnalysis(text));

  const normalized = await normalizeReadableProseText(text, placeholders, undefined, analyzer);

  expect(normalized).toBe(text);
});

it("keeps the normal model request for no-op, Han, and optional analyzer failure", async () => {
  const noOp: EnglishAgreementAnalysis = {
    scope: "simple-present-subject-verb-agreement", disposition: "no-supported-edit", reason: "no SVA issue",
    outputText: text, edits: []
  };
  const noOpAnalyzer = analyzerFor(noOp);
  expect((await prepareReadableProseRequest(input, view(), undefined, noOpAnalyzer)).view.text).toBe(text);

  const hanAnalyzer = vi.fn(async () => suggestion(text));
  const han = "这段中文内容不调用英文分析。";
  expect((await prepareReadableProseRequest(input, view(han, []), undefined, hanAnalyzer)).view.text).toBe(han);
  expect(hanAnalyzer).not.toHaveBeenCalled();

  const unicodeSpaceAnalyzer = vi.fn(async () => suggestion(text));
  const unicodeSpace = "The\u00a0release notes needs review.";
  expect(await normalizeReadableProseText(unicodeSpace, [], undefined, unicodeSpaceAnalyzer)).toBe(unicodeSpace);
  expect(unicodeSpaceAnalyzer).not.toHaveBeenCalled();

  const failing = vi.fn(async () => { throw new Error("optional worker failure"); });
  expect(await normalizeReadableProseText(text, placeholders, undefined, failing)).toBe(text);
});

it("recognizes strict no-rewrite directives only when correct content must stay unchanged", () => {
  expect(requiresStrictProofreadReference(input)).toBe(true);
  expect(requiresStrictProofreadReference({ instruction: "润色正文使其简洁，不改变原意。", systemPrompt: "" })).toBe(false);
  expect(requiresStrictProofreadReference({ instruction: "校对语法并保留原意。", systemPrompt: "" })).toBe(false);
  expect(requiresStrictProofreadReference({
    instruction: "Proofread this.", systemPrompt: "Do not rephrase or polish. Leave correct sentences unchanged."
  })).toBe(true);
  expect(requiresStrictProofreadReference({
    instruction: "Proofread this.", systemPrompt: "", skill: {
      id: "proofread", category: "writing", systemPrompt: "Do not rephrase. Preserve correct content unchanged.",
      userPromptTemplate: "Proofread this content: {{content}}"
    }
  })).toBe(true);
  expect(requiresStrictProofreadReference({
    instruction: "只纠正语法，不润色；正确内容不改动。", systemPrompt: ""
  })).toBe(true);
  expect(requiresStrictProofreadReference({
    instruction: "润色正文，已经正确的句子必须保持原样，不作同义词替换。", systemPrompt: ""
  })).toBe(true);
  expect(requiresStrictProofreadReference({
    instruction: "润色正文，正确的句子必须保持原样。", systemPrompt: ""
  })).toBe(true);
  expect(requiresStrictProofreadReference({
    instruction: "只做语法校对，不作同义词替换。", systemPrompt: ""
  })).toBe(true);
  expect(requiresStrictProofreadReference({
    instruction: "润色正文，示例‘不要改写，正确句子保持原样’只是示例。", systemPrompt: ""
  })).toBe(false);
  expect(requiresStrictProofreadReference({
    instruction: "不必保持正确句原样，允许改写。", systemPrompt: ""
  })).toBe(false);
  expect(requiresStrictProofreadReference({
    instruction: "不要保持正确句原样，允许改写。", systemPrompt: ""
  })).toBe(false);
  expect(requiresStrictProofreadReference({
    instruction: "正确句不必保持原样，允许改写。", systemPrompt: ""
  })).toBe(false);
  expect(requiresStrictProofreadReference({ instruction: "Academic polish.", systemPrompt: "" })).toBe(false);
});

it("does not swallow task cancellation from the optional analyzer", async () => {
  const controller = new AbortController();
  const analyzer = vi.fn(async (_request: { text: string }, options?: { signal?: AbortSignal }) => {
    await new Promise<void>((resolve) => options?.signal?.addEventListener("abort", () => resolve(), { once: true }));
    throw new Error("analysis cancelled");
  });
  const pending = normalizeReadableProseText(text, placeholders, controller.signal, analyzer);
  controller.abort();

  await expect(pending).rejects.toThrow("analysis cancelled");
});
