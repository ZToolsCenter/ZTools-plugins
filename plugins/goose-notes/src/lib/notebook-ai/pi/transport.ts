import {
  createUIMessageStream,
  type ChatTransport,
  type UIMessageChunk,
} from "ai";
import type { AgentEvent } from "@earendil-works/pi-agent-core";
import type { NotebookAiMessage } from "../types";
import { buildPiNotebookAgent } from "./agent";
import {
  collectLoadedSkillIds,
  extractLastUserPrompt,
  uiMessagesToAgentMessages,
} from "./messages";

function createMessageId(prefix: string) {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return `${prefix}-${globalThis.crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Pi Agent → AI SDK UIMessageStream 桥。
 * 保留 useChat / 审批卡 / 工具卡片 UI，不自研第二套对话循环。
 */
export function buildPiTransport(
  notebookId: string,
  currentPageId?: string | null,
):
  | { ok: true; transport: ChatTransport<NotebookAiMessage> }
  | { ok: false; reason: string } {
  const agentBuild = buildPiNotebookAgent(notebookId, currentPageId);
  if (!agentBuild.ok) {
    return { ok: false, reason: agentBuild.reason };
  }

  const { agent, abort, restoreLoadedSkills } = agentBuild;

  const transport: ChatTransport<NotebookAiMessage> = {
    async sendMessages({ messages, abortSignal }) {
      const prompt = extractLastUserPrompt(messages);
      if (!prompt) {
        throw new Error("没有可发送的用户消息");
      }

      // 历史不含最后一条 user（由 agent.prompt 注入）
      const history = messages.slice(0, -1);
      restoreLoadedSkills(collectLoadedSkillIds(history));
      agent.state.messages = uiMessagesToAgentMessages(history);

      const stream = createUIMessageStream<NotebookAiMessage>({
        execute: async ({ writer }) => {
          const assistantMessageId = createMessageId("msg");
          let textId: string | null = null;
          let stepOpen = false;
          let finished = false;

          const openStep = () => {
            if (!stepOpen) {
              writer.write({ type: "start-step" });
              stepOpen = true;
            }
          };
          const closeStep = () => {
            if (stepOpen) {
              writer.write({ type: "finish-step" });
              stepOpen = false;
            }
          };
          const ensureText = () => {
            if (!textId) {
              openStep();
              textId = createMessageId("text");
              writer.write({ type: "text-start", id: textId });
            }
            return textId;
          };
          const endText = () => {
            if (textId) {
              writer.write({ type: "text-end", id: textId });
              textId = null;
            }
          };

          writer.write({
            type: "start",
            messageId: assistantMessageId,
          });

          const onAbort = () => {
            abort();
          };
          abortSignal?.addEventListener("abort", onAbort);

          const unsub = agent.subscribe(async (event: AgentEvent) => {
            try {
              switch (event.type) {
                case "turn_start": {
                  openStep();
                  break;
                }
                case "message_update": {
                  const ame = event.assistantMessageEvent;
                  if (ame.type === "text_delta" && ame.delta) {
                    const id = ensureText();
                    writer.write({
                      type: "text-delta",
                      id,
                      delta: ame.delta,
                    });
                  }
                  if (ame.type === "thinking_delta" && ame.delta) {
                    // 可选：映射 reasoning；当前 UI 不强依赖
                  }
                  break;
                }
                case "message_end": {
                  if (event.message.role === "assistant") {
                    endText();
                  }
                  break;
                }
                case "tool_execution_start": {
                  endText();
                  openStep();
                  writer.write({
                    type: "tool-input-start",
                    toolCallId: event.toolCallId,
                    toolName: event.toolName,
                  });
                  writer.write({
                    type: "tool-input-available",
                    toolCallId: event.toolCallId,
                    toolName: event.toolName,
                    input: event.args ?? {},
                  });
                  break;
                }
                case "tool_execution_end": {
                  if (event.isError) {
                    const errText =
                      typeof event.result?.content?.[0]?.text === "string"
                        ? event.result.content[0].text
                        : event.result?.details?.error
                          ? String(event.result.details.error)
                          : "工具执行失败";
                    writer.write({
                      type: "tool-output-error",
                      toolCallId: event.toolCallId,
                      errorText: errText,
                    });
                  } else {
                    writer.write({
                      type: "tool-output-available",
                      toolCallId: event.toolCallId,
                      output:
                        event.result?.details !== undefined
                          ? event.result.details
                          : event.result,
                    });
                  }
                  break;
                }
                case "turn_end": {
                  endText();
                  closeStep();
                  break;
                }
                case "agent_end": {
                  endText();
                  closeStep();
                  if (!finished) {
                    finished = true;
                    const err = agent.state.errorMessage;
                    if (err) {
                      writer.write({ type: "error", errorText: err });
                    }
                    writer.write({
                      type: "finish",
                      finishReason: err ? "error" : "stop",
                    });
                  }
                  break;
                }
                default:
                  break;
              }
            } catch {
              // 流已关闭时忽略
            }
          });

          try {
            if (prompt.images.length > 0) {
              await agent.prompt(prompt.text, prompt.images);
            } else {
              await agent.prompt(prompt.text);
            }
            await agent.waitForIdle();

            if (!finished) {
              finished = true;
              const err = agent.state.errorMessage;
              if (err) {
                writer.write({ type: "error", errorText: err });
              }
              endText();
              closeStep();
              writer.write({
                type: "finish",
                finishReason: err ? "error" : "stop",
              });
            }
          } catch (error) {
            if (!finished) {
              finished = true;
              const errorText =
                error instanceof Error ? error.message : String(error);
              writer.write({ type: "error", errorText });
              endText();
              closeStep();
              writer.write({ type: "finish", finishReason: "error" });
            }
          } finally {
            unsub();
            abortSignal?.removeEventListener("abort", onAbort);
          }
        },
        onError: (error) =>
          error instanceof Error ? error.message : String(error),
      });

      return stream as ReadableStream<UIMessageChunk>;
    },

    async reconnectToStream() {
      return null;
    },
  };

  return { ok: true, transport };
}
