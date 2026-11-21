import { describe, expect, it } from "vitest";
import { validateProseReplacementFacts } from "../../src/core/ai/proseEditFactGuard";
import {
  bindProseRequestMarkerProofs,
  createProseRequestMarkerSourceProof,
  normalizeProseRequestMarkerAnchorSource,
  prepareProseRequestMarkerProofScope,
  type ProseRequestMarkerSourceProof
} from "../../src/core/ai/proseRequestMarkerProof";

const authorized = "润色正文，删去明显重复的请求用词；保留核对事项，不添加事实。";
const sourceSlot = "请请项目组再次确认。";
const candidateSlot = "请项目组再次确认。";

function makeScope(document: string, instruction = authorized, taskRange = { from: 0, to: document.length }) {
  return prepareProseRequestMarkerProofScope({ instruction, document, taskRange, taskSource: document.slice(taskRange.from, taskRange.to) });
}

function makeProof(document: string, instruction = authorized, taskRange = { from: 0, to: document.length },
  sourceText = sourceSlot, candidateText = candidateSlot, slotId = "slot") {
  const scope = makeScope(document, instruction, taskRange);
  const from = document.indexOf(sourceText);
  if (from < 0) return { scope, proof: undefined };
  const proof = createProseRequestMarkerSourceProof(scope, slotId, { from, to: from + sourceText.length }, sourceText, candidateText);
  return { scope, proof };
}

