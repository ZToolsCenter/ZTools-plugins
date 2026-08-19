import { useEffect, useMemo, useState, type ReactNode } from "react";
import * as LucideIcons from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { toast } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { useHistoryView } from "@/stores/useHistoryView";
import { usePages } from "@/stores/usePages";
import { resolveHistoryBackend } from "@/lib/history/backend";
import { filterAdjacentDuplicateHistoryEntries } from "@/lib/history/dedupe";
import {
  markMilestone,
  recordHistorySnapshot,
  unmarkMilestone,
} from "@/lib/history/snapshot";
import { materializeVersion } from "@/lib/history/restore";
import { parseLocalFrontmatterBlob } from "@/lib/local-frontmatter";
import type { HistoryIndex, HistoryIndexEntry } from "@/lib/history/types";
import {
  createEditorSafeContent,
  extractBlockNoteTitle,
  normalizePageContent,
  type BlockNoteContent,
} from "@/components/editor/utils/blocknote-content";
import { editorSchema } from "@/components/editor/core/EditorComposer";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { HistoryReadOnlyEditor } from "./HistoryReadOnlyEditor";
import { closeNotebookAiIfFullscreen } from "../notebook-ai/useNotebookAiPanel";

const TRIGGER_LABEL: Record<HistoryIndexEntry["trigger"], string> = {
  idle: "自动",
  manual: "手动",
  "pre-op": "操作前",
};

type SelectedHistoryStatus = "idle" | "loading" | "ready" | "missing" | "error";

function triggerLabel(trigger: HistoryIndexEntry["trigger"]): string {
  return TRIGGER_LABEL[trigger] ?? "自动";
}

function createSafeHistoryContent(content: unknown): BlockNoteContent | null {
  try {
    return createEditorSafeContent(
      normalizePageContent(content as any),
      editorSchema,
    );
  } catch (error) {
    console.error("[history] normalize history content failed", error);
    return null;
  }
}

