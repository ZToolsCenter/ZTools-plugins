import { expect, test } from "playwright/test";
import {
  decodeFetchBody,
  forceDisableThinkingOnBody,
  wrapFetchToDisableThinking,
} from "../../src/components/editor/ai/transport/thinkingDisableFetch";

test("forceDisableThinkingOnBody: chat/completions URL 强制关闭 thinking", () => {
  const body: Record<string, unknown> = {
    messages: [{ role: "user", content: "hi" }],
    tools: [{ type: "function", function: { name: "x" } }],
    thinking: { type: "enabled" },
  };
  const changed = forceDisableThinkingOnBody(
    "https://api.deepseek.com/chat/completions",
    body,
  );
  expect(changed).toBe(true);
  expect(body.thinking).toEqual({ type: "disabled" });
});

test("forceDisableThinkingOnBody: 即使已有 thinking 也必须覆盖", () => {
  const body: Record<string, unknown> = {
    messages: [],
    tools: [],
    thinking: { type: "enabled", budget_tokens: 128 },
  };
  forceDisableThinkingOnBody("https://example.test/v1/chat/completions", body);
  expect(body.thinking).toEqual({ type: "disabled" });
});

test("forceDisableThinkingOnBody: responses URL 强制 reasoning.effort=none", () => {
  const body: Record<string, unknown> = {
    input: [{ role: "user", content: "hi" }],
    tools: [{ type: "function" }],
    reasoning: { effort: "high", summary: "auto" },
  };
  const changed = forceDisableThinkingOnBody(
    "https://api.openai.com/v1/responses",
    body,
  );
  expect(changed).toBe(true);
  expect(body.reasoning).toEqual({ effort: "none" });
});

test("forceDisableThinkingOnBody: 按 body 形状识别 chat（无 URL 特征）", () => {
  const body: Record<string, unknown> = {
    messages: [{ role: "user", content: "x" }],
    tools: [{}],
  };
  forceDisableThinkingOnBody("https://gateway.example/v1/proxy", body);
  expect(body.thinking).toEqual({ type: "disabled" });
});

test("forceDisableThinkingOnBody: 按 body 形状识别 responses", () => {
  const body: Record<string, unknown> = {
    input: [{ role: "user", content: "x" }],
    tools: [{}],
  };
  forceDisableThinkingOnBody("https://gateway.example/v1/proxy", body);
  expect(body.reasoning).toEqual({ effort: "none" });
});

test("forceDisableThinkingOnBody: 无关请求不改 body", () => {
  const body: Record<string, unknown> = { model: "x", prompt: "y" };
  const changed = forceDisableThinkingOnBody(
    "https://example.test/v1/embeddings",
    body,
  );
  expect(changed).toBe(false);
  expect(body.thinking).toBeUndefined();
  expect(body.reasoning).toBeUndefined();
});

test("decodeFetchBody: 支持 string / Uint8Array / ArrayBuffer", () => {
  const json = JSON.stringify({ a: 1 });
  expect(decodeFetchBody(json)).toBe(json);

  const bytes = new TextEncoder().encode(json);
  expect(decodeFetchBody(bytes)).toBe(json);
  expect(decodeFetchBody(bytes.buffer)).toBe(json);
});

test("wrapFetchToDisableThinking: POST chat 请求体强制 thinking.disabled", async () => {
  const calls: Array<{ url: string; body: string }> = [];
  const baseFetch: typeof fetch = async (input, init) => {
    calls.push({
      url: String(input),
      body: String(init?.body ?? ""),
    });
    return new Response("{}", { status: 200 });
  };

  const wrapped = wrapFetchToDisableThinking(baseFetch);
  await wrapped("https://api.deepseek.com/chat/completions", {
    method: "POST",
    body: JSON.stringify({
      messages: [{ role: "user", content: "hi" }],
      tools: [{ type: "function", function: { name: "apply" } }],
      thinking: { type: "enabled" },
      tool_choice: "required",
    }),
  });

  expect(calls).toHaveLength(1);
  const sent = JSON.parse(calls[0].body) as Record<string, unknown>;
  expect(sent.thinking).toEqual({ type: "disabled" });
  expect(sent.tool_choice).toBe("required");
});

test("wrapFetchToDisableThinking: 400 Thinking mode 时用 tool_choice=auto 重试一次", async () => {
  const calls: Array<{ body: string }> = [];
  let attempt = 0;
  const baseFetch: typeof fetch = async (_input, init) => {
    calls.push({ body: String(init?.body ?? "") });
    attempt += 1;
    if (attempt === 1) {
      return new Response(
        JSON.stringify({
          error: {
            message: "Thinking mode does not support this tool_choice",
          },
        }),
        { status: 400 },
      );
    }
    return new Response("ok", { status: 200 });
  };

  const wrapped = wrapFetchToDisableThinking(baseFetch);
  const res = await wrapped("https://api.deepseek.com/chat/completions", {
    method: "POST",
    body: JSON.stringify({
      messages: [{ role: "user", content: "hi" }],
      tools: [{}],
      tool_choice: "required",
    }),
  });

  expect(res.status).toBe(200);
  expect(calls).toHaveLength(2);
  const first = JSON.parse(calls[0].body) as Record<string, unknown>;
  const second = JSON.parse(calls[1].body) as Record<string, unknown>;
  expect(first.thinking).toEqual({ type: "disabled" });
  expect(first.tool_choice).toBe("required");
  expect(second.thinking).toEqual({ type: "disabled" });
  expect(second.tool_choice).toBe("auto");
});

test("wrapFetchToDisableThinking: 其它 400 不重试并保留错误体", async () => {
  const baseFetch: typeof fetch = async () =>
    new Response(JSON.stringify({ error: { message: "invalid api key" } }), {
      status: 400,
    });

  const wrapped = wrapFetchToDisableThinking(baseFetch);
  const res = await wrapped("https://api.deepseek.com/chat/completions", {
    method: "POST",
    body: JSON.stringify({
      messages: [{ role: "user", content: "hi" }],
      tools: [{}],
    }),
  });

  expect(res.status).toBe(400);
  const text = await res.text();
  expect(text).toContain("invalid api key");
});
