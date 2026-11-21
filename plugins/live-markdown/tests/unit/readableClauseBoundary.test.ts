import { describe, expect, it, vi } from "vitest";
import { createReadonlyCommaBoundary, restoreReadonlyCommaBoundary } from "../../src/core/ai/readableClauseBoundary";
import { createAiTaskExecution } from "../../src/core/ai/aiTaskExecution";
import { runThinProseTask } from "../../src/core/ai/thinProseTask";
import type { AiTaskRunnerOptions } from "../../src/core/ai/aiTaskRunner";

const source = "由周岚负责的验收日期是2027-01-09，请请相关同事再次进行核对。";
const commaAt = source.indexOf("，");
const window = { from: 0, to: commaAt };
const separator = { from: commaAt, to: commaAt + 1 };

describe("source-owned internal clause comma", () => {
  it("removes only one newly-added Chinese terminal period before the frozen literal comma", () => {
    const boundary = createReadonlyCommaBoundary(source, window, separator)!;
    expect(boundary).toBeDefined();
    const fragment = source.slice(0, commaAt).replace("日期是", "日期为");
    expect(restoreReadonlyCommaBoundary(source, boundary, `${fragment}。`)).toBe(fragment);
    expect(restoreReadonlyCommaBoundary(source, boundary, `${fragment}。  `)).toBe(`${fragment}  `);
    expect(source[commaAt]).toBe("，");
  });

  it("preserves already-correct output and requires the exact source/window/separator identity", () => {
    const boundary = createReadonlyCommaBoundary(source, window, separator)!;
    const raw = source.slice(0, commaAt);
    expect(restoreReadonlyCommaBoundary(source, boundary, raw)).toBe(raw);
    expect(restoreReadonlyCommaBoundary(source.replace("周岚", "陈越"), boundary, `${raw}。`)).toBe(`${raw}。`);
    expect(createReadonlyCommaBoundary(source, window, { from: commaAt + 1, to: commaAt + 2 })).toBeUndefined();
    expect(createReadonlyCommaBoundary(source, { from: -1, to: commaAt }, separator)).toBeUndefined();
    expect(createReadonlyCommaBoundary(source, { from: 0, to: source.length }, separator)).toBeUndefined();
    expect(restoreReadonlyCommaBoundary(source, undefined, `${raw}。`)).toBe(`${raw}。`);
  });

  it.each(["，", ".", "!", "?", "！？", "。。", "。\n", "。\t"])("does not broadly strip the suffix %j", suffix => {
    const boundary = createReadonlyCommaBoundary(source, window, separator)!;
    const raw = `${source.slice(0, commaAt)}${suffix}`;
    expect(restoreReadonlyCommaBoundary(source, boundary, raw)).toBe(raw);
  });

  it("keeps a source terminal period and refuses to normalize a different separator", () => {
    const document = "正文。，后文。";
    expect(createReadonlyCommaBoundary(document, { from: 0, to: 3 }, { from: 3, to: 4 })).toBeUndefined();
    const semicolon = source.replace("，", "；");
    expect(createReadonlyCommaBoundary(semicolon, window, separator)).toBeUndefined();
  });
});

describe("routine style repair through the real prose pipeline", () => {
  const instruction = "润色正文使其简洁，不改变日期和负责人。";
  function optionsFor(responses: string[]) {
    const invoke = vi.fn<AiTaskRunnerOptions["invoke"]>(async () => {
      const response = responses.shift();
      if (response === undefined) throw new Error("unexpected additional inference");
      return response;
    });
    const options: AiTaskRunnerOptions = { invoke, isCurrent: () => true, abortCurrent: vi.fn(), maxCalls: 2 };
    return { invoke, options, execution: createAiTaskExecution(options) };
  }

  it("continues after a model's internal period, repairs an unchanged request marker, and preserves facts and source", async () => {
    const replies = [source.slice(0, commaAt).replace("日期是", "日期为") + "。", source.slice(commaAt + 1)];
    const h = optionsFor(replies);
    const result = await runThinProseTask({ source, instruction, systemPrompt: "", preferReadable: true,
      task: "polish" }, h.execution, h.options);
    expect(result.text).toBe(source.replace("日期是", "日期为").replace("请请", "请"));
    expect(result.text).not.toContain("。，");
    expect(h.invoke).toHaveBeenCalledTimes(2);
    expect(h.execution.remainingCalls).toBe(0);
    expect(source).toContain("2027-01-09，请请");
  });

  it("still rejects a changed date after the same boundary recovery", async () => {
    const h = optionsFor([source.slice(0, commaAt).replace("2027-01-09", "2027-01-10") + "。", source.slice(commaAt + 1)]);
    await expect(runThinProseTask({ source, instruction, systemPrompt: "", preferReadable: true,
      task: "polish" }, h.execution, h.options)).rejects.toThrow(/日期|事实/u);
    expect(h.invoke).toHaveBeenCalledTimes(1);
  });

  it("does not run routine repairs for an absent task or an explicit preservation conflict", async () => {
    for (const config of [{ instruction, task: undefined }, { instruction: "润色正文，但保留重复用词原样。", task: "polish" as const }]) {
      const h = optionsFor([source.slice(0, commaAt), source.slice(commaAt + 1)]);
      const result = await runThinProseTask({ source, ...config, systemPrompt: "", preferReadable: true }, h.execution, h.options);
      expect(result.text).toBe(source);
      expect(h.invoke).toHaveBeenCalledTimes(2);
    }
  });
});
