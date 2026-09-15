/**
 * Agent 文件权限模式（ADR 0007）。
 * UI 切换在 PR9；本模块只定义类型与默认值。
 * 完整权限切换无确认——本层不弹窗。
 */

/** 三档权限：只读工作区 / 工作区读写 / 完整权限 */
export type PermissionMode =
  | "workspace-read"
  | "workspace-write"
  | "full-access";

/** 默认：工作区读写 */
export const DEFAULT_PERMISSION_MODE: PermissionMode = "workspace-write";

/** 用户可见文案（Composer 控件等） */
export const PERMISSION_MODE_LABELS: Record<PermissionMode, string> = {
  "workspace-read": "只读工作区",
  "workspace-write": "工作区读写",
  "full-access": "完整权限",
};

export const PERMISSION_MODES: readonly PermissionMode[] = [
  "workspace-read",
  "workspace-write",
  "full-access",
] as const;

export function isPermissionMode(value: unknown): value is PermissionMode {
  return (
    value === "workspace-read" ||
    value === "workspace-write" ||
    value === "full-access"
  );
}
