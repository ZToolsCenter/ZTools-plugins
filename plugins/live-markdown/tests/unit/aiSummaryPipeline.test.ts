import { describe, expect, it, vi } from "vitest";
import { runSummaryTask } from "../../src/core/ai/aiSummaryPipeline";
import { createAiTaskExecution } from "../../src/core/ai/aiTaskExecution";
import type { AiTaskRequest } from "../../src/core/ai/aiTaskRunner";
import { validateMarkdownFragmentCompleteness } from "../../src/core/ai/markdownAstIntegrity";
import { TYPORA_QUICKSTART_MARKDOWN } from "../../src/core/sampleDocs";
import { parseSummarySelectionReceipt } from "../../src/core/ai/summarySelectionReceipt";

const background = "日常背景用于说明记录方式与沟通路径。".repeat(80);
const source = `# 开篇\n\n开篇决定：苍鹭站点由许宁负责。\n\n${background}\n\n# 中段\n\n中段决定：海盐系统预算为37万元。\n\n${background}\n\n# 末段\n\n末段决定：琥珀版本于2026-12-19发布。`;
const optionalSource = "项目决定采用离线模式。\n\n背景资料用于说明文稿内容。";
const optionalRequest = () => request("总结全文，最多500字", optionalSource);
const request = (userPrompt = "总结全文的三项决定，保留负责人、金额和日期。", content = source): AiTaskRequest => ({ source: content, action: "summarize", userPrompt, baseSystemPrompt: "忠于原文。", actionDefinition: { id: "summarize", label: "总结", prompt: userPrompt } });
function candidatesFromPrompt(prompt: string): Array<{ id: string; quote: string }> {
  const line = prompt.split("\n").find(line => line.startsWith("候选："))!;
  return JSON.parse(line.slice(3)) as Array<{ id: string; quote: string }>;
}
function choose(prompt: string): string {
  const facts = candidatesFromPrompt(prompt);
  return JSON.stringify({ ids: facts.filter(({ quote }) => /决定/.test(quote)).map(({ id }) => id) });
}
function chooseAll(prompt: string): string {
  return JSON.stringify({ ids: candidatesFromPrompt(prompt).map(({ id }) => id) });
}
function execution(invoke = vi.fn(async (prompt: string) => choose(prompt)), maxCalls = 64) {
  return { invoke, task: createAiTaskExecution({ invoke, isCurrent: () => true, abortCurrent: vi.fn(), maxCalls }) };
}

