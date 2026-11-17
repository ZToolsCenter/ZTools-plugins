import { describe, expect, it } from "vitest";
import { calculateLocalAiBudget } from "../../src/core/ai/requestBudget";

describe("local AI request budget", () => {
  it("accounts for input, system prompt, output reserve, and framing", () => {
    const budget = calculateLocalAiBudget("你好", "system", 1024);
    expect(budget.maxTokens).toBe(1024);
    expect(budget.contextTokens).toBeLessThanOrEqual(4096);
  });

  it("rejects context requests above the 4k safety ceiling", () => {
    expect(() => calculateLocalAiBudget("字".repeat(4000), "role", 1024)).toThrow("4096 token 上下文预算");
  });

  it("keeps the real 4k ceiling even if a caller asks for a larger context", () => {
    expect(() => calculateLocalAiBudget("字".repeat(2600), "role", 512, 8192)).toThrow("4096 token 上下文预算");
  });

  it("rejects output budgets beyond the service limit", () => {
    expect(() => calculateLocalAiBudget("prompt", "system", 2049)).toThrow("1–2048");
  });
});