describe("source-bound duplicate request marker proof", () => {
  it("issues only for an explicitly authorized exact one-character request correction", () => {
    const { proof } = makeProof("请请项目组再次确认。", authorized);
    expect(proof).toBeDefined();
    expect(makeProof("请请项目组再次确认。", "润色正文，删去明显重复的请求用词；保留金额和核对事项，不添加事实。").proof).toBeDefined();
    expect(makeProof("请请项目组再次确认。", "删去明显重复的请求用词，保留金额和核对事项，不添加事实。").proof).toBeDefined();
    expect(createProseRequestMarkerSourceProof(makeScope("请请项目组再次确认。", "润色正文。"), "slot",
      { from: 0, to: sourceSlot.length }, sourceSlot, candidateSlot)).toBeUndefined();
    expect(makeProof("请请项目组再次确认。", "不要删去明显重复的请求用词。参考原文。\n").proof).toBeUndefined();
    expect(makeProof("请请项目组再次确认。", "如果有重复，请删去明显重复的请求用词。\n").proof).toBeUndefined();
    expect(makeProof("请请项目组再次确认。", "是否删去明显重复的请求用词？").proof).toBeUndefined();
    expect(makeProof("请请项目组再次确认。", "删去重复的请求用词？").proof).toBeUndefined();
    expect(makeProof("请请项目组再次确认。", "请按原样保留‘删去明显重复的请求用词’这句话。").proof).toBeUndefined();
  });

  it.each([
    ["进行", "", "项目组"], ["进行", "再次", "大家"], ["予以", "", "大家"], ["予以", "再次", "项目组"],
    ["作出", "", "项目组"], ["作出", "再次", "大家"], ["进行", "再次", ""],
    ["进行", "", ""], ["予以", "再次", ""], ["予以", "", ""], ["作出", "再次", ""], ["作出", "", ""]
  ] as const)("preserves a single bounded request light verb %s with modifier %s and recipient %s", (lightVerb, modifier, recipient) => {
    const source = `请请${recipient}${modifier}${lightVerb}确认。`;
    const candidate = source.replace("请请", "请");
    const { proof } = makeProof(source, authorized, undefined, source, candidate);
    expect(proof).toBeDefined();
    expect(() => validateProseReplacementFacts(source, candidate,
      { requestMarkerProofs: [proof!], requestMarkerProofStage: "slot" })).not.toThrow();
  });

  it("rejects a changed remainder, multiple light verbs, or an unrecognized action", () => {
    const source = "请请项目组再次进行确认。";
    const unauthorizedOutputs = [
      "请项目组进行确认。", // dropped the source modifier
      "请财务组再次进行确认。", // changed recipient
      "请项目组再次进行核对。", // changed action
      "请项目组再次进行确认并提交。", // added content
      "请项目组再次进行予以确认。", // stacked light verbs
      "请项目组再次进行归档。" // action outside the known bounded request vocabulary
    ];
    for (const candidate of unauthorizedOutputs) {
      expect(makeProof(source, authorized, undefined, source, candidate).proof).toBeUndefined();
    }
  });

  it("keeps light-verb requests protected in quotes, code, front matter, and partial selections", () => {
    const target = "请请项目组再次进行确认。";
    for (const document of [
      `“${target}”`, `\`${target}\``, `\`\`\`text\n${target}\n\`\`\``, `---\nrequest: ${target}\n---\n正文。`
    ]) {
      const from = document.indexOf(target);
      const scope = makeScope(document);
      expect(createProseRequestMarkerSourceProof(scope, "protected-light-verb",
        { from, to: from + target.length }, target, target.replace("请请", "请"))).toBeUndefined();
    }

    const document = `前文${target}后文`;
    const from = document.indexOf(target);
    const scope = makeScope(document, authorized, { from, to: from + target.length });
    expect(createProseRequestMarkerSourceProof(scope, "partial-light-verb",
      { from, to: from + target.length }, target, target.replace("请请", "请"))).toBeUndefined();
  });

  it("does not reinterpret reduplication or embedded 請-like text as request light verbs", () => {
    for (const [source, candidate] of [
      ["请请客。", "请客。"], ["妈妈请请客。", "妈妈请客。"], ["谢谢请请客。", "谢谢请客。"],
      ["妈妈常常看看。", "妈妈常常看。"], ["谢谢大家。", "谢大家。"]
    ] as const) {
      expect(makeProof(source, authorized, undefined, source, candidate).proof).toBeUndefined();
    }
  });

  it.each([
    ["recipient", "请财务组再次确认。"],
    ["action", "请项目组再次审查。"],
    ["punctuation", "请项目组再次确认！"],
    ["extra text", "请项目组再次确认，并回复。"],
    ["project name", "请请星河项目组再次确认。"],
    ["owner", "请请项目组由周宁负责再次确认。"],
    ["three repeated markers", "请请请项目组再次确认。"]
  ] as const)("does not issue proof if the exact pair has a different %s", (_kind, candidate) => {
    expect(makeProof(sourceSlot, authorized, undefined, sourceSlot, candidate).proof).toBeUndefined();
  });

  it.each([
    "请解释如何删去重复的请求用词。",
    "文中讨论删去重复的请求用词这个方法。",
    "可以删去重复的请求用词吗？",
    "删去重复的请求用词并翻译成英文。",
    "如果有重复，删去明显重复的请求用词。",
    "删去明显重复的请求用词；同时总结全文。"
  ])("does not treat explanatory, conditional, interrogative, or multi-action instruction as authorization: %s", instruction => {
    expect(makeProof(sourceSlot, instruction).proof).toBeUndefined();
  });

  it("permits only an exact duplicate-marker deletion while preserving a named project", () => {
    const source = "请请星河项目组再次确认。";
    const { proof } = makeProof(source, authorized, undefined, source, "请星河项目组再次确认。");
    expect(proof).toBeDefined();
    expect(makeProof(source, authorized, undefined, source, "请银河项目组再次确认。").proof).toBeUndefined();
  });

  it.each([
    ["amount", "金额18万元，请请项目组再次确认。", "金额19万元，请项目组再次确认。"],
    ["date", "周宁负责的2026-11-03排期，请请项目组再次确认。", "周宁负责的2026-11-04排期，请项目组再次确认。"],
    ["owner", "周宁负责的排期日期，请请项目组再次确认。", "林安负责的排期日期，请项目组再次确认。"],
    ["project", "请请星河项目组再次确认。", "请银河项目组再次确认。"],
    ["recipient", "请请项目组再次确认。", "请财务组再次确认。"],
    ["action", "请请项目组再次确认。", "请项目组再次复核。"],
    ["negation", "请请项目组再次确认。", "请项目组不要确认。"]
  ] as const)("does not grant the %s edit as part of a marker proof", (_kind, source, candidate) => {
    expect(makeProof(source, authorized, undefined, source, candidate).proof).toBeUndefined();
  });

  it.each([
    ["Chinese quoted text", "“请请项目组再次确认。”", "请请项目组再次确认。"],
    ["inline code", "`请请项目组再次确认。`", "请请项目组再次确认。"],
    ["fenced code", "```text\n请请项目组再次确认。\n```", "请请项目组再次确认。"],
    ["HTML content", "<span>请请项目组再次确认。</span>", "请请项目组再次确认。"],
    ["math", "$请请项目组再次确认。$", "请请项目组再次确认。"],
    ["front matter", "---\nrequest: 请请项目组再次确认。\n---\n正文。", "请请项目组再次确认。"],
    ["strong emphasis", "**请请项目组再次确认。**", "请请项目组再次确认。"],
    ["link text", "[请请项目组再次确认。](https://example.test)", "请请项目组再次确认。"],
    ["blockquote", "> 请请项目组再次确认。", "请请项目组再次确认。"],
    ["table cell", "| 请求 |\n|---|\n| 请请项目组再次确认。 |", "请请项目组再次确认。"]
  ] as const)("abstains for %s source content", (_kind, document, target) => {
    const start = document.indexOf(target);
    const scope = makeScope(document);
    expect(createProseRequestMarkerSourceProof(scope, "slot", { from: start, to: start + target.length },
      target, target.replace("请请", "请"))).toBeUndefined();
  });

  it("abstains when a selected range cuts the containing paragraph", () => {
    const document = "前文请请项目组再次确认。后文";
    const from = document.indexOf("请请");
    const to = from + sourceSlot.length;
    const scope = makeScope(document, authorized, { from, to });
    expect(createProseRequestMarkerSourceProof(scope, "selected-slot", { from, to }, sourceSlot, candidateSlot)).toBeUndefined();
  });

  it("requires the marker to start at a real full-document clause boundary", () => {
    const document = "上海请请项目组再次确认。";
    const sourceFrom = 2;
    const proof = createProseRequestMarkerSourceProof(makeScope(document), "middle-of-word",
      { from: sourceFrom, to: document.length }, sourceSlot, candidateSlot);
    expect(proof).toBeUndefined();
  });

  it("allows horizontal whitespace only when a real clause boundary precedes it", () => {
    const document = "上海，  请请项目组再次确认。";
    const sourceFrom = document.indexOf(sourceSlot);
    expect(createProseRequestMarkerSourceProof(makeScope(document), "space-after-boundary",
      { from: sourceFrom, to: sourceFrom + sourceSlot.length }, sourceSlot, candidateSlot)).toBeDefined();

    const notBoundary = "上海  请请项目组再次确认。";
    const markerFrom = notBoundary.indexOf(sourceSlot);
    expect(createProseRequestMarkerSourceProof(makeScope(notBoundary), "space-alone",
      { from: markerFrom, to: markerFrom + sourceSlot.length }, sourceSlot, candidateSlot)).toBeUndefined();
  });

  it("recognizes a fullwidth colon as a real request boundary after a plain label", () => {
    const document = "项目一：请请项目组再次确认。\n\n项目二：请请项目组再次确认。";
    const scope = makeScope(document);
    const ranges = [document.indexOf(sourceSlot), document.lastIndexOf(sourceSlot)];
    const proofs = ranges.map((from, index) => createProseRequestMarkerSourceProof(scope, `label-${index}`,
      { from, to: from + sourceSlot.length }, sourceSlot, candidateSlot));
    expect(proofs.every(Boolean)).toBe(true);
  });

  it("copies the task range instead of freezing the caller-owned object", () => {
    const document = sourceSlot;
    const taskRange = { from: 0, to: document.length };
    const scope = prepareProseRequestMarkerProofScope({ instruction: authorized, document, taskRange, taskSource: document });
    expect(scope.taskRange).not.toBe(taskRange);
    expect(Object.isFrozen(taskRange)).toBe(false);
    expect(Object.isFrozen(scope.taskRange)).toBe(true);
  });

  it("recognizes quoted single-quote data but ignores English internal apostrophes", () => {
    const quoted = "'please check\n请请项目组再次确认。'";
    const target = "请请项目组再次确认。";
    const targetFrom = quoted.indexOf(target);
    expect(createProseRequestMarkerSourceProof(makeScope(quoted), "quoted", { from: targetFrom, to: targetFrom + target.length },
      target, target.replace("请请", "请"))).toBeUndefined();

    const prose = `It's a checked note.\n\n${sourceSlot}`;
    const sourceFrom = prose.indexOf(sourceSlot);
    expect(createProseRequestMarkerSourceProof(makeScope(prose), "apostrophe", { from: sourceFrom, to: sourceFrom + sourceSlot.length },
      sourceSlot, candidateSlot)).toBeDefined();
  });

  it("abstains when a long run of document quotes cannot be classified", () => {
    const document = `${"“".repeat(512)}\n\n${sourceSlot}`;
    const sourceFrom = document.indexOf(sourceSlot);
    expect(createProseRequestMarkerSourceProof(makeScope(document), "quote-budget",
      { from: sourceFrom, to: sourceFrom + sourceSlot.length }, sourceSlot, candidateSlot)).toBeUndefined();
  });

  it("abstains quickly on a long backslash run within the document byte budget", () => {
    const document = `${"\\".repeat(12_000)}\n\n${sourceSlot}`;
    const sourceFrom = document.indexOf(sourceSlot);
    const started = performance.now();
    const proof = createProseRequestMarkerSourceProof(makeScope(document), "slash-budget",
      { from: sourceFrom, to: sourceFrom + sourceSlot.length }, sourceSlot, candidateSlot);
    expect(proof).toBeUndefined();
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it("binds UTF-16/CRLF source positions to the actual candidate after a preceding length change", () => {
    const document = "封面✨。\r\n\r\n前置说明，\r\n\r\n请请项目组再次确认。\r\n\r\n尾注。";
    const taskFrom = document.indexOf("前置说明");
    const taskTo = document.indexOf("\r\n\r\n尾注");
    const taskRange = { from: taskFrom, to: taskTo };
    const taskSource = document.slice(taskFrom, taskTo);
    const scope = makeScope(document, authorized, taskRange);
    const sourceFrom = document.indexOf(sourceSlot);
    const sourceRange = { from: sourceFrom, to: sourceFrom + sourceSlot.length };
    const proof = createProseRequestMarkerSourceProof(scope, "request-slot", sourceRange, sourceSlot, candidateSlot)!;
    expect(proof).toBeDefined();

    const candidateTask = taskSource.replace("前置说明，", "前置说明") .replace(sourceSlot, candidateSlot);
    const candidate = document.slice(0, taskFrom) + candidateTask + document.slice(taskTo);
    const candidateFrom = taskFrom + candidateTask.indexOf(candidateSlot);
    const candidateRange = { from: candidateFrom, to: candidateFrom + candidateSlot.length };
    expect(candidateRange.from).toBe(sourceRange.from - 1);
    const bound = bindProseRequestMarkerProofs([proof], {
      fullSource: document, fullCandidate: candidate,
      sourceSlotRanges: new Map([["request-slot", sourceRange]]),
      candidateSlotRanges: new Map([["request-slot", candidateRange]]),
      candidateTaskRange: { from: taskFrom, to: taskFrom + candidateTask.length }
    });
    expect(bound).toHaveLength(1);
    expect(normalizeProseRequestMarkerAnchorSource(document, candidate, bound, "full-document"))
      .toBe(document.replace("请请项目组再次确认。", candidateSlot));
    validateProseReplacementFacts(document, candidate, { requestMarkerProofs: bound, requestMarkerProofStage: "full-document" });
  });

  it("supports multiple independent proofs in one task and shifts each candidate range", () => {
    const document = "请请项目组再次确认。\n\n请请项目组再次确认。";
    const scope = makeScope(document);
    const firstFrom = 0;
    const secondFrom = document.lastIndexOf(sourceSlot);
    const first = createProseRequestMarkerSourceProof(scope, "first", { from: firstFrom, to: firstFrom + sourceSlot.length }, sourceSlot, candidateSlot)!;
    const second = createProseRequestMarkerSourceProof(scope, "second", { from: secondFrom, to: secondFrom + sourceSlot.length }, sourceSlot, candidateSlot)!;
    const candidate = "请项目组再次确认。\n\n请项目组再次确认。";
    const firstCandidateFrom = 0;
    const secondCandidateFrom = candidate.lastIndexOf(candidateSlot);
    const bound = bindProseRequestMarkerProofs([first, second], {
      fullSource: document, fullCandidate: candidate,
      sourceSlotRanges: new Map([["first", { from: firstFrom, to: firstFrom + sourceSlot.length }],
        ["second", { from: secondFrom, to: secondFrom + sourceSlot.length }]]),
      candidateSlotRanges: new Map([["first", { from: firstCandidateFrom, to: firstCandidateFrom + candidateSlot.length }],
        ["second", { from: secondCandidateFrom, to: secondCandidateFrom + candidateSlot.length }]]),
      candidateTaskRange: { from: 0, to: candidate.length }
    });
    expect(bound).toHaveLength(2);
    expect(normalizeProseRequestMarkerAnchorSource(document, candidate, bound, "full-document")).toBe(candidate);
  });

  it("does not normalize with a stale, misbound, or forged proof", () => {
    const { scope, proof } = makeProof(sourceSlot);
    expect(proof).toBeDefined();
    const bound = bindProseRequestMarkerProofs([proof!], {
      fullSource: `prefix ${sourceSlot}`, fullCandidate: `prefix ${candidateSlot}`,
      sourceSlotRanges: new Map([["slot", { from: 0, to: sourceSlot.length }]]),
      candidateSlotRanges: new Map([["slot", { from: 7, to: 7 + candidateSlot.length }]]),
      candidateTaskRange: { from: 0, to: 7 + candidateSlot.length }
    });
    expect(bound).toBeUndefined();
    expect(normalizeProseRequestMarkerAnchorSource(sourceSlot, candidateSlot, [proof!], "full-document")).toBeUndefined();
    const forged = {} as ProseRequestMarkerSourceProof;
    expect(normalizeProseRequestMarkerAnchorSource(sourceSlot, candidateSlot, [forged], "slot")).toBeUndefined();
    expect(() => validateProseReplacementFacts(sourceSlot, candidateSlot, { requestMarkerProofs: [forged], requestMarkerProofStage: "slot" }))
      .toThrow(/显式名称/);
    expect(scope).toBeDefined();
  });
});
