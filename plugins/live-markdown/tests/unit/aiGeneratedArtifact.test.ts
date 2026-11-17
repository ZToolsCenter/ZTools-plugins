import { describe, expect, it } from "vitest";
import { runAiTask, type AiTaskRequest } from "../../src/core/ai/aiTaskRunner";
import { validateTaskCandidate } from "../../src/core/ai/aiOutputContract";

const body = "```python\ndef add(a, b):\n    return a + b\n```";
const wrapped = "````markdown\n" + body + "\n````";
function request(instruction = "在文末生成函数，使用 python 代码围栏"): AiTaskRequest {
  return {
    source: "需要函数 add，参数 a 和 b，返回两者之和。", action: "custom", userPrompt: instruction,
    baseSystemPrompt: "只生成要求的内容。", actionDefinition: { id: "custom", label: "生成", prompt: instruction },
    intentPlanned: true, readOnlyTask: true
  };
}
const options = (raw: string) => ({ invoke: async () => raw, isCurrent: () => true, abortCurrent() {} });

describe("generated artifact validation through the task runner", () => {
  it("decodes one complete Markdown response envelope before checking nested code completeness", async () => {
    const result = await runAiTask(request(), options(wrapped));
    expect(result.text).toBe(body);
  });
  it("preserves a requested source envelope rather than treating it as rendered content", async () => {
    const result = await runAiTask(request("展示 Markdown 源码，使用 python 代码围栏"), options(wrapped));
    expect(result.text).toBe(wrapped);
  });
  it("does not discard an unknown tail to salvage an incomplete response", async () => {
    await expect(runAiTask(request(), options(wrapped + "\n额外的未知尾部"))).rejects.toThrow();
  });
  it("rejects ambiguous equal-length outer and inner fences", async () => {
    const malformed = "```markdown\n" + body + "\n```";
    await expect(runAiTask(request(), options(malformed))).rejects.toThrow();
  });
  it("rejects a second wrapper instead of repeatedly cleaning a response", () => {
    const twice = "`````markdown\n" + wrapped + "\n`````";
    expect(() => validateTaskCandidate({ mode: "fragment", format: "code", source: "", instruction: "生成 Python 代码", raw: twice })).toThrow();
  });
  it("does not decode a literal payload", () => {
    expect(validateTaskCandidate({ mode: "literal", format: "code", source: "", instruction: "原样插入", raw: wrapped, literalSource: wrapped }).text).toBe(wrapped);
  });
});
