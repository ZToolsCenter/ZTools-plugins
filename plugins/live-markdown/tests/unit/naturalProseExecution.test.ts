import { describe, expect, it, vi } from "vitest";
import type { AiInvocationLimits } from "../../src/core/ai/aiTaskExecution";
import { createAiTaskExecution } from "../../src/core/ai/aiTaskExecution";
import { buildNaturalProseEditPlan, NATURAL_PROSE_MARKER, type NaturalProseEditRequest } from "../../src/core/ai/naturalProsePlan";
import { runNaturalProseEditTask } from "../../src/core/ai/naturalProseExecution";
import { buildProseEditSourcePlan } from "../../src/core/ai/proseEditPlan";

function request(source: string, extra: Partial<NaturalProseEditRequest> = {}): NaturalProseEditRequest {
  return {
    source,
    instruction: "校对错字并保持原意",
    systemPrompt: "按用户要求编辑正文。",
    revision: "revision-1",
    providerBudget: { contextLimit: 4096, maxOutputTokens: 2048 },
    ...extra
  };
}

function execution(
  invoke: (prompt: string, system: string, maxTokens: number, limits?: AiInvocationLimits) => Promise<string>,
  maxCalls = 64,
  current: () => boolean = () => true
) {
  return createAiTaskExecution({
    invoke: (prompt, system, maxTokens, _onChunk, outputSchema) => invoke(prompt, system, maxTokens, { outputSchema }),
    isCurrent: current,
    abortCurrent: vi.fn(),
    maxCalls
  });
}

function rawFragment(prompt: string): string {
  const marker = prompt.lastIndexOf(NATURAL_PROSE_MARKER);
  if (marker < 0) throw new Error("natural Markdown marker missing");
  return prompt.slice(marker + NATURAL_PROSE_MARKER.length);
}

