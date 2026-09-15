/**
 * 全局枚举与状态元数据（前端唯一事实源，与后端 core/status-enum.js 同构）。
 * 注意：store / 前端统一使用 camelCase 状态（notLinked…），kebab 仅在 api 层与 preload 互转。
 * 所有状态文案、色调、行操作、严重度都集中在此，便于统一维护与复用。
 */
import type { LinkStatus } from '../store/types/mapping';

// ────────────── 链接状态 ──────────────

/** 状态语义色（对应 styles/base.scss 的 .tag.ok/.warn/.bad/.info/.neutral） */
export type StatusTone = 'ok' | 'warn' | 'bad' | 'info' | 'neutral';

/** 行主操作类型 */
export type RowActionType = 'migrate' | 'relink' | 'repair' | 'none';

/** 行主操作描述（由状态纯函数推导） */
export interface RowAction {
  type: RowActionType;
  /** 按钮文案 */
  label: string;
  /** 是否禁用 */
  disabled: boolean;
}

interface StatusMeta {
  /** 展示文案 */
  label: string;
  /** 语义色 */
  tone: StatusTone;
  /** 严重度（组聚合取最严重） */
  severity: number;
  /** 行主操作 */
  action: RowAction;
}

const noAction: RowAction = { type: 'none', label: '—', disabled: true };

export const STATUS_META: Record<LinkStatus, StatusMeta> = {
  linked: {
    label: '已链接', tone: 'ok', severity: 1,
    action: { type: 'none', label: '已迁移', disabled: true },
  },
  notLinked: {
    label: '待迁移', tone: 'warn', severity: 3,
    action: { type: 'migrate', label: '迁移', disabled: false },
  },
  broken: {
    label: '链接断裂', tone: 'bad', severity: 4,
    action: { type: 'repair', label: '修复', disabled: false },
  },
  conflict: {
    label: '冲突', tone: 'bad', severity: 5,
    action: { type: 'repair', label: '修复', disabled: false },
  },
  targetOnly: {
    label: '待重建', tone: 'info', severity: 2,
    action: { type: 'relink', label: '重建链接', disabled: false },
  },
  notInstalled: { label: '未安装', tone: 'neutral', severity: 0, action: noAction },
  unknown: { label: '未知', tone: 'neutral', severity: 0, action: noAction },
};

export function statusLabel(status: LinkStatus): string {
  return STATUS_META[status]?.label ?? status;
}
export function statusTone(status: LinkStatus): StatusTone {
  return STATUS_META[status]?.tone ?? 'neutral';
}
export function statusAction(status: LinkStatus): RowAction {
  return STATUS_META[status]?.action ?? noAction;
}
export function statusSeverity(status: LinkStatus): number {
  return STATUS_META[status]?.severity ?? 0;
}

/** 待处理：需要迁移/重建 */
export function isPendingStatus(status: LinkStatus): boolean {
  return status === 'notLinked' || status === 'targetOnly';
}
/** 异常：冲突/断裂 */
export function isAbnormalStatus(status: LinkStatus): boolean {
  return status === 'conflict' || status === 'broken';
}

// ────────────── 视图 / 筛选 ──────────────

export const ViewModeEnum = {
  Grouped: 'grouped',
  Flat: 'flat',
} as const;
export type ViewMode = (typeof ViewModeEnum)[keyof typeof ViewModeEnum];

export const FilterEnum = {
  All: 'all',
  Pending: 'pending',
  Linked: 'linked',
  Conflict: 'conflict',
} as const;
export type FilterKey = (typeof FilterEnum)[keyof typeof FilterEnum];

/** 未分组行的 groupId（空串） */
export const UNGROUPED_ID = '';
/** 未分组展示名 */
export const UNGROUPED_NAME = '未分组';
