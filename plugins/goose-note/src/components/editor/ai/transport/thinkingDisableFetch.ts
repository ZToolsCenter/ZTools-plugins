// 行内 AI fetch 包装：强制关闭 thinking/reasoning，并在 tool_choice 400 时降级重试。
// 纯逻辑模块，无业务 store 依赖，便于单测。

const TOOL_CHOICE_THINKING_ERROR_RE = /tool_choice|Thinking mode/i;

/** 从 RequestInfo 取出 URL 字符串。 */
function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/**
 * 尽量把 fetch body 解码成字符串。
 * AI SDK 通常传 string；部分运行时可能是 Uint8Array / ArrayBuffer。
 */
export function decodeFetchBody(body: BodyInit | null | undefined): string | null {
  if (body == null) return null;
  if (typeof body === "string") return body;
  if (typeof ArrayBuffer !== "undefined" && body instanceof ArrayBuffer) {
    return new TextDecoder().decode(new Uint8Array(body));
  }
  if (typeof Uint8Array !== "undefined" && body instanceof Uint8Array) {
    return new TextDecoder().decode(body);
  }
  if (typeof ArrayBuffer !== "undefined" && ArrayBuffer.isView(body)) {
    try {
      const view = body as ArrayBufferView;
      return new TextDecoder().decode(
        new Uint8Array(view.buffer, view.byteOffset, view.byteLength),
      );
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * 在 JSON body 上强制关闭 thinking / reasoning。
 * - chat/completions：body.thinking = { type: "disabled" }（覆盖）
 * - /responses：body.reasoning = { effort: "none" }（覆盖）
 * 端点识别：URL 路径，或 body 形状（messages+tools / input+tools）。
 * @returns 是否改动了 body
 */
export function forceDisableThinkingOnBody(
  url: string,
  body: Record<string, unknown>,
): boolean {
  const isResponses =
    url.includes("/responses") ||
    (Array.isArray(body.input) && body.tools != null);
  const isChatCompletions =
    url.includes("chat/completions") ||
    (Array.isArray(body.messages) && body.tools != null);

  if (isChatCompletions) {
    // 必须强制覆盖：DeepSeek 等可能已带 thinking 开启配置
    body.thinking = { type: "disabled" };
    return true;
  }

  if (isResponses) {
    body.reasoning = { effort: "none" };
    return true;
  }

  return false;
}

export function isToolChoiceThinkingErrorText(text: string): boolean {
  return TOOL_CHOICE_THINKING_ERROR_RE.test(text);
}

export function isToolChoiceThinkingError(err: unknown): boolean {
  if (err == null) return false;
  if (err instanceof Error) {
    if (isToolChoiceThinkingErrorText(err.message)) return true;
    // AI SDK 有时把响应体挂在 cause / data 上
    const cause = (err as Error & { cause?: unknown }).cause;
    if (cause != null && isToolChoiceThinkingError(cause)) return true;
    const data = (err as Error & { data?: unknown }).data;
    if (typeof data === "string" && isToolChoiceThinkingErrorText(data)) {
      return true;
    }
    if (data && typeof data === "object") {
      try {
        return isToolChoiceThinkingErrorText(JSON.stringify(data));
      } catch {
        /* ignore */
      }
    }
  }
  return isToolChoiceThinkingErrorText(String(err));
}

/**
 * 行内 AI 依赖 tool call（xl-ai 默认 toolChoice:"required"）。
 * DeepSeek Thinking 等模型在 thinking 开启时会拒绝 tool_choice=required。
 * 在 fetch 层强制关闭 thinking/reasoning，比 providerOptions 更可靠。
 *
 * 额外：若仍收到 tool_choice/Thinking 类 400，则改 tool_choice=auto 重试一次。
 */
export function wrapFetchToDisableThinking(
  baseFetch: typeof fetch,
): typeof fetch {
  return async (input, init) => {
    // 准备改写后的 init；解析失败时回退原 init，绝不吞网络错误
    let effectiveInit = init;
    let preparedBody: Record<string, unknown> | null = null;
    let url = "";

    try {
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "POST" && init?.body != null) {
        url = requestUrl(input);
        const rawBody = decodeFetchBody(init.body);
        if (rawBody != null) {
          const parsed: unknown = JSON.parse(rawBody);
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            const body = { ...(parsed as Record<string, unknown>) };
            forceDisableThinkingOnBody(url, body);
            preparedBody = body;
            effectiveInit = {
              ...init,
              body: JSON.stringify(body),
            };
          }
        }
      }
    } catch {
      // 仅吞包装/解析异常；用原始 init 继续发请求
      effectiveInit = init;
      preparedBody = null;
    }

    const response = await baseFetch(input, effectiveInit);

    // 仅对 400 + thinking/tool_choice 文案做一次 auto 兜底
    if (response.status !== 400 || preparedBody == null) {
      return response;
    }

    let errorText = "";
    try {
      errorText = await response.text();
    } catch {
      return response;
    }

    if (!isToolChoiceThinkingErrorText(errorText)) {
      return new Response(errorText, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    }

    // 已是 auto 则不再重试
    if (preparedBody.tool_choice === "auto") {
      return new Response(errorText, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    }

    const retryBody = {
      ...preparedBody,
      tool_choice: "auto",
    };
    forceDisableThinkingOnBody(url, retryBody);

    return baseFetch(input, {
      ...effectiveInit,
      body: JSON.stringify(retryBody),
    });
  };
}
