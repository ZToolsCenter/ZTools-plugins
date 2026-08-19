/**
 * liveWriter.ts — 流式写入页面内容
 *
 * 处理 createPage / updatePage 工具的 input-streaming 阶段：
 *  - 首次拿到 title 即建页并跳转打开
 *  - 每 ~200ms 节流把"已收到的部分 markdown"转 blocks 写入该页
 *  - state === 'output-available' 时用完整 markdown 做最终落盘
 *
 * 暴露给 UI 层的接口：handleStreamingWritePart(part, ctx)
 */

import type { ToolUIPart } from "ai";
import type { LiveWriterContext } from "./types";
import { usePages } from "@/stores/usePages";
import { useTabs } from "@/stores/useTabs";
import { buildAiPageContent } from "@/lib/notebook-ai/markdown";
import {
  getOrCreateAiPage,
  type AiPageCreationResult,
} from "@/lib/notebook-ai/pageCreationCoordinator";
import {
  guardPageForAiWrite,
  writePageContentSafely,
} from "@/lib/notebook-ai/pageWriteGuard";
import type { JSONContent } from "@/types";

// ----------------------------------------------------------------
// 内部状态：按 toolCallId 追踪流式写入会话
// ----------------------------------------------------------------
interface WriterSession {
  pageId: string;
  notebookId: string;
  title: string;
  lastScheduled: number;
  throttleTimer: ReturnType<typeof setTimeout> | null;
  lastMarkdown: string;
  follow: boolean;
  wheelCleanup: (() => void) | null;
}

const sessions = new Map<string, WriterSession>();
const stoppedToolCalls = new Set<string>();

const THROTTLE_MS = 200;

// ----------------------------------------------------------------
// 内部工具函数
// ----------------------------------------------------------------

/** 从部分 JSON 字符串中尽力提取 title 和 markdown 字段 */
function tryExtractFromPartialJson(partialInput: unknown): {
  title?: string;
  markdown?: string;
} {
  if (!partialInput || typeof partialInput !== "object") return {};
  const obj = partialInput as Record<string, unknown>;
  return {
    title: typeof obj.title === "string" ? obj.title : undefined,
    markdown: typeof obj.markdown === "string" ? obj.markdown : undefined,
  };
}

/** 获取当前活动页的 pageId */
function getActivePageId(): string | null {
  const { openTabs, activeTabId } = useTabs.getState();
  if (!activeTabId) return null;
  const tab = openTabs.find((t) => t.id === activeTabId);
  return tab?.pageId ?? null;
}

/** 跟随滚动到底部（仅当该页面是当前活动页且 follow=true） */
function followScroll(session: WriterSession) {
  if (!session.follow) return;
  if (getActivePageId() !== session.pageId) return;
  if (typeof window === "undefined") return;

  const scroll = () => {
    if (!session.follow) return;
    if (getActivePageId() !== session.pageId) return;
    const container = document.querySelector(
      ".page-scroll-container",
    ) as HTMLElement | null;
    if (!container) return;
    if (container.scrollHeight <= container.clientHeight) return;
    container.scrollTop = container.scrollHeight;
  };

  // reload 事件里 replaceBlocks 是同步的，DOM 已更新，立即滚一次；
  // rAF 在后台标签页不触发，不能只依赖它，再用两次 setTimeout 兜异步渲染
  scroll();
  requestAnimationFrame(scroll);
  setTimeout(scroll, 80);
  setTimeout(scroll, 400);
}

/** 触发编辑器重载当前页面内容（replaceInPage 等非流式写入工具也复用此通路） */
export function reloadEditorIfActive(pageId: string) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("goose-note:reload-active-editor", {
        detail: { pageId },
      }),
    );
  }
}

/** 写入中间帧（silent=true，不刷新 updatedAt，不触发落盘队列） */
function writeIntermediateFrame(session: WriterSession): boolean {
  const guard = guardPageForAiWrite(session.pageId, {
    expectedNotebookId: session.notebookId,
  });
  if (!guard.ok) return false;

  try {
    const content = buildAiPageContent(session.title, session.lastMarkdown);
    usePages
      .getState()
      .updatePage(
        session.pageId,
        { content: content as JSONContent },
        { silent: true },
      );
    reloadEditorIfActive(session.pageId);
    followScroll(session);
    return true;
  } catch {
    // 部分 markdown 解析失败，跳过此帧
    return true;
  }
}

