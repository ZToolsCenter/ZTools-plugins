import { useEffect, useRef } from "react";
import { toast } from "@/components/ui/sonner";
import { usePages } from "@/stores/usePages";
import { wasRecentlyInteracting } from "@/lib/editor-interaction-signal";
import {
  isDiskContentMatchingSnapshot,
  wasRecentlySelfWritten,
  updateSnapshotAfterWrite,
} from "@/lib/local-md-snapshot";
import { wasRecentlySelfMoved } from "@/stores/pages/actions/localFolder/move";
import { useSettings } from "@/stores/useSettings";
import { shouldIgnoreLocalRelativePath } from "@/lib/local-folder-scanner";
import { discardPendingLocalSave } from "@/stores/pages/folderSync";

interface GooseFs {
  existsAsync?: (path: string) => Promise<boolean>;
  exists: (path: string) => boolean;
  watch: (
    path: string,
    callback: (eventType: string, filename: string) => void,
  ) => void;
  unwatch: (path: string) => void;
  readFileStatAsync?: (
    path: string,
  ) => Promise<{ ok: boolean; content?: string; error?: string }>;
  readFileStat?: (path: string) => {
    ok: boolean;
    content?: string;
    error?: string;
  };
  readFileAsync?: (path: string) => Promise<string | null>;
  readFile?: (path: string) => string | null;
}

interface Notebook {
  id: string;
  source?: string;
  localPath?: string;
}

interface Page {
  localFilePath?: string;
}

interface UseLocalFolderWatchOptions {
  notebook: Notebook | undefined;
  activePageId: string | null | undefined;
  page: Page | undefined;
}

async function readDiskContent(filePath: string): Promise<string | null> {
  const fs = (window as any).gooseFs as GooseFs | undefined;
  if (!fs) return null;
  try {
    if (fs.readFileStatAsync) {
      const r = await fs.readFileStatAsync(filePath);
      return r.ok ? (r.content ?? "") : null;
    }
    if (fs.readFileStat) {
      const r = fs.readFileStat(filePath);
      return r.ok ? (r.content ?? "") : null;
    }
    if (fs.readFileAsync) return (await fs.readFileAsync(filePath)) ?? null;
    if (fs.readFile) return fs.readFile(filePath) ?? null;
  } catch {
    // 读失败按「无从判断」处理，调用方跳过本次检查
  }
  return null;
}

/**
 * 同一文件冲突 toast 去重：记录当前正在显示的冲突 toast id（key = filePath）。
 * toast 关闭后自动清除，确保同文件不叠弹。
 */
const activeConflictToasts = new Map<string, string | number>();

function showConflictToast(
  filePath: string,
  pageId: string,
  onKeepMine: () => void,
  onLoadDisk: () => void,
) {
  // 去重：同文件已有 toast 则不重复弹
  if (activeConflictToasts.has(filePath)) return;

  const fileName = filePath.replace(/^.*[\\/]/, "");
  const toastId = toast.warning(`「${fileName}」已被外部修改`, {
    description: "选择如何处理冲突",
    duration: Infinity,
    action: {
      label: "保留我的编辑",
      onClick: (_e) => {
        activeConflictToasts.delete(filePath);
        onKeepMine();
      },
    },
    cancel: {
      label: "加载磁盘版本",
      onClick: (_e) => {
        activeConflictToasts.delete(filePath);
        onLoadDisk();
      },
    },
    onDismiss: () => {
      activeConflictToasts.delete(filePath);
    },
    onAutoClose: () => {
      activeConflictToasts.delete(filePath);
    },
  });

  activeConflictToasts.set(filePath, toastId);
}

