import { useTabs } from "@/stores/useTabs";
import { useFileNavHistory } from "@/stores/useFileNavHistory";
import { usePages } from "@/stores/usePages";
import { useNotebooks } from "@/stores/useNotebooks";
import { useSettings } from "@/stores/useSettings";
import { activateNotebook } from "@/lib/notebookNavigation";
import { buildTransport } from "@/lib/notebook-ai/transport";
import { resolveNotebookAiRuntime } from "@/lib/notebook-ai/pi/runtime";
import {
  executePreparedBatchPlan,
  readBatchPlanJournal,
} from "@/lib/notebook-ai/batch-plan";
import { createEmptyBlockNoteContent } from "@/components/editor/utils/blocknote-content";
import type { NotebookAiMessage } from "@/lib/notebook-ai/types";
import type { Page } from "@/types";

type ToolCallRecord = {
  toolName: string;
  toolCallId: string;
  input: unknown;
  output?: unknown;
  errorText?: string;
  ok: boolean;
};

function createId(prefix: string) {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return `${prefix}-${globalThis.crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function makePage(partial: {
  id: string;
  workspaceId: string;
  title: string;
  body: string;
}): Page {
  const content = [
    ...createEmptyBlockNoteContent(partial.title),
    {
      type: "paragraph",
      content: [{ type: "text", text: partial.body }],
    },
  ];
  const now = Date.now();
  return {
    id: partial.id,
    workspaceId: partial.workspaceId,
    parentId: undefined,
    isFolder: false,
    isLocked: false,
    fontSize: "default",
    fontFamily: "default",
    content: content as never,
    createdAt: now,
    updatedAt: now,
  };
}

async function readUiMessageStream(
  stream: ReadableStream<unknown>,
): Promise<{ toolCalls: ToolCallRecord[]; errors: string[]; texts: string[] }> {
  const reader = stream.getReader();
  const toolCalls = new Map<string, ToolCallRecord>();
  const errors: string[] = [];
  const texts: string[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = value as Record<string, unknown>;
    if (!chunk || typeof chunk !== "object") continue;
    const type = chunk.type;

    if (type === "text-delta" && typeof chunk.delta === "string") {
      texts.push(chunk.delta);
    }
    if (type === "error" && typeof chunk.errorText === "string") {
      errors.push(chunk.errorText);
    }
    if (type === "tool-input-available") {
      const toolCallId = String(chunk.toolCallId ?? "");
      const toolName = String(chunk.toolName ?? "");
      toolCalls.set(toolCallId, {
        toolName,
        toolCallId,
        input: chunk.input,
        ok: false,
      });
    }
    if (type === "tool-output-available") {
      const toolCallId = String(chunk.toolCallId ?? "");
      const prev = toolCalls.get(toolCallId);
      if (prev) {
        prev.output = chunk.output;
        prev.ok = true;
      }
    }
    if (type === "tool-output-error") {
      const toolCallId = String(chunk.toolCallId ?? "");
      const prev = toolCalls.get(toolCallId);
      if (prev) {
        prev.errorText = String(chunk.errorText ?? "error");
        prev.ok = false;
      }
    }
  }

  return { toolCalls: [...toolCalls.values()], errors, texts };
}

async function autoApproveBatchPlans(
  toolCalls: ToolCallRecord[],
): Promise<Array<{ toolCallId: string; ok: boolean; error?: string }>> {
  const results: Array<{ toolCallId: string; ok: boolean; error?: string }> =
    [];
  for (const call of toolCalls) {
    if (call.toolName !== "executeBatchPlan" || !call.ok) continue;
    const output = call.output as
      | { toolCallId?: string; runId?: string; status?: string; ok?: boolean }
      | undefined;
    if (!output?.runId || output.status !== "prepared") continue;
    const toolCallId = output.toolCallId ?? call.toolCallId;
    const journal = readBatchPlanJournal(toolCallId, output.runId);
    if (!journal) {
      results.push({
        toolCallId,
        ok: false,
        error: "找不到批量计划 journal",
      });
      continue;
    }
    try {
      const executed = await executePreparedBatchPlan(toolCallId, output.runId);
      results.push({
        toolCallId,
        ok: executed.ok,
        error: executed.ok ? undefined : executed.error,
      });
      void journal;
    } catch (error) {
      results.push({
        toolCallId,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return results;
}

export function installTestBridge() {
  if (!import.meta.env.DEV) return;
  (window as Window & { __GOOSE_TEST__?: Record<string, unknown> }).__GOOSE_TEST__ =
    {
      getTabsState: () => useTabs.getState(),
      getPagesState: () => usePages.getState(),
      getNotebooksState: () => useNotebooks.getState(),
      createNotebook: (name?: string, icon?: string) =>
        useNotebooks.getState().createNotebook(name, icon),
      activateNotebook: (notebookId: string) => activateNotebook(notebookId),
      setCloseTabShortcut: (shortcut: string) =>
        useSettings.getState().setCloseTabShortcut(shortcut),
      openPreviewTab: (pageId: string) =>
        useTabs.getState().openPreviewTab(pageId),
      openPermanentTab: (pageId: string, pin?: boolean) =>
        useTabs.getState().openPermanentTab(pageId, { pin }),
      togglePinTab: (tabId: string) => useTabs.getState().togglePinTab(tabId),
      setActiveTab: (tabId: string) => useTabs.getState().setActiveTab(tabId),
      createPage: (parentId?: string, workspaceId?: string) =>
        usePages.getState().createPage(parentId, workspaceId),
      resetTabs: () => {
        useFileNavHistory.getState().reset();
        useTabs.setState({
          openTabs: [],
          activeTabId: null,
          tabHistory: [],
          tabHistoryIndex: -1,
          recentlyClosedPageIds: [],
        });
      },

      getAiRuntime: () => resolveNotebookAiRuntime(),

      /** 配置 OpenAI 兼容端点（DeepSeek / 中转验收用） */
      configureOpenAICompatibleAI: (config: {
        baseURL: string;
        apiKey: string;
        modelId: string;
        enabled?: boolean;
        providerId?: "deepseek" | "glm" | "minimax" | "custom-openai";
      }) => {
        const providerId = config.providerId ?? "custom-openai";
        useSettings.getState().saveAICustomConfig({
          providerId,
          protocol: "openai",
          baseURL: config.baseURL,
          apiKey: config.apiKey,
          modelOptions: [
            {
              id: config.modelId,
              label: config.modelId,
            },
          ],
        });
        useSettings.getState().setAISelectedModelId(config.modelId);
        useSettings.getState().setAIEnabled(config.enabled ?? true);
        return {
          runtime: resolveNotebookAiRuntime(),
          enabled: useSettings.getState().ai.enabled,
          protocol: useSettings.getState().ai.customProtocol,
          providerId: useSettings.getState().ai.customProviderId,
          modelId: useSettings.getState().ai.selectedModelId,
          baseURL: useSettings.getState().ai.customOpenAIBaseURL,
        };
      },

      /** 按供应商预设只填 Key 并拉取模型（浏览器验收用） */
      configureProviderAI: async (config: {
        providerId: "deepseek" | "glm" | "minimax";
        apiKey: string;
        enabled?: boolean;
        modelId?: string;
      }) => {
        const { fetchCustomAIModels, getAIProviderPreset, resolveProtocolForProvider } =
          await import("@/lib/ai-provider");
        const preset = getAIProviderPreset(config.providerId);
        const baseURL = preset.baseURL!;
        const listProtocol =
          config.providerId === "deepseek" ? "openai" : preset.protocol;
        const modelOptions = await fetchCustomAIModels({
          protocol: listProtocol as "openai" | "openai-responses" | "claude",
          baseURL,
          apiKey: config.apiKey,
          providerId: config.providerId,
        });
        const modelId =
          config.modelId ??
          modelOptions.find((m) => /flash/i.test(m.id))?.id ??
          modelOptions[0]?.id ??
          null;
        const protocol = resolveProtocolForProvider(
          config.providerId,
          modelId,
          preset.protocol,
        );
        useSettings.getState().saveAICustomConfig({
          providerId: config.providerId,
          protocol,
          baseURL,
          apiKey: config.apiKey,
          modelOptions,
        });
        if (modelId) {
          useSettings.getState().setAISelectedModelId(modelId);
        }
        useSettings.getState().setAIEnabled(config.enabled ?? true);
        const ai = useSettings.getState().ai;
        return {
          providerId: ai.customProviderId,
          protocol: ai.customProtocol,
          modelId: ai.selectedModelId,
          modelCount: ai.customModelOptions.length,
          models: ai.customModelOptions.map((m) => m.id),
          baseURL:
            protocol === "openai-responses"
              ? ai.customOpenAIResponsesBaseURL
              : ai.customOpenAIBaseURL,
        };
      },

      /** 播种验收用笔记样本 */
      seedAcceptanceNotes: (notebookId?: string) => {
        const notebooks = useNotebooks.getState().notebooks;
        const nbId =
          notebookId ??
          Object.keys(notebooks)[0] ??
          useNotebooks.getState().createNotebook("验收笔记本");
        activateNotebook(nbId);

        const pageA = makePage({
          id: `accept-a-${Date.now()}`,
          workspaceId: nbId,
          title: "验收笔记A-产品规划",
          body: "产品目标是做本地优先的 AI 笔记本，支持搜索、编辑与引用。关键能力包含批注、合并与润色。",
        });
        const pageB = makePage({
          id: `accept-b-${Date.now()}`,
          workspaceId: nbId,
          title: "验收笔记B-技术架构",
          body: "Agent harness 使用 Pi，领域工具由鹅实现。DeepSeek 通过 OpenAI 兼容协议接入。",
        });
        const pageC = makePage({
          id: `accept-c-${Date.now()}`,
          workspaceId: nbId,
          title: "验收笔记C-待合并草稿",
          body: "这是一份待合并的草稿：列出本周待办与风险。",
        });

        usePages.setState((state) => ({
          pages: {
            ...state.pages,
            [pageA.id]: pageA,
            [pageB.id]: pageB,
            [pageC.id]: pageC,
          },
          activePageId: pageA.id,
        }));
        useTabs.getState().openPermanentTab(pageA.id);

        return {
          notebookId: nbId,
          pageIds: [pageA.id, pageB.id, pageC.id],
          titles: [pageA, pageB, pageC].map((p) =>
            // title from content first block
            (p as Page).id,
          ),
          pages: {
            a: pageA.id,
            b: pageB.id,
            c: pageC.id,
          },
        };
      },

      /**
       * 直接走 buildTransport（默认 Pi）发送一轮 prompt，收集 tool call。
       * autoApprove=true 时自动执行 prepared 的 executeBatchPlan。
       */
      runAiPrompt: async (options: {
        notebookId: string;
        text: string;
        currentPageId?: string | null;
        autoApprove?: boolean;
      }) => {
        const transportResult = buildTransport(
          options.notebookId,
          options.currentPageId,
        );
        if (!transportResult.ok) {
          return {
            ok: false as const,
            reason: transportResult.reason,
            runtime: resolveNotebookAiRuntime(),
          };
        }

        const userMessage: NotebookAiMessage = {
          id: createId("user"),
          role: "user",
          parts: [{ type: "text", text: options.text }],
        };

        const stream = await transportResult.transport.sendMessages({
          trigger: "submit-message",
          chatId: `accept-${options.notebookId}`,
          messageId: undefined,
          messages: [userMessage],
          abortSignal: undefined,
        });

        const collected = await readUiMessageStream(stream);
        let approvals: Array<{
          toolCallId: string;
          ok: boolean;
          error?: string;
        }> = [];
        if (options.autoApprove !== false) {
          approvals = await autoApproveBatchPlans(collected.toolCalls);
        }

        return {
          ok: collected.errors.length === 0,
          runtime: transportResult.runtime,
          toolCalls: collected.toolCalls,
          errors: collected.errors,
          text: collected.texts.join(""),
          approvals,
        };
      },
    };
}
