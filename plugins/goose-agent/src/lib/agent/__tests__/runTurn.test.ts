import { afterEach, describe, expect, it, vi } from "vitest";
import type { AISettingsLike } from "@/lib/ai-provider";
import {
  GROK_CLI_CLIENT_IDENTIFIER,
  GROK_CLI_TOKEN_AUTH,
  XAI_CLI_SESSION_BASE_URL,
} from "@/lib/ai-provider";
import type { AgentTurnEvent } from "../types";
import * as registry from "../registry";
import { executeTool, runAgentTurn } from "../runTurn";

function makeSettings(
  overrides: Partial<AISettingsLike> = {},
): AISettingsLike {
  return {
    enabled: true,
    selectedModelId: "gpt-4o-mini",
    workspaceReasoningLevel: "medium",
    customProviderId: "custom-openai",
    customProtocol: "openai",
    customOpenAIResponsesBaseURL: "https://api.example.com/v1",
    customOpenAIBaseURL: "https://api.example.com/v1",
    customClaudeBaseURL: "https://api.anthropic.com",
    customOpenAIResponsesApiKey: "",
    customOpenAIApiKey: "sk-test-key",
    customClaudeApiKey: "",
    customModelOptions: [{ id: "gpt-4o-mini", label: "gpt-4o-mini" }],
    ...overrides,
  };
}

