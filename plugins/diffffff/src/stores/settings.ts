/**
 * 设置持久化 store（roadmap 任务 INT-007）。
 *
 * 「设置」的持久化编排层：把持久化范围（默认精度、对比/视图选项、视图模式、
 * 语言、上下文行数、自定义忽略规则、历史自动保存开关）从
 * dbStorage 载入并回写各 store 真源，再把这些字段的后续变更即时写回
 * dbStorage。纯模型逻辑（形状、默认值、逐字段归一化、版本迁移）下沉
 * core/settingsModel.ts 单测覆盖，本层只做「编排 + 持久化」（与
 * stores/history.ts ↔ core/historyModel.ts 的分工同款）。
 *
 * 职责边界与数据流：
 * - 真源不变：viewStore 仍是视图与选项的唯一真源，historyStore.autoSave 仍
 *   是历史开关的唯一真源 —— 本层不持有任何设置状态，只做 dbStorage ⇄ 真源
 *   之间的搬运（载入回写 + watch 写回），消费方（工具栏 / 设置弹窗 / App）
 *   的读写路径全部不变；
 * - 载入时机 = 模块初始化：模块顶层执行一次 load()（幂等守卫防 HMR 重复
 *   载入用旧快照覆盖内存新值，同 stores/history.ts 的 loaded 惯例）。App.vue
 *   import 本模块即完成载入 —— ESM 依赖模块的求值严格早于 App 组件的
 *   setup()，工具栏 / 编辑器的首次渲染读到的必然是恢复后的持久化值；
 * - watch 注册时机在 load() 之后：Vue 的 watch 只在注册后才响应变更，load
 *   的回写发生在监听器建立之前，天然不会触发一轮「把刚载入的值原样写回」
 *   的多余持久化 —— 因此无需 isInitialLoad / suppressPersist 标志位
 *   （applyToStores 只被 load 调用，且 load 恒在 watch 注册前执行，这一
 *   模块内顺序即守卫本身）；
 * - watch 策略：单一 watch 监听「可序列化快照」（getter 返回普通对象，依赖
 *   收集覆盖全部持久化字段；ignoreRules 逐条浅拷贝进快照 —— 数组长度与每
 *   条规则的 pattern / flags / enabled 变化都会触发，设置弹窗里规则编辑的
 *   输入过程由此最终落盘）。刻意不做节流：设置是低频变更（开关 / 下拉 /
 *   规则编辑），单次写入是 localStorage 量级的小对象；节流会引入「最后一刻
 *   变更未落盘」的丢失窗口，而宿主没有为设置提供 onPluginOut 式的 flush
 *   时机，即时写最简单也最安全。flush 用默认 pre：同一 tick 内的连续变更
 *   由调度器去重为一次写入，规则输入过程天然合并；
 * - 会话态不持久化：viewStore.narrowWindow / keepSplitInNarrow（UI-015 窄窗
 *   降级）与「下次启动的默认状态」无关，不进快照；同理 viewMode 持久化的是
 *   用户选择（窄窗下的 autoUnified 自动接管不回写，见 view.ts）；
 * - 已知语义（接受）：历史「恢复」会写回 viewStore 的选项与上下文行数，经
 *   本层 watch 同步进持久化 —— 即「默认值 = 最近一次使用的设置」，与设置
 *   弹窗「即改即生效、无独立保存动作」的既有语义一致。
 *
 * 持久化降级策略（与 stores/history.ts / usePluginLifecycle 同惯例）：
 * - 宿主内：读写 window.ztools.dbStorage（key 'diff.settings'），写入前经
 *   JSON 序列化剥离 Vue 响应式 Proxy（dbStorage 底层结构化克隆无法克隆
 *   Proxy），失败 console.debug 静默降级、不阻塞 UI；
 * - 浏览器 dev / preview（无 ztools 全局）：内存态运行 —— load 读不到宿主
 *   走 defaultSettings()，watch 写回静默失败，不抛错不崩，设置仍在本会话
 *   经真源 store 生效。
 */
import { watch } from 'vue'
import { SETTINGS_SCHEMA_VERSION, defaultSettings, migrateSettings } from '../core/settingsModel'
import type { StoredSettings } from '../core/settingsModel'
import { historyStore } from './history'
import { viewStore } from './view'

/** dbStorage 中存储设置的 key（与 'diff.history' / 'workbench.draft' 同惯例）。 */
const STORAGE_KEY = 'diff.settings'

/** 是否已完成首次载入（load 幂等守卫，防 HMR / 重复调用覆盖内存新值）。 */
let loaded = false

