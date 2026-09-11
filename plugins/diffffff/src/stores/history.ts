/**
 * 本地历史持久化 store（roadmap 任务 INT-004）。
 *
 * 组合式 reactive 单例（与 workbench / view / diff / nav 同风格，刻意不引
 * Pinia）：持有「已保存差异」历史列表与自动保存开关，参照 f-provider 的
 * useHistory 惯例 —— dbStorage key + 100 条上限 + 读写全程 try/catch 静默
 * 降级；纯模型逻辑（去重 / 截尾 / 搜索 / 标题）下沉 core/historyModel.ts
 * 单测覆盖，本层只做「编排 + 持久化」。
 *
 * 职责边界：
 * - 保存时机归调用侧：App.vue 在 diffStore.run() 成功路径（result ok）后调
 *   saveFromResult()（result watch 单一出口，显式对比 / 实时防抖 / 选项
 *   重跑 / 合并重算全部经过），本 store 不监听 diffStore（保持 store 间
 *   「读输出、不被反向订阅」的既有边界）；
 * - autoSave 默认 true：对比成功即自动入库（INT-004 的「可选/自动」取自动
 *   优先 —— 手动保存需要额外交互面，自动 + 可关闭已覆盖两）；该开关的持久
 *   化归 INT-007 的 stores/settings.ts（dbStorage 载入回写 + 变更写回），
 *   UI 入口在设置弹窗的「自动保存历史」；
 * - restore 写回的是「当时对比的完整输入」：workbench 文本 + viewStore 选项
 *   与上下文行数 + 语言，随后复用 diffStore.run() 重算（选项回写 → 引擎
 *   重算 → UI 切结果态的链路见 restore JSDoc）。
 *
 * 持久化降级策略（与 usePluginLifecycle / f-provider useHistory 同惯例）：
 * - 宿主内：读写 window.ztools.dbStorage（key 'diff.history'），写入前经
 *   JSON 序列化剥离 Vue 响应式 Proxy（dbStorage 底层结构化克隆无法克隆
 *   Proxy，见 f-provider useHistory.persist 的同款注释），失败 console.debug
 *   静默降级、不阻塞 UI；
 * - 浏览器 dev / preview（无 ztools 全局）：内存态运行 —— items 本就是模块
 *   级 ref（进程内唯一），读写不触达 dbStorage 即不抛错；memoryDirty 脏标记
 *   记录「内存中存在未落盘数据」（仅作状态备注与排查线索，不影响任何行为），
 *   所有写操作不崩。
 */
import { ref } from 'vue'
import {
  HISTORY_MAX_ITEMS,
  deriveHistoryTitle,
  historyItemKey,
  pushHistoryItem,
} from '../core/historyModel'
import type { HistoryItem } from '../core/historyModel'
import { DEFAULT_OPTIONS } from '../core/options'
import { isDiffOk } from '../core/types'
import type { DiffOptions, DiffResult } from '../core/types'
import { diffStore } from './diff'
import { viewStore, CONTEXT_LINES_MIN, CONTEXT_LINES_MAX } from './view'
import { workbenchStore } from './workbench'

/** dbStorage 中存储历史的 key（惯例对齐 f-provider 的 `history.list`）。 */
const STORAGE_KEY = 'diff.history'

/**
 * 写入节流窗口（ms）：距上次保存小于该值且「对比身份键」相同（同选项 +
 * 同上下文行数 + 同双侧文本）的连续 run 跳过本次入库 —— 实时对比防抖后的
 * 重算不会改变输入，若每次都写 storage 会高频刷盘；pushHistoryItem 的去重
 * 虽只置顶更新一条，但保存本身仍会写盘，节流把「同输入的重复写」折叠为
 * 每 3s 至多一次。
 */
export const HISTORY_SAVE_THROTTLE_MS = 3000

// ─── 模块级单例（进程内唯一，跨组件共享）────────────────────────────────

/** 历史列表：最新在前（pushHistoryItem 维护 savedAt 降序约定）。 */
const items = ref<HistoryItem[]>( [])

/**
 * 自动保存开关（默认 true，理由见文件头「autoSave 默认 true」段）；
 * INT-007 起由 stores/settings.ts 持久化到 dbStorage，设置弹窗管理 UI 入口。
 */
const autoSave = ref(true)

/** 是否已完成首次载入（load 幂等守卫，防 HMR / 重复调用覆盖内存新数据）。 */
let loaded = false

/** 浏览器 dev 无宿主时的脏标记：true = 内存中存在未写入 dbStorage 的数据。 */
let memoryDirty = false

/** 节流状态：上次成功入库的身份键（null = 本会话尚未入库过）。 */
let lastSaveKey: string | null = null

/** 节流状态：上次入库的时间戳（ms）。 */
let lastSavedAt = 0

