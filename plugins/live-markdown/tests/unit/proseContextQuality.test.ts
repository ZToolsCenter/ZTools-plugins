import { describe, expect, it, vi } from "vitest";
import type { AiTaskRequest } from "../../src/core/ai/aiTaskRunner";
import { createAiTaskExecution } from "../../src/core/ai/aiTaskExecution";
import { attachSourceOwnedProposal } from "../../src/core/ai/sourceOwnedProposal";
import { buildThinProseSlots } from "../../src/core/ai/thinProseSlots";
import { runThinProseTask } from "../../src/core/ai/thinProseTask";

interface ProsePayload {
  slots: Array<{ id: string; text: string; contextBefore?: string; contextAfter?: string }>;
  paragraphContexts: Array<{ ownedSlotIds: string[]; text: string }>;
}

function extractSlots(prompt: string): ProsePayload {
  const marker = "正文文本槽：";
  const index = prompt.lastIndexOf(marker);
  if (index < 0) throw new Error("expected serialized prose slot payload");
  return JSON.parse(prompt.slice(index + marker.length)) as ProsePayload;
}

describe("thin prose language context and no-change disposition", () => {
  it("gives a grammar-error slot its whole readable sentence across protected Markdown atoms", async () => {
    const source = "The **release note** need a check. Keep `v2.1` exact; the [docs](https://internal.invalid/r3) and formula $x^2$ remain. 🧪";
    const instruction = "只润色可读正文，保留强调格式、`v2.1`、链接目标、公式和 🧪 原样；不要改写结构。";
    const slots = buildThinProseSlots(source, instruction);
    const target = slots.find(({ sourceText }) => sourceText === "need a check.");
    expect(target).toBeDefined();

    const invoke = vi.fn(async (prompt: string, systemPrompt: string) => {
      const payload = extractSlots(prompt);
      const context = payload.paragraphContexts.find(({ ownedSlotIds }) => ownedSlotIds.includes(target!.id));
      expect(context?.text).toContain("The release note need a check.");
      expect(context?.ownedSlotIds).toContain(target!.id);
      expect(context?.text).not.toContain("[[");
      expect(context?.text).not.toContain("internal.invalid");
      expect(context?.text).not.toContain("v2.1");
      expect(context?.text).not.toContain("x^2");
      expect(Array.from(context?.text ?? "").length).toBeLessThanOrEqual(512);
      expect(systemPrompt).toContain("语法、拼写和标点错误");
      return JSON.stringify({ edits: payload.slots.map(({ id, text }) => ({ id, text: id === target!.id ? "needs a check." : text })) });
    });
    const execution = createAiTaskExecution({ invoke, isCurrent: () => true, abortCurrent: vi.fn() });

    const result = await runThinProseTask({ source, instruction, systemPrompt: "只处理自然语言正文。" }, execution,
      { invoke, isCurrent: () => true, abortCurrent: vi.fn() });

    expect(result.text).toBe(source.replace("need a check.", "needs a check."));
    expect(result.text).toContain("**release note**");
    expect(result.text).toContain("`v2.1`");
    expect(result.text).toContain("[docs](https://internal.invalid/r3)");
    expect(result.text).toContain("$x^2$");
    expect(result.text.endsWith("🧪")).toBe(true);
  });

  it("does not offer a proposal when every model edit is unchanged", async () => {
    const source = "The release notes needs a review.";
    const slots = buildThinProseSlots(source, "润色语法");
    const invoke = vi.fn(async () => JSON.stringify({ edits: slots.map(({ id, sourceText }) => ({ id, text: sourceText })) }));
    const execution = createAiTaskExecution({ invoke, isCurrent: () => true, abortCurrent: vi.fn() });
    const prose = await runThinProseTask({ source, instruction: "润色语法", systemPrompt: "" }, execution,
      { invoke, isCurrent: () => true, abortCurrent: vi.fn() });
    const request: AiTaskRequest = {
      source, action: "polish", baseSystemPrompt: "",
      actionDefinition: { id: "polish", label: "润色", prompt: "润色语法" }
    };
    const result = attachSourceOwnedProposal(request,
      { documentId: "proofread.md", revision: 1, content: source, selection: null, cursor: null, readOnly: false },
      { text: prose.text, semanticAction: "polish", editAction: true, nonReplacementSkill: false, protection: undefined,
        conservative: false, warnings: prose.warnings, sourceOwned: true });

    expect(result.proposal).toBeUndefined();
    expect(result.preservedSource).toBe(true);
    expect(result.warnings.join(" ")).toContain("没有改变原文");
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("allows a correct sentence to remain unchanged without forcing an edit", async () => {
    const source = "The release notes need a review.";
    const slots = buildThinProseSlots(source, "检查语法并润色");
    const invoke = vi.fn(async (_prompt: string, systemPrompt: string) => {
      expect(systemPrompt).toContain("只有原文确实准确自然时才原样回传 text");
      return JSON.stringify({ edits: slots.map(({ id, sourceText }) => ({ id, text: sourceText })) });
    });
    const execution = createAiTaskExecution({ invoke, isCurrent: () => true, abortCurrent: vi.fn() });
    const prose = await runThinProseTask({ source, instruction: "检查语法并润色", systemPrompt: "" }, execution,
      { invoke, isCurrent: () => true, abortCurrent: vi.fn() });
    const request: AiTaskRequest = {
      source, action: "polish", baseSystemPrompt: "",
      actionDefinition: { id: "polish", label: "润色", prompt: "检查语法并润色" }
    };
    const result = attachSourceOwnedProposal(request,
      { documentId: "correct-prose.md", revision: 1, content: source, selection: null, cursor: null, readOnly: false },
      { text: prose.text, semanticAction: "polish", editAction: true, nonReplacementSkill: false, protection: undefined,
        conservative: false, warnings: prose.warnings, sourceOwned: true });

    expect(prose.text).toBe(source);
    expect(result.proposal).toBeUndefined();
    expect(result.preservedSource).toBe(true);
    expect(result.warnings.join(" ")).toContain("没有改变原文");
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("recognizes finite first/last marker aliases only with preserve and marker language", () => {
    const source = "OPEN-EDGE\n\nThe release notes need a review.\n\nCLOSE-EDGE";
    for (const position of ["首尾", "边缘", "outer", "boundary"]) {
      const slots = buildThinProseSlots(source, `保留 ${position} marker 原样`);
      expect(slots.map(({ sourceText }) => sourceText)).not.toContain("OPEN-EDGE");
      expect(slots.map(({ sourceText }) => sourceText)).not.toContain("CLOSE-EDGE");
    }

    const slotsWithoutPosition = buildThinProseSlots(source, "保留 marker 原样");
    expect(slotsWithoutPosition.map(({ sourceText }) => sourceText)).toContain("OPEN-EDGE");
    expect(slotsWithoutPosition.map(({ sourceText }) => sourceText)).toContain("CLOSE-EDGE");
  });

  it("rejects an exact long sentence copied from farther read-only paragraph context", async () => {
    const copiedSentence = "The distant paragraph describes translucent amber patterns flowing gently across a quiet mountain lake during early spring mornings.";
    const source = `Please revise this short sentence. A nearby transition adds enough wording to move the next note beyond line-local context. ${copiedSentence}`;
    const slots = buildThinProseSlots(source, "润色正文");
    const target = slots.find(({ sourceText }) => sourceText === "Please revise this short sentence.");
    expect(target).toBeDefined();
    expect(target!.contextAfter).not.toContain(copiedSentence);
    const invoke = vi.fn(async (prompt: string) => {
      const payload = extractSlots(prompt);
      const targetContext = payload.paragraphContexts.find(({ ownedSlotIds }) => ownedSlotIds.includes(target!.id));
      expect(targetContext?.text).toContain(copiedSentence);
      return JSON.stringify({ edits: payload.slots.map(({ id, text }) => ({
        id, text: id === target!.id ? `${text} ${copiedSentence}` : text
      })) });
    });
    const execution = createAiTaskExecution({ invoke, isCurrent: () => true, abortCurrent: vi.fn() });

    await expect(runThinProseTask({ source, instruction: "润色正文", systemPrompt: "" }, execution,
      { invoke, isCurrent: () => true, abortCurrent: vi.fn() }))
      .rejects.toThrow("正文润色复制了只读相邻内容");
  });

  it("does not reject a short common word from read-only context", async () => {
    const source = "Please revise this short sentence. The nearby note mentions review.";
    const slots = buildThinProseSlots(source, "润色正文");
    const target = slots.find(({ sourceText }) => sourceText === "Please revise this short sentence.");
    expect(target).toBeDefined();
    const invoke = vi.fn(async (prompt: string) => {
      const payload = extractSlots(prompt);
      return JSON.stringify({ edits: payload.slots.map(({ id, text }) => ({
        id, text: id === target!.id ? `${text} review` : text
      })) });
    });
    const execution = createAiTaskExecution({ invoke, isCurrent: () => true, abortCurrent: vi.fn() });

    const result = await runThinProseTask({ source, instruction: "润色正文", systemPrompt: "" }, execution,
      { invoke, isCurrent: () => true, abortCurrent: vi.fn() });

    expect(result.text).toContain("Please revise this short sentence. review");
  });

  it("allows a long phrase already owned by the source slot", async () => {
    const phrase = "silver lanterns reflecting slowly across the quiet valley";
    const source = `The draft need ${phrase}. The note repeats *${phrase}*.`;
    const slots = buildThinProseSlots(source, "润色正文");
    const target = slots.find(({ sourceText }) => sourceText.startsWith("The draft need"));
    expect(target).toBeDefined();
    expect(target!.sourceText).toContain(phrase);
    const replacement = `The draft clearly needs the phrase ${phrase} in its opening summary.`;
    const invoke = vi.fn(async (prompt: string) => {
      const payload = extractSlots(prompt);
      return JSON.stringify({ edits: payload.slots.map(({ id, text }) => ({ id, text: id === target!.id ? replacement : text })) });
    });
    const execution = createAiTaskExecution({ invoke, isCurrent: () => true, abortCurrent: vi.fn() });

    const result = await runThinProseTask({ source, instruction: "润色正文", systemPrompt: "" }, execution,
      { invoke, isCurrent: () => true, abortCurrent: vi.fn() });

    expect(result.text).toContain(replacement);
  });

  it("keeps numeric label-only fact sentences read-only without invoking the model", async () => {
    const source = "Date: 2026-11-03; budget: 14 万元.";
    const slots = buildThinProseSlots(source, "润色可读正文，保留数字不变");
    expect(slots).toEqual([]);
    const invoke = vi.fn();
    const execution = createAiTaskExecution({ invoke, isCurrent: () => true, abortCurrent: vi.fn() });

    const result = await runThinProseTask({ source, instruction: "润色可读正文，保留数字不变", systemPrompt: "" }, execution,
      { invoke, isCurrent: () => true, abortCurrent: vi.fn() });

    expect(result.text).toBe(source);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("shows a complete readable sentence and slot ownership map around protected numbers", async () => {
    const source = "The release have 3 stages, and each stage need approval.";
    const slots = buildThinProseSlots(source, "纠正可读正文语法，保留数字");
    expect(slots.map(({ sourceText }) => sourceText))
      .toEqual(["The release have", ", and each stage need approval."]);
    const invoke = vi.fn(async (prompt: string) => {
      const payload = extractSlots(prompt);
      expect(payload.paragraphContexts).toEqual([{
        ownedSlotIds: slots.map(({ id }) => id), text: source
      }]);
      return JSON.stringify({ edits: payload.slots.map(({ id, text }) => ({
        id,
        text: id === slots[0].id ? "The release has" : text.replace("stage need", "stage needs")
      })) });
    });
    const execution = createAiTaskExecution({ invoke, isCurrent: () => true, abortCurrent: vi.fn() });

    const result = await runThinProseTask({ source, instruction: "纠正可读正文语法，保留数字", systemPrompt: "" }, execution,
      { invoke, isCurrent: () => true, abortCurrent: vi.fn() });

    expect(result.text).toBe("The release has 3 stages, and each stage needs approval.");
  });

  it("corrects a complete CRLF sentence without changing protected source bytes", async () => {
    const source = "---\r\ntitle: preserve\r\n---\r\n\r\nOPEN-EDGE\r\n\r\nThe release notes needs a review.\r\n\r\nDate: 2026-11-03; budget: 14 万元.\r\n\r\n| key | value |\r\n| --- | --- |\r\n| status | draft |\r\n\r\n$$E = mc^2$$\r\n\r\n```ts\r\nconst sentinel = 'KEEP';\r\n```\r\n\r\nCLOSE-EDGE";
    const instruction = "润色可读正文，保留 CRLF 换行、frontmatter、表格、公式、代码和边缘标记原样。";
    const slots = buildThinProseSlots(source, instruction);
    const target = slots.find(({ sourceText }) => sourceText === "The release notes needs a review.");
    expect(target).toBeDefined();
    expect(slots.map(({ sourceText }) => sourceText)).not.toContain("OPEN-EDGE");
    expect(slots.map(({ sourceText }) => sourceText)).not.toContain("CLOSE-EDGE");
    const invoke = vi.fn(async (prompt: string, systemPrompt: string) => {
      const payload = extractSlots(prompt);
      expect(payload.slots.map(({ text }) => text)).toEqual(["The release notes needs a review."]);
      expect(prompt).not.toContain("2026-11-03");
      expect(prompt).not.toContain("14 万元");
      const context = payload.paragraphContexts.find(({ ownedSlotIds }) => ownedSlotIds.includes(target!.id));
      expect(context?.text).toContain("The release notes needs a review.");
      expect(context?.text).not.toContain("[[");
      expect(context?.ownedSlotIds).toContain(target!.id);
      expect(systemPrompt).toContain("语法、拼写和标点错误");
      return JSON.stringify({ edits: payload.slots.map(({ id, text }) => ({ id,
        text: id === target!.id ? text.replace("notes needs", "notes need") : text })) });
    });
    const execution = createAiTaskExecution({ invoke, isCurrent: () => true, abortCurrent: vi.fn() });

    const result = await runThinProseTask({ source, instruction, systemPrompt: "只处理自然语言正文。" }, execution,
      { invoke, isCurrent: () => true, abortCurrent: vi.fn() });

    expect(result.text).toBe(source.replace("notes needs", "notes need"));
    expect(result.text.match(/\r\n/gu)).toHaveLength(source.match(/\r\n/gu)!.length);
    expect(result.text).toContain("| status | draft |");
    expect(result.text).toContain("$$E = mc^2$$");
    expect(result.text).toContain("const sentinel = 'KEEP';");
    expect(result.text.startsWith("---\r\ntitle: preserve")).toBe(true);
    expect(result.text.endsWith("CLOSE-EDGE")).toBe(true);
  });
});
