import { useNotebooks } from "../../../useNotebooks";
import { migrateLocalPageIdMapEntry, toRelativePath } from "@/lib/local-page-idmap";
import {
  getLocalMdSnapshot,
  setLocalMdSnapshot,
  deleteLocalMdSnapshot,
} from "@/lib/local-md-snapshot";
import { flushPendingLocalSaveByPageIdInternal } from "../../folderSync";
import type { StoreSet, StoreGet } from "../hydrate";

/**
 * 最近自移路径集合——用于在 watcher rename 事件中抑制自写回声。
 * key: 绝对路径，value: 登记时间戳（ms）。
 * 窗口 ~5s，精确路径或目录前缀匹配均视为自移。
 */
const recentSelfMoved = new Map<string, number>();
const SELF_MOVE_WINDOW_MS = 5000;

export function markSelfMoved(absPath: string): void {
  recentSelfMoved.set(absPath, Date.now());
}

export function wasRecentlySelfMoved(absPath: string): boolean {
  const now = Date.now();
  for (const [key, ts] of recentSelfMoved) {
    if (now - ts > SELF_MOVE_WINDOW_MS) {
      recentSelfMoved.delete(key);
      continue;
    }
    if (absPath === key || absPath.startsWith(key + "/")) return true;
  }
  return false;
}

/**
 * 移动 local-folder 页面（文件或目录）到目标父目录。
 * - targetFolderId 为 undefined → 移到笔记本根目录
 * - targetFolderId 非 undefined → 必须是 isFolder=true 的页面
 *
 * 移动语义：文件系统 mv；page.localFilePath / parentId 同步更新；id 不变。
 * 目录移动：递归更新同笔记本中所有以旧目录路径为前缀的子页面。
 */
export async function moveLocalPageAction(
  set: StoreSet,
  get: StoreGet,
  pageId: string,
  targetFolderId: string | undefined,
): Promise<void> {
  if (typeof window === "undefined" || !window.gooseFs) {
    throw new Error("文件系统不可用");
  }

  const page = get().pages[pageId];
  if (!page || !page.localFilePath) {
    throw new Error("页面不存在或非本地文件夹页面");
  }

  const notebook = useNotebooks.getState().notebooks[page.workspaceId];
  if (!notebook?.localPath) {
    throw new Error("所属笔记本不存在");
  }

  // 解析目标目录路径
  let targetDirPath: string;
  if (targetFolderId === undefined) {
    targetDirPath = notebook.localPath;
  } else {
    const targetPage = get().pages[targetFolderId];
    if (!targetPage || !targetPage.isFolder || !targetPage.localFilePath) {
      throw new Error("目标目录不存在");
    }
    targetDirPath = targetPage.localFilePath;
  }

  const oldPath = page.localFilePath;

  // 提取文件名
  const fileName = oldPath.replace(/\\/g, "/").split("/").pop()!;

  // 解析当前所在目录
  const oldDir = oldPath.replace(/\\/g, "/").split("/").slice(0, -1).join("/");
  const normalizedTargetDir = targetDirPath.replace(/\\/g, "/");

  // 同目录 no-op
  if (oldDir === normalizedTargetDir) return;

  // 防止目录移进自己的子孙
  if (page.isFolder) {
    const normalizedOld = oldPath.replace(/\\/g, "/");
    if (
      normalizedTargetDir === normalizedOld ||
      normalizedTargetDir.startsWith(normalizedOld + "/")
    ) {
      throw new Error("不能将目录移到自身的子目录内");
    }
  }

  const newPath = `${normalizedTargetDir}/${fileName}`;

  const fs = window.gooseFs;

  // 目标路径已存在冲突检测
  const exists = (() => {
    try {
      return fs.exists?.(newPath) ?? false;
    } catch {
      return false;
    }
  })();
  if (exists) {
    throw new Error(`目标目录下已存在同名文件：${fileName}`);
  }

  // 登记自移路径（旧 + 新），抑制 watcher 回声
  markSelfMoved(oldPath.replace(/\\/g, "/"));
  markSelfMoved(newPath);

  // flush 待写防抖内容，避免 mv 后计时器把内容写回旧路径重建文件
  await flushPendingLocalSaveByPageIdInternal(pageId, get);

  // 执行文件系统移动
  let renamed: boolean;
  try {
    renamed = Boolean(await Promise.resolve(fs.rename(oldPath, newPath)));
  } catch (err) {
    throw new Error(`移动失败：${(err as Error).message ?? String(err)}`, { cause: err });
  }
  if (!renamed) {
    throw new Error("移动操作未成功");
  }

  const basePath = notebook.localPath;

  if (!page.isFolder) {
    // ── 文件页面移动 ──────────────────────────────────────────────────────────
    // 迁移 md 快照
    const snapshot = getLocalMdSnapshot(oldPath);
    if (snapshot !== undefined) {
      setLocalMdSnapshot(newPath, snapshot);
      deleteLocalMdSnapshot(oldPath);
    }

    // 迁移 idMap
    const oldRel = toRelativePath(basePath, oldPath);
    const newRel = toRelativePath(basePath, newPath);
    migrateLocalPageIdMapEntry(page.workspaceId, oldRel, newRel, pageId);

    // 更新 store
    set((state) => {
      const current = state.pages[pageId];
      if (!current) return state;
      return {
        pages: {
          ...state.pages,
          [pageId]: {
            ...current,
            localFilePath: newPath,
            parentId: targetFolderId,
          },
        },
      };
    });
  } else {
    // ── 目录页面移动 ──────────────────────────────────────────────────────────
    const normalizedOldPath = oldPath.replace(/\\/g, "/");
    const normalizedNewPath = newPath;

    // 收集同笔记本中所有路径前缀匹配的子页面（含目录自身）
    const allPages = get().pages;
    const affectedIds: string[] = [];
    for (const p of Object.values(allPages)) {
      if (p.workspaceId !== page.workspaceId) continue;
      const pPath = p.localFilePath?.replace(/\\/g, "/");
      if (!pPath) continue;
      if (pPath === normalizedOldPath || pPath.startsWith(normalizedOldPath + "/")) {
        affectedIds.push(p.id);
      }
    }

    // 迁移每个受影响页面的 snapshot 和 idMap，然后更新 store
    for (const aid of affectedIds) {
      const ap = get().pages[aid];
      if (!ap?.localFilePath) continue;
      const apOld = ap.localFilePath.replace(/\\/g, "/");
      const apNew = normalizedNewPath + apOld.slice(normalizedOldPath.length);

      const snap = getLocalMdSnapshot(apOld);
      if (snap !== undefined) {
        setLocalMdSnapshot(apNew, snap);
        deleteLocalMdSnapshot(apOld);
      }

      const oldRel = toRelativePath(basePath, apOld);
      const newRel = toRelativePath(basePath, apNew);
      migrateLocalPageIdMapEntry(page.workspaceId, oldRel, newRel, aid);
    }

    // 批量更新 store：所有受影响页面的 localFilePath；目录自身还要更新 parentId
    set((state) => {
      const nextPages = { ...state.pages };
      for (const aid of affectedIds) {
        const ap = nextPages[aid];
        if (!ap?.localFilePath) continue;
        const apOld = ap.localFilePath.replace(/\\/g, "/");
        const apNew = normalizedNewPath + apOld.slice(normalizedOldPath.length);
        const isRoot = apOld === normalizedOldPath;
        nextPages[aid] = {
          ...ap,
          localFilePath: apNew,
          ...(isRoot ? { parentId: targetFolderId } : {}),
        };
      }
      return { pages: nextPages };
    });
  }
}
