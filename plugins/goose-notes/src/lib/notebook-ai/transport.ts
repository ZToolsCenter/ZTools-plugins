import { DirectChatTransport, type ChatTransport } from "ai";
import { buildNotebookAgent } from "./agent";
import type { notebookAiTools } from "./tools";
import type { NotebookAiMessage } from "./types";
import type { UIMessage } from "ai";
import { resolveNotebookAiRuntime } from "./pi/runtime";
import { buildPiTransport } from "./pi/transport";

export type NotebookChatUIMessage = UIMessage<
  unknown,
  never,
  {
    [K in keyof typeof notebookAiTools]: (typeof notebookAiTools)[K] extends {
      inputSchema: infer S;
      execute: (...args: any[]) => Promise<infer O>;
    }
      ? { input: S extends { parse: (v: any) => infer I } ? I : unknown; output: O }
      : never;
  }
>;

export type BuildTransportResult =
  | {
      ok: true;
      transport: ChatTransport<NotebookAiMessage>;
      runtime: "legacy" | "pi";
    }
  | { ok: false; reason: string };

/**
 * 构建绑定指定笔记本的 ChatTransport。
 * 默认 Pi harness；settings.ai.runtime / localStorage goose-ai-runtime 可切 legacy。
 * 每次调用都会重新构建以保证 agent 中的 system prompt 和当前页签上下文是最新的。
 */
export function buildTransport(
  notebookId: string,
  currentPageId?: string | null,
): BuildTransportResult {
  const runtime = resolveNotebookAiRuntime();

  if (runtime === "pi") {
    const piResult = buildPiTransport(notebookId, currentPageId);
    if (!piResult.ok) {
      return { ok: false, reason: piResult.reason };
    }
    return { ok: true, transport: piResult.transport, runtime: "pi" };
  }

  const agentResult = buildNotebookAgent(notebookId, currentPageId);
  if (!agentResult.ok) {
    return { ok: false, reason: agentResult.reason };
  }

  const transport = new DirectChatTransport({
    agent: agentResult.agent,
  });

  return { ok: true, transport, runtime: "legacy" };
}
