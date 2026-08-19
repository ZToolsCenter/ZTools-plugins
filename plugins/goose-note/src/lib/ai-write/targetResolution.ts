import type { JSONContent } from "@/types";
import { getPageTitle } from "@/components/editor/utils/page-title";
import { useNotebooks } from "@/stores/useNotebooks";
import { usePages } from "@/stores/usePages";
import {
  type AiComposerPayload,
  type AiFileReferenceAttrs,
} from "@/components/editor/ai/composer/referenceLookup";

export type AiWriteAction =
  | "chat_only"
  | "replace_page"
  | "append_page"
  | "replace_block_range"
  | "create_root_page"
  | "create_child_page";

export interface AiBlockRange {
  startBlockId: string;
  endBlockId: string;
  rangeLabel: string;
  blockCount: number;
}

export type AiTargetMode =
  | "chat_only"
  | "current_page"
  | "current_notebook"
  | "specific_page"
  | "ambiguous";

export type AiTargetSource =
  | "selector"
  | "reference"
  | "session_memory"
  | "prompt_rule"
  | "llm_router";

export interface AiTargetSelection {
  mode: AiTargetMode;
  pageId?: string | null;
  source: AiTargetSource;
}

export type AiTargetRef = Omit<AiFileReferenceAttrs, "role"> & {
  role: "destination";
};

export interface AiStickyTarget {
  pageId: string;
  workspaceId?: string;
  defaultAction?: "replace_page";
  source: AiTargetSource;
  pageTitle?: string;
  notebookName?: string;
  isLocalFolder?: boolean;
}

export interface AiResolvedTarget {
  mode: AiTargetMode;
  action: AiWriteAction;
  source: AiTargetSource;
  pageId?: string;
  workspaceId?: string;
  parentId?: string;
  targetLabel: string;
  pageTitle?: string;
  notebookName?: string;
  isLocalFolder?: boolean;
  isFolder?: boolean;
  range?: AiBlockRange;
}

export interface AiWritePlan {
  action: Exclude<AiWriteAction, "chat_only">;
  target: AiResolvedTarget;
  promptText: string;
  outputMarkdown: string;
  previewTitle: string;
  content: JSONContent;
  status?: "pending" | "committed" | "cancelled";
  committedPageId?: string;
}

export interface AiContextBundle {
  originPageId?: string | null;
  originNotebookId?: string | null;
  referenceContextBlock: string;
  originContextBlock: string;
  targetContextBlock: string;
}

// ── Patterns ──────────────────────────────────────────────────────────────────

const EXPLICIT_CHAT_PATTERN = /(仅聊天|只聊天|只回答|不要写入|不要落盘|仅回复|只讨论)/;
// 可视化请求强制走 chat_only，图表只在聊天界面渲染
const DATAVIZ_CHAT_PATTERN = /(图表|折线图|柱状图|饼图|散点图|热力图|面积图|趋势图|可视化|画图|画个图|出个图|对比图|交互式视图|交互视图|echarts|数据图|柱形图|扇形图|曲线图|雷达图)/;
const APPEND_PATTERN =
  /(追加|补充|添加|附加|继续写|续写|补到|加到|append)/;
const CHILD_PATTERN = /(下面|下边|下方|子页面|子页|子文档)/;
const TARGET_VERB_PATTERN =
  /(生成到|写到|写入到|写进|放到|放进|保存到|同步到|落到|输出到|创建到|替换到|覆盖到|改写到|更新到|生成进|写入|替换|覆盖|改写|重写)/;
const CONTEXT_HINT_PATTERN = /(参考|参照|结合|基于|根据|对照|引用|查看|看下|看看|分析)/;
const FOLLOW_UP_EDIT_PATTERN =
  /(再改|继续改|接着改|接着写|再写|改得更|更正式|更口语|更简洁|更自然|缩短一点|短一点|展开一点|扩写一下|润色一下|换个口吻|调整一下|修改一下|优化一下|再来一版|重来一版)/;

// ── Internal helpers ─────────────────────────────────────────────────────────

function normalizeSemanticText(value: string) {
  return value.replace(/\s+/g, "").toLowerCase();
}

function collectNeighborText(
  tokens: AiComposerPayload["tokens"],
  index: number,
  direction: "before" | "after",
  maxLength = 18,
) {
  const pieces: string[] = [];
  let remaining = maxLength;
  let cursor = direction === "before" ? index - 1 : index + 1;

  while (cursor >= 0 && cursor < tokens.length && remaining > 0) {
    const token = tokens[cursor];
    const text =
      token.type === "text"
        ? token.text
        : token.type === "reference"
          ? `@${token.reference.titleSnapshot}`
          : token.type === "skill"
            ? `/${token.skill.name}`
            : `[图片 ${token.image.fileName}]`;
    if (text) {
      const slice =
        direction === "before"
          ? text.slice(Math.max(0, text.length - remaining))
          : text.slice(0, remaining);
      if (direction === "before") {
        pieces.unshift(slice);
      } else {
        pieces.push(slice);
      }
      remaining -= slice.length;
    }
    cursor += direction === "before" ? -1 : 1;
  }

  return pieces.join("");
}

