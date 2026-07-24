import type { SyncStatus } from "../preload/sync-store";

export type SyncStatusPresentation = Readonly<{
  label: string;
  detail: string;
  tone: "neutral" | "progress" | "success" | "warning" | "error";
  action?: "retry" | "unlock" | "upgrade";
}>;

export function syncStatusPresentation(
  status: SyncStatus,
): SyncStatusPresentation {
  const pending = status.pendingObjects;
  switch (status.state) {
    case "disabled":
      return { label: "同步已关闭", detail: "历史仅保存在这台 Mac", tone: "neutral" };
    case "idle":
      return { label: "等待首次同步", detail: "保存后将加密上传到 WebDAV", tone: "neutral" };
    case "syncing":
      return { label: "正在同步", detail: `还有 ${pending} 个对象待处理`, tone: "progress" };
    case "success":
      return { label: "已同步", detail: status.lastSyncedAt ?? "刚刚完成", tone: "success" };
    case "offline":
      return { label: "当前离线", detail: `${pending} 个对象已安全排队`, tone: "warning", action: "retry" };
    case "auth_required":
    case "wrong_password":
      return { label: "需要重新验证", detail: "检查 WebDAV 或同步密码", tone: "error", action: "unlock" };
    case "partial":
      return { label: "部分内容未同步", detail: `${pending} 个对象等待重试`, tone: "warning", action: "retry" };
    case "conflict":
      return { label: "远端正在变化", detail: "重新拉取并合并后再试", tone: "warning", action: "retry" };
    case "corrupted":
      return { label: "远端数据损坏", detail: "已停止写入，避免覆盖可恢复数据", tone: "error" };
    case "schema_too_new":
      return { label: "需要更新插件", detail: "远端数据来自更高版本", tone: "error", action: "upgrade" };
  }
}