/** 构造可读的 SSE Response，供 streamOpenAIChatCompletion 消费。 */
function sseResponse(payloads: object[] | string[]): Response {
  const lines = payloads.map((p) =>
    typeof p === "string" ? `data: ${p}` : `data: ${JSON.stringify(p)}`,
  );
  const body = `${lines.join("\n\n")}\n\ndata: [DONE]\n\n`;
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

function toolCallChunk(opts: {
  id: string;
  name: string;
  arguments: string;
  index?: number;
}) {
  return {
    choices: [
      {
        delta: {
          tool_calls: [
            {
              index: opts.index ?? 0,
              id: opts.id,
              type: "function",
              function: {
                name: opts.name,
                arguments: opts.arguments,
              },
            },
          ],
        },
      },
    ],
  };
}

function finishChunk(reason: string) {
  return {
    choices: [{ delta: {}, finish_reason: reason }],
  };
}

function contentChunk(text: string) {
  return {
    choices: [{ delta: { content: text } }],
  };
}

function collectEvents() {
  const events: AgentTurnEvent[] = [];
  return {
    events,
    onEvent: (e: AgentTurnEvent) => {
      events.push(e);
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("runAgentTurn (openai Chat Completions tool loop)", () => {
  it("runs loadSkill tool call then final text, emitting tool-start/end + text-delta + done", async () => {
    const fetchMock = vi
      .fn()
      // step 1: model requests loadSkill
      .mockResolvedValueOnce(
        sseResponse([
          toolCallChunk({
            id: "call_load_1",
            name: "loadSkill",
            arguments: JSON.stringify({ skill: "chat" }),
          }),
          finishChunk("tool_calls"),
        ]),
      )
      // step 2: pure text, no tool_calls
      .mockResolvedValueOnce(
        sseResponse([
          contentChunk("已加载 chat skill，可以开始对话。"),
          finishChunk("stop"),
        ]),
      );

    vi.stubGlobal("fetch", fetchMock);

    const { events, onEvent } = collectEvents();
    const ac = new AbortController();

    await runAgentTurn({
      messages: [{ role: "user", content: "你好" }],
      settings: makeSettings(),
      permissionMode: "workspace-write",
      workspaceRoot: null,
      signal: ac.signal,
      onEvent,
      agentsMd: "测试边界",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstUrl = String(fetchMock.mock.calls[0]?.[0] ?? "");
    expect(firstUrl).toContain("/chat/completions");

    const types = events.map((e) => e.type);
    expect(types).toContain("tool-start");
    expect(types).toContain("tool-end");
    expect(types).toContain("text-delta");
    expect(types[types.length - 1]).toBe("done");

    const toolStart = events.find((e) => e.type === "tool-start");
    expect(toolStart).toMatchObject({
      type: "tool-start",
      id: "call_load_1",
      name: "loadSkill",
    });

    const toolEnd = events.find((e) => e.type === "tool-end");
    expect(toolEnd).toMatchObject({
      type: "tool-end",
      id: "call_load_1",
      name: "loadSkill",
    });
    if (toolEnd?.type === "tool-end") {
      expect(toolEnd.result).toMatchObject({
        skill: "chat",
        supported: true,
      });
    }

    const text = events
      .filter((e): e is Extract<AgentTurnEvent, { type: "text-delta" }> =>
        e.type === "text-delta",
      )
      .map((e) => e.text)
      .join("");
    expect(text).toContain("已加载 chat skill");

    // done 仅一次，且在末尾
    expect(events.filter((e) => e.type === "done")).toHaveLength(1);
  });

  it("emits error + done when AI is unavailable (no API key)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { events, onEvent } = collectEvents();
    const ac = new AbortController();

    await runAgentTurn({
      messages: [{ role: "user", content: "hi" }],
      settings: makeSettings({
        customOpenAIApiKey: "",
        customOpenAIResponsesApiKey: "",
      }),
      permissionMode: "workspace-write",
      workspaceRoot: null,
      signal: ac.signal,
      onEvent,
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(events.some((e) => e.type === "error")).toBe(true);
    expect(events[events.length - 1]?.type).toBe("done");

    const err = events.find((e) => e.type === "error");
    if (err?.type === "error") {
      expect(err.message).toMatch(/API Key|尚未开启|模型/i);
    }
  });

  it("continues to done when tool returns ok:false (unknown tool)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        sseResponse([
          toolCallChunk({
            id: "call_bad_1",
            name: "notARealTool",
            arguments: "{}",
          }),
          finishChunk("tool_calls"),
        ]),
      )
      .mockResolvedValueOnce(
        sseResponse([
          contentChunk("工具不可用，改用文字回复。"),
          finishChunk("stop"),
        ]),
      );

    vi.stubGlobal("fetch", fetchMock);

    const { events, onEvent } = collectEvents();

    await runAgentTurn({
      messages: [{ role: "user", content: "试一下" }],
      settings: makeSettings(),
      permissionMode: "workspace-write",
      workspaceRoot: null,
      signal: new AbortController().signal,
      onEvent,
      agentsMd: "测试边界",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);

    const toolEnd = events.find((e) => e.type === "tool-end");
    expect(toolEnd).toMatchObject({
      type: "tool-end",
      id: "call_bad_1",
      name: "notARealTool",
    });
    if (toolEnd?.type === "tool-end") {
      expect(toolEnd.result).toMatchObject({
        ok: false,
        error: expect.stringContaining("未知工具"),
      });
    }

    expect(events.some((e) => e.type === "text-delta")).toBe(true);
    expect(events[events.length - 1]?.type).toBe("done");
    // 工具失败不应冒出 error 事件中断整轮
    expect(events.every((e) => e.type !== "error")).toBe(true);
  });

  it("emits estimate usage when stream has no usage field", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      sseResponse([
        contentChunk("你好，这是纯文本回复。"),
        finishChunk("stop"),
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { events, onEvent } = collectEvents();

    await runAgentTurn({
      messages: [{ role: "user", content: "打个招呼" }],
      settings: makeSettings(),
      permissionMode: "workspace-write",
      workspaceRoot: null,
      signal: new AbortController().signal,
      onEvent,
      agentsMd: "测试边界",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);

    const usageEvents = events.filter((e) => e.type === "usage");
    expect(usageEvents).toHaveLength(1);

    const usageEvent = usageEvents[0];
    expect(usageEvent?.type).toBe("usage");
    if (usageEvent?.type === "usage") {
      expect(usageEvent.usage.source).toBe("estimate");
      expect(usageEvent.usage.promptTokens).toBeGreaterThanOrEqual(0);
      expect(usageEvent.usage.completionTokens).toBeGreaterThanOrEqual(0);
      expect(usageEvent.usage.totalTokens).toBeGreaterThanOrEqual(0);
    }

    const doneIndex = events.findIndex((e) => e.type === "done");
    expect(doneIndex).toBeGreaterThanOrEqual(0);
    const usageIndex = events.findIndex((e) => e.type === "usage");
    expect(usageIndex).toBeGreaterThanOrEqual(0);
    expect(usageIndex).toBeLessThan(doneIndex);
    expect(events.filter((e) => e.type === "done")).toHaveLength(1);
  });

  it("emits provider usage when stream includes usage chunk", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      sseResponse([
        contentChunk("带 usage 的回复。"),
        finishChunk("stop"),
        {
          choices: [],
          usage: {
            prompt_tokens: 100,
            completion_tokens: 20,
            total_tokens: 120,
          },
        },
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { events, onEvent } = collectEvents();

    await runAgentTurn({
      messages: [{ role: "user", content: "用量测试" }],
      settings: makeSettings(),
      permissionMode: "workspace-write",
      workspaceRoot: null,
      signal: new AbortController().signal,
      onEvent,
      agentsMd: "测试边界",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);

    const usageEvents = events.filter((e) => e.type === "usage");
    expect(usageEvents).toHaveLength(1);

    const usageEvent = usageEvents[0];
    expect(usageEvent?.type).toBe("usage");
    if (usageEvent?.type === "usage") {
      expect(usageEvent.usage.source).toBe("provider");
      expect(usageEvent.usage.promptTokens).toBe(100);
      expect(usageEvent.usage.completionTokens).toBe(20);
      expect(usageEvent.usage.totalTokens).toBe(120);
    }

    expect(events.some((e) => e.type === "done")).toBe(true);
    const usageIndex = events.findIndex((e) => e.type === "usage");
    const doneIndex = events.findIndex((e) => e.type === "done");
    expect(usageIndex).toBeLessThan(doneIndex);
  });

  it("injects Grok CLI proxy identity headers on xai oauth tool-loop fetch", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      sseResponse([
        contentChunk("ok"),
        finishChunk("stop"),
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { events, onEvent } = collectEvents();
    await runAgentTurn({
      messages: [{ role: "user", content: "你好" }],
      settings: makeSettings({
        customProviderId: "xai",
        customProtocol: "openai-responses",
        customOpenAIResponsesBaseURL: XAI_CLI_SESSION_BASE_URL,
        customOpenAIResponsesApiKey: "",
        customOpenAIApiKey: "",
        preferredAuthMode: "oauth",
        selectedModelId: "grok-4",
        customModelOptions: [{ id: "grok-4", label: "grok-4" }],
        oauthSession: {
          accessToken: "oauth-test-token",
          expiresAt: Date.now() + 60 * 60 * 1000,
          providerId: "xai",
          source: "grok_cli",
        },
      }),
      permissionMode: "workspace-write",
      workspaceRoot: null,
      signal: new AbortController().signal,
      onEvent,
      agentsMd: "测试边界",
    });

    expect(fetchMock).toHaveBeenCalled();
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toContain("cli-chat-proxy.grok.com");
    expect(String(url)).toContain("/responses");
    const headers = (init as { headers?: Record<string, string> })?.headers ?? {};
    expect(headers["x-grok-client-version"]).toBeTruthy();
    expect(headers["x-grok-client-version"]).not.toBe("none");
    expect(headers["x-grok-client-identifier"]).toBe(GROK_CLI_CLIENT_IDENTIFIER);
    expect(headers["X-XAI-Token-Auth"]).toBe(GROK_CLI_TOKEN_AUTH);
    expect(headers.Authorization).toBe("Bearer oauth-test-token");
    expect(events.some((e) => e.type === "error")).toBe(false);
  });
});


describe("toolCtx conversationId wiring", () => {
  it("executeTool forwards conversationId to registry", async () => {
    const spy = vi
      .spyOn(registry, "executeTool")
      .mockResolvedValue({ ok: true, skill: "chat", supported: true });

    await executeTool(
      "loadSkill",
      { skill: "chat" },
      {
        permissionMode: "workspace-write",
        workspaceRoot: "/ws",
        conversationId: "conv-wire-1",
        signal: new AbortController().signal,
      },
    );

    expect(spy).toHaveBeenCalledWith(
      "loadSkill",
      { skill: "chat" },
      expect.objectContaining({ conversationId: "conv-wire-1" }),
    );
  });

  it("runAgentTurn tool loop passes conversationId into registryExecuteTool", async () => {
    const spy = vi.spyOn(registry, "executeTool").mockResolvedValue({
      ok: true,
      skill: "chat",
      supported: true,
    });

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        sseResponse([
          toolCallChunk({
            id: "call_load_wire",
            name: "loadSkill",
            arguments: JSON.stringify({ skill: "chat" }),
          }),
          finishChunk("tool_calls"),
        ]),
      )
      .mockResolvedValueOnce(
        sseResponse([contentChunk("ok"), finishChunk("stop")]),
      );
    vi.stubGlobal("fetch", fetchMock);

    const { onEvent } = collectEvents();
    await runAgentTurn({
      messages: [{ role: "user", content: "load" }],
      settings: makeSettings(),
      permissionMode: "workspace-write",
      workspaceRoot: "/tmp/ws",
      signal: new AbortController().signal,
      conversationId: "conv-from-session",
      onEvent,
      agentsMd: "测试边界",
    });

    expect(spy).toHaveBeenCalled();
    const ctxArg = spy.mock.calls[0]?.[2] as { conversationId?: string };
    expect(ctxArg?.conversationId).toBe("conv-from-session");
  });
});
