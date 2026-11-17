import { describe, expect, it } from "vitest";
import { runPlannedAiTaskCore } from "../../src/core/ai/plannedTaskRunnerCore";
import type { AiTaskRequest, AiTaskRunnerOptions } from "../../src/core/ai/aiTaskRunner";
import type { AiDocumentSnapshot } from "../../src/types/aiEditing";

type ProviderInput = { prompt: string; systemPrompt: string; maxTokens: number; outputSchema?: Record<string, unknown> };
type Provider = ReturnType<typeof provider>;

function provider(run: (input: ProviderInput, call: number) => Promise<string> | string) {
  let calls = 0;
  const inputs: ProviderInput[] = [];
  const invoke: AiTaskRunnerOptions["invoke"] = async (prompt, systemPrompt, maxTokens, _onChunk, outputSchema) => {
    calls += 1;
    const input = { prompt, systemPrompt, maxTokens, ...(outputSchema ? { outputSchema } : {}) };
    inputs.push(input);
    return run(input, calls);
  };
  return { invoke, inputs, calls: () => calls };
}

function makeSnapshot(content: string, selection: AiDocumentSnapshot["selection"] = null, readOnly = false): AiDocumentSnapshot {
  return { documentId: "safety.md", revision: 7, content, selection, cursor: selection?.to ?? content.length, readOnly };
}

function makeRequest(instruction: string, source: string, extra: Partial<AiTaskRequest> = {}): AiTaskRequest {
  return {
    action: "custom", source, userPrompt: instruction, baseSystemPrompt: "基础规则：事实准确。",
    actionDefinition: { id: "custom", label: "自定义", prompt: instruction }, ...extra
  };
}

function options(boundary: Provider, extra: Partial<AiTaskRunnerOptions> = {}): AiTaskRunnerOptions {
  return { invoke: boundary.invoke, isCurrent: () => true, abortCurrent() {}, ...extra };
}

function wireEdit(operation: "insert" | "rewrite" | "replace_exact", target: string, text: string,
  extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ version: 1, kind: "edit", operation, target, ...extra, text });
}

function applyProposal(snapshot: AiDocumentSnapshot, proposal: NonNullable<Awaited<ReturnType<typeof runPlannedAiTaskCore>>["proposal"]>): string {
  const patch = proposal.patch;
  if (!patch) throw new Error("expected explicit patch");
  return snapshot.content.slice(0, patch.from) + patch.insertText + snapshot.content.slice(patch.to);
}

async function run(instruction: string, snapshot: AiDocumentSnapshot, boundary: Provider,
  requestExtra: Partial<AiTaskRequest> = {}, optionExtra: Partial<AiTaskRunnerOptions> = {}) {
  return runPlannedAiTaskCore(makeRequest(instruction, snapshot.content, requestExtra), snapshot, options(boundary, optionExtra));
}

const source = "# 原文\n\n价格为 27 元；发布日期为 10 月 3 日。";