describe("source-owned extractive summary pipeline", () => {
  it("does not offer unrelated background IDs when the user asks for decision relations", async () => {
    const document = Array.from({ length: 25 }, (_, index) => `## 过程 ${index + 1}\n\n本节没有新增决策。\n\n日常沟通需要区分事实与待办。`).join("\n\n")
      + "\n\n## 决议\n\n决定采用离线引擎。\n\n由罗青负责。\n\n预算为12万元。";
    const invoke = vi.fn(async (prompt: string) => {
      const candidates = JSON.parse(prompt.split("\n").find(line => line.startsWith("候选："))!.slice(3)) as Array<{ id: string }>;
      return JSON.stringify({ ids: candidates.map(({ id }) => id) });
    });
    const { task } = execution(invoke);
    const result = await runSummaryTask(request("总结决定、负责人和金额", document), task, {});
    expect(result.sourceFacts).toEqual(["决定采用离线引擎。", "由罗青负责。", "预算为12万元。"]);
    expect(result.text).not.toMatch(/没有新增决策|日常沟通/);
    expect(invoke.mock.calls.every(([prompt]) => !prompt.includes('"quote":"本节没有新增决策。"'))).toBe(true);
  });
  it("retains source relations from every region with N map calls and zero reduce calls", async () => {
    const { invoke, task } = execution();
    const result = await runSummaryTask(request(), task, {});
    expect(result.stats.chunks).toBeGreaterThan(1);
    expect(invoke).toHaveBeenCalledTimes(result.stats.modelCalls);
    expect(result.stats.modelCalls).toBeLessThanOrEqual(result.stats.chunks);
    expect(result.text).toContain("苍鹭站点由许宁负责");
    expect(result.text).toContain("海盐系统预算为37万元");
    expect(result.text).toContain("琥珀版本于2026-12-19发布");
    expect(result.text).not.toContain("日常背景");
    expect(result.sourceFacts.every(quote => source.includes(quote))).toBe(true);
    expect(invoke.mock.calls.every(([prompt]) => !prompt.includes("合并以下分段摘要"))).toBe(true);
  });
  it("accepts Gemini's complete json-fenced fact receipt and still validates every ID", async () => {
    const expectedQuotes = new Set([
      "**Live Markdown** 为你提供读者与创作者合一的**无缝所见即所得体验**。",
      "> [!WARNING]\n> 在处理重要本地文稿时，建议开启偏好设置中的**自动保存 (Auto Save)** 功能。"
    ]);
    let invocationIndex = 0;
    const invoke = vi.fn(async (prompt: string) => {
      const ids = candidatesFromPrompt(prompt)
        .filter(({ quote }) => expectedQuotes.has(quote))
        .map(({ id }) => id);
      const receipt = JSON.stringify({ ids });
      return invocationIndex++ === 0 ? `\`\`\`json\n${receipt}\n\`\`\`` : receipt;
    });
    const { task } = execution(invoke);
    const result = await runSummaryTask(request("总结全文", TYPORA_QUICKSTART_MARKDOWN), task, {});
    expect(result.sourceFacts).toContain("**Live Markdown** 为你提供读者与创作者合一的**无缝所见即所得体验**。");
    expect(result.sourceFacts).toContain("> [!WARNING]\n> 在处理重要本地文稿时，建议开启偏好设置中的**自动保存 (Auto Save)** 功能。");
    expect(invoke).toHaveBeenCalledTimes(2);
  });
  it("accepts one complete no-language or CRLF JSON fence", async () => {
    const invoke = vi.fn(async (prompt: string) => `\`\`\`\n${chooseAll(prompt)}\n\`\`\``);
    const { task } = execution(invoke);
    const result = await runSummaryTask(optionalRequest(), task, {});
    expect(result.sourceFacts).toContain("背景资料用于说明文稿内容。");
    expect(invoke).toHaveBeenCalledTimes(1);
    const crlfInvoke = vi.fn(async (prompt: string) => `\`\`\`JSON\r\n${chooseAll(prompt)}\r\n\`\`\``);
    const { task: crlfTask } = execution(crlfInvoke);
    const crlfResult = await runSummaryTask(optionalRequest(), crlfTask, {});
    expect(crlfResult.sourceFacts).toContain("背景资料用于说明文稿内容。");
    expect(crlfInvoke).toHaveBeenCalledTimes(1);
  });
  it("rejects ambiguous JSON wrappers and invalid or ungrounded IDs without retrying", async () => {
    const failures: Array<{ label: string; response: (id: string) => string; message: RegExp }> = [
      { label: "prose prefix", response: id => `说明\n{\"ids\":[\"${id}\"]}`, message: /读取/ },
      { label: "prose suffix", response: id => `{\"ids\":[\"${id}\"]}\n说明`, message: /读取/ },
      { label: "multiple fences", response: id => `\`\`\`json\n{\"ids\":[\"${id}\"]}\n\`\`\`\n\`\`\`\n{\"ids\":[]}\n\`\`\``, message: /读取/ },
      { label: "unclosed fence", response: id => `\`\`\`json\n{\"ids\":[\"${id}\"]}`, message: /读取/ },
      { label: "non-JSON fence", response: id => `\`\`\`javascript\n{\"ids\":[\"${id}\"]}\n\`\`\``, message: /读取/ },
      { label: "malformed JSON", response: () => "```json\n{\"ids\":[}\n```", message: /读取/ },
      { label: "unknown ID", response: () => "{\"ids\":[\"unknown\"]}", message: /无法回溯/ },
      { label: "duplicate ID", response: id => `\`\`\`json\n{\"ids\":[\"${id}\",\"${id}\"]}\n\`\`\``, message: /无法回溯/ },
      { label: "extra key", response: id => `{\"ids\":[\"${id}\"],\"extra\":true}`, message: /格式无效/ },
    ];
    for (const item of failures) {
      let optionalCandidateSeen = false;
      const invoke = vi.fn(async (prompt: string) => {
        const candidates = candidatesFromPrompt(prompt);
        optionalCandidateSeen = candidates.some(({ quote }) => quote === "背景资料用于说明文稿内容。");
        return item.response(candidates[0].id);
      });
      const { task } = execution(invoke);
      await expect(runSummaryTask(optionalRequest(), task, {}), item.label)
        .rejects.toThrow(item.message);
      expect(invoke, item.label).toHaveBeenCalledTimes(1);
      expect(optionalCandidateSeen, item.label).toBe(true);
    }
  });
  it("checks the UTF-8 receipt limit before parsing", () => {
    const limit = 16 * 1024;
    expect(() => parseSummarySelectionReceipt("x".repeat(limit + 1), ["known-id"]))
      .toThrow(/摘要证据输出超过上限/);
    expect(() => parseSummarySelectionReceipt("汉".repeat(5500), ["known-id"]))
      .toThrow(/摘要证据输出超过上限/);
    expect(() => parseSummarySelectionReceipt(`${" ".repeat(limit - 1)}{"ids":[]}`, ["known-id"]))
      .toThrow(/摘要证据输出超过上限/);
  });
  it("rejects a foreign ID rather than fabricating a partial summary or trying again", async () => {
    let optionalCandidateSeen = false;
    const { invoke, task } = execution(vi.fn(async (prompt: string) => {
      optionalCandidateSeen = candidatesFromPrompt(prompt).some(({ quote }) => quote === "背景资料用于说明文稿内容。");
      return '{"ids":["invented-fact"]}';
    }));
    await expect(runSummaryTask(optionalRequest(), task, {})).rejects.toThrow(/无法回溯/);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(optionalCandidateSeen).toBe(true);
  });
  it("refuses free paraphrasing before invoking the model", async () => {
    const { invoke, task } = execution();
    await expect(runSummaryTask(request("用自己的话总结全文"), task, {})).rejects.toThrow(/关键原句/);
    expect(invoke).not.toHaveBeenCalled();
  });
  it("honors length and item constraints instead of silently rendering a different task", async () => {
    const a = execution();
    await expect(runSummaryTask(request("总结为2条"), a.task, {})).rejects.toThrow(/2 条/);
    const b = execution();
    await expect(runSummaryTask(request("总结全文，10字以内"), b.task, {})).rejects.toThrow(/10 字/);
  });
  it("applies Arabic counts followed by 个要点 and two-digit 条 counts", async () => {
    const allIds = vi.fn(async (prompt: string) => {
      const candidates = JSON.parse(prompt.split("\n").find(line => line.startsWith("候选："))!.slice(3)) as Array<{ id: string }>;
      return JSON.stringify({ ids: candidates.map(({ id }) => id) });
    });
    const source10 = Array.from({ length: 10 }, (_, index) => `背景说明${String.fromCharCode(0x7532 + index)}内容完整。`).join("\n\n");
    const three = execution(allIds);
    const threeResult = await runSummaryTask(request("总结3个要点", source10), three.task, {});
    expect(threeResult.sourceFacts).toHaveLength(3);

    const source12 = Array.from({ length: 12 }, (_, index) => `事项${index + 1}保持完整。`).join("\n\n");
    const twelve = execution(allIds);
    const twelveResult = await runSummaryTask(request("总结为12条", source12), twelve.task, {});
    expect(twelveResult.sourceFacts).toHaveLength(12);
  });
  it("fits whole optional facts inside the default global character target", async () => {
    const longFact = `${"过程方案说明".repeat(18)}。`;
    const document = Array.from({ length: 10 }, (_, index) => `第${String.fromCharCode(0x7532 + index)}项：${longFact}`).join("\n\n");
    const invoke = vi.fn(async (prompt: string) => {
      const candidates = JSON.parse(prompt.split("\n").find(line => line.startsWith("候选："))!.slice(3)) as Array<{ id: string }>;
      return JSON.stringify({ ids: candidates.map(({ id }) => id) });
    });
    const { task } = execution(invoke);
    const result = await runSummaryTask(request("总结全文", document), task, {});
    expect(Array.from(result.text).length).toBeLessThanOrEqual(400);
    expect(result.sourceFacts.length).toBeLessThanOrEqual(5);
    expect(result.sourceFacts.every((quote) => document.includes(quote))).toBe(true);
  });
  it("rejects an impossible short character limit instead of ignoring it or truncating source facts", async () => {
    const { task } = execution();
    await expect(runSummaryTask(request("摘要最多5个字", "项目决定采用离线模式。"), task, {}))
      .rejects.toThrow(/5 字/);
  });
  it("can satisfy a short character limit using a complete fact", async () => {
    const invoke = vi.fn(async (prompt: string) => {
      const candidates = JSON.parse(prompt.split("\n").find(line => line.startsWith("候选："))!.slice(3)) as Array<{ id: string }>;
      return JSON.stringify({ ids: candidates.map(({ id }) => id) });
    });
    const { task } = execution(invoke);
    const result = await runSummaryTask(request("摘要最多5个字", "上线。"), task, {});
    expect(Array.from(result.text)).toHaveLength(5);
    expect(result.sourceFacts).toEqual(["上线。"]);
  });
  it("reports when required facts make an extractive summary longer than its source", async () => {
    const document = "# 决策\n\n" + Array.from({ length: 10 }, (_, index) => `由成员${String.fromCharCode(0x7532 + index)}负责项目。`).join("\n");
    const invoke = vi.fn(async () => JSON.stringify({ ids: [] }));
    const { task } = execution(invoke);
    const result = await runSummaryTask(request("总结全文", document), task, {});
    expect(result.sourceFacts).toHaveLength(10);
    expect(result.text.length).toBeGreaterThan(document.length);
    expect(result.warnings).toEqual([expect.stringContaining("未删减关键内容")]);
  });
  it("keeps an unconstrained summary compact when a model selects every optional fact", async () => {
    const document = Array.from({ length: 24 }, (_, index) => `背景事项${index + 1}说明了一种独立的协作过程。`).join("\n\n");
    const invoke = vi.fn(async (prompt: string) => {
      const candidates = JSON.parse(prompt.split("\n").find(line => line.startsWith("候选："))!.slice(3)) as Array<{ id: string }>;
      return JSON.stringify({ ids: candidates.map(({ id }) => id) });
    });
    const { task } = execution(invoke);
    const result = await runSummaryTask(request("总结全文", document), task, {});
    expect(result.sourceFacts.length).toBeLessThanOrEqual(5);
    expect(result.text.length).toBeLessThan(400);
    expect(invoke).toHaveBeenCalledTimes(1);
  });
  it("keeps all required facts when they exceed the soft default summary budget", async () => {
    const document = Array.from({ length: 8 }, (_, index) => `项目决定采用系统 CM${index + 1}，由王明负责。`).join("\n\n");
    const invoke = vi.fn(async () => JSON.stringify({ ids: [] }));
    const { task } = execution(invoke);
    const result = await runSummaryTask(request("总结全文", document), task, {});
    expect(result.sourceFacts).toHaveLength(8);
    expect(result.sourceFacts.every((quote) => document.includes(quote))).toBe(true);
    expect(result.stats.retainedRequiredFacts).toBe(8);
  });
  it("omits raw code and diagram blocks from default summaries", async () => {
    const document = "项目决定采用离线模式。\n\n```ts\nconst sample = true;\n```\n\n```mermaid\ngraph TD\n  A --> B\n```";
    const invoke = vi.fn(async (prompt: string) => {
      const candidates = JSON.parse(prompt.split("\n").find(line => line.startsWith("候选："))!.slice(3)) as Array<{ id: string }>;
      return JSON.stringify({ ids: candidates.map(({ id }) => id) });
    });
    const { task } = execution(invoke);
    const result = await runSummaryTask(request("总结全文", document), task, {});
    expect(result.sourceFacts).toContain("项目决定采用离线模式。");
    expect(result.sourceFacts.some((quote) => quote.startsWith("```"))).toBe(false);
    expect(result.text).not.toContain("graph TD");
  });
  it("keeps explicitly requested code as a complete source-backed block", async () => {
    const code = "```ts\nconst sample = true;\n```";
    const document = `实现如下：\n\n${code}`;
    const invoke = vi.fn(async (prompt: string) => {
      const candidates = JSON.parse(prompt.split("\n").find(line => line.startsWith("候选："))!.slice(3)) as Array<{ id: string }>;
      return JSON.stringify({ ids: candidates.map(({ id }) => id) });
    });
    const { task } = execution(invoke);
    const result = await runSummaryTask(request("总结代码实现", document), task, {});
    expect(result.sourceFacts).toContain(code);
    expect(result.text).toContain(code);
    expect(() => validateMarkdownFragmentCompleteness(result.text)).not.toThrow();
  });
  it("keeps a required source date even when it appears inside an otherwise optional code block", async () => {
    const code = "```text\nrelease_date = 2026-12-19\n```";
    const invoke = vi.fn(async () => JSON.stringify({ ids: [] }));
    const { task } = execution(invoke);
    const result = await runSummaryTask(request("总结全文", code), task, {});
    expect(result.sourceFacts).toEqual([code]);
    expect(result.text).toBe(code);
    expect(() => validateMarkdownFragmentCompleteness(result.text)).not.toThrow();
  });
  it("preflights the shared remaining call budget", async () => {
    const { invoke, task } = execution(undefined, 0);
    await expect(runSummaryTask(optionalRequest(), task, {})).rejects.toThrow(/剩余模型调用预算/);
    expect(invoke).not.toHaveBeenCalled();
  });
  it("ignores a late extraction result after the document generation becomes stale", async () => {
    let current = true;
    let optionalCandidateSeen = false;
    const invoke = vi.fn(async (prompt: string) => {
      optionalCandidateSeen = candidatesFromPrompt(prompt).some(({ quote }) => quote === "背景资料用于说明文稿内容。");
      current = false;
      return chooseAll(prompt);
    });
    const task = createAiTaskExecution({ invoke, isCurrent: () => current, abortCurrent: vi.fn() });
    await expect(runSummaryTask(optionalRequest(), task, {})).rejects.toThrow(/已取消/);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(optionalCandidateSeen).toBe(true);
  });
});
