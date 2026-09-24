/**
 * ============================================================================
 * 设置持久化纯模型（roadmap 任务 INT-007）
 * ============================================================================
 *
 * 「设置」的数据模型层：持久化形状（`StoredSettings`）、默认值
 * （`defaultSettings`）、逐字段归一化（`normalizeSettings`）与版本迁移入口
 * （`migrateSettings`），全部为纯函数 / 纯类型 —— 零 UI、零 DOM、零 store、
 * 零 Vue 依赖（与 historyModel.ts 同级的引擎层约束），持久化编排归
 * stores/settings.ts（读写 dbStorage + 回写各 store 真源 + watch 即时写回）。
 *
 * 为什么不复用 stores/view.ts 的既有导出（CONTEXT_LINES_MIN/MAX/
 * DEFAULT_CONTEXT_LINES 与 ViewMode）：view.ts 是 Vue reactive store，core
 * 层引入它会破坏「纯逻辑可单测、无框架依赖」的分层约束 —— 因此上下文行数
 * 区间与视图模式取值在此镜像声明（同值同义，两端注释互指）；漂移风险由
 * stores/settings.ts 的真实源单向搬运兜住（本模块只定义持久化形状，不参与
 * 运行时钳制 —— viewStore 的写入方仍以 view.ts 的常量为准）。
 *
 * 版本策略（schemaVersion）：
 * - v1 是首个版本，也是当前唯一版本。`normalizeSettings` 恒产出当前版本
 *   形状（含重写 schemaVersion），「迁移」的职责只是按版本路由 + 为未来
 *   版本预留升级链，字段级兜底全部归 normalizeSettings；
 * - 扩展方式（未来新增 v2 时）：
 *   1. SETTINGS_SCHEMA_VERSION 递增为 2；
 *   2. 按需增改 StoredSettings 字段，normalizeSettings 的逐字段校验同步
 *      覆盖新形状（老字段按需保留或删除）；
 *   3. 新增 migrateV1toV2(raw): unknown 纯函数 —— 只做结构改写（旧形状 →
 *      新形状），不做字段级兜底（那是 normalizeSettings 的职责）；
 *   4. 在 migrateSettings 的版本分支接入：`version === 1` 时改为
 *      `normalizeSettings(migrateV1toV2(raw))`；更高（未知）版本的数据无法
 *      安全降级解读，维持「整体回退 defaultSettings()」策略 —— 宁可重置
 *      设置也不让新版字段被旧逻辑误读。
 * ============================================================================
 */

import type { DiffPrecision, IgnoreRule } from './types'

/** 当前持久化 schema 版本（首版；升级时递增，扩展方式见文件头「版本策略」）。 */
export const SETTINGS_SCHEMA_VERSION = 1

/**
 * 结果视图模式（与 stores/view.ts 导出的 ViewMode 同构；core 层不反向依赖
 * store，故在此独立声明，两端注释互指防漂移）。
 */
export type SettingsViewMode = 'split' | 'unified'

/**
 * 设置的持久化形状（dbStorage key 'diff.settings' 的值）。
 *
 * 字段集合 = roadmap INT-007 的持久化范围（默认精度、默认选项、上下文行数、
 * 历史开关）+ 同属用户偏好的视图/语言/忽略规则；各字段语义与
 * 取值范围见字段注释，非法值在 normalizeSettings 中逐字段兜底回默认。
 * （「实时对比默认值」字段已随实时对比功能整体移除：normalizeSettings
 * 丢弃未知字段，旧持久化数据中的残留键在载入时被自然忽略。）
 */
export interface StoredSettings {
  /** schema 版本号（migrateSettings 的路由依据；normalizeSettings 恒重写为当前版本）。 */
  schemaVersion: number
  /** 对比精度（默认精度，工具栏精度下拉的初始值）。 */
  precision: DiffPrecision
  /** 语言选择（含 'auto' 自动检测；工具栏语言下拉的初始值）。 */
  language: string
  /** 结果视图模式：'split' 并排 / 'unified' 统一。 */
  viewMode: SettingsViewMode
  /** 折叠未变更行（视图选项，默认 true）。 */
  showCollapsed: boolean
  /** 超长行换行（视图选项，默认 false）。 */
  wrapLongLines: boolean
  /** hunk 上下文行数（钳制 [0, 10]，默认 3；区间常量镜像自 stores/view.ts）。 */
  contextLines: number
  /** 忽略空白差异（对比选项，默认 false）。 */
  ignoreWhitespace: boolean
  /** 忽略大小写（对比选项，默认 false）。 */
  ignoreCase: boolean
  /**
   * 自定义忽略规则列表（默认空；条目形状见 isRuleLike —— 正则能否编译归
   * viewStore.getRuleError 的编辑期校验，形状合法但正则非法的条目照常保留，
   * 载入后由设置弹窗标红、引擎侧照旧拦截，与本模块无关）。
   */
  ignoreRules: IgnoreRule[]
  /** 历史自动保存开关（对应 historyStore.autoSave，默认 true）。 */
  autoSaveHistory: boolean
}