/**
 * 载入历史列表到单例 ref。仅在模块首次初始化时执行一次（理由同 f-provider
 * useHistory：若在 push 入库之后重复 load，会用 dbStorage 旧快照覆盖内存
 * 新记录）。非数组 / 条目形状不符 / 读写异常一律容错为空列表或丢弃坏条目。
 */
function load(): void {
  if (loaded) return
  loaded = true
  try {
    const stored = window.ztools.dbStorage.getItem<HistoryItem[]>(STORAGE_KEY)
    items.value = Array.isArray(stored) ? stored.filter(isHistoryItemLike) : []
  } catch (e) {
    // 浏览器 dev 无 ztools 全局 / 宿主读取失败 → 空列表起步（内存态运行）。
    console.debug('[history] 读取 dbStorage 失败，以空历史起步:', e)
    items.value = []
  }
}

/** 载入历史（幂等）：模块初始化时执行一次，详见 load JSDoc。 */
load()

/**
 * 条目形状守卫：dbStorage 里的旧数据 / 手改数据可能残缺，缺关键字段或类型
 * 不符的条目直接丢弃（宁可少一条也不让渲染层 / 搜索层踩到 undefined）。
 */
function isHistoryItemLike(value: unknown): value is HistoryItem {
  if (value === null || typeof value !== 'object') return false
  const it = value as Partial<HistoryItem>
  return (
    typeof it.id === 'string' &&
    typeof it.title === 'string' &&
    typeof it.savedAt === 'number' &&
    typeof it.left === 'string' &&
    typeof it.right === 'string' &&
    typeof it.contextLines === 'number' &&
    typeof it.language === 'string' &&
    it.options !== null &&
    typeof it.options === 'object' &&
    it.stats !== null &&
    typeof it.stats === 'object'
  )
}

/**
 * 同步当前列表到 dbStorage。写入前经 JSON 序列化剥离响应式 Proxy（理由见
 * 文件头持久化降级策略）；无宿主环境只置脏标记，不抛错不阻塞。
 */
function persist(): void {
  try {
    const plain = JSON.parse(JSON.stringify(items.value)) as HistoryItem[]
    window.ztools.dbStorage.setItem(STORAGE_KEY, plain)
    memoryDirty = false
  } catch (e) {
    // 浏览器 dev 无 ztools 全局 / 写盘失败（超大文本、存储已满等）→ 静默
    // 降级为内存态，数据仍在本会话的 items 里；console.debug 记录原因便于
    // 排查（刻意用 debug 而非 warn：写盘失败是可接受降级，不是错误）。
    memoryDirty = true
    console.debug('[history] 写入 dbStorage 失败，本会话降级为内存态:', e)
  }
}

/** 生成条目 id：优先 crypto.randomUUID()，宿主不支持时时间戳 + 随机串兜底。 */
function createHistoryId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * 把选项深拷贝为独立快照（diff.ts 的 snapshotOptions 同构）：items 里的
 * options 不能与 diffStore.lastOptions / viewStore.ignoreRules 共享对象
 * 引用，否则后续增删改规则会连带篡改已存历史。
 */
function snapshotOptions(options: DiffOptions): DiffOptions {
  const rules = Array.isArray(options.ignoreRules) ? options.ignoreRules : []
  return {
    ignoreWhitespace: options.ignoreWhitespace === true,
    ignoreCase: options.ignoreCase === true,
    ignoreEmptyLines: options.ignoreEmptyLines === true,
    ignoreRules: rules.map((rule) => ({ ...rule })),
  }
}

/** 对外 store 形状：历史列表 + 自动保存开关 + 四个动作。 */
export interface HistoryStore {
  /** 历史列表（最新在前；只经本 store 的动作变更）。 */
  readonly items: HistoryItem[]
  /** 自动保存开关（默认 true；INT-007 接入设置持久化，见文件头）。 */
  autoSave: boolean
  /** 对比成功后入库（语义见 saveFromResult JSDoc）。 */
  saveFromResult: () => void
  /** 按 id 删除一条历史。 */
  remove: (id: string) => void
  /** 清空全部历史。 */
  clearAll: () => void
  /** 恢复一条历史到工作台并重算（语义见 restore JSDoc）。 */
  restore: (item: HistoryItem) => Promise<boolean>
}

/**
 * 对比成功后入库（App.vue 的 diffStore.result watch 在 ok 结果落地时调用，
 * 是唯一保存出口 —— 显式对比 / 实时防抖 / 选项重跑 / 合并重算全路径覆盖）。
 *
 * 行为约定：
 * - autoSave 关闭时直接跳过（用户显式不要历史）；
 * - 组装条目：title 由 deriveHistoryTitle 推导（文件名对优先、left 首非空
 *   行摘要兜底）、options 取 diffStore.lastOptions（run 落下的实际生效选项
 *   快照，深拷贝入列）、contextLines 取 viewStore.contextLines（run 的实际
 *   入参）、language 取 viewStore.effectiveLanguage（auto 已解析）、stats
 *   取当前成功结果的统计快照；
 * - 节流：身份键与上次入库相同且距上次 <3s 时跳过（见
 *   HISTORY_SAVE_THROTTLE_MS），实时对比的连续重算不重复刷盘；
 * - 入库经 pushHistoryItem（去重置顶 + 100 条截尾）后同步写 dbStorage。
 */