/** 最终落盘（完整 markdown，走正常持久化路径） */
async function writeFinalFrame(
  markdown: string,
  title: string,
  session: WriterSession,
): Promise<boolean> {
  try {
    const content = buildAiPageContent(title, markdown);
    const result = await writePageContentSafely(
      session.pageId,
      content as JSONContent,
      { expectedNotebookId: session.notebookId },
    );
    if (!result.ok) {
      console.error("[liveWriter] writeFinalFrame refused", result.error);
      return false;
    }
    reloadEditorIfActive(session.pageId);
    followScroll(session);
    return true;
  } catch (err) {
    console.error("[liveWriter] writeFinalFrame failed", err);
    return false;
  }
}

// ----------------------------------------------------------------
// 创建/打开页面
// ----------------------------------------------------------------
async function ensurePageCreated(
  title: string,
  notebookId: string,
  toolCallId: string,
  initialMarkdown = "",
  retryFailedCreation = false,
): Promise<AiPageCreationResult> {
  if (stoppedToolCalls.has(toolCallId)) {
    return { ok: false, error: "本轮 AI 写入已结束" };
  }
  const existing = sessions.get(toolCallId);
  if (existing) return { ok: true, pageId: existing.pageId };

  const request = {
    toolCallId,
    notebookId,
    title,
    content: buildAiPageContent(title, initialMarkdown) as JSONContent,
  };
  let creation = await getOrCreateAiPage(request);
  if (!creation.ok && retryFailedCreation) {
    creation = await getOrCreateAiPage(request);
  }
  if (!creation.ok || stoppedToolCalls.has(toolCallId)) return creation;

  const existingAfterCreate = sessions.get(toolCallId);
  if (existingAfterCreate) {
    return { ok: true, pageId: existingAfterCreate.pageId };
  }

  const pageGuard = guardPageForAiWrite(creation.pageId, {
    expectedNotebookId: notebookId,
  });
  if (!pageGuard.ok) return pageGuard;

  const session: WriterSession = {
    pageId: creation.pageId,
    notebookId,
    title,
    lastScheduled: 0,
    throttleTimer: null,
    lastMarkdown: initialMarkdown,
    follow: true,
    wheelCleanup: null,
  };
  sessions.set(toolCallId, session);

  // 绑定滚轮监听：向上滚→停止跟随，滚回底部→恢复跟随
  if (typeof window !== "undefined" && typeof document !== "undefined") {
    const container = document.querySelector(".page-scroll-container");
    if (container) {
      const onWheel = (e: Event) => {
        const we = e as WheelEvent;
        if (we.deltaY < 0) {
          session.follow = false;
        } else {
          const el = container as HTMLElement;
          const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
          if (dist < 48) session.follow = true;
        }
      };
      container.addEventListener("wheel", onWheel, { passive: true });
      session.wheelCleanup = () =>
        container.removeEventListener("wheel", onWheel);
    }
  }

  return creation;
}

/**
 * createPage 工具的唯一最终提交入口。它与流式预建共享同一个单飞创建操作，
 * 因此 execute 与 React effect 无论谁先到达都只能得到同一页。
 */
export async function createAndFinalizePage(params: {
  toolCallId: string;
  notebookId: string;
  title: string;
  markdown: string;
}): Promise<AiPageCreationResult> {
  const creation = await ensurePageCreated(
    params.title,
    params.notebookId,
    params.toolCallId,
    params.markdown,
    true,
  );
  if (!creation.ok) return creation;

  const session = sessions.get(params.toolCallId);
  if (!session) {
    return { ok: false, error: "AI 写入会话已结束" };
  }

  try {
    const written = await writeFinalFrame(
      params.markdown,
      params.title,
      session,
    );
    return written
      ? creation
      : { ok: false, error: "页面写入失败，内容未保存" };
  } finally {
    cleanupWriterSession(params.toolCallId);
  }
}

// ----------------------------------------------------------------
// 公开接口
// ----------------------------------------------------------------

export type StreamingWritePart = ToolUIPart & {
  type: "tool-createPage" | "tool-updatePage";
};

/**
 * 处理 createPage / updatePage 工具的流式 part。
 * 由 UI 层在每次 messages 更新时调用。
 *
 * @param part - 工具调用 part（类型为 tool-createPage 或 tool-updatePage）
 * @param ctx - 包含当前绑定笔记本 id 的上下文
 */
