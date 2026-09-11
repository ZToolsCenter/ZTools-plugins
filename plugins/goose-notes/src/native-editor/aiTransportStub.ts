import type { ChatTransport, UIMessage, UIMessageChunk } from "ai";
import { createRequestID, isValidEnvelope, postToHost } from "./bridge";
import type {
  BridgeEnvelope,
  NativeAICancel,
  NativeAIDelta,
  NativeAIResult,
} from "./types";

const REQUEST_TIMEOUT_MS = 15_000;

interface PendingAIRequest extends Pick<BridgeEnvelope, "pageID" | "revision"> {
  controller: ReadableStreamDefaultController<UIMessageChunk>;
  timeout: number;
}

/**
 * 把 BlockNote 的 ChatTransport 映射为严格的 WKWebView 消息。这里刻意不使用
 * fetch、API SDK 或本地配置；原生服务负责模型、凭据及流式连接。
 */
export class NativeAITransportBridge {
  private readonly pending = new Map<string, PendingAIRequest>();

  createTransport(): ChatTransport<UIMessage> {
    return {
      sendMessages: async ({ chatId, messages, body, abortSignal }) => {
        const context = window.__gooseBridgeContext;
        if (!context?.pageID || !window.webkit?.messageHandlers?.gooseNotes) {
          throw new Error("当前原生应用未启用 AI 服务。请在原生应用的 AI 设置中配置服务后重试。");
        }
        const requestID = createRequestID();
        return new ReadableStream<UIMessageChunk>({
          start: (controller) => {
            const timeout = window.setTimeout(() => {
              this.fail(requestID, "原生 AI 服务未响应。请检查原生应用中的 AI 服务配置。");
            }, REQUEST_TIMEOUT_MS);
            this.pending.set(requestID, {
              ...context,
              controller,
              timeout,
            });
            postToHost({
              version: 1,
              type: "aiRequest",
              requestID,
              pageID: context.pageID,
              revision: context.revision,
              chatID: chatId,
              messages: structuredClone(messages),
              toolDefinitions: structuredClone((body as { toolDefinitions?: unknown })?.toolDefinitions ?? null),
            });
            abortSignal?.addEventListener("abort", () => this.cancel(requestID), { once: true });
          },
          cancel: () => this.cancel(requestID),
        });
      },
      reconnectToStream: async () => null,
    };
  }

  readonly receiveDelta = (delta: NativeAIDelta) => {
    if (!isValidEnvelope(delta)) return;
    const pending = this.pending.get(delta.requestID);
    if (!pending || pending.pageID !== delta.pageID || pending.revision !== delta.revision) return;
    if (!delta.chunk || typeof delta.chunk !== "object" || Array.isArray(delta.chunk)) return;
    pending.controller.enqueue(delta.chunk as UIMessageChunk);
  };

  readonly receiveResult = (result: NativeAIResult) => {
    if (!isValidEnvelope(result)) return;
    const pending = this.pending.get(result.requestID);
    if (!pending || pending.pageID !== result.pageID || pending.revision !== result.revision) return;
    if (result.status === "started") return;
    this.pending.delete(result.requestID);
    window.clearTimeout(pending.timeout);
    if (result.status === "completed") pending.controller.close();
    else pending.controller.error(new Error(result.message ?? "原生 AI 服务当前不可用。请在设置中配置后重试。"));
  };

  invalidate() {
    for (const requestID of this.pending.keys()) this.fail(requestID, "当前文件已切换，AI 请求已取消。");
  }

  private cancel(requestID: string) {
    const pending = this.pending.get(requestID);
    if (!pending) return;
    const message: NativeAICancel = {
      version: 1,
      type: "aiCancel",
      requestID,
      pageID: pending.pageID,
      revision: pending.revision,
    };
    postToHost(message);
    this.fail(requestID, "AI 请求已取消。");
  }

  private fail(requestID: string, message: string) {
    const pending = this.pending.get(requestID);
    if (!pending) return;
    this.pending.delete(requestID);
    window.clearTimeout(pending.timeout);
    pending.controller.error(new Error(message));
  }
}

const nativeAITransportBridge = new NativeAITransportBridge();

export function createGooseAITransport() {
  return nativeAITransportBridge.createTransport();
}

export { nativeAITransportBridge };
