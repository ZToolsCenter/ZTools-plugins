import { useNotebooks } from "@/stores/useNotebooks";
import { usePages } from "@/stores/usePages";
import { useTabs } from "@/stores/useTabs";
import { guardNotebookForAiWrite } from "@/lib/notebook-ai/pageWriteGuard";
import type { JSONContent } from "@/types";

export type AiPageCreationResult =
  | { ok: true; pageId: string }
  | { ok: false; error: string };

interface AiPageCreationRequest {
  toolCallId: string;
  notebookId: string;
  title: string;
  content: JSONContent;
}

interface AiPageCreationOperation {
  notebookId: string;
  promise: Promise<AiPageCreationResult>;
}

const operations = new Map<string, AiPageCreationOperation>();

async function createPage(
  request: AiPageCreationRequest,
): Promise<AiPageCreationResult> {
  const notebookGuard = guardNotebookForAiWrite(request.notebookId);
  if (!notebookGuard.ok) return notebookGuard;

  try {
    const notebook = useNotebooks.getState().notebooks[request.notebookId]!;
    let pageId: string | null;

    if (notebook.source === "local-folder") {
      pageId = await usePages.getState().createLocalPageRecord({
        workspaceId: request.notebookId,
        title: request.title,
        content: request.content,
      });
    } else {
      pageId = usePages.getState().createPageRecord({
        workspaceId: request.notebookId,
        content: request.content,
      });
    }

    if (!pageId) {
      return { ok: false, error: "创建页面失败，内容未保存" };
    }

    // 页面记录一旦创建成功就必须返回同一个 pageId。标签页等 UI 副作用失败时
    // 不能把结果伪装成“未创建”，否则调用方重试会留下孤儿页或重复页。
    try {
      useTabs.getState().openTab(pageId);
    } catch (error) {
      console.error("[notebook-ai] open created page failed", error);
    }
    try {
      useNotebooks.getState().setLastActivePage(request.notebookId, pageId);
    } catch (error) {
      console.error("[notebook-ai] remember created page failed", error);
    }
    return { ok: true, pageId };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error && error.message
          ? error.message
          : "创建页面失败，内容未保存",
    };
  }
}

/**
 * 同一个 AI 工具调用无论由流式预览还是 execute 先到达，都只创建一次页面。
 * 已完成结果在当前应用进程内持续保留，避免迟到或重放的流式事件再次建页。
 * 记录只保存 notebookId 和最终 Promise，不保留正文；应用重启后工具调用也不会重放。
 */
export function getOrCreateAiPage(
  request: AiPageCreationRequest,
): Promise<AiPageCreationResult> {
  if (!request.toolCallId) {
    return Promise.resolve({ ok: false, error: "缺少 AI 工具调用编号" });
  }

  const existing = operations.get(request.toolCallId);
  if (existing) {
    if (existing.notebookId !== request.notebookId) {
      return Promise.resolve({
        ok: false,
        error: "AI 工具调用与目标笔记本不一致，已取消创建",
      });
    }
    return existing.promise;
  }

  const operation: AiPageCreationOperation = {
    notebookId: request.notebookId,
    // 真实创建在微任务中开始；当前函数会先把共享 Promise 登记进 Map，
    // 即使 store 订阅者产生同步重入，后续调用也只能拿到这一个操作。
    promise: Promise.resolve().then(() => createPage(request)),
  };
  operations.set(request.toolCallId, operation);
  void operation.promise.then(
    (result) => {
      // 成功结果持续保留以保证幂等；明确失败时释放占位，让正式 execute
      // 可以从流式预建的瞬时失败中重试。
      if (!result.ok && operations.get(request.toolCallId) === operation) {
        operations.delete(request.toolCallId);
      }
    },
    () => {
      if (operations.get(request.toolCallId) === operation) {
        operations.delete(request.toolCallId);
      }
    },
  );
  return operation.promise;
}