/** 冲突 toast 两个按钮的标准行为（watch change / pre-save / 新鲜度检查共用）。 */
function conflictHandlers(filePath: string, pageId: string) {
  return {
    // 保留我的编辑：清空快照使 isLocalMdUnchanged 返回 false（否则 diff 相同时
    // 跳过写盘），再 force=true 绕过写盘前冲突检查强制落盘。
    onKeepMine: () => {
      updateSnapshotAfterWrite(filePath, "");
      const pg = usePages.getState().pages[pageId];
      if (!pg) return;
      void usePages
        .getState()
        .saveLocalPageContent(pageId, pg.content as any, { force: true });
    },
    // 加载磁盘版本：丢弃本地编辑，重读磁盘
    onLoadDisk: () => {
      discardPendingLocalSave(pageId);
      usePages.setState((s) => ({
        dirtyLocalPageIds: { ...s.dirtyLocalPageIds, [pageId]: false },
      }));
      void usePages.getState().reloadLocalPageFromDisk(pageId);
    },
  };
}

/**
 * 主动新鲜度检查：watch 不在场期间（uTools 窗口隐藏、查看其他笔记本、插件退出）
 * 的外部修改收不到 change 事件，在切页 / 窗口恢复可见时主动读盘 diff 兜底。
 * 没变 → 无操作；变了且页面干净 → 静默重载（无感）；变了且有未保存编辑 → 冲突提示。
 */
async function checkLocalPageFreshness(pageId: string): Promise<void> {
  const page = usePages.getState().pages[pageId];
  const filePath = page?.localFilePath;
  if (!filePath) return;

  const diskContent = await readDiskContent(filePath);
  if (diskContent === null) return;
  if (isDiskContentMatchingSnapshot(filePath, diskContent)) return;

  if (usePages.getState().dirtyLocalPageIds[pageId]) {
    const { onKeepMine, onLoadDisk } = conflictHandlers(filePath, pageId);
    showConflictToast(filePath, pageId, onKeepMine, onLoadDisk);
    return;
  }
  void usePages.getState().reloadLocalPageFromDisk(pageId);
}