function formatGroupLabel(ts: number, now: number): string {
  const d1 = new Date(ts);
  const d2 = new Date(now);
  const day1 = new Date(
    d1.getFullYear(),
    d1.getMonth(),
    d1.getDate(),
  ).getTime();
  const day2 = new Date(
    d2.getFullYear(),
    d2.getMonth(),
    d2.getDate(),
  ).getTime();
  const diffDays = Math.floor((day2 - day1) / (24 * 3600 * 1000));
  if (diffDays === 0) return "今天";
  if (diffDays === 1) return "昨天";
  if (diffDays < 7) return `${diffDays} 天前`;
  return d1.toLocaleDateString("zh-CN", { month: "long", day: "numeric" });
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/**
 * 历史模式的状态/行为共享层。
 * 所有三个布局插槽（VersionPane / Toolbar / Reader）通过这个 hook 拿到同一份数据。
 * 这样 WorkspaceLayout 可以把它们分别放到 Sidebar 右侧 / main 顶部 / main 编辑区，
 * 而不必再把版本列表塞进编辑区内部。
 */
function useHistoryViewLogic() {
  const active = useHistoryView((s) => s.active);
  const selectedVersionId = useHistoryView((s) => s.selectedVersionId);
  const refreshTick = useHistoryView((s) => s.refreshTick);
  const exit = useHistoryView((s) => s.exit);
  const select = useHistoryView((s) => s.select);
  const bumpRefresh = useHistoryView((s) => s.bumpRefresh);

  const { getPage, updatePage } = usePages();
  const pageId = active;
  const page = pageId ? getPage(pageId) : undefined;
  const pageTitle = page ? extractBlockNoteTitle(page.content) || "无标题" : "";

  const [index, setIndex] = useState<HistoryIndex | null>(null);
  const [selectedContent, setSelectedContent] =
    useState<BlockNoteContent | null>(null);
  const [selectedStatus, setSelectedStatus] =
    useState<SelectedHistoryStatus>("idle");
  const [isRestoring, setIsRestoring] = useState(false);
  const [pendingMilestoneVersionId, setPendingMilestoneVersionId] = useState<
    string | null
  >(null);

  // 加载版本索引
  useEffect(() => {
    if (!pageId) {
      setIndex(null);
      return;
    }
    let cancelled = false;
    const backend = resolveHistoryBackend(pageId);
    backend
      .loadIndex(pageId)
      .then(async (idx) => {
        const versions = await filterAdjacentDuplicateHistoryEntries(
          pageId,
          idx.versions,
          backend,
        );
        if (!cancelled) setIndex({ ...idx, versions });
      })
      .catch(() => {
        if (!cancelled)
          setIndex({ pageId, versions: [], lastVersionCharCount: 0 });
      });
    return () => {
      cancelled = true;
    };
  }, [pageId, refreshTick]);

  // 加载选中版本内容
  useEffect(() => {
    if (!pageId || !selectedVersionId) {
      setSelectedContent(null);
      setSelectedStatus("idle");
      return;
    }
    let cancelled = false;
    setSelectedContent(null);
    setSelectedStatus("loading");
    materializeVersion(pageId, selectedVersionId)
      .then((result) => {
        if (cancelled) return;
        if (!result || result.content == null) {
          setSelectedContent(null);
          setSelectedStatus("missing");
          return;
        }
        const safeContent = createSafeHistoryContent(result.content);
        if (!safeContent) {
          setSelectedContent(null);
          setSelectedStatus("error");
          return;
        }
        setSelectedContent(safeContent);
        setSelectedStatus("ready");
      })
      .catch(() => {
        if (!cancelled) {
          setSelectedContent(null);
          setSelectedStatus("error");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [pageId, selectedVersionId]);

  useEffect(() => {
    if (!index || index.versions.length === 0) return;
    if (selectedVersionId) {
      if (index.versions.some((v) => v.versionId === selectedVersionId)) return;
    }
    const sorted = [...index.versions].sort(
      (a, b) => b.createdAt - a.createdAt,
    );
    select(sorted[0].versionId);
  }, [index, selectedVersionId, select]);

  useEffect(() => {
    if (pageId && !page) {
      exit();
    }
  }, [pageId, page, exit]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        exit();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [exit]);

  const groups = useMemo(() => {
    if (!index || index.versions.length === 0) return [];
    const sorted = [...index.versions].sort(
      (a, b) => b.createdAt - a.createdAt,
    );
    const now = Date.now();
    const result: { label: string; items: HistoryIndexEntry[] }[] = [];
    let currentLabel = "";
    for (const v of sorted) {
      const label = formatGroupLabel(v.createdAt, now);
      if (label !== currentLabel) {
        result.push({ label, items: [] });
        currentLabel = label;
      }
      result[result.length - 1].items.push(v);
    }
    return result;
  }, [index]);

  const selectedEntry = useMemo(
    () =>
      index?.versions.find((v) => v.versionId === selectedVersionId) ?? null,
    [index, selectedVersionId],
  );

  const handleRestore = () => {
    if (!pageId || !selectedVersionId || isRestoring) return;
    const current = getPage(pageId);
    if (!current) return;
    const ok = window.confirm(
      "将当前内容覆盖为此版本？\n当前内容会自动保留为一次「操作前」快照，可随时撤回。",
    );
    if (!ok) return;
    setIsRestoring(true);

    try {
      flushEditorContent(true);
    } catch {
      /* ignore */
    }

    const latest = getPage(pageId);
    if (!latest) return;

    recordHistorySnapshot({
      pageId,
      workspaceId: latest.workspaceId,
      content: latest.content,
      trigger: "pre-op",
    }).catch((err) => console.error("[history] pre-op snapshot failed:", err));

    materializeVersion(pageId, selectedVersionId)
      .then((result) => {
        if (!result || result.content == null) {
          toast.error("无法读取该版本");
          setIsRestoring(false);
          return;
        }
        const safeContent = createSafeHistoryContent(result.content);
        if (!safeContent) {
          toast.error("该历史版本格式异常，无法还原");
          setIsRestoring(false);
          return;
        }
        const updates: Parameters<typeof updatePage>[1] = {
          content: safeContent,
        };
        if (result.localFrontmatter !== undefined) {
          updates.localFrontmatter = result.localFrontmatter;
          // 还原 frontmatter 时同步 goose 设置，避免随后写盘用当前内存设置覆盖
          const fm = parseLocalFrontmatterBlob(result.localFrontmatter);
          updates.fontFamily = fm.settings.fontFamily;
          updates.isLocked = fm.settings.isLocked;
        }
        updatePage(pageId, updates);
        toast.success("已还原，当前内容已保留为「操作前」版本");
        setIsRestoring(false);
        exit();
      })
      .catch(() => {
        toast.error("无法读取该版本");
        setIsRestoring(false);
      });
  };

  const handleToggleMilestone = (versionId: string, willBe: boolean) => {
    if (!pageId || pendingMilestoneVersionId) return;
    setPendingMilestoneVersionId(versionId);
    if (willBe) {
      markMilestone(pageId, versionId)
        .then(() => {
          toast.success("已标记为里程碑");
          bumpRefresh();
        })
        .catch((err) => {
          console.error("[history] markMilestone failed:", err);
          toast.error("标记失败，请重试");
        })
        .finally(() => setPendingMilestoneVersionId(null));
    } else {
      unmarkMilestone(pageId, versionId)
        .then(() => {
          bumpRefresh();
        })
        .catch((err) => {
          console.error("[history] unmarkMilestone failed:", err);
          toast.error("取消标记失败，请重试");
        })
        .finally(() => setPendingMilestoneVersionId(null));
    }
  };

  return {
    pageId,
    page,
    pageTitle,
    groups,
    isEmpty: groups.length === 0,
    selectedVersionId,
    selectedEntry,
    selectedContent,
    selectedStatus,
    isRestoring,
    pendingMilestoneVersionId,
    exit,
    select,
    handleRestore,
    handleToggleMilestone,
  };
}

/**
 * 页面历史模块（历史模式下占据整块侧栏主体，替换笔记本头 + 页面树/大纲）。
 * 不自带宽度/背景/边框——靠 Sidebar 父容器提供（Sidebar 已是 shell-bg）。
 * 退出按钮在主区 HistoryToolbar 上，这里不重复放。
 */
export function HistoryVersionList() {
  const {
    groups,
    isEmpty,
    selectedVersionId,
    pendingMilestoneVersionId,
    select,
    handleToggleMilestone,
  } = useHistoryViewLogic();

  return (
    <div className="flex-1 min-h-0 flex flex-col" aria-label="页面历史">
      <div className="shrink-0 px-3 pt-3 pb-2">
        <div className="flex items-center gap-1.5">
          <LucideIcons.History className="h-3.5 w-3.5 text-[var(--goose-interactive-selected-fg)]" />
          <span className="text-[12px] font-medium text-foreground">
            页面历史
          </span>
        </div>
        <p className="mt-1 truncate whitespace-nowrap text-[11px] leading-none text-muted-foreground">
          选择时间点预览后还原
        </p>
      </div>
      {isEmpty ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 px-6 text-center">
          <LucideIcons.History className="h-10 w-10 text-muted-foreground/20" />
          <p className="text-xs text-muted-foreground/60">暂无历史版本</p>
          <p className="text-[11px] text-muted-foreground/40 leading-relaxed">
            停笔后合并保存，自动版本至少间隔 5 分钟
            <br />
            仅空白/换行变化不计入
          </p>
        </div>
      ) : (
        <ScrollArea className="flex-1">
          <div className="py-1 pb-4">
            {groups.map((group) => (
              <div key={group.label} className="mb-1">
                <div className="px-3 py-1.5 text-[10px] tracking-wider text-muted-foreground/55">
                  {group.label}
                </div>
                <div className="px-2">
                  {group.items.map((v, index) => {
                    const isSelected = selectedVersionId === v.versionId;
                    const isMilestonePending =
                      pendingMilestoneVersionId === v.versionId;
                    const isFirst = index === 0;
                    const isLast = index === group.items.length - 1;
                    const delta = v.charDelta;
                    const deltaText =
                      delta === 0 ? null : delta > 0 ? `+${delta}` : `${delta}`;
                    const detailTitle = [
                      new Date(v.createdAt).toLocaleString("zh-CN"),
                      triggerLabel(v.trigger),
                      `${v.charCount} 字`,
                      deltaText ? `变化 ${deltaText}` : null,
                      v.label || null,
                      v.isMilestone ? "里程碑" : null,
                    ]
                      .filter(Boolean)
                      .join(" · ");

                    return (
                      <div
                        key={v.versionId}
                        className={cn(
                          "history-version-item group relative rounded-[10px] transition-colors duration-150",
                          isSelected
                            ? "bg-[var(--goose-interactive-selected)]"
                            : "hover:bg-[var(--goose-interactive-hover)]",
                        )}
                      >
                        {/* 绝对定位轨道：覆盖整行高度（含 padding），相邻项首尾相接不断线 */}
                        <span
                          aria-hidden
                          className="pointer-events-none absolute bottom-0 left-1.5 top-0 z-[1] flex w-4 items-center justify-center"
                        >
                          {!isFirst ? (
                            <span className="absolute bottom-1/2 left-1/2 top-0 w-px -translate-x-1/2 bg-border/70" />
                          ) : null}
                          {!isLast ? (
                            <span className="absolute bottom-0 left-1/2 top-1/2 w-px -translate-x-1/2 bg-border/70" />
                          ) : null}
                          <span
                            className={cn(
                              "relative z-[1] h-2 w-2 rounded-full border",
                              isSelected
                                ? "border-[var(--goose-interactive-selected-fg)] bg-[var(--goose-interactive-selected-fg)]"
                                : "border-border bg-[hsl(var(--goose-shell-bg))]",
                            )}
                          />
                        </span>
                        <button
                          type="button"
                          title={detailTitle}
                          aria-current={isSelected ? "true" : undefined}
                          data-selected={isSelected ? "true" : "false"}
                          aria-label={`查看 ${group.label} ${formatTime(v.createdAt)} 的历史版本`}
                          onClick={() => {
                            closeNotebookAiIfFullscreen();
                            select(v.versionId);
                          }}
                          className={cn(
                            "flex min-h-8 w-full cursor-pointer items-center gap-2 rounded-[10px] py-1.5 pl-8 pr-11 text-left transition-[background-color,box-shadow] duration-150 focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--goose-interactive-selected-fg)]",
                            "history-version-row",
                            isSelected
                              ? "hover:bg-[var(--goose-interactive-selected)] hover:shadow-[inset_0_0_0_1px_var(--goose-interactive-selected-fg)] active:bg-[var(--goose-interactive-selected)] active:shadow-[inset_0_0_0_2px_var(--goose-interactive-selected-fg)]"
                              : "hover:bg-[var(--goose-control-hover-bg)] active:bg-[var(--goose-interactive-selected)]",
                          )}
                        >
                          <span
                            className={cn(
                              "min-w-0 flex-1 truncate text-xs leading-none tabular-nums",
                              isSelected
                                ? "font-medium text-[var(--goose-interactive-selected-fg)]"
                                : "text-foreground",
                            )}
                          >
                            {formatTime(v.createdAt)}
                            {v.label ? (
                              <span
                                className={cn(
                                  "ml-1.5 truncate text-[11px] font-normal leading-none",
                                  isSelected
                                    ? "text-[var(--goose-interactive-selected-fg)] opacity-80"
                                    : "text-muted-foreground",
                                )}
                              >
                                {v.label}
                              </span>
                            ) : null}
                          </span>
                          <span className="flex shrink-0 items-center gap-1.5">
                            {deltaText ? (
                              <span
                                className={cn(
                                  "text-[10px] leading-none tabular-nums",
                                  isSelected
                                    ? "text-[var(--goose-interactive-selected-fg)] opacity-80"
                                    : delta > 0
                                      ? "text-foreground/55"
                                      : "text-muted-foreground/55",
                                )}
                              >
                                {deltaText}
                              </span>
                            ) : null}
                          </span>
                        </button>
                        <button
                          type="button"
                          disabled={isMilestonePending}
                          data-marked={v.isMilestone ? "true" : "false"}
                          aria-busy={isMilestonePending || undefined}
                          aria-pressed={v.isMilestone}
                          aria-label={
                            isMilestonePending
                              ? v.isMilestone
                                ? "正在取消标记此版本"
                                : "正在标记此版本"
                              : v.isMilestone
                                ? "取消标记此版本"
                                : "标记此版本"
                          }
                          onClick={(event) => {
                            event.stopPropagation();
                            handleToggleMilestone(v.versionId, !v.isMilestone);
                          }}
                          className={cn(
                            "history-star-control group/star absolute right-1 top-1/2 z-[2] flex h-7 w-7 -translate-y-1/2 cursor-pointer select-none items-center justify-center rounded-[8px] transition-[background-color,color,opacity,transform] duration-150 hover:bg-[var(--goose-icon-chip-on-selected)] dark:hover:bg-[var(--goose-interactive-hover)] active:scale-95 active:bg-[var(--goose-interactive-selected)] disabled:cursor-wait disabled:opacity-70",
                            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                            v.isMilestone || isMilestonePending
                              ? "opacity-100"
                              : "opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100",
                          )}
                        >
                          {isMilestonePending ? (
                            <LucideIcons.LoaderCircle className="h-4 w-4 animate-spin text-muted-foreground" />
                          ) : (
                            <LucideIcons.Star
                              className={cn(
                                "h-4 w-4 text-muted-foreground transition-colors group-hover/star:text-foreground",
                                v.isMilestone &&
                                  "fill-[var(--goose-color-favorite)] text-[var(--goose-color-favorite)] group-hover/star:text-[var(--goose-color-favorite)]",
                              )}
                            />
                          )}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}

export function HistoryToolbar() {
  const {
    pageTitle,
    selectedVersionId,
    selectedStatus,
    isRestoring,
    exit,
    handleRestore,
  } = useHistoryViewLogic();

  return (
    <header className="h-11 px-3 flex items-center gap-3 shrink-0 bg-[hsl(var(--goose-editor-bg))]">
      <Button
        variant="secondary"
        size="sm"
        aria-label="返回编辑页面"
        className="history-secondary-control h-8 px-3 text-xs gap-1.5 text-foreground shadow-none transition-[background-color,color,transform] hover:bg-[var(--goose-control-hover-bg)] hover:text-foreground active:translate-y-px active:bg-[var(--goose-interactive-selected)] active:text-[var(--goose-interactive-selected-fg)]"
        onClick={exit}
      >
        <LucideIcons.ArrowLeft className="h-3.5 w-3.5" />
        返回
      </Button>

      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="truncate text-sm font-medium">{pageTitle}</span>
      </div>

      <Button
        size="sm"
        aria-label={
          isRestoring
            ? "正在还原此版本"
            : selectedStatus === "loading"
              ? "正在读取历史版本"
              : "还原此版本"
        }
        aria-busy={isRestoring || selectedStatus === "loading" || undefined}
        className="history-primary-control h-7 shrink-0 px-3 text-xs transition-[background-color,box-shadow,transform] hover:bg-[var(--goose-primary-hover-bg)] active:translate-y-px active:bg-[var(--goose-primary-active-bg)] active:shadow-none"
        disabled={
          !selectedVersionId || selectedStatus !== "ready" || isRestoring
        }
        onClick={handleRestore}
      >
        {isRestoring || selectedStatus === "loading" ? (
          <>
            <LucideIcons.LoaderCircle className="h-3.5 w-3.5 animate-spin" />
            {isRestoring ? "正在还原" : "正在读取"}
          </>
        ) : (
          "还原此版本"
        )}
      </Button>
    </header>
  );
}

function HistoryReaderState({
  icon: Icon,
  title,
  description,
  spinning = false,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  spinning?: boolean;
  action?: ReactNode;
}) {
  return (
    <div className="h-full min-h-[280px] flex items-center justify-center px-6 text-center">
      <div className="flex max-w-sm flex-col items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-[var(--goose-interactive-hover)] text-muted-foreground">
          <Icon
            className={cn("h-5 w-5", spinning && "animate-spin")}
            strokeWidth={1.75}
          />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">{title}</p>
          {description && (
            <p className="text-xs leading-relaxed text-muted-foreground">
              {description}
            </p>
          )}
        </div>
        {action}
      </div>
    </div>
  );
}

/**
 * 主区只读编辑器。挂在 workspace-editor-surface > page-scroll-container 内，
 * 复用与主 Editor 完全一致的滚动容器和 max-w-4xl 包裹。
 */
export function HistoryReader() {
  const { selectedContent, selectedVersionId, selectedStatus, isEmpty } =
    useHistoryViewLogic();

  if (selectedStatus === "loading") {
    return (
      <HistoryReaderState
        icon={LucideIcons.LoaderCircle}
        title="正在读取历史版本"
        description="稍等片刻，正在准备只读预览。"
        spinning
      />
    );
  }

  if (isEmpty) {
    return (
      <HistoryReaderState
        icon={LucideIcons.History}
        title="暂无历史版本"
        description="停笔一段时间后，鹅的笔记会自动保存可回看的历史。"
      />
    );
  }

  if (selectedStatus === "missing") {
    return (
      <HistoryReaderState
        icon={LucideIcons.FileQuestion}
        title="此历史版本不可读取"
        description="这条历史索引还在，但对应版本内容可能已被旧版数据或外部清理移除。"
      />
    );
  }

  if (selectedStatus === "error") {
    return (
      <HistoryReaderState
        icon={LucideIcons.FileWarning}
        title="此历史版本格式异常"
        description="这条记录可能来自旧版格式或包含脏数据，已跳过渲染以避免白屏。"
      />
    );
  }

  if (!(selectedContent && selectedVersionId)) {
    return (
      <HistoryReaderState
        icon={LucideIcons.MousePointerClick}
        title="选择一个历史版本"
        description="从左侧列表选择时间点后，这里会显示只读预览。"
      />
    );
  }

  return (
    <ErrorBoundary
      resetKey={selectedVersionId}
      fallback={(_, reset) => (
        <HistoryReaderState
          icon={LucideIcons.FileWarning}
          title="此历史版本渲染失败"
          description="已阻止历史视图白屏。可以重试，或切换左侧其他历史版本。"
          action={
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="history-secondary-control mt-1 h-8 gap-1.5 rounded-[10px] text-xs shadow-none transition-[background-color,color,transform] hover:bg-[var(--goose-control-hover-bg)] hover:text-foreground active:translate-y-px active:bg-[var(--goose-interactive-selected)] active:text-[var(--goose-interactive-selected-fg)]"
              onClick={reset}
            >
              <LucideIcons.RotateCcw className="h-3.5 w-3.5" />
              重试
            </Button>
          }
        />
      )}
    >
      <HistoryReadOnlyEditor
        content={selectedContent}
        versionKey={selectedVersionId}
      />
    </ErrorBoundary>
  );
}
