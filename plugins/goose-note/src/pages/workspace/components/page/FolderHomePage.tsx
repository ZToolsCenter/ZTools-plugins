/**
 * FolderHomePage —— 本地文件夹「目录主页」（方案 B：Finder 式）。
 *
 * 点击侧栏本地文件夹时在主区打开：头部显示文件夹名与路径面包屑，
 * 内容区列出直接子项（文件/子文件夹），右上角提供「新建子文件夹 / 新建文件」。
 *
 * 边界态：
 * - 空文件夹：居中空态 + 前置创建入口，不渲染空列表框；
 * - 子项很多：列表固定约 8 行高度内部滚动，标题旁显示总数徽章；
 * - 超长文件名：truncate 截断，与侧栏树行一致。
 */
import { useMemo, useState } from "react";
import type { Page } from "@/types";
import {
  FolderOpen,
  FolderPlus,
  FilePlus2,
  FileText,
  Folder,
  Loader2,
} from "lucide-react";
import { toast } from "@/components/ui/sonner";
import { getPageTitle } from "@/components/editor/utils/page-title";
import { usePages } from "@/stores/usePages";
import { useNotebooks } from "@/stores/useNotebooks";
import { useTabs } from "@/stores/useTabs";
import { useSidebarView } from "@/stores/useSidebarView";
import { cn } from "@/lib/utils";

interface FolderHomePageProps {
  page: Page;
}

/** 与编辑器一致的相对时间，够用且不引新依赖 */
function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return "刚刚";
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`;
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`;
  if (diff < 7 * day) return `${Math.floor(diff / day)} 天前`;
  const d = new Date(timestamp);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