function detectDestinationReference(payload: AiComposerPayload): AiTargetRef | null {
  return resolveAiTargetReference(payload)?.reference ?? null;
}

function getResolvedPageTarget(
  pageId: string,
  action: AiWriteAction,
  mode: AiTargetMode,
  source: AiTargetSource,
): AiResolvedTarget | null {
  const page = usePages.getState().pages[pageId];
  if (!page) return null;

  const notebook = useNotebooks.getState().notebooks[page.workspaceId];
  const isLocalFolder = notebook?.source === "local-folder";
  const pageTitle = getPageTitle(page);

  if (page.isFolder) {
    return {
      mode,
      action: "create_child_page",
      source,
      pageId: page.id,
      parentId: page.id,
      workspaceId: page.workspaceId,
      targetLabel: `在 ${pageTitle} 下新建`,
      pageTitle,
      notebookName: notebook?.name ?? "未知笔记本",
      isLocalFolder,
      isFolder: true,
    };
  }

  return {
    mode,
    action,
    source,
    pageId: page.id,
    workspaceId: page.workspaceId,
    targetLabel:
      action === "append_page"
        ? `追加到 ${pageTitle}`
        : `写入 ${pageTitle}`,
    pageTitle,
    notebookName: notebook?.name ?? "未知笔记本",
    isLocalFolder,
    isFolder: false,
  };
}

function createUnavailableSpecificPageTarget(
  pageId: string,
  action: Extract<AiWriteAction, "replace_page" | "append_page">,
  source: AiTargetSource,
): AiResolvedTarget {
  return {
    mode: "specific_page",
    action,
    source,
    pageId,
    targetLabel: action === "append_page" ? "追加到目标页" : "写入目标页",
  } satisfies AiResolvedTarget;
}

function isFollowUpEditPrompt(normalizedPrompt: string) {
  return Boolean(normalizedPrompt) && FOLLOW_UP_EDIT_PATTERN.test(normalizedPrompt);
}

// ── Public API ────────────────────────────────────────────────────────────────

export function resolveAiTargetReference(payload: AiComposerPayload): {
  reference: AiTargetRef;
  tokenIndex: number;
} | null {
  for (let index = 0; index < payload.tokens.length; index += 1) {
    const token = payload.tokens[index];
    if (token.type !== "reference") continue;

    const explicitRole = token.role ?? token.reference.role;
    if (explicitRole === "context") continue;
    if (explicitRole === "target") {
      return {
        tokenIndex: index,
        reference: {
          ...token.reference,
          role: "destination",
        },
      };
    }

    const before = normalizeSemanticText(collectNeighborText(payload.tokens, index, "before"));
    const after = normalizeSemanticText(collectNeighborText(payload.tokens, index, "after"));

    if (CONTEXT_HINT_PATTERN.test(before) && !TARGET_VERB_PATTERN.test(before)) {
      continue;
    }

    const hasTargetCue =
      TARGET_VERB_PATTERN.test(before) ||
      APPEND_PATTERN.test(before) ||
      CHILD_PATTERN.test(after);

    if (!hasTargetCue) {
      continue;
    }

    return {
      tokenIndex: index,
      reference: {
        ...token.reference,
        role: "destination",
      },
    };
  }

  return null;
}

export function createAiChatOnlyTarget(source: AiTargetSource = "prompt_rule"): AiResolvedTarget {
  return {
    mode: "chat_only",
    action: "chat_only",
    source,
    targetLabel: "仅聊天",
  } satisfies AiResolvedTarget;
}

export function resolvedTargetToSelection(
  target: AiResolvedTarget | null | undefined,
): AiTargetSelection | null {
  if (!target) return null;

  if (target.mode === "specific_page") {
    if (!target.pageId) return null;
    return {
      mode: "specific_page",
      pageId: target.pageId,
      source: target.source,
    } satisfies AiTargetSelection;
  }

  return {
    mode: target.mode,
    source: target.source,
  } satisfies AiTargetSelection;
}

export function stickyTargetToSelection(
  stickyTarget: AiStickyTarget | null | undefined,
): AiTargetSelection | null {
  if (!stickyTarget?.pageId) return null;
  return {
    mode: "specific_page",
    pageId: stickyTarget.pageId,
    source: "session_memory",
  } satisfies AiTargetSelection;
}

export function createStickyTargetFromResolvedTarget(
  target: AiResolvedTarget | null | undefined,
): AiStickyTarget | null {
  if (!target?.pageId) return null;
  if (target.action !== "replace_page" && target.action !== "append_page") {
    return null;
  }

  return {
    pageId: target.pageId,
    workspaceId: target.workspaceId,
    defaultAction: "replace_page",
    source: target.source === "selector" ? "selector" : "session_memory",
    pageTitle: target.pageTitle,
    notebookName: target.notebookName,
    isLocalFolder: target.isLocalFolder,
  } satisfies AiStickyTarget;
}