function saveFromResult(): void {
  if (!autoSave.value) return
  const result: DiffResult | null = diffStore.result
  if (result === null || !isDiffOk(result)) return

  const left = workbenchStore.leftText
  const right = workbenchStore.rightText
  const options = snapshotOptions(diffStore.lastOptions)
  const contextLines = viewStore.contextLines
  const item: HistoryItem = {
    id: createHistoryId(),
    title: deriveHistoryTitle(
      left,
      right,
      workbenchStore.leftFileName,
      workbenchStore.rightFileName,
    ),
    savedAt: Date.now(),
    left,
    right,
    options,
    contextLines,
    stats: { ...result.stats },
    language: viewStore.effectiveLanguage,
  }

  // 写入节流：同身份键 + 3s 窗口内的连续 run（实时对比 / 选项重跑的原地
  // 重算）不重复入库与写盘。节流跳过是「整体跳过」：不 push（去重置顶的
  // savedAt 刷新一并跳过，3s 后的下一次变化会正常入库）。
  const key = historyItemKey(item)
  if (key === lastSaveKey && Date.now() - lastSavedAt < HISTORY_SAVE_THROTTLE_MS) {
    return
  }

  items.value = pushHistoryItem(items.value, item, HISTORY_MAX_ITEMS)
  persist()
  lastSaveKey = key
  lastSavedAt = item.savedAt
}

/** 按 id 删除一条历史（未命中静默忽略），并同步 dbStorage。 */
function remove(id: string): void {
  items.value = items.value.filter((it) => it.id !== id)
  persist()
}

/** 清空全部历史，并同步 dbStorage。 */
function clearAll(): void {
  items.value = []
  persist()
}

/**
 * 恢复一条历史到工作台并重算（「恢复」链路的唯一实现）：
 *
 * 1. 写回 workbench 双侧文本；来源文件名清空 —— 历史文本与原文件已无对应
 *    关系（草稿恢复 / 示例载入同语义），残留旧文件名会误导语言检测与复制
 *    报告的 patch 头命名；
 * 2. 写回 viewStore 选项（ignoreWhitespace / ignoreCase / ignoreEmptyLines /
 *    ignoreRules 逐条深拷贝）与 contextLines（钳制到设置弹窗同款区间）；
 * 3. 写回语言（item.language 是当时的 effectiveLanguage，恢复后原样生效，
 *    不再走 auto 检测 —— 与「恢复当时的对比现场」语义一致）；
 * 4. await diffStore.run() 重算（选项回写已生效，run 从 viewStore 读取），
 *    返回本次结果是否成功（true = ok 结果，供调用方切结果态；false 含空态
 *    短路 / 失败 —— 调用方保持当前工作台态即可，错误反馈由既有 result
 *    watch 的 toast 承担）。
 *
 * 注意：恢复触发的新结果会再次经过 App 的 result watch → saveFromResult()
 * —— 身份键与被恢复条目相同，pushHistoryItem 去重只置顶更新该条（时间戳
 * 刷新），不会产生重复条目。
 *
 * @param item 待恢复的历史条目（只读，写回值均经拷贝）
 * @returns 重算是否得到 ok 结果
 */
async function restore(item: HistoryItem): Promise<boolean> {
  workbenchStore.setLeftText(item.left)
  workbenchStore.setRightText(item.right)
  workbenchStore.setLeftFileName('')
  workbenchStore.setRightFileName('')

  const options = snapshotOptions(item.options ?? DEFAULT_OPTIONS)
  viewStore.ignoreWhitespace = options.ignoreWhitespace
  viewStore.ignoreCase = options.ignoreCase
  viewStore.ignoreEmptyLines = options.ignoreEmptyLines
  viewStore.ignoreRules = options.ignoreRules
  viewStore.contextLines = Math.min(
    CONTEXT_LINES_MAX,
    Math.max(CONTEXT_LINES_MIN, Math.floor(item.contextLines) || 0),
  )
  viewStore.language = item.language

  await diffStore.run()
  const result = diffStore.result
  return result !== null && isDiffOk(result)
}

/** 历史持久化单例 store（模块级 ref 单例，与各 store 同风格）。 */
export const historyStore: HistoryStore = {
  get items(): HistoryItem[] {
    return items.value
  },
  get autoSave(): boolean {
    return autoSave.value
  },
  set autoSave(value: boolean) {
    autoSave.value = value
  },
  saveFromResult,
  remove,
  clearAll,
  restore,
}