export function FolderHomePage({ page }: FolderHomePageProps) {
  const pages = usePages((s) => s.pages);
  const createLocalPage = usePages((s) => s.createLocalPage);
  const createLocalFolderRecord = usePages((s) => s.createLocalFolderRecord);
  const setExpandPageId = usePages((s) => s.setExpandPageId);
  const expandView = useSidebarView((s) => s.expand);
  const openPreviewTab = useTabs((s) => s.openPreviewTab);
  const notebookName = useNotebooks(
    (s) => s.notebooks[page.workspaceId]?.name ?? "本地",
  );
  const [creating, setCreating] = useState<"file" | "folder" | null>(null);

  const children = useMemo(
    () =>
      Object.values(pages)
        .filter((p) => p.parentId === page.id && !p.trashedAt)
        .sort((a, b) => {
          // 文件夹排前，其余按名称排序，与访达一致
          if (!!a.isFolder !== !!b.isFolder) return a.isFolder ? -1 : 1;
          return getPageTitle(a).localeCompare(getPageTitle(b), "zh-Hans-CN");
        }),
    [pages, page.id],
  );

  const folderName = getPageTitle(page);

  const handleCreateFile = async () => {
    if (creating) return;
    setCreating("file");
    try {
      const newId = await createLocalPage(page.id, page.workspaceId);
      if (!newId) {
        toast.error("新建文件失败，请重试");
        return;
      }
      // createLocalPage 内部已激活新页；确保父文件夹在侧栏展开可见
      expandView(page.workspaceId, page.id);
    } finally {
      setCreating(null);
    }
  };

  const handleCreateFolder = async () => {
    if (creating) return;
    setCreating("folder");
    try {
      const newId = await createLocalFolderRecord({
        workspaceId: page.workspaceId,
        parentId: page.id,
      });
      if (!newId) {
        toast.error("新建文件夹失败：名称冲突或文件系统错误");
        return;
      }
      // 侧栏展开父级并定位新文件夹，保持「双向可见」
      expandView(page.workspaceId, page.id);
      setExpandPageId(newId);
      toast.success("已新建文件夹");
    } finally {
      setCreating(null);
    }
  };

  const handleOpenChild = (child: Page) => {
    // 子文件夹打开自己的主页；文件以预览标签打开（与侧栏单击一致）
    openPreviewTab(child.id);
  };

  const count = children.length;

  return (
    <div className="h-full overflow-y-auto bg-[hsl(var(--goose-editor-bg))]">
      <div className="mx-auto w-full max-w-3xl px-8 py-8 md:px-12 md:py-10">
        {/* 头部 */}
        <div className="mb-6 flex items-center gap-3.5">
          <span className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-[13px] bg-[hsl(var(--goose-selected-bg))] text-muted-foreground">
            <FolderOpen className="h-6 w-6" />
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-[22px] font-bold leading-tight text-foreground">
              {folderName}
            </h1>
            <p className="mt-1 text-xs text-muted-foreground/80">
              {notebookName} / {folderName} · {count} 个子项
            </p>
          </div>
        </div>

        {/* 内容标题行 + 创建入口 */}
        <div className="mb-2.5 flex items-center gap-2.5">
          <h2 className="text-[13px] font-semibold text-muted-foreground">
            内容
            <span className="ml-1.5 rounded-full bg-[hsl(var(--goose-selected-bg))] px-2 py-0.5 text-[10.5px] font-semibold text-muted-foreground">
              {count}
            </span>
          </h2>
          <span className="flex-1" />
          <button
            type="button"
            onClick={() => void handleCreateFolder()}
            disabled={creating !== null}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-[var(--goose-interactive-hover)] disabled:opacity-55"
          >
            {creating === "folder" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <FolderPlus className="h-3.5 w-3.5" />
            )}
            新建子文件夹
          </button>
          <button
            type="button"
            onClick={() => void handleCreateFile()}
            disabled={creating !== null}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-[var(--goose-interactive-hover)] disabled:opacity-55"
          >
            {creating === "file" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <FilePlus2 className="h-3.5 w-3.5" />
            )}
            新建文件
          </button>
        </div>

        {count === 0 ? (
          /* 空文件夹：居中空态，创建入口前置 */
          <div className="flex flex-col items-center gap-1 rounded-[11px] border border-dashed border-[#d2d2ce] bg-[#fbfbfa] px-5 pb-10 pt-11 text-center dark:border-border dark:bg-transparent">
            <span className="mb-2 flex h-[46px] w-[46px] items-center justify-center rounded-[11px] bg-[hsl(var(--goose-selected-bg))] text-muted-foreground">
              <FolderOpen className="h-5 w-5" />
            </span>
            <p className="m-0 text-sm font-semibold text-foreground">
              这个文件夹还是空的
            </p>
            <p className="m-0 mb-3 text-xs text-muted-foreground">
              在「{folderName}」里创建第一个文件或子文件夹
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void handleCreateFile()}
                disabled={creating !== null}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-[var(--goose-interactive-hover)] disabled:opacity-55"
              >
                <FilePlus2 className="h-3.5 w-3.5" />
                新建文件
              </button>
              <button
                type="button"
                onClick={() => void handleCreateFolder()}
                disabled={creating !== null}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-[var(--goose-interactive-hover)] disabled:opacity-55"
              >
                <FolderPlus className="h-3.5 w-3.5" />
                新建子文件夹
              </button>
            </div>
          </div>
        ) : (
          /* 子项列表：固定约 8 行高度内部滚动，头部与创建按钮始终可见 */
          <div
            className={cn(
              "overflow-hidden rounded-[11px] border border-border bg-background",
              count > 8 && "max-h-[336px] overflow-y-auto",
            )}
          >
            {children.map((child) => (
              <button
                key={child.id}
                type="button"
                onClick={() => handleOpenChild(child)}
                className="flex w-full items-center gap-2.5 border-b border-border bg-background px-3.5 py-2.5 text-left text-[13px] text-foreground transition-colors last:border-b-0 hover:bg-[var(--goose-interactive-hover)]"
              >
                {child.isFolder ? (
                  <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
                ) : (
                  <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                )}
                <span className="min-w-0 flex-1 truncate">
                  {getPageTitle(child)}
                  {!child.isFolder && (
                    <span className="text-muted-foreground/60">.md</span>
                  )}
                </span>
                <span className="shrink-0 text-[11px] text-muted-foreground/70">
                  {formatRelativeTime(child.updatedAt)}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