export function useLocalFolderWatch({
  notebook,
  activePageId,
  page,
}: UseLocalFolderWatchOptions) {
  // 增量 rename/delete 事件去抖：同一目录连发事件合并，300ms 内只触发一次
  const renameDebounceTimers = useRef<
    Map<string, ReturnType<typeof setTimeout>>
  >(new Map());

  // 监听文件变更事件
  useEffect(() => {
    const handleFileChange = async (event: Event) => {
      const customEvent = event as CustomEvent;
      const { eventType, filename, dirPath } = customEvent.detail;
      if (
        notebook?.source !== "local-folder" ||
        notebook.localPath !== dirPath
      ) {
        return;
      }

      // 与全量扫描共用忽略规则：dot / 内置忽略目录 / 用户隐藏目录都不进入增量链路。
      if (
        typeof filename === "string" &&
        shouldIgnoreLocalRelativePath(
          filename,
          useSettings.getState().localFolderHiddenFolders,
        )
      ) {
        return;
      }

      const gooseFs = (window as any).gooseFs as GooseFs | undefined;
      if (!gooseFs) return;
      const filePath = `${dirPath}/${filename}`;

      // ── change 事件：单文件 reload ────────────────────────────────────────
      if (eventType === "change") {
        const pages = usePages.getState().pages;
        const target = Object.values(pages).find(
          (p) =>
            p.workspaceId === notebook.id &&
            !p.isFolder &&
            (p.localFilePath === filePath ||
              p.localFilePath?.replace(/\\/g, "/") ===
                filePath.replace(/\\/g, "/")),
        );
        if (!target) return;

        // ── 自写回声抑制 ────────────────────────────────────────────────────
        // 本应用自动保存写盘同样触发 change 事件。不抑制的话，写盘回声撞上
        // 2s 交互窗口（打字/点侧栏切页都算交互）就会弹假冲突——uTools 真机
        // 必现、web mock watch 不回调所以测不出。双保险：
        // 1) 刚写过盘（时间窗）直接忽略；
        // 2) 读盘与快照 diff，内容没真变（回声/无实质修改）不弹不重载。
        if (wasRecentlySelfWritten(filePath)) return;

        const diskContent = await readDiskContent(filePath);
        if (diskContent === null) return;
        if (isDiskContentMatchingSnapshot(filePath, diskContent)) return;

        // 磁盘内容确实被外部改了
        const isDirty = usePages.getState().dirtyLocalPageIds[target.id];
        if (isDirty || wasRecentlyInteracting(2000)) {
          // 脏页或用户刚操作过（输入尚未进入 debounce 标脏的竞态窗口）：弹冲突 toast
          const { onKeepMine, onLoadDisk } = conflictHandlers(
            filePath,
            target.id,
          );
          showConflictToast(filePath, target.id, onKeepMine, onLoadDisk);
          return;
        }

        void usePages.getState().reloadLocalPageFromDisk(target.id);
        return;
      }

      // ── rename/delete 事件：增量处理，300ms 去抖合并连发 ─────────────────
      if (eventType === "rename") {
        const debounceKey = filePath;
        const existing = renameDebounceTimers.current.get(debounceKey);
        if (existing) clearTimeout(existing);

        const timer = setTimeout(async () => {
          renameDebounceTimers.current.delete(debounceKey);

          // macOS 的 fs.watch 可能把普通 writeFile 报成 rename。应用自身保存产生的
          // 这类回声不能按“文件重新出现”处理，否则 addSingleLocalPage 会替换当前页，
          // 让编辑器选区和滚动视角一起回到文首。
          if (
            wasRecentlySelfMoved(filePath) ||
            wasRecentlySelfWritten(filePath)
          ) {
            return;
          }

          const exists = gooseFs.existsAsync
            ? await gooseFs.existsAsync(filePath)
            : gooseFs.exists(filePath);

          if (!exists) {
            // 文件/目录消失 → 单页移除（md 文件）或全量重扫（目录变化兜底）
            const isMdFile = /\.(md|markdown)$/i.test(filePath);
            if (isMdFile) {
              // 单文件 md 消失：增量移除
              usePages.getState().removeSingleLocalPage(filePath);
            } else {
              // 目录变化或非 md 文件：全量重扫兜底
              if (notebook.id && notebook.localPath) {
                void usePages
                  .getState()
                  .loadLocalFolderPages(notebook.id, notebook.localPath)
                  .catch((error) => {
                    console.error("[local-folder] rescan failed", error);
                  });
              }
            }
          } else {
            // 文件出现（新建 / rename 到此名）
            const isMdFile = /\.(md|markdown)$/i.test(filePath);
            if (isMdFile && notebook.id && notebook.localPath) {
              // 延迟到达的自写 rename 事件可能已经超过时间窗。若该路径本来就在
              // store 中，且磁盘内容仍与写后快照一致，则它只是保存回声，不应重载。
              const existingPage = Object.values(
                usePages.getState().pages,
              ).find(
                (candidate) =>
                  candidate.workspaceId === notebook.id &&
                  !candidate.isFolder &&
                  candidate.localFilePath?.replace(/\\/g, "/") ===
                    filePath.replace(/\\/g, "/"),
              );
              if (existingPage) {
                const diskContent = await readDiskContent(filePath);
                if (
                  diskContent !== null &&
                  isDiskContentMatchingSnapshot(filePath, diskContent)
                ) {
                  return;
                }
              }
              void usePages
                .getState()
                .addSingleLocalPage(notebook.id, notebook.localPath, filePath);
            } else if (!isMdFile) {
              // 非 md 文件（可能是目录）：全量重扫兜底
              if (notebook.id && notebook.localPath) {
                void usePages
                  .getState()
                  .loadLocalFolderPages(notebook.id, notebook.localPath)
                  .catch((error) => {
                    console.error("[local-folder] rescan failed", error);
                  });
              }
            }
          }
        }, 300);

        renameDebounceTimers.current.set(debounceKey, timer);
      }
    };

    window.addEventListener("goose-note:file-changed", handleFileChange);
    return () => {
      window.removeEventListener("goose-note:file-changed", handleFileChange);
    };
  }, [notebook, activePageId, page]);

  // ── 监听写盘前冲突（pre-save conflict）─────────────────────────────────────
  useEffect(() => {
    const handlePreSaveConflict = (event: Event) => {
      const { pageId, filePath } = (event as CustomEvent).detail as {
        pageId: string;
        filePath: string;
      };

      const { onKeepMine, onLoadDisk } = conflictHandlers(filePath, pageId);
      showConflictToast(filePath, pageId, onKeepMine, onLoadDisk);
    };

    window.addEventListener(
      "goose-note:local-file-conflict",
      handlePreSaveConflict,
    );
    return () => {
      window.removeEventListener(
        "goose-note:local-file-conflict",
        handlePreSaveConflict,
      );
    };
  }, []);

  // ── 监听本地路径重复：状态异常时拒绝写盘，避免两个页面覆盖同一磁盘文件 ───────
  useEffect(() => {
    const handleDuplicateLocalFile = (event: Event) => {
      const { filePath } = (event as CustomEvent).detail as {
        pageId: string;
        duplicatePageId: string;
        filePath: string;
      };
      const fileName = filePath.replace(/^.*[\\/]/, "");
      toast.error(`「${fileName}」保存失败`, {
        description:
          "检测到另一个页面已指向同一个本地文件，请重新加载本地文件夹后再试。",
      });
    };

    window.addEventListener(
      "goose-note:local-file-duplicate",
      handleDuplicateLocalFile,
    );
    return () => {
      window.removeEventListener(
        "goose-note:local-file-duplicate",
        handleDuplicateLocalFile,
      );
    };
  }, []);

  // ── 主动新鲜度检查：切页 / 切笔记本时 ──────────────────────────────────────
  // watch 只覆盖「当前笔记本目录 + 窗口存活」期间的外部修改；切页时主动 diff
  // 一次磁盘，把 watch 不在场期间的外部改动无感同步进来。
  useEffect(() => {
    if (notebook?.source !== "local-folder" || !activePageId) return;
    void checkLocalPageFreshness(activePageId);
  }, [activePageId, notebook?.id, notebook?.source]);

  // ── 主动新鲜度检查：uTools 窗口重新可见 / 聚焦时 ───────────────────────────
  useEffect(() => {
    if (notebook?.source !== "local-folder") return;
    const check = () => {
      if (document.visibilityState === "hidden") return;
      const pid = usePages.getState().activePageId;
      if (pid) void checkLocalPageFreshness(pid);
    };
    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);
    return () => {
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("focus", check);
    };
  }, [notebook?.id, notebook?.source]);

  // ── 启动/停止目录 watcher ─────────────────────────────────────────────────
  useEffect(() => {
    const gfs = (window as any).gooseFs as GooseFs | undefined;
    if (notebook?.source === "local-folder" && notebook.localPath && gfs) {
      // 先检查目录是否存在，避免 ENOENT
      const dirExists = gfs.exists(notebook.localPath);
      if (dirExists) {
        try {
          gfs.watch(
            notebook.localPath,
            (_eventType: string, _filename: string) => {
              // Handled via the goose-note:file-changed event above
            },
          );
        } catch {
          // 目录不存在或无权访问，忽略
        }
      }
    }

    return () => {
      // 清理去抖计时器
      renameDebounceTimers.current.forEach((timer) => clearTimeout(timer));
      renameDebounceTimers.current.clear();

      if (notebook?.localPath && (window as any).gooseFs) {
        try {
          ((window as any).gooseFs as GooseFs).unwatch(notebook.localPath!);
        } catch {
          // ignore
        }
      }
    };
  }, [notebook?.id]);
}
