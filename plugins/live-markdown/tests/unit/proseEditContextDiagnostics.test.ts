import { describe, expect, it, vi } from "vitest";
import { createAiTaskExecution } from "../../src/core/ai/aiTaskExecution";
import { runProseEditTask, type ProseEditRequest } from "../../src/core/ai/proseEditExecution";
import { proseResponse } from "../helpers/proseResponses";

const request = (source: string): ProseEditRequest => ({
  source, instruction: "校对文字并保持原意", systemPrompt: "只编辑普通正文",
  providerBudget: { contextLimit: 4096, maxOutputTokens: 2048 }
});

function provider(transform: (text: string) => string) {
  const invoke = vi.fn(async (prompt: string) => proseResponse(prompt, transform));
  const execution = createAiTaskExecution({ invoke, isCurrent: () => true, abortCurrent: vi.fn() });
  return { invoke, execution };
}

describe("prose context and failure diagnostics", () => {
  it("corrects a task-list sentence while retaining its checkbox state", async () => {
    const { invoke, execution } = provider(text => text.replace("我门", "我们"));
    const result = await runProseEditTask(request("- [ ] 我门处理文稿。"), execution);
    expect(result.text).toBe("- [ ] 我们处理文稿。");
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("corrects a soft-wrapped sentence while retaining its CRLF bytes", async () => {
    const source = "第一行我门处理\r\n第二行继续校对。";
    const { invoke, execution } = provider(text => text.replace("我门", "我们"));
    const result = await runProseEditTask(request(source), execution);
    expect(result.text).toBe("第一行我们处理\r\n第二行继续校对。");
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("rejects removal or conversion of the original soft newline", async () => {
    for (const newline of [" ", "\n"]) {
      const { invoke, execution } = provider(text => text.replace("\r\n", newline));
      await expect(runProseEditTask(request("第一行我门处理\r\n第二行继续校对。"), execution)).rejects.toThrow(/换行/);
      expect(invoke).toHaveBeenCalledTimes(1);
    }
  });

  it("uses fixed inline context when allowing an equivalent instrumental phrase", async () => {
    const source = "说明，可通过`Ctrl+K`打开面板。";
    const { invoke, execution } = provider(text => text.replace("可通过", "可使用"));
    const result = await runProseEditTask(request(source), execution);
    expect(result.text).toBe("说明，可使用`Ctrl+K`打开面板。");
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("identifies the batch and copied readonly context without retrying", async () => {
    const source = "正文完整。后文 H~2~O 固定。";
    const { invoke, execution } = provider(text => text.includes("正文") ? `${text}后文 H~2~O 固定。` : text);
    await expect(runProseEditTask(request(source), execution)).rejects.toThrow(/第 1\/1 组正文.*只读相邻内容/);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("keeps the actual fact error and batch location for a changed conclusion", async () => {
    const { invoke, execution } = provider(text => text.replace("通过", "失败"));
    await expect(runProseEditTask(request("验收已通过。"), execution)).rejects.toThrow(/第 1\/1 组正文.*状态词/);
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
