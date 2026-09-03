/**
 * 链接状态枚举与状态语义（后端唯一事实源）。
 * 前端 src/utils/enums.ts 保持同构；新增状态时两处同步。
 */

/** 链接状态 */
const LinkStatus = Object.freeze({
  LINKED: 'linked',             // 已正确链接
  NOT_LINKED: 'not-linked',     // 未迁移，源为实体目录
  BROKEN: 'broken',             // 链接断裂或指向错误
  CONFLICT: 'conflict',         // 源与目标都有实体目录
  TARGET_ONLY: 'target-only',   // 源不存在、目标有数据（重装场景）
  NOT_INSTALLED: 'not-installed', // 源与目标都不存在
  UNKNOWN: 'unknown',           // 检测失败
})

/** 行操作类型 */
const RowActionType = Object.freeze({
  MIGRATE: 'migrate',
  RELINK: 'relink',
  REPAIR: 'repair',
  NONE: 'none',
})

/** 状态严重度（数字越大越紧急，组聚合取最严重） */
const STATUS_SEVERITY = Object.freeze({
  [LinkStatus.CONFLICT]: 5,
  [LinkStatus.BROKEN]: 4,
  [LinkStatus.NOT_LINKED]: 3,
  [LinkStatus.TARGET_ONLY]: 2,
  [LinkStatus.LINKED]: 1,
  [LinkStatus.NOT_INSTALLED]: 0,
  [LinkStatus.UNKNOWN]: 0,
})

/** 状态 → 行主操作 */
const STATUS_ACTION = Object.freeze({
  [LinkStatus.NOT_LINKED]: { type: RowActionType.MIGRATE, label: '迁移', disabled: false },
  [LinkStatus.TARGET_ONLY]: { type: RowActionType.RELINK, label: '重建链接', disabled: false },
  [LinkStatus.BROKEN]: { type: RowActionType.REPAIR, label: '修复', disabled: false },
  [LinkStatus.CONFLICT]: { type: RowActionType.REPAIR, label: '修复', disabled: false },
  [LinkStatus.LINKED]: { type: RowActionType.NONE, label: '已迁移', disabled: true },
  [LinkStatus.NOT_INSTALLED]: { type: RowActionType.NONE, label: '—', disabled: true },
  [LinkStatus.UNKNOWN]: { type: RowActionType.NONE, label: '—', disabled: true },
})

function rowAction(status) {
  return STATUS_ACTION[status] || STATUS_ACTION[LinkStatus.UNKNOWN]
}

function aggregateStatus(statuses) {
  return statuses.reduce(
    (acc, s) => ((STATUS_SEVERITY[s] ?? 0) > (STATUS_SEVERITY[acc] ?? 0) ? s : acc),
    LinkStatus.UNKNOWN
  )
}

/** 是否为待处理（需要迁移/重建） */
function isPending(status) {
  return status === LinkStatus.NOT_LINKED || status === LinkStatus.TARGET_ONLY
}

/** 是否为异常（冲突/断裂） */
function isAbnormal(status) {
  return status === LinkStatus.CONFLICT || status === LinkStatus.BROKEN
}

module.exports = {
  LinkStatus,
  RowActionType,
  STATUS_SEVERITY,
  STATUS_ACTION,
  rowAction,
  aggregateStatus,
  isPending,
  isAbnormal,
}