/**
 * 从 dbStorage 载入设置并回写各 store。仅在模块首次初始化时执行一次。
 * 读取失败 / 无宿主 / 数据残缺 / 未知版本统一收敛为 StoredSettings
 * （migrateSettings 内部完成版本路由与逐字段兜底），本层不感知数据形状。
 */
function load(): void {
  if (loaded) return
  loaded = true
  let settings: StoredSettings
  try {
    const stored = window.ztools.dbStorage.getItem<unknown>(STORAGE_KEY)
    settings = migrateSettings(stored)
  } catch (e) {
    // 浏览器 dev 无 ztools 全局 / 宿主读取失败 → 默认设置起步（内存态运行）。
    console.debug('[settings] 读取 dbStorage 失败，使用默认设置:', e)
    settings = defaultSettings()
  }
  applyToStores(settings)
}

/**
 * 把归一化后的设置回写到各 store 真源（载入链路的落点）。只被 load() 调用
 * 且恒发生在下方 watch 注册之前（见文件头「watch 注册时机」，这一顺序就是
 * 「载入不触发多余持久化」的守卫）。规则列表逐条浅拷贝，store 与 dbStorage
 * 读取产物不共享对象引用。
 */
function applyToStores(settings: StoredSettings): void {
  viewStore.precision = settings.precision
  viewStore.language = settings.language
  viewStore.viewMode = settings.viewMode
  viewStore.showCollapsed = settings.showCollapsed
  viewStore.wrapLongLines = settings.wrapLongLines
  viewStore.contextLines = settings.contextLines
  viewStore.ignoreWhitespace = settings.ignoreWhitespace
  viewStore.ignoreCase = settings.ignoreCase
  viewStore.ignoreRules = settings.ignoreRules.map((rule) => ({ ...rule }))
  historyStore.autoSave = settings.autoSaveHistory
}

/**
 * 从各 store 真源读出当前设置的持久化快照（普通对象 + 当前 schemaVersion）。
 * 同时充当 watch 的 getter：读取全部持久化字段完成依赖收集，ignoreRules
 * 逐条浅拷贝进快照使「规则 pattern / flags / enabled 的编辑」也可被监听。
 * 持久化字段集合 = StoredSettings 定义（core/settingsModel.ts），此处是其
 * 运行时出口，两处字段需同步维护。
 */
function snapshotSettings(): StoredSettings {
  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    precision: viewStore.precision,
    language: viewStore.language,
    viewMode: viewStore.viewMode,
    showCollapsed: viewStore.showCollapsed,
    wrapLongLines: viewStore.wrapLongLines,
    contextLines: viewStore.contextLines,
    ignoreWhitespace: viewStore.ignoreWhitespace,
    ignoreCase: viewStore.ignoreCase,
    ignoreRules: viewStore.ignoreRules.map((rule) => ({ ...rule })),
    autoSaveHistory: historyStore.autoSave,
  }
}

/**
 * 同步设置快照到 dbStorage。写入前经 JSON 序列化剥离响应式 Proxy（快照里的
 * 规则对象虽已是浅拷贝，但拷贝自 reactive 代理，统一过一遍 JSON 最稳妥，
 * 理由同 stores/history.ts persist）；无宿主 / 写盘失败静默降级，不抛错。
 *
 * @param snapshot 待写盘的快照（通常为 watch 回调携带的最新值，避免读旧）
 */
function persist(snapshot: StoredSettings): void {
  try {
    const plain = JSON.parse(JSON.stringify(snapshot)) as StoredSettings
    window.ztools.dbStorage.setItem(STORAGE_KEY, plain)
  } catch (e) {
    // 浏览器 dev 无 ztools 全局 / 写盘失败（存储已满等）→ 静默降级为内存态
    // （设置仍在本会话生效），console.debug 记录原因便于排查（刻意用 debug
    // 而非 warn：写盘失败是可接受降级，不是错误，同 history persist 惯例）。
    console.debug('[settings] 写入 dbStorage 失败，本会话降级为内存态:', e)
  }
}

/** 载入设置（幂等）：模块初始化时执行一次，App.vue import 本模块即触发。 */
load()

/*
 * 持久化 watch（注册于 load() 之后，理由见文件头「watch 注册时机」）：
 * getter 返回可序列化快照 —— 任一持久化字段变化（含规则逐条 pattern /
 * flags / enabled 与数组增删）都会触发回调，把携带的最新快照整体写盘；
 * 同一 tick 内的连续变更由调度器去重为一次写入（默认 pre flush）。
 */
watch(snapshotSettings, (snapshot) => persist(snapshot))