/**
 * 上下文行数的钳制区间与默认值：与 stores/view.ts 导出的 CONTEXT_LINES_MIN /
 * CONTEXT_LINES_MAX / DEFAULT_CONTEXT_LINES 同值同义（core 层不依赖 store，
 * 镜像声明，理由见文件头）。仅供本模块归一化使用，不对外导出。
 */
const CONTEXT_LINES_MIN = 0
const CONTEXT_LINES_MAX = 10
const DEFAULT_CONTEXT_LINES = 3

/** 合法精度取值（与 DiffPrecision 一一对应，归一化的白名单）。 */
const PRECISION_VALUES: readonly DiffPrecision[] = ['smart', 'line', 'word', 'char']

/** 合法视图模式取值（归一化的白名单）。 */
const VIEW_MODE_VALUES: readonly SettingsViewMode[] = ['split', 'unified']

/**
 * 构造一份全字段默认值的设置对象（每次调用返回全新对象，调用方可安全改写）。
 *
 * 默认值与各 store 的模块级缺省值一致（precision 'smart' / showCollapsed
 * true / viewMode 'split' / language 'auto' / contextLines 3 / 布尔开关
 * false / autoSaveHistory true）—— 若 store 缺省值调整，本函数需同步。
 */
export function defaultSettings(): StoredSettings {
  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    precision: 'smart',
    language: 'auto',
    viewMode: 'split',
    showCollapsed: true,
    wrapLongLines: false,
    contextLines: DEFAULT_CONTEXT_LINES,
    ignoreWhitespace: false,
    ignoreCase: false,
    ignoreRules: [],
    autoSaveHistory: true,
  }
}

/**
 * 把任意持久化载荷归一化为干净的当前版本设置对象：
 *
 * - 输入非对象（null / 原始值 / 数组）时按「全空载荷」处理 —— 逐字段兜底后
 *   等价于 defaultSettings()；
 * - 逐字段类型校验：类型不符 / 越界一律回退该字段默认值（isHistoryItemLike
 *   的防御同风格：宁可回退也不让脏值进入 store），合法值原样保留；
 * - contextLines 例外地「不回退而是钳制」：数字一律 Math.floor 后钳到
 *   [0, 10]（2.9 → 2、99 → 10、-5 → 0），只有非有限数字才回退默认 3 ——
 *   上下文行数是连续量，钳制比丢弃更贴近用户意图；
 * - ignoreRules 非数组 → 空数组；数组内逐条做形状校验（isRuleLike），形状
 *   不符的条目直接丢弃，合法条目浅拷贝保留（顺序不变）；
 * - schemaVersion 恒重写为 SETTINGS_SCHEMA_VERSION（本函数的产物即当前
 *   版本形状，写入方无需再关心版本）；未知字段一律丢弃（不进产物）。
 *
 * @param raw dbStorage 读取产物（可能残缺 / 手改 / 旧版本 / 完全陌生）
 * @returns 全新对象；幂等（normalize(normalize(x)) 深等于 normalize(x)）
 */
export function normalizeSettings(raw: unknown): StoredSettings {
  const source: Record<string, unknown> =
    raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    precision: normalizePrecision(source.precision),
    language: normalizeLanguage(source.language),
    viewMode: normalizeViewMode(source.viewMode),
    showCollapsed: normalizeBoolean(source.showCollapsed, true),
    wrapLongLines: normalizeBoolean(source.wrapLongLines, false),
    contextLines: normalizeContextLines(source.contextLines),
    ignoreWhitespace: normalizeBoolean(source.ignoreWhitespace, false),
    ignoreCase: normalizeBoolean(source.ignoreCase, false),
    ignoreRules: normalizeIgnoreRules(source.ignoreRules),
    autoSaveHistory: normalizeBoolean(source.autoSaveHistory, true),
  }
}