export async function handleStreamingWritePart(
  part: StreamingWritePart,
  ctx: LiveWriterContext,
): Promise<void> {
  const partData = part as unknown as {
    toolCallId: string;
    state: string;
    input?: unknown;
    output?: unknown;
  };
  const { toolCallId, state, input, output } = partData;
  const isCreatePage = part.type === "tool-createPage";

  // React 会在后续文本分片到达时重复传入已经完成的工具 part。
  // 终态只处理一次，避免同一个 updatePage 随每个文本分片重复刷新或落盘。
  if (stoppedToolCalls.has(toolCallId)) return;

  if (state.includes("error") || state.includes("denied")) {
    cleanupWriterSession(toolCallId);
    return;
  }

  if (state === "input-streaming") {
    const { title, markdown } = tryExtractFromPartialJson(input);

    if (!title) return; // title 还没流出来，等下一帧

    // 只有当 markdown 字段已出现（说明 title 的 JSON 字符串已闭合），才建页
    // 防止截断标题建页（bug 2 fix）：title 在 markdown 字段出现之前可能还未完整
    if (isCreatePage && !sessions.has(toolCallId)) {
      if (markdown === undefined) return; // title 还未完整，继续等
      await ensurePageCreated(title, ctx.notebookId, toolCallId);
    }

    const session = sessions.get(toolCallId);
    if (!session) return;

    const frameGuard = guardPageForAiWrite(session.pageId, {
      expectedNotebookId: session.notebookId,
    });
    if (!frameGuard.ok) {
      cleanupWriterSession(toolCallId);
      return;
    }

    // updatePage 的 markdown 可能因为工具调用修复/兜底暂时缺失；
    // 缺正文时不能写空帧，否则会把当前页清空。
    if (!isCreatePage && markdown === undefined) return;
    session.lastMarkdown = markdown ?? "";

    // 节流调度写入
    const now = Date.now();
    if (now - session.lastScheduled < THROTTLE_MS) {
      // 已有定时器在跑，更新 markdown 数据后等定时器触发
      return;
    }

    session.lastScheduled = now;
    if (session.throttleTimer) {
      clearTimeout(session.throttleTimer);
    }
    session.throttleTimer = setTimeout(() => {
      const s = sessions.get(toolCallId);
      if (!s) return;
      if (!writeIntermediateFrame(s)) {
        cleanupWriterSession(toolCallId);
        return;
      }
      s.throttleTimer = null;
    }, THROTTLE_MS);
  } else if (state === "output-available") {
    // 最终落盘
    // 清理定时器
    const session = sessions.get(toolCallId);
    // createPage 的 output 只有在 execute 完成后才应到达；若 UI 事件乱序且当前
    // 没有 session，不要抢先把 toolCallId 标成 stopped，正式 execute 仍需建页。
    if (isCreatePage && !session) return;
    if (session?.throttleTimer) {
      clearTimeout(session.throttleTimer);
      session.throttleTimer = null;
    }

    try {
      // output-available 时 input 已完整，从 input 取 markdown
      const { title: inputTitle, markdown: inputMarkdown } =
        tryExtractFromPartialJson(input);

      if (isCreatePage) {
        // createPage：优先使用 session（liveWriter 已建的页面）中的 pageId
        // execute() 会通过 registry 拿同一个 pageId，不会再建第二页
        const pageId = session?.pageId ?? null;
        if (!pageId) return;

        const md = inputMarkdown ?? "";
        // 用最终完整 title（input 已完整），确保标题与模型输出一致
        const title = inputTitle ?? session?.title ?? "";
        // 若最终 title 与建页时不同，writeFinalFrame 里 buildPageContent 会用最新 title 覆盖
        if (session) await writeFinalFrame(md, title, session);
      } else {
        // updatePage.execute 已经完成最终落盘；UI 层只负责刷新一次活动编辑器。
        // 不能在这里再次写入，否则最终回复的每个文本分片都会重复保存整篇页面。
        const pageId =
          input && typeof input === "object"
            ? ((input as Record<string, unknown>).pageId as string | undefined)
            : undefined;
        const targetPageId =
          pageId ?? ctx.currentPageId ?? usePages.getState().activePageId;
        if (!targetPageId) return;
        const result =
          output && typeof output === "object"
            ? (output as Record<string, unknown>)
            : null;
        if (result?.ok === true) reloadEditorIfActive(targetPageId);
      }
    } finally {
      cleanupWriterSession(toolCallId);
    }
  }
}

/**
 * 清理指定 toolCallId 的写入会话（例如错误发生时）。
 */
export function cleanupWriterSession(toolCallId: string): void {
  stoppedToolCalls.add(toolCallId);
  if (stoppedToolCalls.size > 200) {
    const oldest = stoppedToolCalls.values().next().value;
    if (oldest) stoppedToolCalls.delete(oldest);
  }
  const session = sessions.get(toolCallId);
  if (session?.throttleTimer) {
    clearTimeout(session.throttleTimer);
  }
  session?.wheelCleanup?.();
  sessions.delete(toolCallId);
}
