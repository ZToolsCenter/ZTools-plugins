import { describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import type { AiInvocationLimits } from "../../src/core/ai/aiTaskExecution";
import { createAiTaskExecution, AiTaskCancelledError } from "../../src/core/ai/aiTaskExecution";
import { runProseEditTask, type ProseEditRequest } from "../../src/core/ai/proseEditExecution";

const SLOTS_MARKER = "【待编辑文本槽】\n";
const { validateOutputSchema } = createRequire(import.meta.url)("../../preload/local-ai/output-constraint.cjs");
type BatchPayload = { batchId: string; slots: Array<{ id: string; text: string }> };

function request(source: string, extra: Partial<ProseEditRequest> = {}): ProseEditRequest {
  return {
    source,
    instruction: "校对错字并保持原意",
    systemPrompt: "只编辑指定的普通正文文本槽，不得新增 Markdown 结构。",
    revision: "rev-1",
    providerBudget: { contextLimit: 4096, maxOutputTokens: 2048 },
    ...extra
  };
}

function readBatch(prompt: string): BatchPayload {
  const index = prompt.indexOf(SLOTS_MARKER);
  if (index < 0) throw new Error("expected serialized slot payload in prompt");
  return JSON.parse(prompt.slice(index + SLOTS_MARKER.length)) as BatchPayload;
}

function outputFor(prompt: string, transform: (text: string) => string): string {
  const batch = readBatch(prompt);
  return JSON.stringify({
    protocol: "prose-edit/v1",
    batchId: batch.batchId,
    edits: batch.slots.map(({ id, text }) => ({ id, status: "replace", text: transform(text) }))
  });
}

function execution(invoke: (prompt: string, system: string, maxTokens: number, limits?: AiInvocationLimits) => Promise<string>, maxCalls = 64) {
  return createAiTaskExecution({
    invoke: (prompt, system, maxTokens, _onChunk, outputSchema) => invoke(prompt, system, maxTokens, { outputSchema }),
    isCurrent: () => true,
    abortCurrent: vi.fn(),
    maxCalls
  });
}

const malformedReceipts: Array<[string, (batch: BatchPayload) => unknown[]]> = [
  ["unknown slot", () => [{ id: "foreign-slot", status: "unchanged" }]],
  ["duplicate slot", (batch) => batch.slots.flatMap(({ id }) => [
    { id, status: "unchanged" }, { id, status: "unchanged" }
  ])],
  ["missing slot", (batch) => batch.slots.slice(1).map(({ id }) => ({ id, status: "unchanged" }))]
];

describe("source-bound prose edit execution", () => {
  it("returns one reconstructed full-document result only after every batch is acknowledged", async () => {
    const source = "# 标题\r\n\r\n第一段错字。\r\n\r\n**第二段错字**，`固定代码`。\r\n";
    const invoke = vi.fn(async (prompt: string) => outputFor(prompt, (text) => text.replaceAll("错字", "正字")));

    const result = await runProseEditTask(request(source), execution(invoke));

    expect(invoke.mock.calls.length).toBeGreaterThan(0);
    expect(result.text).toContain("第一段正字。");
    expect(result.text).toContain("**第二段正字**");
    expect(result.text).toContain("`固定代码`");
    expect(result.text).toBe(source.replaceAll("错字", "正字"));
    expect(result.preservedSource).toBe(false);
    expect(result.stats.modelCalls).toBe(invoke.mock.calls.length);
    expect(result.stats.sourceHash).toBeTruthy();
    const sentSlots = invoke.mock.calls.flatMap(([prompt]) => readBatch(prompt).slots.map(({ text }) => text));
    expect(sentSlots).toContain("第一段错字。");
    expect(sentSlots).toContain("**第二段错字**，`固定代码`。");
  });

  it("binds each response schema to the current batch and exact slot IDs", async () => {
    const source = "普通正文错字。";
    let limits: AiInvocationLimits | undefined;
    let systemPrompt = "";
    const invoke = vi.fn(async (prompt: string, system: string, _maxTokens: number, received?: AiInvocationLimits) => {
      limits = received;
      systemPrompt = system;
      return outputFor(prompt, (text) => text);
    });

    await runProseEditTask(request(source), execution(invoke));

    const batch = readBatch(invoke.mock.calls[0][0]);
    expect(() => validateOutputSchema(limits?.outputSchema)).not.toThrow();
    const schema = limits?.outputSchema as {
      properties: {
        batchId: { const: string };
        edits: {
          minItems: number;
          maxItems: number;
          items: { anyOf: Array<{ properties: { id: { enum: string[] }; text?: { maxLength: number } } }> };
        };
      };
    };
    expect(schema.properties.batchId.const).toBe(batch.batchId);
    expect(schema.properties.edits.minItems).toBe(batch.slots.length);
    expect(schema.properties.edits.maxItems).toBe(batch.slots.length);
    const replace = schema.properties.edits.items.anyOf.find((item) => item.properties.text);
    expect(replace?.properties.id.enum).toEqual(batch.slots.map(({ id }) => id));
    expect(replace?.properties.text?.maxLength).toBe(2 * new TextEncoder().encode(batch.slots[0].text).byteLength + 64);
    expect(systemPrompt).toContain("contextBefore/contextAfter 是受限只读相邻语境");
    expect(systemPrompt).toContain("未改变时只回传 id 和 status");
  });

  it("publishes the complete plan synchronously before the first invocation and stops if publication fails", async () => {
    const events: string[] = [];
    const invoke = vi.fn(async (prompt: string) => {
      events.push("invoke");
      return outputFor(prompt, (text) => text);
    });
    const result = await runProseEditTask(request("普通正文错字。"), execution(invoke), {
      onPlan: (plan) => events.push(`plan:${plan.sourceHash}:${plan.batches.length}`)
    });

    expect(events[0]).toMatch(/^plan:/);
    expect(events[1]).toBe("invoke");
    expect(result.stats.batches).toBeGreaterThan(0);

    const blockedInvoke = vi.fn(async () => "unexpected");
    await expect(runProseEditTask(request("普通正文错字。"), execution(blockedInvoke), {
      onPlan: () => { throw new Error("plan artifact write failed"); }
    })).rejects.toThrow("plan artifact write failed");
    expect(blockedInvoke).not.toHaveBeenCalled();
  });

  it("keeps rich Markdown, numeric facts, icons and original CRLF bytes fixed while editing prose slots", async () => {
    const source = [
      "---\r\ntitle: Stable\r\n---\r\n",
      "# 标题 ✨\r\n\r\n",
      "普通正文错字，日期 2026-10-23、版本 8GB 与图标 ✨ 固定。**强调错字**，`代码` 和 [链接](https://example.test)。\r\n\r\n",
      "| 项目 | 数量 |\r\n| --- | ---: |\r\n| Alpha | 42 |\r\n\r\n",
      "```ts\r\nconst answer = 42;\r\n```\r\n\r\n",
      "公式 $x+y$ 与脚注[^note] 固定。\r\n\r\n",
      "<b>HTML 标签和内容原样保留</b>。\r\n\r\n",
      "[^note]: 脚注定义原样保留。\r\n"
    ].join("");
    const invoke = vi.fn(async (prompt: string) => outputFor(prompt, (text) => text.replaceAll("错字", "正字")));

    const result = await runProseEditTask(request(source), execution(invoke));

    expect(result.text).toBe(source.replaceAll("错字", "正字"));
    expect(result.text).toContain("2026-10-23、版本 8GB 与图标 ✨");
    expect(result.text).toContain("| Alpha | 42 |");
    expect(result.text).toContain("const answer = 42;");
    expect(result.text).toContain("$x+y$");
    expect(result.text).toContain("[^note]");
    expect(result.text).toContain("<b>HTML 标签和内容原样保留</b>");
    expect(result.text).toContain("\r\n");
    const sentSlots = invoke.mock.calls.flatMap(([prompt]) => readBatch(prompt).slots.map(({ text }) => text));
    expect(sentSlots).toContain("普通正文错字，日期 2026-10-23、版本 8GB 与图标 ✨ 固定。");
    expect(sentSlots).toContain("**强调错字**，`代码` 和 [链接](https://example.test)。");
    expect(sentSlots).toContain("公式 $x+y$ 与脚注[^note] 固定。");
  });

  it("accepts explicit unchanged receipts and preserves their exact source bytes", async () => {
    const source = "保留原样\r\n\r\n无需改动。\r\n";
    const invoke = vi.fn(async (prompt: string, _system: string, _maxTokens: number) => {
      const batch = readBatch(prompt);
      return JSON.stringify({
        protocol: "prose-edit/v1",
        batchId: batch.batchId,
        edits: batch.slots.map(({ id }) => ({ id, status: "unchanged" }))
      });
    });

    const result = await runProseEditTask(request(source), execution(invoke));

    expect(result.text).toBe(source);
    expect(result.preservedSource).toBe(true);
  });

  it.each(malformedReceipts)("rejects %s without retrying or producing a partial candidate", async (_label, receipts) => {
    const invoke = vi.fn(async (prompt: string) => {
      const batch = readBatch(prompt);
      return JSON.stringify({ protocol: "prose-edit/v1", batchId: batch.batchId, edits: receipts(batch) });
    });

    await expect(runProseEditTask(request("一段正文错字。"), execution(invoke))).rejects.toThrow();
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("rejects an invalid protocol or batch identity on the first response without repair", async () => {
    const invoke = vi.fn(async (prompt: string) => {
      const batch = readBatch(prompt);
      return JSON.stringify({ protocol: "wrong/v1", batchId: `${batch.batchId}-stale`, edits: [] });
    });

    await expect(runProseEditTask(request("普通正文"), execution(invoke))).rejects.toThrow();
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("rejects newline expansion and text beyond the per-slot expansion bound", async () => {
    const source = "正文槽";
    const newline = vi.fn(async (prompt: string) => outputFor(prompt, (text) => `${text}\n新段`));
    await expect(runProseEditTask(request(source), execution(newline))).rejects.toThrow();
    expect(newline).toHaveBeenCalledTimes(1);

    const expanded = vi.fn(async (prompt: string) => outputFor(prompt, () => "扩张".repeat(200)));
    await expect(runProseEditTask(request(source), execution(expanded))).rejects.toThrow();
    expect(expanded).toHaveBeenCalledTimes(1);
  });

  it("rejects an oversized reconstructed candidate before validating or exposing it", async () => {
    const source = `\`\`\`text\n${"x".repeat(1024 * 1024 - 80)}\n\`\`\`\n\n错字`;
    const invoke = vi.fn(async (prompt: string) => outputFor(prompt, () => "a".repeat(76)));

    await expect(runProseEditTask(request(source), execution(invoke))).rejects.toThrow(/候选文档超过 1 MiB/);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("runs the mandatory full-document AST gate and rejects newly introduced Markdown topology", async () => {
    const invoke = vi.fn(async (prompt: string) => outputFor(prompt, () => "# 新标题"));

    await expect(runProseEditTask(request("普通正文"), execution(invoke))).rejects.toThrow(/AST|标题|结构/);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["雾港项目暂未确定模型品牌。错别字。", "蓝海项目已确定 TinyBERT 模型品牌。正字。"],
    ["恢复演练尚未完成。", "恢复演练已经完成。"],
    ["内容已完成。", "内容没完成。"],
    ["检查结论为通过。", "检查结论为失败。"],
    ["普通正文错字。", "普通正文正字，计划于2027年发布。"],
    ["由林安负责部署检查。", "由王敏负责部署检查。"],
    ["普通正文错字。", "普通正文正字，并采用 $x+y$ 公式。"],
    ["普通正文错字。", "普通正文正字，并采用 \\\\$x+y\\\\$ 公式。"],
    ["普通正文错字。", "普通正文正字，参考脚注[^added]。"]
  ])("rejects new factual anchors or rich syntax in conservative prose: %s", async (source, replacement) => {
    const invoke = vi.fn(async (prompt: string) => outputFor(prompt, () => replacement));
    await expect(runProseEditTask(request(source), execution(invoke))).rejects.toThrow(/事实|公式|脚注|结构/);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("allows ordinary spelling correction without treating every English word as an immutable entity", async () => {
    const source = "The quick fox is teh example. 这以经完成。";
    const invoke = vi.fn(async (prompt: string) => outputFor(prompt, (text) => text.replace("teh", "the").replace("以经", "已经")));
    const result = await runProseEditTask(request(source), execution(invoke));
    expect(result.text).toBe("The quick fox is the example. 这已经完成。");
  });

  it("checks factual identities across fixed inline Markdown boundaries", async () => {
    const invoke = vi.fn(async (prompt: string) => outputFor(prompt, text => text.replace("雾港", "蓝海")));
    await expect(runProseEditTask(request("**雾港**项目尚未发布。"), execution(invoke))).rejects.toThrow(/事实/);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("preflights the complete batch count against shared remaining calls before the first invocation", async () => {
    const source = Array.from({ length: 20 }, (_, index) =>
      `第${index}段${"正文错字，保持原意。".repeat(8)}`
    ).join("\n\n");
    const invoke = vi.fn(async (prompt: string) => outputFor(prompt, (text) => text));
    const tight = request(source, { providerBudget: { contextLimit: 1500, maxOutputTokens: 512 } });

    await expect(runProseEditTask(tight, execution(invoke, 1))).rejects.toThrow(/预算|批次|分组|调用/);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("stops on cancellation between batches and never returns already staged edits", async () => {
    let current = true;
    const invoke = vi.fn(async (prompt: string, _system: string, _maxTokens: number) => {
      const reply = outputFor(prompt, (text) => text.replaceAll("错字", "正字"));
      current = false;
      return reply;
    });
    const taskExecution = createAiTaskExecution({
      invoke: (prompt, system, maxTokens) => invoke(prompt, system, maxTokens),
      isCurrent: () => current,
      abortCurrent: vi.fn(),
      maxCalls: 64
    });

    const source = Array.from({ length: 20 }, (_, index) => `第${index}段正文错字。`).join("\n\n");
    await expect(runProseEditTask(
      request(source, { providerBudget: { contextLimit: 900, maxOutputTokens: 256 } }), taskExecution
    )).rejects.toBeInstanceOf(AiTaskCancelledError);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("returns the exact source without a model call when only headings and block structures are present", async () => {
    const source = "# 标题 ✨\n\n```ts\nconst answer = 42;\n```\n\n$$\nx+y\n$$";
    const invoke = vi.fn(async () => "unexpected");

    const result = await runProseEditTask(request(source), execution(invoke));

    expect(invoke).not.toHaveBeenCalled();
    expect(result.text).toBe(source);
    expect(result.preservedSource).toBe(true);
  });
});