describe("default thin execution safety", () => {
  it("does not switch direct mode to a multi-stage workflow when unknown intent is over budget", async () => {
    const document = "Unrelated plain source. ".repeat(3_000);
    const boundary = provider(() => "must not start");
    await expect(run("让它符合我的想法。", makeSnapshot(document), boundary, { executionPolicy: "direct" }))
      .rejects.toThrow(/上下文预算/u);
    expect(boundary.calls()).toBe(0);
  });
  it("answers an ordinary explanation in one raw call without unrelated document source", async () => {
    const boundary = provider(({ prompt }) => {
      expect(prompt).toContain("Markdown 引用块怎么使用");
      expect(prompt).not.toContain("价格为 27 元");
      return "引用块使用 > 前缀标记引用内容。";
    });
    const result = await run("Markdown 引用块怎么使用？只回答，不修改文档。", makeSnapshot(source), boundary);
    expect(boundary.calls()).toBe(1);
    expect(result.answerOnly).toBe(true);
    expect(result.proposal).toBeUndefined();
    expect(result.text).toBe("引用块使用 > 前缀标记引用内容。");
  });

  it("answers a source-grounded field question from evidence instead of a raw model answer", async () => {
    const quote = "Iris 的预算为 6 万元。";
    const factSource = `# Project notes\n\n${quote}`;
    const boundary = provider(() => { throw new Error("A unique source field relation needs no raw answer call."); });
    const result = await run("根据原文回答：Iris 的预算是多少？只回答，不修改文档。", makeSnapshot(factSource), boundary);
    expect(boundary.calls()).toBe(0);
    expect(result.answerOnly).toBe(true);
    expect(result.contentExecutor).toBe("evidence");
    expect(result.sourceFacts).toEqual([quote]);
    expect(result.text).toContain("预算（Iris）：6 万元");
    expect(result.warnings.join("\n")).toContain("sourceFacts 只表示所列原句存在于来源");
    expect(result.proposal).toBeUndefined();
  });

  it("programmatically appends a fully specified Markdown code artifact without inference", async () => {
    const boundary = provider(() => { throw new Error("unexpected inference"); });
    const snapshot = makeSnapshot(source);
    const result = await run("创建代码块 markdown 格式 标题一 hello", snapshot, boundary);
    expect(boundary.calls()).toBe(0);
    expect(applyProposal(snapshot, result.proposal!)).toBe(`${source}\n\n\`\`\`markdown\n# hello\n\`\`\``);
  });

  it("rejects a raw Markdown fence instead of unwrapping it as an artifact payload", async () => {
    const boundary = provider(() => "```python\ndef add(a, b):\n    return a + b\n```");
    await expect(run("在文末新增 Python 代码块，定义 add(a, b)，返回 a + b。", makeSnapshot(source), boundary))
      .rejects.toThrow("填充结果不是完整 JSON");
    expect(boundary.calls()).toBe(1);
  });

  it("programmatically renders explicitly paired table columns and rows", async () => {
    const boundary = provider(() => { throw new Error("unexpected inference"); });
    const snapshot = makeSnapshot(source);
    const result = await run("新增一个 Markdown 表格，列名为测试项、结果；行数据为编译器→通过、测试→待定。", snapshot, boundary);
    expect(boundary.calls()).toBe(0);
    expect(applyProposal(snapshot, result.proposal!)).toBe(`${source}\n\n| 测试项 | 结果 |\n| --- | --- |\n| 编译器 | 通过 |\n| 测试 | 待定 |`);
  });

  it("programmatically renders a fully given display equation without inference", async () => {
    const boundary = provider(() => { throw new Error("unexpected inference"); });
    const snapshot = makeSnapshot(source);
    const result = await run("在文末新增一个 LaTeX 显示公式块，用 $$ 包裹公式，表达勾股定理：a^2 + b^2 = c^2。", snapshot, boundary);
    expect(boundary.calls()).toBe(0);
    expect(applyProposal(snapshot, result.proposal!)).toBe(`${source}\n\n$$\na^2 + b^2 = c^2\n$$`);
  });

  it("programmatically renders explicitly supplied icon list items without inference", async () => {
    const boundary = provider(() => { throw new Error("unexpected inference"); });
    const snapshot = makeSnapshot(source);
    const result = await run("在文末新增三个状态图标清单：✅ 已完成、⚠️ 待确认、❌ 已阻塞。", snapshot, boundary);
    expect(boundary.calls()).toBe(0);
    expect(applyProposal(snapshot, result.proposal!)).toBe(`${source}\n\n- ✅ 已完成\n- ⚠️ 待确认\n- ❌ 已阻塞`);
  });

  it("resolves an unknown natural-language edit and its body in one combined call", async () => {
    const boundary = provider(({ outputSchema }) => {
      expect(outputSchema).toBeDefined();
      return wireEdit("rewrite", "document", "面向新同事的清晰说明。\n\n价格为 27 元。发布日期为 10 月 3 日。");
    });
    const snapshot = makeSnapshot(source);
    const result = await run("让这份文档更容易被新同事阅读。", snapshot, boundary);
    expect(boundary.calls()).toBe(1);
    expect(result.planningMode).toBe("model");
    expect(result.proposal?.patch).toMatchObject({ from: 0, to: source.length, expectedText: source });
  });

  it("rewrites the entire document only when the instruction names the whole document", async () => {
    const boundary = provider(({ prompt }) => {
      const payload = JSON.parse(prompt.slice(0, prompt.indexOf("\n"))) as { document?: string };
      expect(payload.document).toBe(source);
      return "# 简明说明\n\n价格为 27 元；发布日期为 10 月 3 日。";
    });
    const snapshot = makeSnapshot(source);
    const result = await run("改写全文，语言更简洁。", snapshot, boundary);
    expect(boundary.calls()).toBe(1);
    expect(result.proposal?.patch).toMatchObject({ from: 0, to: source.length, expectedText: source });
    expect(applyProposal(snapshot, result.proposal!)).toBe("# 简明说明\n\n价格为 27 元；发布日期为 10 月 3 日。");
  });

  it("sends only the selected text as rewrite context when the user names the selection", async () => {
    const document = "前缀私有内容\n待改写段落\n后缀私有内容";
    const from = document.indexOf("待改写段落");
    const to = from + "待改写段落".length;
    const snapshot = makeSnapshot(document, { from, to });
    const boundary = provider(({ prompt }) => {
      expect(prompt).toContain("待改写段落");
      expect(prompt).not.toContain("前缀私有内容");
      expect(prompt).not.toContain("后缀私有内容");
      return "改写后的段落";
    });
    const result = await run("改写当前选区，保留原意。", snapshot, boundary);
    expect(boundary.calls()).toBe(1);
    expect(result.proposal?.patch).toMatchObject({ from, to, expectedText: "待改写段落" });
  });

  it("preserves the exact prefix and suffix around a selection patch", async () => {
    const document = "头部不变\n原来的选中句子\n尾部不变";
    const from = document.indexOf("原来的选中句子");
    const to = from + "原来的选中句子".length;
    const snapshot = makeSnapshot(document, { from, to });
    const boundary = provider(() => "新的选中句子");
    const result = await run("改写当前选区，保持意思不变。", snapshot, boundary);
    const patch = result.proposal?.patch;
    expect(patch).toMatchObject({ from, to, expectedText: "原来的选中句子" });
    expect(document.slice(0, patch!.from)).toBe("头部不变\n");
    expect(document.slice(patch!.to)).toBe("\n尾部不变");
    expect(applyProposal(snapshot, result.proposal!)).toBe("头部不变\n新的选中句子\n尾部不变");
  });

  it("replaces only the requested last repeated anchor", async () => {
    const document = "待办：校验\n已办：构建\n待办：发布";
    const boundary = provider(() => { throw new Error("literal replacement should not infer"); });
    const snapshot = makeSnapshot(document);
    const result = await run("将最后一处“待办”替换为“已办”。", snapshot, boundary);
    expect(boundary.calls()).toBe(0);
    expect(applyProposal(snapshot, result.proposal!)).toBe("待办：校验\n已办：构建\n已办：发布");
  });

  it("replaces all requested repeated anchors while preserving text between them", async () => {
    const document = "旧词 A，中间内容；旧词 B。";
    const boundary = provider(() => { throw new Error("literal replacement should not infer"); });
    const snapshot = makeSnapshot(document);
    const result = await run("将所有“旧词”替换为“新词”。", snapshot, boundary);
    expect(boundary.calls()).toBe(0);
    expect(applyProposal(snapshot, result.proposal!)).toBe("新词 A，中间内容；新词 B。");
  });

  it("fails closed for an ambiguous repeated anchor rather than choosing one", async () => {
    const document = "重复词在开头，后面再次出现重复词。";
    const boundary = provider(({ outputSchema }) => {
      expect(outputSchema).toBeDefined();
      return JSON.stringify({ version: 1, kind: "clarify", reason: "ambiguous_anchor" });
    });
    await expect(run("将“重复词”替换为“唯一词”。", makeSnapshot(document), boundary)).rejects.toThrow();
    expect(boundary.calls()).toBeLessThanOrEqual(1);
  });

  it("allows a full-body-to-table rewrite without requiring the original prose shape", async () => {
    const document = "项目甲通过检查\n项目乙仍待确认";
    const snapshot = makeSnapshot(document);
    const table = "| 项目 | 状态 |\n| --- | --- |\n| 项目甲 | 通过检查 |\n| 项目乙 | 待确认 |";
    const boundary = provider(() => table);
    const result = await run("将全文整理成表格。", snapshot, boundary);
    expect(boundary.calls()).toBe(1);
    expect(result.proposal?.patch).toMatchObject({ from: 0, to: document.length, expectedText: document });
    expect(applyProposal(snapshot, result.proposal!)).toBe(table);
  });

  it("keeps direct-path wrong generated code language as a warning-backed review proposal", async () => {
    const snapshot = makeSnapshot(source);
    const boundary = provider(() => "```javascript\nfunction add(a, b) { return a + b; }\n```\n\n用途：计算两个数的和。");
    const result = await run("在文末新增 Python 代码块，定义 add(a, b)，返回 a + b，并解释用途。", snapshot, boundary,
      { executionPolicy: "direct" });
    expect(boundary.calls()).toBe(1);
    expect(result.executionPolicy).toBe("direct");
    expect(result.proposal).toBeDefined();
    expect(result.warnings.join("\n")).toContain("language_mismatch");
  });

  it("keeps direct-path wrong explicit heading level as a warning-backed review proposal", async () => {
    const snapshot = makeSnapshot(source);
    const boundary = provider(() => "```markdown\n## hello\n\n用途说明。\n```");
    const result = await run("新增 Markdown 代码块，包含一级标题 hello，并解释它的用途。", snapshot, boundary,
      { executionPolicy: "direct" });
    expect(boundary.calls()).toBe(1);
    expect(result.executionPolicy).toBe("direct");
    expect(result.proposal).toBeDefined();
    expect(result.warnings.join("\n")).toContain("heading_level_mismatch");
  });

  it("rejects empty generated content without retrying or proposing an edit", async () => {
    const boundary = provider(() => "");
    await expect(run("改写全文，语言简洁。", makeSnapshot(source), boundary)).rejects.toThrow();
    expect(boundary.calls()).toBe(1);
  });

  it("rejects a truncated combined response without retrying", async () => {
    const boundary = provider(() => "{\"version\":1,\"kind\":\"edit\",\"operation\":\"rewrite\"");
    await expect(run("让这份文档更容易被新同事阅读。", makeSnapshot(source), boundary)).rejects.toThrow();
    expect(boundary.calls()).toBe(1);
  });

  it("does not retry after the provider rejects a truncated generation", async () => {
    const boundary = provider(() => Promise.reject(new Error("provider rejected: truncated response")));
    await expect(run("改写全文，语言简洁。", makeSnapshot(source), boundary)).rejects.toThrow("truncated response");
    expect(boundary.calls()).toBe(1);
  });

  it("does not invoke the provider when cancellation is already signaled", async () => {
    const controller = new AbortController();
    controller.abort();
    const boundary = provider(() => "不可应用的内容");
    await expect(run("改写全文，语言简洁。", makeSnapshot(source), boundary, {}, { signal: controller.signal })).rejects.toThrow();
    expect(boundary.calls()).toBe(0);
  });

  it("abandons an in-flight provider response after cancellation without proposing it", async () => {
    const controller = new AbortController();
    let started!: () => void;
    const entered = new Promise<void>(resolve => { started = resolve; });
    let finish!: (text: string) => void;
    const held = new Promise<string>(resolve => { finish = resolve; });
    const boundary = provider(() => { started(); return held; });
    const pending = run("改写全文，语言简洁。", makeSnapshot(source), boundary, {}, { signal: controller.signal });
    await entered;
    controller.abort();
    await expect(pending).rejects.toThrow();
    finish("过期结果");
    expect(boundary.calls()).toBe(1);
  });

  it("does not start inference for a stale task", async () => {
    const boundary = provider(() => "不可应用的内容");
    await expect(run("改写全文，语言简洁。", makeSnapshot(source), boundary, {}, { isCurrent: () => false })).rejects.toThrow();
    expect(boundary.calls()).toBe(0);
  });

  it("rejects a result completed after the task deadline without a retry", async () => {
    let clock = 1_000;
    const boundary = provider(() => { clock = 1_020; return "过期结果"; });
    await expect(run("改写全文，语言简洁。", makeSnapshot(source), boundary, {}, {
      now: () => clock, maxDurationMs: 10
    })).rejects.toThrow();
    expect(boundary.calls()).toBe(1);
  });

  it("does not create a proposal for a read-only document", async () => {
    const boundary = provider(() => "改写后的全文。");
    await expect(run("改写全文，语言简洁。", makeSnapshot(source, null, true), boundary)).rejects.toThrow(/只读/u);
    expect(boundary.calls()).toBe(0);
  });

  it("uses one generation call for a source-dependent rewrite that fits the budget", async () => {
    const brief = "第一段说明。\n\n第二段说明。";
    const boundary = provider(() => "精简后的说明。\n\n保留第二段关系。");
    const result = await run("改写全文，保留事实。", makeSnapshot(brief), boundary);
    expect(boundary.calls()).toBe(1);
    expect(result.proposal?.patch).toMatchObject({ from: 0, to: brief.length, expectedText: brief });
  });

  it("splits only an over-budget rewrite into contiguous full source ownership", async () => {
    const document = Array.from({ length: 720 }, (_unused, index) =>
      `record-${String(index).padStart(4, "0")}: stable fact ${index} belongs to this paragraph.`).join("\n\n");
    const documents: string[] = [];
    const boundary = provider(({ prompt }, call) => {
      const payload = JSON.parse(prompt.slice(0, prompt.indexOf("\n"))) as { document?: string };
      expect(payload.document).toBeTypeOf("string");
      documents.push(payload.document!);
      return `改写片段 ${call}。`;
    });
    const snapshot = makeSnapshot(document);
    const result = await run("改写全文，保留全部事实。", snapshot, boundary);
    expect(boundary.calls()).toBeGreaterThan(1);
    expect(documents[0]).toContain("record-0000:");
    expect(documents.some(part => part.includes("record-0360:"))).toBe(true);
    expect(documents.at(-1)).toContain("record-0719:");
    expect(documents.join("" )).toBe(document);
    expect(result.proposal?.patch).toMatchObject({ from: 0, to: document.length, expectedText: document });
  });

  it("does not return a partial proposal when the middle chunk fails", async () => {
    const document = Array.from({ length: 720 }, (_unused, index) =>
      `record-${String(index).padStart(4, "0")}: stable fact ${index} belongs to this paragraph.`).join("\n\n");
    const seen: string[] = [];
    const boundary = provider(({ prompt }, call) => {
      const payload = JSON.parse(prompt.slice(0, prompt.indexOf("\n"))) as { document?: string };
      seen.push(payload.document ?? "");
      if (call === 2) throw new Error("middle chunk failed");
      return "部分改写，不得提交。";
    });
    await expect(run("改写全文，保留全部事实。", makeSnapshot(document), boundary)).rejects.toThrow("middle chunk failed");
    expect(boundary.calls()).toBe(2);
    expect(seen).toHaveLength(2);
  });
});
