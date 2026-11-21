import { expect, it, vi } from "vitest";
import { createAiTaskExecution } from "../../src/core/ai/aiTaskExecution";

it("rejects aggregate output across individually valid subrequests", async () => {
  const raw = "a".repeat(800_000);
  const invoke = vi.fn(async () => raw);
  const execution = createAiTaskExecution({ invoke, isCurrent: () => true, abortCurrent() {} });
  await execution.invoke("first", "system", 1024);
  await execution.invoke("second", "system", 1024);
  await expect(execution.invoke("third", "system", 1024)).rejects.toThrow(/上限/);
  await expect(execution.invoke("fourth", "system", 1024)).rejects.toThrow(/累计输出/);
  expect(invoke).toHaveBeenCalledTimes(3);
});

it("counts streaming and returned bytes only once against the task budget", async () => {
  const raw = "b".repeat(800_000);
  const execution = createAiTaskExecution({
    invoke: async (_prompt, _system, _tokens, chunk) => { chunk(raw); return raw; },
    isCurrent: () => true, abortCurrent() {}
  });
  await execution.invoke("first", "system", 1024);
  await expect(execution.invoke("second", "system", 1024)).resolves.toBe(raw);
});