describe("natural Markdown prose execution", () => {
  it("sends contiguous natural Markdown directly, without JSON receipts or schema", async () => {
    const source = "第一句错字。第二句错字。";
    let limits: AiInvocationLimits | undefined;
    const invoke = vi.fn(async (prompt: string, _system: string, _tokens: number, received?: AiInvocationLimits) => {
      limits = received;
      return rawFragment(prompt).replaceAll("错字", "正字");
    });

    const plan = buildNaturalProseEditPlan(request(source), 4);
    const result = await runNaturalProseEditTask(request(source), execution(invoke));

    expect(plan.batches).toHaveLength(1);
    expect(plan.batches[0].sourceText).toBe(source);
    expect(plan.batches[0].range).toEqual({ from: 0, to: source.length });
    expect(result.text).toBe("第一句正字。第二句正字。");
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(limits?.outputSchema).toBeUndefined();
    expect(invoke.mock.calls[0][0]).not.toContain('"protocol"');
    expect(invoke.mock.calls[0][0].endsWith(`${NATURAL_PROSE_MARKER}${source}`)).toBe(true);
    expect(invoke.mock.calls[0][2]).toBeLessThanOrEqual(2048);
  });

  it("preserves rich inline literals, line-ending bytes, and protected Markdown outside owned ranges", async () => {
    const source = [
      "普通错字，日期 2026-10-25、重量 3 kg、图标 ✨，`const x = 42`、[站点](https://example.test/a) 与公式 $x^2$，状态为验收未通过[^note]。\r\n\r\n",
      "```ts\r\nconst stable = 42;\r\n```\r\n\r\n",
      "| 字段 | 数值 |\r\n| --- | ---: |\r\n| 版本 | 42 |\r\n\r\n",
      "[^note]: 脚注定义保持原样。\r\n\r\n",
      "另一处错字。\r\n"
    ].join("");
    const invoke = vi.fn(async (prompt: string) => rawFragment(prompt).replaceAll("错字", "正字"));

    const result = await runNaturalProseEditTask(request(source), execution(invoke));

    expect(result.text).toBe(source.replaceAll("错字", "正字"));
    expect(result.text).toContain("2026-10-25、重量 3 kg、图标 ✨");
    expect(result.text).toContain("`const x = 42`");
    expect(result.text).toContain("[站点](https://example.test/a)");
    expect(result.text).toContain("$x^2$");
    expect(result.text).toContain("const stable = 42;");
    expect(result.text).toContain("| 版本 | 42 |");
    expect(result.text).toContain("[^note]: 脚注定义保持原样。");
    expect(result.text).toContain("验收未通过[^note]");
    expect(result.text.match(/\r\n/gu)?.length).toBe(source.match(/\r\n/gu)?.length);
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("does not merge across protected blocks and retains their original gap bytes", () => {
    const source = "第一处错字。\n\n```ts\nconst keep = true;\n```\n\n第二处错字。";
    const plan = buildNaturalProseEditPlan(request(source), 8);

    expect(plan.batches).toHaveLength(2);
    expect(plan.batches[0].sourceText).toBe("第一处错字。");
    expect(plan.batches[1].sourceText).toBe("第二处错字。");
    expect(plan.batches[0].range.to).toBeLessThan(plan.batches[1].range.from);
  });

  it("keeps standalone TOC control lines source-owned while editing nearby prose", async () => {
    const source = "[TOC]\n正文有错字。\n[[toc]]\n[toc]12 是普通文字错字。";
    const sourcePlan = buildProseEditSourcePlan(request(source));
    const plan = buildNaturalProseEditPlan(request(source), 8);
    const invoke = vi.fn(async (prompt: string) => rawFragment(prompt).replaceAll("错字", "正字"));

    const result = await runNaturalProseEditTask(request(source), execution(invoke));

    expect(sourcePlan.slots.map(({ sourceText }) => sourceText)).not.toContain("[TOC]");
    expect(sourcePlan.slots.map(({ sourceText }) => sourceText)).not.toContain("[[toc]]");
    expect(sourcePlan.slots.some(({ sourceText }) => sourceText.includes("[toc]12"))).toBe(true);
    expect(plan.batches.every(({ sourceText }) => !/^\s*(?:\[TOC\]|\[\[TOC\]\])\s*$/imu.test(sourceText))).toBe(true);
    expect(result.text).toBe("[TOC]\n正文有正字。\n[[toc]]\n[toc]12 是普通文字正字。");
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("splits long prose only at complete sentence boundaries within 4096/2048 budgets", async () => {
    const source = Array.from({ length: 30 }, (_, index) =>
      `第 ${index + 1} 句错字${"甲".repeat(80)}。`
    ).join("");
    const plan = buildNaturalProseEditPlan(request(source), 8);
    const invoke = vi.fn(async (prompt: string) => rawFragment(prompt).replaceAll("错字", "正字"));

    const result = await runNaturalProseEditTask(request(source), execution(invoke, 8));

    expect(plan.batches.length).toBeGreaterThan(1);
    expect(plan.batches.every((batch) => batch.sourceText.endsWith("。"))).toBe(true);
    expect(plan.batches.every((batch) => batch.maxTokens <= 2048 && batch.contextTokens <= 4096)).toBe(true);
    expect(result.text).toBe(source.replaceAll("错字", "正字"));
    expect(invoke).toHaveBeenCalledTimes(plan.batches.length);
  });

  it("includes an in-scope list or quote prefix so the model sees complete Markdown structure", () => {
    const list = buildNaturalProseEditPlan(request("- 列表错字。\n- 第二项错字。"), 8);
    const quoted = buildNaturalProseEditPlan(request("> 引用错字。"), 8);

    expect(list.batches[0].sourceText).toBe("- 列表错字。\n- 第二项错字。");
    expect(list.batches[0].range.from).toBe(0);
    expect(quoted.batches[0].sourceText).toBe("> 引用错字。");
    expect(quoted.batches[0].range.from).toBe(0);
  });

  it("never widens a selection to include a Markdown list prefix", () => {
    const source = "- 列表错字。";
    const from = source.indexOf("列");
    const plan = buildNaturalProseEditPlan(request(source, { scope: { from, to: source.length } }), 8);

    expect(plan.batches[0].range.from).toBe(from);
    expect(plan.batches[0].sourceText).toBe("列表错字。");
  });

  it("preflights call count, output and context budgets before invoking the model", async () => {
    const invoke = vi.fn(async () => "unexpected");
    await expect(runNaturalProseEditTask(request("第一句错字。第二句错字。"), execution(invoke, 0))).rejects.toThrow(/调用预算/);
    expect(() => buildNaturalProseEditPlan(request("很长的单句错字。", {
      providerBudget: { contextLimit: 200, maxOutputTokens: 2048 }
    }), 8)).toThrow(/预算|上下文/);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("rejects more than 50 complete groups before starting any inference", async () => {
    const source = Array.from({ length: 51 }, (_, index) =>
      `第 ${index + 1} 处错字。\n\n\`\`\`text\n保护块 ${index + 1}\n\`\`\`\n\n`
    ).join("");

    expect(() => buildNaturalProseEditPlan(request(source), 64)).toThrow(/50 组/);
  });

  it("bounds oversized model output and reports a permitted inline emphasis change", async () => {
    const oversized = vi.fn(async () => "x".repeat(1000));
    await expect(runNaturalProseEditTask(request("一个错字。"), execution(oversized))).rejects.toThrow(/输出超过|上限/);
    expect(oversized).toHaveBeenCalledTimes(1);

    const source = "我门在 **重点内容** 中工作。";
    const emphasis = vi.fn(async (prompt: string) => rawFragment(prompt).replace("我门", "我们").replaceAll("**", ""));
    const result = await runNaturalProseEditTask(request(source), execution(emphasis));
    expect(result.text).toBe("我们在 重点内容 中工作。");
    expect(result.warnings).toContain("已调整行内强调格式，请在 Diff 中确认。");
  });

  it("rejects long ordinary prose below 50 percent coverage but does not impose that ratio on short edits", async () => {
    const code = `\`${"KEEP-CODE ".repeat(100)}\``;
    const source = `${"这是一段可编辑的普通正文内容。".repeat(16)} ${code} [链接](https://example.test/a) $x^2$。`;
    const output = vi.fn(async () => `。 ${code} [链接](https://example.test/a) $x^2$。`);
    await expect(runNaturalProseEditTask(request(source), execution(output))).rejects.toThrow(/缩短|覆盖|遗漏/);
    expect(output).toHaveBeenCalledTimes(1);

    const separated = Array.from({ length: 20 }, () =>
      `这是错字句。\n\n\`\`\`text\nprotected\n\`\`\`\n\n`
    ).join("");
    const shortenedChunks = vi.fn(async () => "。");
    await expect(runNaturalProseEditTask(request(separated), execution(shortenedChunks))).rejects.toThrow(/缩短|覆盖|遗漏/);
    expect(shortenedChunks).toHaveBeenCalledTimes(20);

    const short = vi.fn(async (prompt: string) => rawFragment(prompt).replace("错字", "正字"));
    const result = await runNaturalProseEditTask(request("一个错字。"), execution(short));
    expect(result.text).toBe("一个正字。");
  });

  it("does not expose a candidate that would push the assembled document past 1 MiB", async () => {
    const protectedPrefix = `\`\`\`text\n${"x".repeat(1_048_500)}\n\`\`\`\n\n`;
    const source = `${protectedPrefix}一个错字。`;
    const invoke = vi.fn(async (prompt: string) => rawFragment(prompt).replace("错字", "新内容".repeat(8)));

    await expect(runNaturalProseEditTask(request(source), execution(invoke))).rejects.toThrow(/候选文档超过 1 MiB/);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("rejects explanatory output and newline changes on the first response without retry", async () => {
    const source = "第一行错字。\r\n第二行错字。";
    const explanatory = vi.fn(async () => "修改如下：\n第一行正字。\n第二行正字。");
    await expect(runNaturalProseEditTask(request(source), execution(explanatory))).rejects.toThrow(/Markdown|输出|换行/);
    expect(explanatory).toHaveBeenCalledTimes(1);

    const normalized = vi.fn(async (prompt: string) => rawFragment(prompt).replaceAll("\r\n", "\n"));
    await expect(runNaturalProseEditTask(request(source), execution(normalized))).rejects.toThrow(/换行/);
    expect(normalized).toHaveBeenCalledTimes(1);

    const receipt = vi.fn(async () => JSON.stringify({ protocol: "prose-edit/v1", edits: [] }));
    await expect(runNaturalProseEditTask(request("正文错字。"), execution(receipt))).rejects.toThrow(/JSON/);
    expect(receipt).toHaveBeenCalledTimes(1);
  });

  it("rejects dropped source prose and malformed Markdown atomically", async () => {
    const source = "第一段错字。\n\n第二段错字。";
    const omission = vi.fn(async (prompt: string) => rawFragment(prompt).replace("第二段错字。", ""));
    await expect(runNaturalProseEditTask(request(source), execution(omission))).rejects.toThrow(/遗漏|段落|结构|AST/);
    expect(omission).toHaveBeenCalledTimes(1);

    const malformed = vi.fn(async () => "**未闭合的 Markdown");
    await expect(runNaturalProseEditTask(request("一个错字。"), execution(malformed))).rejects.toThrow();
    expect(malformed).toHaveBeenCalledTimes(1);
  });

  it("stages all ranges privately, preserves source gaps and checks snapshot between calls", async () => {
    const source = "第一段错字。\n\n```text\nprotected\n```\n\n第二段错字。";
    const invoke = vi.fn(async (prompt: string) => rawFragment(prompt).replaceAll("错字", "正字"));
    const result = await runNaturalProseEditTask(request(source), execution(invoke));
    expect(result.text).toBe(source.replaceAll("错字", "正字"));
    expect(result.text).toContain("\n\n```text\nprotected\n```\n\n");

    let calls = 0;
    const staleInvoke = vi.fn(async (prompt: string) => {
      calls += 1;
      return rawFragment(prompt).replaceAll("错字", "正字");
    });
    await expect(runNaturalProseEditTask(request(source), execution(staleInvoke, 8, () => calls < 1), {
      isSnapshotCurrent: () => calls < 1
    })).rejects.toThrow(/版本|取消|已变化/);
    expect(staleInvoke).toHaveBeenCalledTimes(1);
  });

  it("accepts only a complete outer markdown fence and never repairs partial fences", async () => {
    const source = "一个错字。";
    const fenced = vi.fn(async (prompt: string) => `\`\`\`markdown\n${rawFragment(prompt).replace("错字", "正字")}\n\`\`\``);
    const result = await runNaturalProseEditTask(request(source), execution(fenced));
    expect(result.text).toBe("一个正字。");

    const unclosed = vi.fn(async () => "```markdown\n未闭合");
    await expect(runNaturalProseEditTask(request(source), execution(unclosed))).rejects.toThrow();
    expect(unclosed).toHaveBeenCalledTimes(1);
  });
});