/**
 * 设置持久化的版本迁移入口（stores/settings.ts 载入 dbStorage 后的第一站）。
 *
 * 路由策略（按读取到的 schemaVersion 分派）：
 * - 缺失 / 非有限数字：视为未携带版本的早期或脏数据。v1 是首个版本、不存
 *   在更早的真实形状，按 v1 逐字段归一化即可 —— 字段级校验会把垃圾值兜成
 *   默认，比整体重置多保住合法字段（数据保全优先）；
 * - 等于当前版本：正常归一化；
 * - 大于当前版本（未来版本插件写入的数据）：无法安全降级解读，整体回退
 *   defaultSettings() —— 未知字段不应被旧逻辑误读，宁可重置（下次持久化
 *   即写回当前版本）；
 * - 小于当前版本：历史版本数据，未来扩展时在此接入迁移链（见文件头「版本
 *   策略」的扩展方式），升级到当前形状后再归一化。当前 v1 之前不存在合法
 *   形状（0 / 负数属手改脏数据），防御性按 v1 归一化。
 *
 * @param raw dbStorage 读取产物
 * @returns 当前版本的干净设置对象（幂等：migrate(migrate(x)) 深等于 migrate(x)）
 */
export function migrateSettings(raw: unknown): StoredSettings {
  if (raw === null || typeof raw !== 'object') {
    return defaultSettings()
  }
  const version = (raw as { schemaVersion?: unknown }).schemaVersion
  if (typeof version !== 'number' || !Number.isFinite(version)) {
    return normalizeSettings(raw)
  }
  if (version === SETTINGS_SCHEMA_VERSION) {
    return normalizeSettings(raw)
  }
  if (version > SETTINGS_SCHEMA_VERSION) {
    return defaultSettings()
  }
  // version < 当前版本：预留的历史版本迁移链挂载点（当前按 v1 防御归一化）。
  return normalizeSettings(raw)
}

/** 布尔字段归一化：仅接受 boolean，其余回退 fallback。 */
function normalizeBoolean(raw: unknown, fallback: boolean): boolean {
  return typeof raw === 'boolean' ? raw : fallback
}

/** 精度归一化：白名单外（含非字符串）回退 'smart'。 */
function normalizePrecision(raw: unknown): DiffPrecision {
  return (PRECISION_VALUES as readonly unknown[]).includes(raw)
    ? (raw as DiffPrecision)
    : 'smart'
}

/** 视图模式归一化：白名单外（含非字符串）回退 'split'。 */
function normalizeViewMode(raw: unknown): SettingsViewMode {
  return (VIEW_MODE_VALUES as readonly unknown[]).includes(raw)
    ? (raw as SettingsViewMode)
    : 'split'
}

/**
 * 语言归一化：非空字符串原样透传（不校验候选清单 —— 语言列表在 view.ts 的
 * LANGUAGE_OPTIONS 且可扩充，存储值来自同一来源，按清单硬校验会拒绝未来
 * 版本新增的语言），空串 / 非字符串回退 'auto'。
 */
function normalizeLanguage(raw: unknown): string {
  return typeof raw === 'string' && raw !== '' ? raw : 'auto'
}

/**
 * 上下文行数归一化：非有限数字回退默认 3；数字 Math.floor 后钳制到
 * [CONTEXT_LINES_MIN, CONTEXT_LINES_MAX]（取舍见 normalizeSettings 注释）。
 */
function normalizeContextLines(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    return DEFAULT_CONTEXT_LINES
  }
  return Math.min(CONTEXT_LINES_MAX, Math.max(CONTEXT_LINES_MIN, Math.floor(raw)))
}

/**
 * 忽略规则列表归一化：非数组 → 空数组；数组内逐条形状校验（isRuleLike），
 * 不符条目丢弃，合法条目浅拷贝保留（保持原顺序，浅拷贝使产物与 dbStorage
 * 读取对象不共享引用）。
 */
function normalizeIgnoreRules(raw: unknown): IgnoreRule[] {
  if (!Array.isArray(raw)) return []
  return raw.filter(isRuleLike).map((rule) => ({ ...rule }))
}

/**
 * 单条忽略规则的形状守卫（stores/history.ts isHistoryItemLike 同风格）：
 * id / pattern / flags 为字符串且 enabled 为布尔才保留 —— 宁可丢弃可疑条目
 * 也不让渲染层与引擎踩到 undefined；正则能否编译不在本层职责内（见
 * StoredSettings.ignoreRules 注释）。
 */
function isRuleLike(value: unknown): value is IgnoreRule {
  if (value === null || typeof value !== 'object') return false
  const rule = value as Partial<IgnoreRule>
  return (
    typeof rule.id === 'string' &&
    typeof rule.pattern === 'string' &&
    typeof rule.flags === 'string' &&
    typeof rule.enabled === 'boolean'
  )
}