export function resolveAiTargetSelection(params: {
  payload: AiComposerPayload;
  manualSelection?: AiTargetSelection | null;
  stickyTarget?: AiStickyTarget | null;
  recentWriteTarget?: AiTargetSelection | null;
  originPageId?: string | null;
  originNotebookId?: string | null;
}) {
  const { manualSelection, stickyTarget, recentWriteTarget, payload } = params;
  const normalizedPrompt = normalizeSemanticText(
    payload.freeformText || payload.promptText,
  );
  const stickySelection = stickyTargetToSelection(stickyTarget);
  const followUpPrompt = isFollowUpEditPrompt(normalizedPrompt);

  // 优先级 1：显式聊天 / 可视化请求
  if (EXPLICIT_CHAT_PATTERN.test(normalizedPrompt) || DATAVIZ_CHAT_PATTERN.test(normalizedPrompt)) {
    return {
      mode: "chat_only",
      source: "prompt_rule",
    } satisfies AiTargetSelection;
  }

  // 优先级 2：目标引用
  const destinationRef = detectDestinationReference(payload);
  if (destinationRef) {
    return {
      mode: "specific_page",
      pageId: destinationRef.pageId,
      source: "reference",
    } satisfies AiTargetSelection;
  }

  // 优先级 3：手动选择（保留给程序化调用）
  if (manualSelection?.mode === "specific_page" && manualSelection.pageId) {
    return {
      mode: "specific_page",
      pageId: manualSelection.pageId,
      source: "selector",
    } satisfies AiTargetSelection;
  }

  if (manualSelection) {
    return {
      ...manualSelection,
      source: "selector",
    } satisfies AiTargetSelection;
  }

  // 优先级 4：follow-up 编辑 + 最近写入目标 / stickyTarget
  if (followUpPrompt && recentWriteTarget?.mode === "specific_page" && recentWriteTarget.pageId) {
    return {
      mode: "specific_page",
      pageId: recentWriteTarget.pageId,
      source: "session_memory",
    } satisfies AiTargetSelection;
  }

  if (followUpPrompt && stickySelection?.pageId) {
    return {
      mode: "specific_page",
      pageId: stickySelection.pageId,
      source: "session_memory",
    } satisfies AiTargetSelection;
  }

  // 优先级 5：模糊场景交给 LLM
  return {
    mode: "ambiguous",
    source: "prompt_rule",
  } satisfies AiTargetSelection;
}

export function resolveAiTargetIntent(params: {
  payload: AiComposerPayload;
  selection: AiTargetSelection;
  originPageId?: string | null;
  originNotebookId?: string | null;
}) {
  const { payload, selection, originPageId, originNotebookId } = params;
  const normalizedPrompt = normalizeSemanticText(
    payload.freeformText || payload.promptText,
  );
  const wantsAppend = APPEND_PATTERN.test(normalizedPrompt);
  const wantsChild = CHILD_PATTERN.test(normalizedPrompt);

  if (selection.mode === "chat_only") {
    return createAiChatOnlyTarget(selection.source);
  }

  if (selection.mode === "current_notebook") {
    const notebookId = originNotebookId;
    const notebook = notebookId
      ? useNotebooks.getState().notebooks[notebookId]
      : undefined;
    return {
      mode: "current_notebook",
      action: "create_root_page",
      source: selection.source,
      workspaceId: notebookId ?? undefined,
      targetLabel: notebook ? `在 ${notebook.name} 中新建` : "在当前笔记本中新建",
      notebookName: notebook?.name ?? "当前笔记本",
      isLocalFolder: notebook?.source === "local-folder",
    } satisfies AiResolvedTarget;
  }

  if (selection.mode === "specific_page" && selection.pageId) {
    const targetPage = usePages.getState().pages[selection.pageId];
    if (!targetPage) {
      return createUnavailableSpecificPageTarget(
        selection.pageId,
        wantsAppend ? "append_page" : "replace_page",
        selection.source,
      );
    }

    if (targetPage.isFolder || wantsChild) {
      return getResolvedPageTarget(
        targetPage.id,
        "create_child_page",
        "specific_page",
        selection.source,
      )!;
    }

    return getResolvedPageTarget(
      targetPage.id,
      wantsAppend ? "append_page" : "replace_page",
      "specific_page",
      selection.source,
    )!;
  }

  if (originPageId) {
    return getResolvedPageTarget(
      originPageId,
      wantsAppend ? "append_page" : "replace_page",
      "current_page",
      selection.source,
    )!;
  }

  return createAiChatOnlyTarget(selection.source);
}

export function resolveAiTargetFromSelection(params: {
  selection: AiTargetSelection;
  originPageId?: string | null;
  originNotebookId?: string | null;
}) {
  return resolveAiTargetIntent({
    payload: {
      promptText: "",
      freeformText: "",
      references: [],
      images: [],
      skills: [],
      tokens: [],
    },
    selection: params.selection,
    originPageId: params.originPageId,
    originNotebookId: params.originNotebookId,
  });
}
