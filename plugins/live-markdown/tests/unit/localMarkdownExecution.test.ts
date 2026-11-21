import { describe, expect, it, vi } from "vitest";
import { buildAiTaskRequest } from "../../src/core/ai/aiTaskRequest";
import { runAiTask } from "../../src/core/ai/aiTaskRunner";
import { TYPORA_QUICKSTART_MARKDOWN } from "../../src/core/sampleDocs";

const marker = "【待编辑 Markdown】\n";
const request = (source: string, action: "proofread" | "polish" = "proofread") => buildAiTaskRequest({
  source, selected: false, action,
  config: { provider: "local", activeRoleId: "general", customSystemPrompt: "" }
});
const options = (transform: (text: string) => string) => {
  const invoke = vi.fn(async (prompt: string, _system: string, _tokens: number, _chunk: unknown, schema?: unknown) => {
    expect(schema).toBeUndefined();
    expect(prompt).toContain(marker);
    return transform(prompt.slice(prompt.indexOf(marker) + marker.length));
  });
  return { invoke, isCurrent: () => true, abortCurrent: vi.fn() };
};

describe("local natural Markdown production path", () => {
  it("corrects two typos in rich Markdown without asking the model for receipts", async () => {
    const source = TYPORA_QUICKSTART_MARKDOWN.replace("为你提供", "为你提拱").replace("支持**文件树", "支恃**文件树");
    const provider = options(text => text.replace("为你提拱", "为你提供").replace("支恃**文件树", "支持**文件树"));
    const result = await runAiTask(request(source), provider);
    expect(result.text).toBe(TYPORA_QUICKSTART_MARKDOWN);
    expect(result.sourceOwned).toBe(true);
    expect(result.proseStats?.modelCalls).toBe(provider.invoke.mock.calls.length);
    expect(result.warnings).toEqual([]);
  });

  it.each([
    ["容量 8GB 可用。", "8GB", "8MB", /事实|原子/],
    ["代码 `stable` 保持。", "stable", "changed", /代码/],
    ["文稿完整。", "文稿完整。", "```ts\nunfinished", /代码块|Markdown/]
  ] as const)("rejects bad output once and keeps the original transaction private: %s", async (source, before, after, error) => {
    const provider = options(text => text.replace(before, after));
    await expect(runAiTask(request(source), provider)).rejects.toThrow(error);
    expect(provider.invoke).toHaveBeenCalledTimes(1);
  });

  it("exposes emphasis changes for Diff review without weakening literal payload protection", async () => {
    const provider = options(text => text.replace("**正文**", "正文"));
    const result = await runAiTask(request("**正文**清楚。", "polish"), provider);
    expect(result.text).toBe("正文清楚。");
    expect(result.warnings.join(" ")).toMatch(/强调|格式/);
  });

  it.each(['{"示例":"文本"}', "以下是：原文介绍。"])("accepts unchanged source data that resembles a response wrapper: %s", async source => {
    const result = await runAiTask(request(source), options(text => text));
    expect(result.text).toBe(source);
    expect(result.preservedSource).toBe(true);
  });

  it("can correct original introductory wording without mistaking it for an added response preface", async () => {
    const result = await runAiTask(request("以下是：为你提拱的示例。"), options(text => text.replace("提拱", "提供")));
    expect(result.text).toBe("以下是：为你提供的示例。");
  });
});
