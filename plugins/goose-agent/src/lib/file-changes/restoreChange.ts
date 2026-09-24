/**
 * 单文件变更还原（纯逻辑，不弹 UI）。
 * 用户主动将历史快照写回本机，不走 Agent sandbox。
 * 语义见 ADR 0013。
 */
import { exists, isFsAvailable, removeFile, writeFile } from "@/lib/fs";
import {
  useFileChanges,
  type FileChange,
} from "@/stores/useFileChanges";

export type RestoreChangeResult =
  | { ok: true }
  | { ok: false; error: string };

/** 与 RestoreChangeResult 同义，兼容 UI 侧命名 */
export type RestoreFileResult = RestoreChangeResult;

const ERR_BINARY = "二进制文件无法还原";
const ERR_TRUNCATED = "内容已截断，无法安全还原";
const ERR_NO_SNAPSHOT = "无可用快照，无法还原";
const ERR_FS = "本机文件桥不可用";
const ERR_FAIL = "还原失败";

/**
 * 不可还原时返回原因文案；可还原返回 null。
 * 条件：非 binary、非 truncated；create 可还原；其余 kind 需 before !== null（空串可）。
 */
export function getRestoreBlockReason(change: FileChange): string | null {
  if (change.binary) return ERR_BINARY;
  if (change.truncated) return ERR_TRUNCATED;
  if (change.kind === "create") return null;
  if (change.before === null) return ERR_NO_SNAPSHOT;
  return null;
}

export function canRestoreFileChange(change: FileChange): boolean {
  return getRestoreBlockReason(change) === null;
}

function restoreConfirmDescription(change: FileChange): string {
  switch (change.kind) {
    case "create":
      return "将删除此新建文件，恢复为变更前「文件不存在」的状态。";
    case "delete":
      return "将按删除前快照写回磁盘内容。";
    case "rename":
      return "将按快照恢复重命名前的路径与内容（新路径上的文件会移除）。";
    case "modify":
    default:
      return "将按变更前快照覆盖当前磁盘内容。";
  }
}

/** 确认对话框正文（克制、无「默认/推荐」） */
export function getRestoreConfirmCopy(change: FileChange): {
  title: string;
  description: string;
} {
  return {
    title: "还原此文件",
    description: `${restoreConfirmDescription(change)} 此操作不可撤销。`,
  };
}

/**
 * 将一条 FileChange 还原到磁盘，成功后从 store 移除该 path。
 * create → 删 path（已不存在视为成功）；
 * modify → write before；
 * delete → 用 before 重建；
 * rename → 删 path(to)，写回 fromPath（或无 fromPath 时写 path）。
 */
export async function restoreFileChange(
  change: FileChange,
): Promise<RestoreChangeResult> {
  const blocked = getRestoreBlockReason(change);
  if (blocked) return { ok: false, error: blocked };

  if (!isFsAvailable()) {
    return { ok: false, error: ERR_FS };
  }

  try {
    const applied = await applyRestore(change);
    if (!applied.ok) return applied;

    useFileChanges
      .getState()
      .removeChange(change.conversationId, change.path);
    return { ok: true };
  } catch {
    return { ok: false, error: ERR_FAIL };
  }
}

/** 删文件；目标已不存在视为成功 */
async function removeIfPresent(path: string): Promise<boolean> {
  if (!(await exists(path))) return true;
  return removeFile(path);
}

async function applyRestore(
  change: FileChange,
): Promise<RestoreChangeResult> {
  switch (change.kind) {
    case "create": {
      const ok = await removeIfPresent(change.path);
      return ok ? { ok: true } : { ok: false, error: ERR_FAIL };
    }
    case "modify": {
      if (typeof change.before !== "string") {
        return { ok: false, error: ERR_FAIL };
      }
      const ok = await writeFile(change.path, change.before);
      return ok ? { ok: true } : { ok: false, error: ERR_FAIL };
    }
    case "delete": {
      if (change.before === null) {
        return { ok: false, error: ERR_FAIL };
      }
      const ok = await writeFile(change.path, change.before);
      return ok ? { ok: true } : { ok: false, error: ERR_FAIL };
    }
    case "rename": {
      // 去掉新路径（to）；已不存在则跳过
      const removed = await removeIfPresent(change.path);
      if (!removed) {
        return { ok: false, error: ERR_FAIL };
      }
      if (change.fromPath) {
        const ok = await writeFile(change.fromPath, change.before ?? "");
        return ok ? { ok: true } : { ok: false, error: ERR_FAIL };
      }
      // 无 fromPath：按 modify 语义写 path（before 已在 block 检查中非 null）
      if (typeof change.before !== "string") {
        return { ok: false, error: ERR_FAIL };
      }
      const ok = await writeFile(change.path, change.before);
      return ok ? { ok: true } : { ok: false, error: ERR_FAIL };
    }
    default: {
      return { ok: false, error: ERR_FAIL };
    }
  }
}
