import { expect, test } from "playwright/test";
import { handleOpenAIResponsesStream } from "../../src/lib/ai-provider/providers/openaiResponses";
import type { AISettingsLike } from "../../src/lib/ai-provider/types";
import { normalizeAISettings } from "../../src/stores/settings/types";

const settings: AISettingsLike = {
  enabled: true,
  selectedModelId: "gpt-test",
  workspaceReasoningLevel: "high",
  customProtocol: "openai-responses",
  customOpenAIResponsesBaseURL: "https://responses.example.test/v1/",
  customOpenAIBaseURL: "https://compatible.example.test/v1",
  customClaudeBaseURL: "https://api.anthropic.com/v1",
  customOpenAIResponsesApiKey: "responses-key",
  customOpenAIApiKey: "compatible-key",
  customClaudeApiKey: "anthropic-key",
  customModelOptions: [{ id: "gpt-test", label: "GPT Test" }],
};

test("Responses 协议发送独立配置并解析文本与推理摘要事件", async () => {
  const originalFetch = globalThis.fetch;
  let requestURL = "";
  let requestInit: RequestInit | undefined;
  globalThis.fetch = async (input, init) => {
    requestURL = String(input);
    requestInit = init;
    const events = [
      'data: {"type":"response.reasoning_summary_text.delta","delta":"分析"}',
      'data: {"type":"response.output_text.delta","delta":"答案"}',
      'data: {"type":"response.completed"}',
      "",
    ].join("\n");
    return new Response(events, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });
  };

  try {
    const updates: Array<{ text: string; isReasoning: boolean }> = [];
    const result = await handleOpenAIResponsesStream(
      settings,
      [
        { role: "system", content: "系统要求" },
        { role: "user", content: "用户问题" },
      ],
      new AbortController().signal,
      (_phase, text, isReasoning) => updates.push({ text, isReasoning }),
    );

    expect(requestURL).toBe("https://responses.example.test/v1/responses");
    expect((requestInit?.headers as Record<string, string>).Authorization).toBe(
      "Bearer responses-key",
    );
    expect(JSON.parse(String(requestInit?.body))).toEqual({
      model: "gpt-test",
      input: [{ role: "user", content: "用户问题" }],
      stream: true,
      store: false,
      instructions: "系统要求",
      reasoning: { effort: "high", summary: "auto" },
    });
    expect(updates).toEqual([
      { text: "分析", isReasoning: true },
      { text: "答案", isReasoning: false },
    ]);
    expect(result).toEqual({ text: "答案", reasoningText: "分析" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("OpenAI Chat Completions 兼容配置保持原协议与独立凭证", () => {
  const normalized = normalizeAISettings({
    useCustomProvider: false,
    customProtocol: "openai",
    customOpenAIBaseURL: "https://legacy.example.test/v1",
    customOpenAIApiKey: "legacy-key",
  } as never);

  expect(normalized.customProtocol).toBe("openai");
  expect(normalized.customOpenAIBaseURL).toBe("https://legacy.example.test/v1");
  expect(normalized.customOpenAIApiKey).toBe("legacy-key");
  expect(normalized.customOpenAIResponsesBaseURL).toBe(
    "https://api.openai.com/v1",
  );
  expect(normalized.customOpenAIResponsesApiKey).toBe("");
  expect("useCustomProvider" in normalized).toBe(false);
});

test("早期通用 OpenAI 配置迁移到兼容协议", () => {
  const normalized = normalizeAISettings({
    customBaseURL: "https://very-legacy.example.test/v1",
    customApiKey: "very-legacy-key",
  } as never);

  expect(normalized.customProtocol).toBe("openai");
  expect(normalized.customOpenAIBaseURL).toBe(
    "https://very-legacy.example.test/v1",
  );
  expect(normalized.customOpenAIApiKey).toBe("very-legacy-key");
});

test("已保存的 AI 服务配置 rehydrate 后完整保留", () => {
  const normalized = normalizeAISettings({
    enabled: true,
    selectedModelId: "gpt-4.1-mini",
    workspaceSelectedModelId: "gpt-4.1",
    workspaceReasoningLevel: "medium",
    customProtocol: "openai-responses",
    customOpenAIResponsesBaseURL: "https://proxy.example.test/v1",
    customOpenAIBaseURL: "https://compatible.example.test/v1",
    customClaudeBaseURL: "https://claude.example.test/v1",
    customOpenAIResponsesApiKey: "sk-live-keep",
    customOpenAIApiKey: "sk-compat",
    customClaudeApiKey: "sk-claude",
    customModelOptions: [
      { id: "gpt-4.1", label: "GPT-4.1" },
      { id: "gpt-4.1-mini", label: "GPT-4.1 mini" },
    ],
  });

  expect(normalized.enabled).toBe(true);
  expect(normalized.readGlobalPrompt).toBe(true);
  expect(normalized.readLocalSkills).toBe(true);
  expect(normalized.customProtocol).toBe("openai-responses");
  expect(normalized.customOpenAIResponsesBaseURL).toBe(
    "https://proxy.example.test/v1",
  );
  expect(normalized.customClaudeBaseURL).toBe(
    "https://claude.example.test/v1",
  );
  expect(normalized.customOpenAIResponsesApiKey).toBe("sk-live-keep");
  expect(normalized.customClaudeApiKey).toBe("sk-claude");
  expect(normalized.selectedModelId).toBe("gpt-4.1-mini");
  expect(normalized.workspaceSelectedModelId).toBe("gpt-4.1");
  expect(normalized.customModelOptions.map((item) => item.id)).toEqual([
    "gpt-4.1",
    "gpt-4.1-mini",
  ]);
});

test("本地 AI 上下文开关可独立关闭", () => {
  const normalized = normalizeAISettings({
    readGlobalPrompt: false,
    readLocalSkills: false,
  });

  expect(normalized.readGlobalPrompt).toBe(false);
  expect(normalized.readLocalSkills).toBe(false);
});

test("Claude 协议配置 rehydrate 后保留 Base URL / Key / 默认模型", () => {
  const normalized = normalizeAISettings({
    enabled: true,
    selectedModelId: "claude-sonnet-4",
    customProtocol: "claude",
    customClaudeBaseURL: "https://claude-proxy.example.test/v1",
    customClaudeApiKey: "sk-ant-keep",
    customModelOptions: [
      { id: "claude-sonnet-4", label: "Sonnet 4" },
      { id: "claude-haiku", label: "Haiku" },
    ],
  });

  expect(normalized.customProtocol).toBe("claude");
  expect(normalized.customClaudeBaseURL).toBe(
    "https://claude-proxy.example.test/v1",
  );
  expect(normalized.customClaudeApiKey).toBe("sk-ant-keep");
  expect(normalized.selectedModelId).toBe("claude-sonnet-4");
  expect(normalized.customModelOptions).toHaveLength(2);
});
