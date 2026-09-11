/**
 * 首次引导清单：实时从真实配置推导，不持久化完成态。
 * 两项：① 供应商+凭证（必做）② 已有工作区（可选）
 * 界面导览不依赖清单 allDone：有凭证进工作台自动播 1 次；无主表面常驻入口；设置可重置。
 */
import {
  hasConfiguredCredential,
  type AISettingsLike,
} from "@/lib/ai-provider";
import type { WorkspaceItem } from "@/stores/useWorkspaces";

export type ChecklistItemId = "apiKey" | "workspace";

export interface ChecklistItem {
  id: ChecklistItemId;
  title: string;
  description: string;
  done: boolean;
  /** 主操作文案；已完成可为 null */
  actionLabel: string | null;
  /** 操作语义：打开 AI 设置 / 添加工作区 */
  action: "open-ai-settings" | "add-workspace" | null;
}

export interface ChecklistStatus {
  items: ChecklistItem[];
  /** 凭证 + 工作区是否都完成（进度用；tour 不依赖此项） */
  allDone: boolean;
  hasApiKey: boolean;
  hasWorkspace: boolean;
  doneCount: number;
}

/** @deprecated 语义已扩展为「有效凭证」；请优先用 hasConfiguredCredential */
export function hasConfiguredApiKey(settings: AISettingsLike): boolean {
  return hasConfiguredCredential(settings);
}

export { hasConfiguredCredential };

export function hasAnyWorkspace(workspaces: WorkspaceItem[]): boolean {
  return workspaces.length > 0;
}

/** 纯函数：由 stores 快照推导清单状态 */
export function deriveChecklistStatus(input: {
  settings: AISettingsLike;
  workspaces: WorkspaceItem[];
}): ChecklistStatus {
  const hasApiKey = hasConfiguredApiKey(input.settings);
  const hasWorkspace = hasAnyWorkspace(input.workspaces);

  const items: ChecklistItem[] = [
    {
      id: "apiKey",
      title: "配置供应商与凭证",
      description: hasApiKey
        ? "已就绪"
        : "设置 → AI，密钥或账号登录",
      done: hasApiKey,
      actionLabel: hasApiKey ? null : "打开 AI 设置",
      action: hasApiKey ? null : "open-ai-settings",
    },
    {
      id: "workspace",
      title: "添加工作区",
      description: hasWorkspace
        ? "已添加"
        : "可选，用于读写本地文件",
      done: hasWorkspace,
      actionLabel: hasWorkspace ? null : "添加文件夹",
      action: hasWorkspace ? null : "add-workspace",
    },
  ];

  const doneCount = items.filter((i) => i.done).length;
  return {
    items,
    allDone: doneCount === items.length,
    hasApiKey,
    hasWorkspace,
    doneCount,
  };
}
