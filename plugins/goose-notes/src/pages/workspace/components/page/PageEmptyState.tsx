import { Search, Plus, Sparkles, FolderOpen, type LucideIcon } from "lucide-react";
import { usePages } from "@/stores/usePages";
import { useNotebooks } from "@/stores/useNotebooks";
import {
  useEffect,
  useCallback,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { toast } from "@/components/ui/sonner";
import { getPageTitle } from "@/components/editor/utils/page-title";
import { requestPageTitleFocus } from "@/lib/page-title-focus";
import { DEFAULT_NOTEBOOK } from "@/stores/useNotebooks";
import { cn } from "@/lib/utils";
import { dialogs } from "@/lib/utools/dialogs";
import { useTabs } from "@/stores/useTabs";
import { useSettings } from "@/stores/useSettings";

const isEmptyContent = (
  content:
    | {
        type?: string;
        content?: Array<{
          type?: string;
          content?: unknown[];
        }>;
      }
    | null
    | undefined,
) => {
  if (!content || content.type !== "doc") return true;
  if (!content.content || content.content.length === 0) return true;
  if (content.content.length === 1) {
    const first = content.content[0];
    if (
      first.type === "paragraph" &&
      (!first.content || first.content.length === 0)
    ) {
      return true;
    }
  }
  return false;
};

function AiCrystalFx() {
  return (
    <span className="page-empty-ai-fx" aria-hidden="true">
      <span className="page-empty-ai-orb page-empty-ai-orb--a" />
      <span className="page-empty-ai-orb page-empty-ai-orb--b" />
      <span className="page-empty-ai-orb page-empty-ai-orb--c" />
      <span className="page-empty-ai-sheen" />
      <span className="page-empty-ai-spark page-empty-ai-spark--1" />
      <span className="page-empty-ai-spark page-empty-ai-spark--2" />
      <span className="page-empty-ai-spark page-empty-ai-spark--3" />
    </span>
  );
}

type AiTiltStyle = CSSProperties & {
  "--ai-tilt-x"?: string;
  "--ai-tilt-y"?: string;
  "--ai-glare-x"?: string;
  "--ai-glare-y"?: string;
};

function useAiChipTilt(enabled: boolean) {
  const reduceMotion = useMemo(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);
  const [tiltStyle, setTiltStyle] = useState<AiTiltStyle>({
    "--ai-tilt-x": "0deg",
    "--ai-tilt-y": "0deg",
    "--ai-glare-x": "50%",
    "--ai-glare-y": "50%",
  });
  const frameRef = useRef<number | null>(null);
  const targetRef = useRef({ x: 0, y: 0, gx: 50, gy: 50 });

  const flushTilt = useCallback(() => {
    frameRef.current = null;
    const { x, y, gx, gy } = targetRef.current;
    setTiltStyle({
      "--ai-tilt-x": `${x.toFixed(2)}deg`,
      "--ai-tilt-y": `${y.toFixed(2)}deg`,
      "--ai-glare-x": `${gx.toFixed(1)}%`,
      "--ai-glare-y": `${gy.toFixed(1)}%`,
    });
  }, []);

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (!enabled || reduceMotion) return;
      const rect = event.currentTarget.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const px = (event.clientX - rect.left) / rect.width;
      const py = (event.clientY - rect.top) / rect.height;
      const nx = Math.min(1, Math.max(0, px));
      const ny = Math.min(1, Math.max(0, py));
      // 轻微 3D tilt：像陀螺仪/磁力跟随，而不是整张卡大幅翻转
      targetRef.current = {
        x: (0.5 - ny) * 14,
        y: (nx - 0.5) * 16,
        gx: nx * 100,
        gy: ny * 100,
      };
      if (frameRef.current == null) {
        frameRef.current = window.requestAnimationFrame(flushTilt);
      }
    },
    [enabled, flushTilt, reduceMotion],
  );

  const onPointerLeave = useCallback(() => {
    if (!enabled || reduceMotion) return;
    targetRef.current = { x: 0, y: 0, gx: 50, gy: 50 };
    if (frameRef.current != null) {
      window.cancelAnimationFrame(frameRef.current);
    }
    frameRef.current = window.requestAnimationFrame(flushTilt);
  }, [enabled, flushTilt, reduceMotion]);

  useEffect(() => {
    return () => {
      if (frameRef.current != null) {
        window.cancelAnimationFrame(frameRef.current);
      }
    };
  }, []);

  return {
    tiltStyle: enabled && !reduceMotion ? tiltStyle : undefined,
    onPointerMove: enabled ? onPointerMove : undefined,
    onPointerLeave: enabled ? onPointerLeave : undefined,
  };
}

export function PageEmptyState() {
  const {
    createPage,
    createLocalPage,
    pages,
    loadLocalFolderPages,
  } = usePages();
  const {
    activeNotebookId,
    notebooks,
    createNotebook,
    setActiveNotebook,
    createLocalFolderNotebook,
  } = useNotebooks();
  const openInCurrentTab = useTabs((state) => state.openInCurrentTab);
  const aiEnabled = useSettings((s) => s.ai.enabled);
  const aiTilt = useAiChipTilt(aiEnabled);
  const activeNotebook = activeNotebookId ? notebooks[activeNotebookId] : null;
  const isLocalFolder = activeNotebook?.source === "local-folder";

  const activateOrCreatePage = useCallback(async () => {
    // 如果没有活跃笔记本，创建一个默认笔记本
    let notebookId = activeNotebookId;
    if (!notebookId) {
      const notebookIds = Object.keys(notebooks);
      if (notebookIds.length === 0) {
        notebookId = createNotebook("我的笔记");
        toast.success("已自动创建笔记本");
      } else {
        notebookId = notebookIds[0];
        setActiveNotebook(notebookId);
      }
    }

    const notebook = notebookId ? notebooks[notebookId] : undefined;
    const isLocalFolder = notebook?.source === "local-folder";

    if (isLocalFolder) {
      const localPageId = await createLocalPage(undefined, notebookId || undefined);
      if (localPageId) openInCurrentTab(localPageId);
      return localPageId;
    }

    const matchWorkspaceId = notebookId || DEFAULT_NOTEBOOK;
    const existingBlankPage = Object.values(pages).find((p) => {
      const matchWorkspace = p.workspaceId === matchWorkspaceId;
      const notTrashed = !p.trashedAt;
      const title = getPageTitle(p);
      const isBlankTitle = !title || title === "无标题" || title.trim() === "";
      const isBlankContent = isEmptyContent(p.content);
      return matchWorkspace && notTrashed && isBlankTitle && isBlankContent;
    });

    if (existingBlankPage) {
      openInCurrentTab(existingBlankPage.id);
      requestPageTitleFocus(existingBlankPage.id);
      if (!useSettings.getState().singleTabMode) {
        window.setTimeout(() => {
          window.dispatchEvent(
            new CustomEvent("goose-note:focus-editor-start"),
          );
        }, 100);
      }
      return existingBlankPage.id;
    }

    const newPageId = createPage(undefined, matchWorkspaceId);
    openInCurrentTab(newPageId);
    return newPageId;
  }, [
    activeNotebookId,
    notebooks,
    createNotebook,
    setActiveNotebook,
    createLocalPage,
    openInCurrentTab,
    pages,
    createPage,
  ]);

  const onCreatePage = useCallback(async () => {
    await activateOrCreatePage();
  }, [activateOrCreatePage]);

  const onSearch = useCallback(() => {
    window.dispatchEvent(new CustomEvent("goose-note:open-search"));
  }, []);

  const onOpenAi = useCallback(() => {
    window.dispatchEvent(new CustomEvent("goose-note:open-ai-panel"));
  }, []);

  const onOpenLocalFolder = useCallback(async () => {
    const utools = (
      window as {
        utools?: {
          showOpenDialog?: (options: {
            title: string;
            properties: string[];
          }) => Promise<string[]>;
        };
      }
    ).utools;
    if (typeof utools?.showOpenDialog === "function") {
      const result = await utools.showOpenDialog({
        title: "选择 Markdown 文件夹",
        properties: ["openDirectory"],
      });
      if (result && result.length > 0) {
        const folderPath = result[0];
        const folderName = folderPath.split(/[\\/]/).pop() || "Unknown";
        const notebookId = createLocalFolderNotebook(folderName, folderPath);
        await loadLocalFolderPages(notebookId, folderPath, {
          showWelcome: true,
        });
      }
      return;
    }

    try {
      const path = await dialogs.selectDirectory();
      if (path) {
        const folderName = path.split(/[\\/]/).pop() || "Unknown";
        const notebookId = createLocalFolderNotebook(folderName, path);
        await loadLocalFolderPages(notebookId, path, { showWelcome: true });
      }
    } catch (e) {
      console.error(e);
      toast.error("打开文件夹失败: " + String(e));
    }
  }, [createLocalFolderNotebook, loadLocalFolderPages]);

  // 全局快捷键监听
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd+Option+P: 新建页面
      if ((e.metaKey || e.ctrlKey) && e.altKey && e.key === "p") {
        e.preventDefault();
        onCreatePage();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onCreatePage]);

  const actions = useMemo(() => {
    const list: Array<{
      key: string;
      title: string;
      description: string;
      onClick: () => void | Promise<void>;
      icon: LucideIcon;
      variant?: "default" | "ai";
    }> = [
      {
        key: "create-page",
        icon: Plus,
        title: isLocalFolder ? "新建文件" : "新建页面",
        description: isLocalFolder
          ? "在当前文件夹创建 Markdown 文件"
          : "创建一个空白页面开始记录",
        onClick: onCreatePage,
      },
      {
        key: "open-folder",
        icon: FolderOpen,
        title: "打开本地文件夹",
        description: "批量管理 Markdown 笔记",
        onClick: onOpenLocalFolder,
      },
    ];

    if (aiEnabled) {
      list.push({
        key: "ai",
        icon: Sparkles,
        title: "AI",
        description: "整理、续写、检索与可视化笔记",
        onClick: onOpenAi,
        variant: "ai",
      });
    }

    list.push({
      key: "search",
      icon: Search,
      title: "搜索内容",
      description: "快速查找已记录的内容",
      onClick: onSearch,
    });

    return list;
  }, [
    aiEnabled,
    isLocalFolder,
    onCreatePage,
    onOpenLocalFolder,
    onOpenAi,
    onSearch,
  ]);

  return (
    <div className="h-full overflow-y-auto px-3 py-4 sm:px-6 sm:py-8 md:p-8 relative bg-[hsl(var(--goose-editor-bg))]">
      <div className="min-h-full flex items-start justify-center pt-2 sm:pt-4 md:pt-6">
        {/* 内容区 */}
        <div className="relative w-full max-w-5xl">
          {/* 标题 */}
          <div className="text-center mb-6 sm:mb-8 md:mb-12 pt-2 sm:pt-4">
            <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold text-foreground mb-2 sm:mb-3 md:mb-4">
              准备好记录想法了吗？
            </h1>
            <p className="text-sm sm:text-base md:text-lg text-muted-foreground max-w-xl mx-auto leading-relaxed">
              {isLocalFolder
                ? "点击左侧侧边栏新建文件，或选择现有文件开始记录"
                : "点击左侧侧边栏新建页面，或选择现有页面开始记录"}
            </p>
          </div>

          {/* 操作卡片网格：AI 关 3 卡 / AI 开 4 卡（第 3=AI，第 4=搜索） */}
          <div
            className={cn(
              "grid grid-cols-1 min-[520px]:grid-cols-2 gap-3 sm:gap-4 md:gap-5 mx-auto",
              aiEnabled
                ? "max-w-5xl xl:grid-cols-4"
                : "max-w-4xl xl:grid-cols-3",
            )}
          >
            {actions.map((action) => {
              const Icon = action.icon;
              const isAi = action.variant === "ai";
              return (
                <button
                  key={action.key}
                  onClick={() => {
                    void action.onClick();
                  }}
                  type="button"
                  onPointerMove={isAi ? aiTilt.onPointerMove : undefined}
                  onPointerLeave={isAi ? aiTilt.onPointerLeave : undefined}
                  className={cn(
                    "group relative cursor-pointer rounded-[12px] md:rounded-[14px] border border-transparent bg-[hsl(var(--goose-editor-bg))] p-4 sm:p-5 md:p-6 text-left shadow-[0_8px_22px_rgba(15,23,42,0.06)] transition-[background-color,border-color,box-shadow,transform] duration-200 ease-out hover:-translate-y-0.5 hover:bg-[var(--goose-interactive-hover)] hover:border-[hsl(var(--border))] hover:shadow-[0_16px_36px_rgba(15,23,42,0.12)] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 dark:bg-[hsl(var(--goose-editor-bg))] dark:hover:bg-[var(--goose-interactive-hover)] dark:hover:border-[hsl(var(--border))] dark:hover:shadow-[0_16px_34px_rgba(2,6,23,0.48)]",
                    isAi && "page-empty-ai-card",
                  )}
                  style={isAi ? aiTilt.tiltStyle : undefined}
                >
                  <div
                    className={cn(
                      "w-11 h-11 sm:w-12 sm:h-12 md:w-14 md:h-14 rounded-[9px] md:rounded-[10px] flex items-center justify-center mb-3 sm:mb-4 transition-[background-color,box-shadow,transform] duration-200 ease-out",
                      isAi
                        ? "page-empty-ai-chip"
                        : "bg-[hsl(var(--goose-selected-bg))] group-hover:scale-105 group-hover:bg-[var(--goose-interactive-selected)] group-hover:shadow-[0_8px_18px_rgba(15,23,42,0.08)] dark:bg-[hsl(var(--goose-selected-bg))] dark:group-hover:bg-[var(--goose-interactive-selected)] dark:group-hover:shadow-[0_10px_22px_rgba(0,0,0,0.26)]",
                    )}
                  >
                    {isAi ? <AiCrystalFx /> : null}
                    <Icon
                      className={cn(
                        "w-5 h-5 sm:w-6 sm:h-6 md:w-7 md:h-7 text-foreground/75 transition-colors group-hover:text-foreground",
                        isAi && "page-empty-ai-icon",
                      )}
                    />
                  </div>
                  <h3
                    className={cn(
                      "text-base sm:text-lg font-semibold text-foreground mb-1.5 sm:mb-2 text-left transition-colors dark:text-foreground/90 dark:group-hover:text-foreground",
                    )}
                  >
                    {action.title}
                  </h3>
                  <p className="hidden min-[420px]:block text-xs sm:text-sm text-muted-foreground text-left leading-relaxed transition-colors dark:text-muted-foreground/80 dark:group-hover:text-muted-foreground/95">
                    {action.description}
                  </p>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
