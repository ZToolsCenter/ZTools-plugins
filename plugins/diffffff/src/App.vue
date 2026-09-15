<script setup lang="ts">
// FND-004 App Shell：容器布局骨架（侧边栏 / 工具条 / 双栏工作台；原底部
// 操作区已随统计条上移工具条撤除）。
// FND-005：双栏接入 workbench store，并完成生命周期接线
// （onPluginEnter 聚焦左编辑器、onPluginOut 持久化未保存输入，见 usePluginLifecycle）。
// UI-001：双栏已替换为 CodeMirror 6 编辑器组件（components/InputEditor.vue），
// 数据源仍是 store（stores/workbench.ts），聚焦接口（focusLeftEditor）签名不变。
// UI-002：pane 头部新增「打开文件」按钮（useFileLoad），并挂载全局反馈组件
// （ZToast / ZConfirmDialog，供 useFileLoad 的错误提示与覆盖确认使用）。
// UI-003：每侧 pane 成为拖放目标（useDropLoad）——文件拖入走 preload 读路径、
// 文本拖入直接覆盖该侧，悬停时显示拖拽覆盖层（虚线框 + 半透明遮罩 + 文案）。
// UI-004：对比触发机制接线 —— 「查找差异」主按钮（本任务起驻顶部工具条、
// 结果态变为「重新编辑」）+ ⌘/Ctrl+Enter 全局快捷键
// （window 捕获阶段）+ 底部最小结果摘要条（result-summary，UI-010 升级为
// 完整统计条，本任务随底部操作区撤除迁至顶部工具条左端）。
// UI-005：工具栏重排为「标题 | 视图/精度/语言 | 选项开关 | 设置」，
// 视图与选项状态归 viewStore（stores/view.ts），结果态归 diffStore ——
// 新增「选项变化自动重跑」watch（有结果立即重跑）与「实时对比默认值」
// 启动注入（onMounted），设置弹窗（SettingsDialog.vue）由齿轮按钮触发。
// UI-006：工作台切换为「输入态 / 结果态」双态 —— 存在成功结果且 resultMode
// 时渲染结果视图；结果态回输入态由主按钮「重新编辑」承担（仅 UI 层切回、
// 不清 diffStore.result）。显式触发（主按钮 / ⌘/Ctrl+Enter）run 成功后自动进入
// 结果态；选项自动重跑属后台刷新，不改变当前态（避免编辑中被拽回
// 结果视图）。三态扩展已随本任务回退为双态（见 UI-011 条目）。
// UI-007：结果态按 viewStore.viewMode 分流 —— 并排渲染 SplitDiffView、
// 统一渲染 UnifiedDiffView（单栏 +/−/空格 行 + hunk 头条，组件文件头有全量说明）。
// UI-010：底部摘要条升级为完整统计条（+N/−M/~K/H 处差异 徽标）+ hunk 导航
// 按钮组（▲ 上一处 / 位置 2/5 / ▼ 下一处）+ F3/Shift+F3 全局快捷键；导航态
// 归 stores/nav.ts（键盘与按钮同一出口），result 变化时 watch 重置定位。
// 本任务起统计条与导航组迁至主区顶部工具条（左端统计 / 主按钮右侧导航），
// 底部操作区随迁移撤除。
// UI-011 → 本任务撤除：原「结果态保留编辑」（结果行点击进入保留编辑态 +
// 顶部编辑提示条「正在编辑…」）已整体移除 —— 结果态下点击行内容不再切态、
// 不再展示编辑提示条；回编辑的唯一出口是顶部工具条主按钮「重新编辑」
// （不清 result 缓存直接切回输入态）。双态状态机与全部转换见脚本区
// 「结果态开关」大注释；结果态错误块兜底（ok:false 不白屏，完整错误态归
// UI-013）。
// UI-012：合并更改 —— 两个结果视图 hunk 首行前的「合并控制条」emit
// applyHunk（hunk 下标 + 方向），handleApplyHunk 调 core/merge.ts 的
// applyHunk 把该 hunk 一侧内容写入另一侧（setLeftText / setRightText）后
// diffStore.run() 重算刷新（后台刷新路径：不碰 appMode，结果态保持；
// 应用后该 hunk 消失属预期）。
// UI-013：状态与反馈补全 ——
// ① 空输入：runDiffWithEmptyFeedback 在调用侧检测两侧全空（与 store 空态
//    短路同条件）时 ZToast info，两条触发路径（显式 / 选项重跑）
//    统一走该包装；store 保持纯状态机、clear() 语义不变；
// ② 两侧相同：isIdenticalResult（成功 + 统计/hunk 全零）时结果视图顶部
//    常驻提示条 .same-notice（main.css），结果视图照常渲染可浏览；
// ③ 引擎错误：错误块按类别具体化（too-large 带实际/上限详情、invalid-regex
//    带 pattern 与「打开设置」直达、internal 原文直出），错误结果落地瞬间
//    ZToast error 一次（result watch），完整详情常驻错误块 / 底部摘要条；
// ④ 加载态：重算进行中且已有旧结果时工作台顶部不确定进度条（.result-progress，
//    main.css，纯感知优化）；主按钮「对比中…」维持原有反馈。
// UI-014：操作便捷项 —— 工具栏新增「示例数据」动作下拉（中文示例 / 代码示例，
// 载入前覆盖确认、载入后清旧结果回输入态、不自动对比）与「交换 / 清空」
// 小按钮：交换在有结果时自动重算刷新（后台刷新路径）、清空带防误弹确认并
// 落回输入态、复制走宿主 copyText 优先 + 剪贴板降级的双路径。各动作的状态
// 交互决策见脚本区 UI-014 大注释块。UI-017 起「交换 / 清空」迁至主区右上
// 工具条并配图标，「复制原始 / 复制更改后」由两侧 pane 头部的「全部复制」
// 取代（原侧边栏四个小按钮随之撤出）。
// UI-017：操作区调整 —— ① 移除「实时对比」功能（侧边栏开关、防抖 watch、
// 设置弹窗默认值与持久化字段一并撤除，对比只由显式触发与选项自动重跑驱动）；
// ② 「清空 / 全部展开 / 交换」三个按钮移至主区右上工具条（.main-toolbar），
// 均带图标，「全部展开」经结果视图 defineExpose 的 expandAll / isAnyCollapsed
// 接线（视图内原 sticky「全部展开」工具条撤除）；③ 两侧 pane 头部各新增
// 「全部复制」按钮组 —— 按钮左侧展示该侧总行数，hover 弹出统计悬浮
// （.copy-stats-pop）：分「行 / 字符」两节展示 总计 与 变化量（左侧 = 删除、
// 右侧 = 添加，含占比与计数；数据源见脚本区 UI-017 大注释）。
// INT-002：导出能力 —— 工具栏新增「导出」动作下拉（PDF / HTML，与示例数据
// 同款 ZSelect 动作菜单模式）：PDF 走 window.print()（Electron 打印对话框
// 自带「另存为 PDF」，roadmap §4 的无网导出路径，打印样式见 main.css 的
// @media print 块）；HTML 由 core/exporters.ts 组装单文件内联样式文档，宿主
// 环境经 services.pickSaveFile + writeTextFile 落盘（新增第 5 个桥接方法），
// 浏览器 dev 降级为 Blob 下载兜底。无结果 / ok:false 时导出入口禁用（任务 D）。
// INT-003：复制差异报告 —— 工具栏新增「复制报告」动作下拉（unified patch /
// Markdown / HTML 三种格式到剪贴板，对应官网「分享链接」的无网本地化）：
// patch / Markdown 由 core/reporters.ts 纯函数组装（HTML 复用 buildExportHtml，
// 与落盘导出共用同一构建出口 buildResultExportHtml），复制走 useCopy 的宿主
// copyText 优先 + 剪贴板降级链（从 UI-014 的实现抽取共享）。无结果 / ok:false
// 时入口随「导出」一并禁用；unified patch 在两侧无差异时 toast info 引导。
// INT-004：本地历史（「已保存差异」）—— 保存出口是 diffStore.result 的 watch
// （结果 ok 时调 historyStore.saveFromResult()，自动保存关闭时 store 内跳过；
// 显式对比 / 选项重跑 / 合并重算 / 交换重算各条路径的 ok 结果统一经过该
// watch，节流与去重在 store / 模型层完成）；历史入口自本任务起为侧边栏
// 头部「文本对比 / 历史」页签切换（sidebarTab，原「历史」按钮 + 右侧滑出
// 抽屉 HistoryDrawer 撤除，历史内嵌侧边栏 HistoryPanel）：搜索 /
// 恢复 / 删除 / 清空；恢复经 handleRestoreHistory 编排 —— restore 写回文本
// / 选项 / 语言并重算，成功后切回 workbench 页签并切结果态（与
// runAndShowResult 同语义，详见该函数注释）。
// INT-005：文件编码支持 —— 两侧 pane 头部「打开文件」按钮旁各渲染一个全局
// 「打开编码」选择器（UTF-8 默认 / GBK / UTF-16）：决策取全局单值（两侧
// 选择器绑定同一 ref，改一侧另一侧同步），理由是用户通常连续导入同源文件，
// 每侧独立编码徒增心智负担。「打开文件」与拖入文件两条载入链路均按该编码
// 解码（getter 每次载入时求值）；GBK 等编码遇非法字节序列不抛错，按
// TextDecoder 标准以 U+FFFD 替换符呈现乱码，选择器 tooltip 提示切换编码重试；
// 选择在两次载入间保持（App 级 ref 会话态，不持久化 —— 未列入 INT-007 的
// 持久化范围，见 stores/settings.ts）。
// INT-006：剪贴板载入 —— 两侧 pane 头部各加「粘贴」小按钮（读剪贴板写入该
// 侧：空剪贴板 toast info「剪贴板为空」、目标侧已有内容时覆盖确认「覆盖未
// 保存内容」（与「打开文件」语义一致）、不自动对比不碰 appMode）；工具栏
// 便捷项组加「粘贴并对比」快捷路径（目标侧决策：两侧均空 → 左侧 / 仅一侧
// 空 → 空侧 / 两侧均非空 → 左侧 + 覆盖确认，写入后立即 runAndShowResult 与
// 主按钮同语义进结果态；剪贴板空 toast info 且不触发对比）；⌘/Ctrl+Shift+V
// 全局快捷键（捕获阶段，与 ⌘/Ctrl+Enter / F3 同一监听器）。读取降级链
// ztools services → navigator.clipboard、单侧粘贴流程与目标侧决策抽在
// composables/useClipboardLoad.ts（决策表见该文件头注释）。
// INT-007：设置持久化 —— 设置的载入与写回编排归 stores/settings.ts（纯模型
// 在 core/settingsModel.ts）：模块 import 求值时一次性从 dbStorage（key
// 'diff.settings'，经 schemaVersion 迁移路由）恢复「默认精度 / 默认选项 /
// 视图与语言 / 上下文行数 / 自定义忽略规则 / 自动保存历史开关」并回写
// viewStore 与 historyStore.autoSave，此后字段变更即时写回。
// 本文件只需 side-effect import 触发模块初始化。
// 本任务（结果态顶部栏 + 载入即重算 + 统计上移）：① 查找差异后不再隐藏
// 两侧 pane 顶部栏 —— 结果态以 .result-headers 行复用 PaneHeader（原
// pane-header 段抽取成组件），编码 / 打开文件 / 粘贴 / 全部复制在结果态
// 保持可达；② 结果态下经顶部栏「打开文件 / 粘贴」改变任一侧内容、或切换
// 「打开编码」，都视为「重新编辑后查找差异」：内容写入后自动
// runAndShowResult 刷新结果视图（切编码还会按新编码重读已记录来源路径的
// 侧 —— workbench 新增 leftFilePath / rightFilePath 会话态字段）；③ 顶部
// 栏左侧徽标改为「N 字符 · M 行」（原 InputEditor 底部统计条口径，底部条
// 随之撤除；统计视图模型与样式整体迁入 components/PaneHeader.vue）。
// 本任务（统计条与导航上移、底部操作区撤除）：① 底部 footer 操作区整体
// 撤除 —— 差异统计徽标条（+N/−M/~K/H 处差异 / 错误摘要）迁至主区顶部工具
// 条左端（.main-toolbar-side），与主按钮「查找差异 / 重新编辑」同一行；
// ② hunk 导航按钮组改为纯图标按钮（chevron-up / chevron-down + aria-label，
// 位置文案保留），迁至主按钮右侧（「清空 / 全部展开 / 交换」之前）；
// ③ F3/Shift+F3 快捷键语义不变（navStore 单一出口，视图模型不变）。
// 本任务（操作区精简）：侧边栏「操作」组移除「粘贴并对比 / 复制报告 / 导出」
// 三个入口（INT-006 快捷路径、INT-003 / INT-002 整体撤除）——「粘贴并对比」
// 的 ⌘/Ctrl+Shift+V 快捷键与目标侧决策（resolvePasteCompareTarget）、
// core/reporters.ts / core/exporters.ts 及其单测、preload 的 pickSaveFile /
// writeTextFile 桥接方法与 @media print 打印样式一并移除；单侧「粘贴」
// （pane 头部按钮）与「示例数据 / 交换 / 清空」等便捷项保留。
// 本任务（折叠开关左下角化 + 收纳动画）：侧边栏折叠开关自头部迁至【窗口
// 左下角】，成为展开 / 收起共用的恒驻悬浮按钮（.sidebar-toggle，原头部
// `‹` 按钮与收起后的窄轨 `.sidebar-rail` 一并撤除）；收起动画改为「收纳
// 进开关」—— 面板以开关所在左下角为缩聚原点（transform-origin）整体
// scale + 淡出，布局收缩仍由 width → 0 承担，展开为同一路径逆放（从开关
// 长出）；点击瞬间开关播放一次主色光环「吞入」脉冲（sidebarTogglePulse）。
// 详见脚本区 UI-016 大注释与样式区 .sidebar / .sidebar-toggle 段。
// 本任务（窄窗展开禁用 + 分离指引 + 设置按钮解除避让）：① 宿主窄窗
// （hostNarrow，.app-body 宽度阈值）时折叠开关【禁止展开】—— 原生
// disabled + 禁用样式 + title 说明原因，toggleSidebar 内再守一道兜底；
// ② 配套右上角一次性指引卡（.detach-hint）：初始进入插件且「宿主窄窗 +
// 停靠」时显示，引导到宿主右上角插件设置开启「自动分离为独立窗口」并
// 分离 —— 经宿主 ztools.getWindowType / onPluginDetach 感知分离态（浏览器
// dev 无宿主 API 时按停靠降级），检测到已分离即消失；③ 侧边栏底部
// 「设置」按钮不再避让左下角开关（footer 撤 48px 左让位，按钮改右端恒驻
// —— sidebar-settings-btn 宽度从通栏改自适应）。
// 本任务（侧边栏头部页签化 + 历史内嵌 + 设置迁主区工具条）：① 侧边栏头部
// 改为「文本对比 / 历史」分段控件（sidebarTab，会话级 UI 态）—— workbench
// 页保留原选项分组列，history 页内嵌 HistoryPanel（原头部「历史」徽标按钮
// 与右侧滑出抽屉 HistoryDrawer / UiDrawer 一并撤除），搜索 / 恢复 / 删除 /
// 清空能力原样迁移；恢复经 handleRestoreHistory 编排，成功后页签切回
// workbench（原「关闭抽屉」的等价动作）；② 「设置」入口自侧边栏底部迁至
// 主区顶部工具条最右端（「交换」右侧的行尾齿轮图标钮），侧边栏底排撤空
// 仅保留收尾分隔线。
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
// UI 组件层（Scandi 重构）：本地轻量组件 + reka-ui 原语，ztools-ui 组件已全部
// 移除（仅 main.ts 保留其 useZtoolsTheme 做宿主亮暗同步）。
import UiButton from './components/ui/UiButton.vue'
import UiConfirmDialog from './components/ui/UiConfirmDialog.vue'
import UiIcon from './components/ui/UiIcon.vue'
import UiInput from './components/ui/UiInput.vue'
import UiSegmented from './components/ui/UiSegmented.vue'
import UiSelect from './components/ui/UiSelect.vue'
import UiSwitch from './components/ui/UiSwitch.vue'
import UiToastHost from './components/ui/UiToastHost.vue'
import { useToast } from './composables/useToast'
import { useConfirmDialog } from './composables/useConfirm'
import InputEditor from './components/InputEditor.vue'
import PaneHeader from './components/PaneHeader.vue'
import HistoryPanel from './components/HistoryPanel.vue'
import SettingsDialog from './components/SettingsDialog.vue'
import SplitDiffView from './components/SplitDiffView.vue'
import UnifiedDiffView from './components/UnifiedDiffView.vue'
import { SAMPLES } from './data/samples'
import type { SamplePair } from './data/samples'
import { workbenchStore } from './stores/workbench'
import { diffStore } from './stores/diff'
import { historyStore } from './stores/history'
import { navStore } from './stores/nav'
import {
  LANGUAGE_OPTIONS,
  PRECISION_OPTIONS,
  diffGutterWidthPx,
  viewStore,
} from './stores/view'
// INT-007：设置持久化的初始化入口（side-effect import —— import 求值即完成
// dbStorage 载入与各 store 回写，编排与降级策略见 stores/settings.ts 文件头）。
import './stores/settings'
import { isDiffOk } from './core/types'
import type { DiffError, DiffPrecision } from './core/types'
import type { HistoryItem } from './core/historyModel'
import { applyHunk } from './core/merge'
import type { MergeDirection } from './core/merge'
import { usePluginLifecycle } from './composables/usePluginLifecycle'
import {
  readFileIntoStore,
  useFileLoad,
  type FileEncoding,
  type PaneSide,
} from './composables/useFileLoad'
import { useDropLoad } from './composables/useDropLoad'
import { useCopy } from './composables/useCopy'
import { useClipboardLoad } from './composables/useClipboardLoad'

/** 左栏 InputEditor 组件实例 ref：onPluginEnter 时经其 exposed focus() 聚焦内部 EditorView */
const leftEditorRef = ref<InstanceType<typeof InputEditor> | null>(null)

/** 右栏 InputEditor 组件实例 ref：UI-011 结果态点击右侧行内容格时聚焦 / 定位用 */
const rightEditorRef = ref<InstanceType<typeof InputEditor> | null>(null)

/** 聚焦左编辑器：交由 usePluginLifecycle 在 onPluginEnter 时调用 */
function focusLeftEditor(): void {
  leftEditorRef.value?.focus()
}

// 生命周期接线：恢复草稿 / onPluginEnter 聚焦 / onPluginOut 持久化
// （内部已 try/catch 静默降级，浏览器 dev 环境无 ztools 全局也不会抛错）
usePluginLifecycle(focusLeftEditor)

/*
 * 全局反馈（UI-002 → Scandi 重构）：useToast / useConfirmDialog 来自本地
 * composables（模块级单例状态，API 与原 ztools-ui 完全一致）。渲染端：
 * UiToastHost / UiConfirmDialog 各自内部读取单例，App 只需挂载组件、
 * 无需再手工绑定 props（原 v-model:visible / @confirm 接线随组件移除）。
 * 状态驱动方不变：useFileLoad / useDropLoad / useClipboardLoad 与 App 的
 * success / confirm 动作共用同一单例。
 */
const { toastState, info: toastInfo, error: toastError, success: toastSuccess } = useToast()
const { confirm } = useConfirmDialog()

// 剪贴板复制单出口（INT-003 抽取）：UI-017 的「全部复制」（两侧 pane
// 头部）走这条宿主优先降级链（见 useCopy.ts）
const { copyText } = useCopy()

/*
 * 「打开编码」（INT-005）：全局单值 —— 两侧 pane 头部各渲染一个选择器，
 * 绑定同一 ref（改一侧另一侧同步），理由：用户通常连续导入同源文件，两侧
 * 独立编码徒增心智负担。App 级 ref 即可（纯会话态：两次载入间保持、刷新/
 * 重开复位，不持久化 —— 未列入 INT-007 的持久化范围，故不进 store）。
 * 改值即按新编码重读「已记录来源路径」的侧（reloadTrackedFilesWithEncoding，
 * 乱码自愈 —— 与选择器 tooltip「切换编码重新载入」一致），并按结果态语义
 * 自动重算（见 handleEncodingChange）。
 */
const fileEncoding = ref<FileEncoding>('utf-8')

/**
 * 「打开编码」变更（编码选择器的统一回调，两侧顶部栏选择器共用；原始
 * 字符串载荷在此收窄）：
 * - 非法值忽略（防御）；值未变化（两侧选择器同值联动时可能各触发一次）
 *   直接跳过，不做任何副作用；
 * - 变更生效后先重读来源文件（输入态编辑器即时回显新解码内容），再把
 *   「结果态下的载入」语义走完：视为重新编辑后查找差异 —— 自动重算并
 *   刷新结果视图（runAndShowResult 与主按钮同语义）。无结果（输入态刚
 *   打开文件还没对比过）时只重读文本，不发起对比（保持显式触发）；
 * - isRunning 期间不重算（run() 重入守卫会吞掉调用，与合并 / 交换同
 *   策略，见 refreshResultAfterSideLoad 注释）。
 */
async function handleEncodingChange(value: string): Promise<void> {
  if (value !== 'utf-8' && value !== 'gbk' && value !== 'utf-16') return
  if (value === fileEncoding.value) return
  fileEncoding.value = value
  reloadTrackedFilesWithEncoding()
  if (inResultMode.value && !diffStore.isRunning) {
    await runAndShowResult()
  }
}

/**
 * 按当前「打开编码」重读已记录来源路径的侧（handleEncodingChange 专属）：
 * 只重读有来源文件的侧（粘贴 / 拖文本 / 示例载入的内容与文件无关，不动）；
 * 读取失败在 readFileIntoStore 内部 toast（目标侧内容不变）。浏览器 dev /
 * preview 无 preload services 时静默跳过（与打开文件的降级惯例一致）。
 */
function reloadTrackedFilesWithEncoding(): void {
  const services =
    typeof window.services === 'object' && window.services !== null ? window.services : null
  if (services === null || typeof services.readTextFile !== 'function') return
  if (workbenchStore.leftFilePath !== '') {
    readFileIntoStore('left', workbenchStore.leftFilePath, fileEncoding.value)
  }
  if (workbenchStore.rightFilePath !== '') {
    readFileIntoStore('right', workbenchStore.rightFilePath, fileEncoding.value)
  }
}

// 「打开文件」载入链路（UI-002）：取消/失败/无 services 降级均在内部消化；
// INT-005：读取编码取当前全局「打开编码」（getter 每次载入时求值，不取快照）
const { openFileInto } = useFileLoad(() => fileEncoding.value)

/** 指定侧当前文本（结果态载入刷新的「内容是否变化」检测基线） */
function sideTextOf(side: PaneSide): string {
  return side === 'left' ? workbenchStore.leftText : workbenchStore.rightText
}

/*
 * 结果态载入刷新（本任务语义）：结果态下经顶部栏「打开文件 / 粘贴」改变
 * 某侧内容 = 视为「重新编辑后查找差异」—— 自动重算并刷新结果视图。
 * - 输入态不触发（保持显式触发：载入只写文本，对比仍由主按钮 / 快捷键
 *   发起，用户可在输入态从容备好两侧）；
 * - 内容未变化（用户取消选择 / 取消覆盖 / 剪贴板空 / 读取失败）不重算
 *   —— 以「载入前后该侧文本」比对为准，取消与失败出口无需各自上报；
 * - isRunning 期间不重算：run() 有重入守卫，「写文本发生在 run() 之前」
 *   的动作在对比进行中放行会出现「文本已改、结果未刷新」的中间态（与
 *   handleApplyHunk / handleSwapSides 同策略；对比是同步计算，窗口极小，
 *   下一次显式动作自然刷新）；
 * - runAndShowResult 与主按钮同语义：成功刷新结果、失败呈现结果态错误块、
 *   两侧全空（如两侧都清成空文件）短路回输入态并 toast 引导。
 */
async function refreshResultAfterSideLoad(side: PaneSide, textBefore: string): Promise<void> {
  if (!inResultMode.value || diffStore.isRunning) return
  if (sideTextOf(side) === textBefore) return
  await runAndShowResult()
}

/** 左侧 pane 头部「打开文件」回调（结果态下成功载入后自动重算刷新） */
async function openLeftFile(): Promise<void> {
  const before = sideTextOf('left')
  await openFileInto('left')
  await refreshResultAfterSideLoad('left', before)
}

/** 右侧 pane 头部「打开文件」回调（同上） */
async function openRightFile(): Promise<void> {
  const before = sideTextOf('right')
  await openFileInto('right')
  await refreshResultAfterSideLoad('right', before)
}

/*
 * ============================================================================
 * 剪贴板载入（INT-006）：单侧「粘贴」（pane 头部按钮）。原工具栏「粘贴并
 * 对比」快捷路径（含 ⌘/Ctrl+Shift+V）已随本任务撤除。
 *
 * 读取降级链（useClipboardLoad）：ztools services.readClipboardText 优先
 * （宿主注入，剪贴板空/失败返回空串，语义见 env.d.ts）；浏览器 dev /
 * preview 无 window.services 时降级 navigator.clipboard.readText()（首次
 * 调用有权限弹窗，拒绝/非安全上下文抛错）。空串 → toast info「剪贴板为
 * 空」；降级路径读取失败 → toast info「无法读取剪贴板」。
 *
 * 单侧粘贴：固定目标侧，读取 → 该侧已有内容时弹覆盖确认（文案与「打开
 * 文件」一致）→ 写入该侧并清来源文件名（内容不再来自文件，语言检测回到
 * 内容启发式，与文本拖入一致）。不自动对比、不碰 appMode（与「打开文件」
 * 同策略）。
 * ============================================================================
 */
const { pasteIntoSide } = useClipboardLoad()

/** 左侧 pane 头部「粘贴」回调（结果态下成功写入后自动重算刷新，见
 *  refreshResultAfterSideLoad；空剪贴板/取消覆盖等出口在链路内部消化，
 *  内容未变化时不重算） */
async function pasteLeftClipboard(): Promise<void> {
  const before = sideTextOf('left')
  await pasteIntoSide('left')
  await refreshResultAfterSideLoad('left', before)
}

/** 右侧 pane 头部「粘贴」回调（语义同左侧） */
async function pasteRightClipboard(): Promise<void> {
  const before = sideTextOf('right')
  await pasteIntoSide('right')
  await refreshResultAfterSideLoad('right', before)
}

/*
 * 拖拽载入（UI-003）：每侧 pane 的拖拽绑定（事件处理器 + 覆盖层可见性）。
 * 文件拖入走 preload 读路径（复用 useFileLoad 抽出的 readFileIntoStore），
 * 文本拖入与「粘贴等价」直接覆盖该侧；载入语义为直接覆盖、不弹覆盖确认
 * （与「打开文件」按钮的确认语义区分，理由见 useDropLoad.ts 文件头注释）。
 * 事件绑定阶段（capture 接管 drop/dragover、冒泡观察 dragstart/dragend）
 * 见模板内各 pane 的注释。INT-005：文件拖入同样按当前全局「打开编码」解码
 * （与「打开文件」按钮共用同一 getter，drop 时求值）。
 */
const { left: leftDrop, right: rightDrop } = useDropLoad(() => fileEncoding.value)

/*
 * 编辑器语言（INT-001）：两侧编辑器共用「本次对比」的生效语言 ——
 * viewStore.effectiveLanguage 在 auto 时已含 detectLanguagePair 检测结果
 * （plaintext 兜底），手动指定语言时原样透传。传给两个 InputEditor 的
 * language prop（动态 compartment 重配，见 InputEditor 注释）。
 */
const editorLanguage = computed(() => viewStore.effectiveLanguage)

/*
 * ============================================================================
 * 对比触发机制（UI-004）：三条触发路径共用 diffStore.run() ——
 * 1.「查找差异」主按钮（顶部工具条右端，显式触发的主交互）；
 * 2. ⌘/Ctrl+Enter 全局快捷键（window 捕获阶段监听，见 onGlobalKeydown）；
 * 3.「实时对比」开关开启后的 400ms 防抖 watch（见下方实时对比段）。
 * 结果展示不在本任务范围（视图归 UI-006/007）：最初为底部最小摘要条
 * （result-summary），UI-010 升级为完整统计条，本任务迁至顶部工具条左端。
 * ============================================================================
 */

/*
 * ============================================================================
 * 结果态开关（UI-006 引入输入/结果双态；本任务起简化回双态 —— 原 UI-011 的
 * 「保留编辑态（edit-from-result）」随「结果行点击进入编辑」与顶部编辑提示条
 * 一并撤除）：appMode 是唯一状态源（App 本地 ref，刻意不进 store —— 纯 UI
 * 态、无跨组件消费方；「result 缓存」由 diffStore.result 天然承载）。两个
 * 状态与全部转换：
 *
 *   input（双栏编辑器，现状）
 *     ├─ 主按钮 / ⌘+Enter（run 成功）─────→ result（现状语义）
 *     └─ 主按钮 / ⌘+Enter（失败/空态短路）→ input（留在原态，顶部统计条提示）
 *   result（结果视图，现状）
 *     └─ 主按钮「重新编辑」────────────────→ input（不清 result 缓存，不重算）
 *
 * 结果态下唯一回到编辑的入口是主按钮「重新编辑」（原侧边栏「返回编辑」与
 * 结果行点击编辑入口一并撤除）；切回 input 后 diffStore.result 保留 —— 顶部
 * 统计条 / 交换重算 / 选项自动重跑等「有结果即重跑」路径照常工作，再次
 * 「查找差异」显式重算刷新。
 *
 * 不切态的后台路径（UI-005 既有策略，verify 保持）：「选项变化自动重跑」
 * 路径直接 diffStore.run()、不碰 appMode —— 结果态里 result 原位刷新；
 * result 变化触发的 navStore.reset()（既有 watch）语义不受影响。
 * ============================================================================
 */
type WorkbenchMode = 'input' | 'result'

const appMode = ref<WorkbenchMode>('input')

/** 是否处于结果态：结果视图 / 错误块与工具栏「返回编辑」的显示条件 */
const inResultMode = computed(() => appMode.value === 'result')

/** 是否渲染结果视图：结果态 + 结果存在 + 成功通道（失败走错误块、空回编辑器） */
const showResultView = computed(() => {
  const result = diffStore.result
  return inResultMode.value && result !== null && isDiffOk(result)
})

/*
 * 结果态错误块（UI-011 兜底，完整错误态呈现归 UI-013）：保留编辑态发起的
 * 重新对比可能因文本增长触发 too-large 等失败 —— 若只按 ok 渲染，结果态会
 * 回落到编辑器，看起来「点了没反应」；错误块明确呈现原因，工具栏「返回编辑」
 * 在错误态下仍可达（回编辑态修正后重试）。
 */
const showResultError = computed(() => {
  const result = diffStore.result
  return inResultMode.value && result !== null && !isDiffOk(result)
})

/*
 * 无差异判定（UI-013「两侧相同」）：对比成功、且统计与 hunk 全零（无新增 /
 * 删除 / 修改对、无差异块）即「两侧规范化后等价」。totalRows > 0 保证确实
 * 存在可浏览的 equal 行（双栏编辑器全空的输入已被 run() 空态短路拦下，此处
 * 再兜一道防御）；hunks.length === 0 时 collapses 亦为空数组（ENG-008 只在
 * hunk 之间折叠），属正常形态 —— 视图照常渲染全部 equal 行，可浏览、可展开。
 */
const isIdenticalResult = computed(() => {
  const result = diffStore.result
  if (result === null || !isDiffOk(result)) return false
  const stats = result.stats
  return (
    stats.totalRows > 0 &&
    result.hunks.length === 0 &&
    stats.addedLines === 0 &&
    stats.removedLines === 0 &&
    stats.modifiedPairs === 0
  )
})

/*
 * 感知加载态（UI-013）：重算进行中且已有旧结果（结果视图 / 错误块 / 保留编辑
 * 态都算）→ 结果区顶部显示不确定进度条。compareFull 是同步计算、单次很快，
 * 进度条纯为感知优化（无真实进度）；首次对比（result 为 null）不显示 ——
 * 那时还在输入态，主按钮「对比中…」已承担进行中反馈。
 */
const showResultProgress = computed(() => diffStore.isRunning && diffStore.result !== null)

/*
 * 空输入反馈（UI-013）：diffStore.run() 对「两侧全空」做空态短路（clear() 后
 * 静默返回，见 stores/diff.ts）—— store 层刻意不持 UI 依赖（纯状态机），反馈
 * 在调用侧补：本包装在调用 run() 前按与 store 短路一致的条件（两侧文本均为空
 * 串）检测空态，命中即 ZToast info 引导输入，随后照常调 run() —— store 的
 * 短路分支会执行 clear()，「空输入不产生结果、清掉旧结果」的原有语义原样
 * 保留，本层只补提示、不改行为。
 *
 * 三条触发路径（显式主按钮/快捷键、实时防抖、选项自动重跑）统一走本包装：
 * - 显式路径点击「查找差异」却没输入 → toast 是主反馈（此前毫无回应）；
 * - 实时/选项两条后台路径把旧结果静默清掉时，toast 解释「结果为何消失」。
 * 刻意先检测后调用（而非 run() 后以 result === null 推断空态短路）：run()
 * 有重入守卫，isRunning 期间的并发调用会原样返回、不触碰 result —— 以
 * result 反推会把「首次对比进行中的并发触发」误判为空态（此时 result 尚为
 * null），先检测无此歧义（isRunning 时两侧必非空，空态检测天然不会误报）。
 */
function runDiffWithEmptyFeedback(): Promise<void> {
  if (workbenchStore.leftText === '' && workbenchStore.rightText === '') {
    toastInfo('请先输入要对比的文本')
  }
  return diffStore.run()
}

/**
 * 显式触发对比（主按钮 / ⌘+Enter 共用）。run() 后按结果与当前态落位（完整
 * 转换表见上方状态机大注释）：
 * - 空态短路（两侧全空，result 为 null）→ 回输入态：空文本无结果可看；
 *   反馈（ZToast info）由 runDiffWithEmptyFeedback 在调用侧补；
 * - 成功 → 结果态；
 * - 失败（ok:false）→ 输入态显式触发保持现状（留在输入态、顶部统计条提示 +
 *   错误 Toast，见 result watch，UI-006 语义）；已不在输入态 → 切到结果态
 *   由错误块呈现，避免语义悬空。
 */
async function runAndShowResult(): Promise<void> {
  await runDiffWithEmptyFeedback()
  const result = diffStore.result
  if (result === null) {
    appMode.value = 'input'
    return
  }
  if (isDiffOk(result)) {
    appMode.value = 'result'
    return
  }
  if (appMode.value !== 'input') {
    appMode.value = 'result'
  }
}

/*
 * 「重新编辑」（结果态主按钮的唯一出口）：切回输入态展示双栏编辑器，
 * diffStore.result 缓存不清 —— 顶部统计条 / 选项自动重跑等「有结果」路径
 * 照常工作；再次「查找差异」显式重算（转换表见状态机大注释）。
 * 原 UI-011 的保留编辑态（编辑提示条 / 行点击聚焦定位）已随本任务撤除。
 */
function backToEditing(): void {
  appMode.value = 'input'
}

/*
 * 合并更改（UI-012）：两个结果视图的合并控制条 emit applyHunk（hunk 下标 +
 * 方向）的统一入口。语义 = 把 result.hunks[hunkIndex] 按方向应用到另一侧：
 * core/merge.ts 的 applyHunk 以「当前编辑器文本（workbench）+ 当前结果
 * （result.rows / hunk）」为输入返回新的双侧文本 → setLeftText /
 * setRightText 写回编辑器数据源 → diffStore.run() 重算刷新。
 *
 * - 后台刷新路径：不碰 appMode —— 结果态保持（重算后新结果原位刷新）、
 *   保留编辑态照常重算（与实时防抖 / 选项重跑同策略，见状态机大注释）；
 *   应用后目标 hunk 消失属预期（重算刷新，navStore 由 result watch 重置）；
 * - isRunning 守卫：run() 有重入守卫，但「applyHunk 写文本发生在 run() 之前」
 *   —— 若对比进行中放行，文本会被写入而本次 run() 被重入守卫吞掉，出现
 *   「文本已改、结果未刷新」的中间态；对比中直接忽略本次点击（按钮无禁用
 *   态，点击是细粒度轻操作，忽略比禁用更顺滑）；
 * - 输入与 rows 不同步（用户在保留编辑态改文本未重跑）时 applyHunk 内部
 *   仍按区间执行（调用方契约见 merge.ts 文件头），此处无需预校验。
 */
async function handleApplyHunk(hunkIndex: number, direction: MergeDirection): Promise<void> {
  if (diffStore.isRunning) return
  const result = diffStore.result
  if (result === null || !isDiffOk(result)) return
  const hunk = result.hunks[hunkIndex]
  if (hunk === undefined) return
  const next = applyHunk(
    { left: workbenchStore.leftText, right: workbenchStore.rightText },
    result.rows,
    hunk,
    direction,
  )
  workbenchStore.setLeftText(next.left)
  workbenchStore.setRightText(next.right)
  await diffStore.run()
}

/** 结果态错误块的原因文案（与顶部统计条共用 summarizeError；函数声明提升，前向引用安全） */
const resultErrorText = computed(() => {
  const result = diffStore.result
  if (result === null || isDiffOk(result)) return ''
  return summarizeError(result.error)
})

/** 「查找差异」主按钮回调（显式触发路径之一，成功后进入结果态） */
function handleFindDiff(): void {
  void runAndShowResult()
}

/*
 * 主按钮双态文案（本任务起主按钮驻顶部工具条）：输入态 =「查找差异」
 * （显式触发对比），结果态 =「重新编辑」（切回输入态，见 backToEditing）；
 * isRunning 时短暂显示「对比中…」（禁用 + 文案双反馈）。禁用是防指针重入的
 * 硬保证，文案是进行中感知的补充；store.run() 内部还有 isRunning 重入守卫
 * 兜底键盘路径。
 */
const findDiffLabel = computed(() => {
  if (diffStore.isRunning) return '对比中…'
  return inResultMode.value ? '重新编辑' : '查找差异'
})

/** 主按钮回调：输入态发起对比，结果态切回编辑（语义见 backToEditing） */
function handleMainAction(): void {
  if (inResultMode.value) {
    backToEditing()
    return
  }
  handleFindDiff()
}

/*
 * ⌘/Ctrl+Enter 全局快捷键（UI-004）：挂在 window 的【捕获阶段】——
 * CodeMirror 6 的 keymap 在编辑器 DOM 上以冒泡处理按键，捕获阶段先于其
 * 触发，保证焦点在编辑器内也能命中；CM 默认 keymap 不含 Mod-Enter，
 * 本监听也不会与其冲突（若未来 CM 侧绑定同键，捕获先行仍保证触发）。
 * 与宿主快捷键的冲突面刻意收窄：只认 (meta|ctrl)+Enter 这一个组合，
 * 不吃单键、不认 Shift/Alt 变体，ZTools 宿主亦无该组合的默认占用。
 * 命中后 preventDefault + stopPropagation：本组合语义完全归「对比」所有。
 *
 * F3 / Shift+F3 全局快捷键（UI-010，同一捕获监听内分支）：hunk 导航的
 * 键盘路径，语义走 navStore（与统计条按钮同一出口，见 stores/nav.ts）。
 * 必须 preventDefault：浏览器给 F3 绑定的默认行为是「查找下一个」
 * （Chrome / Edge / Firefox 一致），Shift+F3 在部分浏览器（如 Firefox）
 * 还承担「反方向查找」，不拦截会弹出 / 扰动页面查找框；stopPropagation
 * 与 ⌘/Ctrl+Enter 同理，语义完全归「差异导航」所有。无结果 / 无 hunk 时
 * goNext / goPrev 内部 no-op，无需在此判态。
 *
 * Escape 说明（Scandi 重构后）：确认弹窗 / 设置弹窗 / 历史抽屉的 Esc 关闭
 * 均由 reka-ui 的 AlertDialog / Dialog 内建（DismissableLayer 层级栈保证
 * 叠加场景只关最上层，「历史抽屉上的清空确认」等组合不再需要本监听代管），
 * 原先补齐 ZConfirmDialog 能力缺口的手工 Esc 分支随之移除。
 */
function onGlobalKeydown(e: KeyboardEvent): void {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    e.preventDefault()
    e.stopPropagation()
    // 显式触发路径：成功后进入结果态（与主按钮同语义，见 runAndShowResult）。
    void runAndShowResult()
    return
  }
  if (e.key === 'F3') {
    e.preventDefault()
    e.stopPropagation()
    // Shift 修饰 = 反方向（对齐主流编辑器「Shift+F3 上一处」惯例）。
    if (e.shiftKey) navStore.goPrev()
    else navStore.goNext()
    return
  }
}

onMounted(() => {
  // 第三参 true = capture：见上方快捷键段的捕获阶段说明。
  window.addEventListener('keydown', onGlobalKeydown, true)
  /*
   * UI-015 / UI-016：窄窗观察接线。同一 ResizeObserver 观察两个目标，回调按
   * entry.target 分发：
   * - .workbench → viewStore.narrowWindow（工作台宽度 = 结果视图真实可用
   *   宽度，驱动并排自动降级为统一，UI-015）；
   * - .app-body → hostNarrow（宿主面板宽度，驱动侧边栏窄窗自动收起，UI-016；
   *   不用工作台宽度的原因见脚本区 UI-016 段 —— 工作台会被侧边栏展开实时
   *   挤压，以其触发收起会形成「展开到一半被收回」的回路）。
   * 回调首次 observe 时即同步触发一次，初始宽度状态无需手动补算；写入前
   * 比较（同值不写）避免 reactive 无谓触发。ResizeObserver 在本插件运行环境
   * 恒存在（Electron Chromium / 现代 dev 浏览器），缺失时静默跳过 —— 降级
   * 只是不生效，不报错。
   */
  if (
    typeof ResizeObserver !== 'undefined'
    && workbenchEl.value !== null
    && appBodyEl.value !== null
  ) {
    narrowObserver = new ResizeObserver((entries) => {
      // 一次回调可能同时携带两个目标的条目，逐条按 target 归属写各自的信号。
      for (const entry of entries) {
        const width = entry.contentRect.width
        if (entry.target === workbenchEl.value) {
          const narrow = width > 0 && width < NARROW_WINDOW_THRESHOLD_PX
          if (viewStore.narrowWindow !== narrow) viewStore.narrowWindow = narrow
        } else if (entry.target === appBodyEl.value) {
          const narrow = width > 0 && width < NARROW_HOST_THRESHOLD_PX
          if (hostNarrow.value !== narrow) hostNarrow.value = narrow
        }
      }
    })
    narrowObserver.observe(workbenchEl.value)
    narrowObserver.observe(appBodyEl.value)
  }
  /*
   * 停靠 / 分离态接线（「分离为独立窗口」指引）：初始 resolve 一次（分离
   * 窗口内插件重新加载时 getWindowType 直接返回 'detach'/'browser'），再挂
   * onPluginDetach 捕获「停靠运行中被分离」的迁移事件。宿主 API 缺失
   * （浏览器 dev）或异常时 resolveDetachedFromHost 内部已降级为「停靠」，
   * 这里不重复 try/catch。onPluginDetach 返回 void、宿主未提供解绑方法，
   * 不持有 off 句柄 —— 插件页面卸载即整页销毁，回调随之失效，无泄漏面。
   */
  pluginDetached.value = resolveDetachedFromHost()
  const detachApi = window.ztools
  if (typeof detachApi?.onPluginDetach === 'function') {
    detachApi.onPluginDetach(() => {
      pluginDetached.value = true
    })
  }
})

onBeforeUnmount(() => {
  // 移除捕获监听（须与注册时的 capture 标志一致）。
  window.removeEventListener('keydown', onGlobalKeydown, true)
  // 断开窄窗观察器（UI-015）
  narrowObserver?.disconnect()
  narrowObserver = null
  // 摘除未到期的吞入脉冲定时器（左下角折叠开关）
  if (sidebarPulseTimer !== null) clearTimeout(sidebarPulseTimer)
})

/*
 * ============================================================================
 * 工具栏控件（UI-005）：视图/精度/语言三个选择器写入 viewStore 的处理器。
 * 用显式处理器而非 v-model：ztools-ui 的 ZSelect / ZTabs 更新事件载荷是宽类型
 * （SelectModelValue = string | number | null | 数组），而 store 字段是窄字面量
 * 联合 —— 在处理器里做字面量校验收窄，拒绝越界值（不落数据库式 cast）。
 * ============================================================================
 */

/** 视图分段控件候选（并排 / 统一）：value 语义见 setViewMode */
const VIEW_MODE_OPTIONS: { label: string; value: string }[] = [
  { label: '并排', value: 'split' },
  { label: '统一', value: 'unified' },
]

/**
 * 视图分段控件回调：非 'unified' 一律归一为 'split'（两值控件，天然兜底）。
 * UI-015 窄窗语义：窄窗内用户主动点「并排」= 坚持使用并排（keepSplitInNarrow，
 * 本episode内不再自动降级并显示建议提示）；点「统一」或窗口已宽 = 清除坚持
 * 标志（恢复 autoUnified 的正常判定）。
 */
function setViewMode(value: string): void {
  const mode: 'split' | 'unified' = value === 'unified' ? 'unified' : 'split'
  viewStore.viewMode = mode
  viewStore.keepSplitInNarrow = mode === 'split' && viewStore.narrowWindow
}

/** 精度分段控件回调：仅接受 DiffPrecision 四个字面量，其余载荷忽略 */
function setPrecision(value: string): void {
  if (value === 'smart' || value === 'line' || value === 'word' || value === 'char') {
    viewStore.precision = value as DiffPrecision
  }
}

/** 语言下拉回调：字符串载荷直接透传（高亮消费归 INT-001） */
function setLanguage(value: string): void {
  viewStore.language = value
}

/** 设置弹窗显隐：工具栏齿轮按钮触发（弹窗本体见 components/SettingsDialog.vue） */
const settingsOpen = ref(false)

/*
 * ============================================================================
 * 小窗口降级布局（UI-015，roadmap §3.1「小窗口下并排视图自动降级为上下排列
 * 或提示用统一视图」的实现口径）：
 * - 观察：ResizeObserver 观察 .workbench 容器宽度（ZTools 主面板宽度由宿主
 *   管理、可能很窄；容器宽度即结果视图的真实可用宽度），低于
 *   NARROW_WINDOW_THRESHOLD_PX（620px）时写 viewStore.narrowWindow = true；
 * - 降级：narrowWindow 且用户未坚持并排时 viewStore.autoUnified = true，
 *   effectiveViewMode 接管为 'unified'（并排视图在小窗下左右两列内容格各
 *   只剩百余 px，不可用；统一视图单栏仍可读）。viewMode 本身【不被改写】
 *   —— 窗口变宽后自动回到用户原选视图，用户选择与自动降级可区分；
 * - 用户坚持：窄窗内用户在分段控件主动点回「并排」→ viewStore.keepSplitInNarrow
 *   = true（本episode内不再自动降级、选择生效），结果视图顶部显示可关闭的
 *   「窗口较窄，建议使用统一视图」轻提示条（.narrow-notice，一次性 —— 关闭
 *   后本episode不再出现，窗口变宽再变窄会重置）；自动降级同样有轻提示
 *   （「已自动切换为统一视图」）告知视图变化原因；
 * - 方案取舍：自动降级 + 可关闭提示 + 尊重用户坚持（而非强制降级）—— 强制
 *   降级会让「我就要在窄窗看并排」的用户失去选择权；提示条承担告知义务。
 * ============================================================================
 */

/** 窄窗降级阈值（px）：结果工作台容器宽度低于该值时并排自动降级为统一 */
const NARROW_WINDOW_THRESHOLD_PX = 620

/** 工作台容器模板 ref：窄窗观察目标之一（宽度 = 结果视图真实可用宽度，驱动 UI-015 降级） */
const workbenchEl = ref<HTMLElement | null>(null)

/** 窄窗观察器（onMounted 建立、onBeforeUnmount 断开；环境缺失时静默跳过） */
let narrowObserver: ResizeObserver | null = null

/** 窄窗提示条关闭态：关闭后本episode不再出现（窗口退出窄窗时重置） */
const narrowNoticeDismissed = ref(false)

/*
 * ============================================================================
 * 左侧可折叠侧边栏（UI-016：顶部工具栏改为左侧侧边栏；本任务起折叠开关
 * 迁至【窗口左下角】，成为展开 / 收起共用的唯一悬浮开关，收起动画改为
 * 「收纳进开关」—— 面板以开关所在左下角为缩聚原点整体收缩淡出，展开时
 * 从同一点长出，走向见样式区 .sidebar / .sidebar-toggle 段）：折叠态为
 * 纯会话级 UI 态（不进 store、不持久化 —— 与「窄窗坚持」等偏好语义有
 * 本质区别，侧边栏收合是浏览时的临时姿势，重开插件回到展开态最可预期）。
 * 两个出口：
 * - 左下角开关：展开态点击收起（面板缩进开关）、收起态点击展开（面板从
 *   开关长出）—— 开关恒驻原位不卸载，是「侧边栏被收纳后」的把手；
 * - 窄窗自动收起：进入窄窗（hostNarrow 变 true，宿主面板宽度低于阈值）
 *   时主动收起侧边栏，把水平空间让给编辑器 / 结果视图 —— 窄窗下固定
 *   248px 的侧边栏会让双栏编辑器每侧只剩百余 px，不可用；仅「进入窄窗」
 *   时自动收起一次，不自动展开（宽窗回来时保持用户当前姿势 —— 用户主动
 *   收起在宽窗里也该被尊重）。窄窗内开关【禁止展开】（尺寸不足不允许
 *   展开，配套「分离为独立窗口」指引，见下方后续任务注释）。
 *   ── 触发信号必须用宿主宽度（.app-body，hostNarrow）而非工作台宽度
 *   （narrowWindow）：工作台宽度会被侧边栏收合实时挤压，若以其触发，
 *   中等宽度窗口里「点击展开 → 工作台被压窄 → 窄窗信号翻转 → 自动收回」
 *   会连成回路，展开动画播到一半即被收回（历史缺陷）；.app-body 是宿主
 *   管理的外层容器，宽度不随侧边栏收合变化，信号与回路解耦。
 * ============================================================================
 */

/** 侧边栏展开占位（px）：面板宽 248px（--sidebar-w）+ 右缘发丝边 1px */
const SIDEBAR_FOOTPRINT_PX = 249

/** 工作台水平内边距合计（px）：contentRect 度量内容盒宽，padding 同在被挤压范围内 */
const WORKBENCH_H_PADDING_PX = 32

/**
 * 宿主窄窗阈值（px）：.app-body 宽度低于「工作台窄窗阈值 + 侧边栏展开占位 +
 * 工作台水平内边距」时视为宿主过窄 —— 此时展开侧边栏必然把工作台内容宽压入
 * 窄窗（<620px，触发并排自动降级），故自动收起；反之（宿主未过窄）展开后
 * 工作台仍在窄窗阈值之上，不触发降级也不会有收回回路。与 UI-015 的
 * NARROW_WINDOW_THRESHOLD_PX 挂钩推导而非独立取值，保证两个「窄」判据
 * 恒一致地联动。
 */
const NARROW_HOST_THRESHOLD_PX
  = NARROW_WINDOW_THRESHOLD_PX + SIDEBAR_FOOTPRINT_PX + WORKBENCH_H_PADDING_PX

/** 宿主面板容器模板 ref：窄窗观察目标之二（宽度不随侧边栏收合变化，见 UI-016 大注释） */
const appBodyEl = ref<HTMLElement | null>(null)

/** 宿主窄窗信号：由 onMounted 的 ResizeObserver 写入（见窄窗观察接线注释） */
const hostNarrow = ref(false)

const sidebarCollapsed = ref(false)

/*
 * 「吞入」脉冲（本任务）：点击开关的瞬间让按钮播放一次短脉冲动画（主色
 * 光环自按钮外扩一圈消散，见样式区 sidebar-toggle-pulse keyframes），与
 * 面板向按钮缩聚的走向互为因果，强化「被装进开关」的手感。实现为类开关 +
 * 定时摘除：先摘类、再隔一个宏任务补回 —— 同一 tick 内先 false 后 true
 * 会被 Vue 批处理合并成「类从未离开」，动画不会重启；用 setTimeout 而非
 * requestAnimationFrame 拉开间隙（隐藏页签 / 被遮挡窗口里 rAF 会停发，
 * 定时器只是节流），快速连点也能每次重放；隐藏页签下脉冲延后播放，纯
 * 装饰可接受。
 */
const sidebarTogglePulse = ref(false)

/** 脉冲类的摘除延时（ms）：略长于 keyframes 的 0.3s，动画播完再摘类 */
const SIDEBAR_PULSE_MS = 340

/** 脉冲摘除定时器句柄（onBeforeUnmount 清理，防卸载后迟到置态） */
let sidebarPulseTimer: ReturnType<typeof setTimeout> | null = null

/**
 * 折叠 / 展开侧边栏：左下角开关的唯一出口（顺带播放一次吞入脉冲）。
 * 窄窗守卫：宿主窄窗（hostNarrow）且侧边栏当前收起时拒绝展开 —— 展开必然
 * 把工作台压入窄窗阈值触发并排降级，面板不可用；开关已 disabled（点击进
 * 不来），此处再守一道，兜底程序化调用 / 键盘触发的旁路。收起方向
 * （已展开 → 收起）在窄窗恒放行 —— 与窄窗自动收起语义一致。
 */
function toggleSidebar(): void {
  if (hostNarrow.value && sidebarCollapsed.value) return
  sidebarCollapsed.value = !sidebarCollapsed.value
  sidebarTogglePulse.value = false
  if (sidebarPulseTimer !== null) {
    clearTimeout(sidebarPulseTimer)
    sidebarPulseTimer = null
  }
  sidebarPulseTimer = setTimeout(() => {
    sidebarTogglePulse.value = true
    sidebarPulseTimer = setTimeout(() => {
      sidebarTogglePulse.value = false
      sidebarPulseTimer = null
    }, SIDEBAR_PULSE_MS)
  }, 0)
}

/*
 * 侧边栏窄窗自动收起（UI-016）：只在「进入窄窗」的沿边触发——
 * hostNarrow（宿主面板宽度）变 true 时收起；（退出窄窗不展开，理由见上方
 * 大注释。宿主宽度不随侧边栏收合变化，信号不会抖动 —— 这正是改用
 * .app-body 观测、避开工作台反馈回路的收益）。
 */
watch(hostNarrow, (narrow) => {
  if (narrow) sidebarCollapsed.value = true
})

/*
 * ============================================================================
 * 窄窗展开禁用与「分离为独立窗口」指引（UI-016 后续）：
 * 前一任务的窄窗自动收起存在体验盲区：用户在窄窗里点击左下角开关手动
 * 展开，工作台被挤压到窄窗阈值之下、触发并排自动降级，虽无「收回回路」
 * （已断开），但面板展开后编辑器每侧仅百余 px，实际不可用。本任务改为
 * 尺寸不足时【禁止展开】：开关原生 disabled + 触发器兜底守卫，title 说明
 * 原因并指引分离。配套三处：
 * - 禁用：hostNarrow（宿主面板宽度，阈值推导见上）时开关 disabled ——
 *   展开必然把工作台压入窄窗（620px）触发降级，故尺寸不足不允许展开；
 * - 指引：初始进入插件且【宿主窄窗 + 停靠（未分离）】时，右上角显示一次性
 *   指示卡（.detach-hint），引导用户在宿主右上角插件设置中启用「自动分离
 *   为独立窗口」并点击「分离到独立窗口」—— 分离出的独立窗口由窗口系统
 *   自由拉宽，是窄窗问题的正解；检测到已分离（onPluginDetach）即消失；
 * - 解锁时机：分离到独立窗口后窗口通常足够宽，hostNarrow 退出窄窗、开关
 *   自然解锁；若用户把独立窗口也拉窄，同样禁用（此时指引卡不再出现 ——
 *   用户已知晓分离路径，重复打扰）。
 * ============================================================================
 */

/** 插件是否已分离为独立窗口（true = 分离窗口；false/未知 = 停靠或浏览器 dev） */
const pluginDetached = ref(false)

/** 指引卡关闭态：关闭后本episode不再出现（会话级，不持久化） */
const detachHintDismissed = ref(false)

/**
 * 解析宿主停靠 / 分离态：宿主 API 的 getWindowType 返回 'main'（主窗口
 * 停靠）| 'detach'（分离窗口）| 'browser'（createBrowserWindow 创建）。
 * 后两者都按「已分离」处理 —— 共同点是宽度不再受主面板停靠区约束。
 * 浏览器 dev / preview（无 window.ztools）与 API 异常时按「停靠」降级
 * （保守取向：指引卡在纯浏览器 dev 无意义但无害，尺寸禁用仍由宽度信号
 * 独立驱动，不受此降级影响）。
 */
function resolveDetachedFromHost(): boolean {
  try {
    const api = window.ztools
    if (typeof api?.getWindowType !== 'function') return false
    const type = api.getWindowType()
    return type === 'detach' || type === 'browser'
  } catch {
    return false
  }
}

/*
 * 分离事件：onPluginDetach 在宿主把停靠运行的插件分离为独立窗口时回调
 * （onMounted 注册，见停靠 / 分离态接线注释）；宿主无解绑方法，插件页面
 * 卸载即销毁，无泄漏面 —— 本变量已撤（事件处理内联在 onMounted）。
 */

/** 指引卡显示条件：宿主窄窗 + 未分离 + 未关闭（初始进入即评估，分离即失效） */
const detachHintVisible = computed(
  () => hostNarrow.value && !pluginDetached.value && !detachHintDismissed.value,
)

/** 指引卡关闭：仅本episode静音（不持久化，重进插件再评估 —— 分离过则不再出现） */
function dismissDetachHint(): void {
  detachHintDismissed.value = true
}

/**
 * 结果视图行号列宽（UI-015「宽随位数自适应」）：按结果总行数位数映射
 * （≤3 位 40px / 4–5 位 52px / ≥6 位 64px，映射见 view.ts 的
 * diffGutterWidthPx），以 `--gutter-w` 注入 .result-stage —— 两个结果视图的
 * 行号列 grid 模板与记号列 sticky 偏移经各自的局部变量引用同一来源，
 * 保证两视图行号列宽恒一致。无结果 / 错误结果时按 0 行取最小档。
 */
const gutterWidthPx = computed(() => {
  const result = diffStore.result
  const totalRows = result !== null && isDiffOk(result) ? result.stats.totalRows : 0
  return diffGutterWidthPx(totalRows)
})

/** 窄窗提示条文案：用户坚持并排 → 建议语；自动降级 → 说明语 */
const narrowNoticeText = computed(() =>
  viewStore.keepSplitInNarrow ? '窗口较窄，建议使用统一视图' : '窗口较窄，已自动切换为统一视图',
)

/**
 * 窄窗提示条显示条件（结果态 + 窄窗 + 未关闭）：
 * - 自动降级生效（autoUnified 且用户原选是 split）→ 说明语；
 * - 用户窄窗内坚持并排（keepSplitInNarrow）→ 建议语；
 * - 窄窗但用户本就选了统一 → 不提示（没有视图被改变）。
 */
const narrowNoticeVisible = computed(() => {
  if (!showResultView.value || !viewStore.narrowWindow || narrowNoticeDismissed.value) {
    return false
  }
  return viewStore.keepSplitInNarrow || (viewStore.autoUnified && viewStore.viewMode === 'split')
})

/**
 * 错误块的「打开设置」（UI-013，invalid-regex 专属动作）：设置弹窗开合态
 * （settingsOpen）就在本组件，直接置 true 即可 —— 无需给 SettingsDialog
 * 暴露 open 方法或提升开合态（最小改动）。用户修正规则后，App 的选项
 * watch 会自动重跑，非法规则补完合法的那一刻结果自然恢复。
 */
function openErrorSettings(): void {
  settingsOpen.value = true
}

/*
 * ============================================================================
 * 主区右上工具条（UI-017）：「清空 / 全部展开 / 交换」三个动作恒驻主区右上
 * （.main-toolbar，三种工作台状态下恒在），均带图标；处理器复用 UI-014 的
 * handleClearInputs / handleSwapSides（守卫与确认逻辑见该两条 JSDoc）。
 * 「全部展开」经结果视图 defineExpose 的 expandAll / isAnyCollapsed 接线
 * （两个视图暴露同一形状，见各自组件内注释）——App 按当前生效视图模式取
 * 对应 ref 调用；视图内原 sticky「全部展开」工具条随本任务撤除。
 * 本任务调整：① 「全部展开」升级为「全部展开 / 全部收起」双态按钮 —— 视图
 * 内存在折叠条时展示「全部展开」（expandAll），全部展开后切换为「全部收起」
 * （collapseAll），由 isAnyCollapsed 驱动双态（单条展开的探索可一键还原）；
 * ② hunk 导航组自主按钮右侧迁至主按钮左侧（上一处 / 下一处图标钮），页码
 * （2/5）驻「下一处」按钮左侧 —— 尚未定位（currentIndex === -1）时不渲染
 * 页码（「—」无信息量）。
 * ============================================================================
 */

/** 两个结果视图经 defineExpose 暴露的折叠控制接口（同一形状的结构化类型） */
interface ExpandableResultView {
  expandAll: () => void
  collapseAll: () => void
  hasCollapses: () => boolean
  isAnyCollapsed: () => boolean
}

/** 并排视图实例 ref（effectiveViewMode === 'split' 时挂在模板上） */
const splitViewRef = ref<ExpandableResultView | null>(null)

/** 统一视图实例 ref（effectiveViewMode === 'unified' 时挂在模板上） */
const unifiedViewRef = ref<ExpandableResultView | null>(null)

/** 按当前生效视图模式取对应结果视图实例（窄窗自动降级时取统一视图） */
function activeResultView(): ExpandableResultView | null {
  return viewStore.effectiveViewMode === 'split' ? splitViewRef.value : unifiedViewRef.value
}

/**
 * 「全部展开 / 全部收起」双态按钮的可用性：结果态 + 当前视图内存在折叠
 * 区段（hasCollapses，与展开态无关 —— 无折叠时展开 / 收起都无事可做）。
 * 子视图的 isAnyCollapsed / hasCollapses 在本 computed 求值期间被调用，
 * 其内部 ref 的响应式依赖会被本组件的渲染效果跟踪 —— 折叠 / 展开即时
 * 反映为按钮可用性与双态翻转。
 */
const canExpandAll = computed(() => {
  if (!showResultView.value) return false
  return activeResultView()?.hasCollapses() ?? false
})

/**
 * 双态按钮当前侧（本任务新增）：true = 折叠条已全部展开 → 展示「全部收起」
 * （点击 collapseAll，一键还原展开探索）；false = 存在未展开折叠条 → 展示
 * 「全部展开」（点击 expandAll）。禁用态（无折叠区段 / 非结果态）恒为
 * false —— 「收起」侧只在按钮可用时出现，禁用时的「全部展开」形态与旧版
 * 一致。canExpandAll 管「按钮是否可用」（有无折叠区段），本值管「按钮当前
 * 是哪一侧」（未展开折叠条是否还有剩余，isAnyCollapsed）。
 */
const isAllExpanded = computed(() => {
  if (!canExpandAll.value) return false
  return !(activeResultView()?.isAnyCollapsed() ?? false)
})

/** 「全部展开 / 全部收起」回调：按双态分发给当前视图（无实例时静默跳过） */
function handleToggleCollapseAll(): void {
  const view = activeResultView()
  if (view === null) return
  if (isAllExpanded.value) {
    view.collapseAll()
  } else {
    view.expandAll()
  }
}

/*
 * ============================================================================
 * 操作便捷项（UI-014）：示例数据 / 交换两侧 / 清空（后两者 UI-017 起迁至
 * 主区右上工具条）。
 *
 * 位置选择（UI-017 调整后）：「交换 / 清空」放在 .main-toolbar（主区右上，
 * 三种工作台状态下恒在，交换 → 结果原地重算刷新、清空 → 回输入态，结果态
 * 下同样可达）；侧边栏「操作」组只留「示例数据」一个满宽控件（「粘贴并
 * 对比 / 复制报告 / 导出」已随本任务撤除）。
 *
 * 三个会写文本的动作（示例 / 交换 / 清空）共用同一状态交互底线：
 * - isRunning 期间忽略点击（与 handleApplyHunk 同策略）：这些动作先写文本
 *   后（可能）触发 run()，对比进行中放行会撞上 run() 的重入守卫，出现
 *   「文本已改、结果未刷新」的中间态；点击是细粒度轻操作，忽略比禁用更
 *   顺滑，窗口极小（同步计算 + 一轮 nextTick）；
 * - 破坏性动作（清空 / 覆盖载入）弹 ZConfirmDialog 走既有内联挂载组件；
 *   非破坏性动作（交换 / 复制）不弹确认。
 * ============================================================================
 */

/** 示例数据下拉的当前值：动作菜单语义 —— 选中即回弹为 null，触发器恒显占位文案 */
const sampleValue = ref<string | null>(null)

/** 示例数据下拉候选：value 到 SAMPLES 条目的映射见 handleSampleSelect */
const SAMPLE_SELECT_OPTIONS: { label: string; value: string }[] = [
  { label: '中文示例', value: 'zh' },
  { label: '代码示例', value: 'code' },
]

/**
 * 示例数据下拉回调：本下拉是「动作菜单」而非状态选择器 —— 无论是否真正
 * 载入，先把手头 model-value 回弹为 null，让触发器立刻恢复「示例数据」
 * 占位文案（控件只表达「发起一次载入」，不持久化选择状态）。value 按
 * SAMPLE_SELECT_OPTIONS 映射到 SAMPLES 条目后交给 loadSampleIntoInputs
 * 执行（防御：未知值直接忽略，不载入）。
 */
function handleSampleSelect(value: string): void {
  sampleValue.value = null
  const sample = value === 'zh' ? SAMPLES[0] : value === 'code' ? SAMPLES[1] : undefined
  if (sample === undefined) return
  void loadSampleIntoInputs(sample)
}

/**
 * 载入一组示例到两侧输入（示例数据下拉的唯一执行路径）。
 *
 * @param sample 目标示例条目（left → 原始文本、right → 更改后文本）
 *
 * 状态交互决策：
 * - isRunning 期间忽略点击（理由见 UI-014 大注释块）；
 * - 覆盖确认：任一侧非空即弹 ZConfirmDialog（沿用 useFileLoad 的确认流程
 *   惯例：await confirm() 由 App 挂载的 ZConfirmDialog 兑现），用户取消 →
 *   保留原输入静默结束；两侧全空 → 直接载入不打扰；
 * - 载入后【不自动对比】：保持「显式触发」语义 —— 尚无结果时等主按钮 /
 *   ⌘+Enter；
 * - 载入同时清掉旧结果并落回输入态（取舍）：被覆盖的原输入已不存在，旧
 *   结果不可再由输入复现，结果态 / 保留编辑态若继续展示会成为「对应不上
 *   任何一侧文本」的悬空结果；回输入态让载入的示例直接可见（结果态下载入
 *   若原地不动，用户看不到示例已被载入）。
 */
async function loadSampleIntoInputs(sample: SamplePair): Promise<void> {
  if (diffStore.isRunning) return
  if (workbenchStore.leftText !== '' || workbenchStore.rightText !== '') {
    const confirmed = await confirm({
      title: '载入示例',
      message: '载入示例将覆盖当前输入？',
      type: 'warning',
      confirmText: '覆盖载入',
      cancelText: '取消',
    })
    if (!confirmed) return
  }
  workbenchStore.setLeftText(sample.left)
  workbenchStore.setRightText(sample.right)
  // INT-001：示例内容无文件来源，清空两侧文件名（语言检测回到内容启发式）
  workbenchStore.setLeftFileName('')
  workbenchStore.setRightFileName('')
  diffStore.clear()
  appMode.value = 'input'
}

/**
 * 交换两侧文本（UI-014）：左 → 右、右 → 左。
 *
 * 状态交互决策：
 * - 不弹确认：交换完全可逆（再点一次即还原），确认框只会添堵；
 * - isRunning 期间忽略点击（理由见 UI-014 大注释块）；
 * - 先 set 再 run 的顺序不能反：diffStore.run() 从 workbench 现值读取对比
 *   输入（见 stores/diff.ts），先 run 会拿到交换前的旧文本；
 * - 已有结果（result !== null）→ 立即 run() 自动重算刷新，与「选项变化
 *   自动重跑」同一「有结果即重跑」策略：结果态 / 保留编辑态原地刷新、
 *   不碰 appMode（后台刷新路径，语义见状态机大注释）；尚无结果则只换文本
 *   不触发计算 —— 避免用户还在编排输入时被意外拉进一次（可能大文本的）
 *   对比，实时对比开启时由防抖 watch 自然承接。
 */
async function handleSwapSides(): Promise<void> {
  if (diffStore.isRunning) return
  // INT-001：交换经 workbenchStore.swapSides()，文本与来源文件名一起互换
  // （语言检测的扩展名线索跟着内容走）
  workbenchStore.swapSides()
  if (diffStore.result !== null) {
    await diffStore.run()
  }
}

/**
 * 清空两侧输入（UI-014）。
 *
 * 状态交互决策：
 * - isRunning 期间忽略点击（理由见 UI-014 大注释块）；
 * - 确认框的防误弹（任务指定）：任一侧非空才弹 ZConfirmDialog「清空两侧
 *   输入？」，两侧已空时直接执行不弹 —— 空态下清空是无副作用的幂等操作，
 *   弹窗纯属骚扰；
 * - 执行 = 两侧文本置空 + diffStore.clear() + 落回输入态：store 的 clear()
 *   只清结果不动输入（见 stores/diff.ts），文本置空在 App 层完成；结果一并
 *   清空（空输入不该有结果可看），且 result 变 null 后结果态 / 保留编辑态
 *   失去展示物，显式落回输入态避免 appMode 与 result 脱节 —— 与显式对比的
 *   空态短路路径（runAndShowResult 对 result === null 回输入态）语义一致。
 */
async function handleClearInputs(): Promise<void> {
  if (diffStore.isRunning) return
  if (workbenchStore.leftText !== '' || workbenchStore.rightText !== '') {
    const confirmed = await confirm({
      title: '清空输入',
      message: '清空两侧输入？',
      type: 'warning',
      confirmText: '清空',
      cancelText: '取消',
    })
    if (!confirmed) return
  }
  // INT-001：清空经 workbenchStore.clearSides()，文本置空 + 来源文件名清空
  workbenchStore.clearSides()
  diffStore.clear()
  appMode.value = 'input'
}

/**
 * 复制文本并给出统一反馈（INT-003 抽取）：复制成功 → toast success（文案由
 * 调用方给定），两条剪贴板路径都失败 → toast error（含原始 message），沿用
 * useFileLoad 的错误文案惯例。UI-017 的「全部复制」按钮共用本出口，
 * 成功 / 失败反馈格式保持一致；剪贴板写入本体在 useCopy（宿主 copyText
 * 优先 + navigator.clipboard 降级）。
 *
 * @param text 待复制文本
 * @param successMessage 成功 toast 文案（如 '已复制'）
 */
async function copyWithToast(text: string, successMessage: string): Promise<void> {
  try {
    await copyText(text)
    toastSuccess(successMessage)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    toastError(`复制失败：${message}`)
  }
}

/**
 * 复制一侧全部文本（UI-017）：两侧 pane 头部的「全部复制」按钮共用
 * （取代原侧边栏「复制原始 / 复制更改后」，语义不变 —— 复制该侧完整输入）。
 *
 * @param side 目标侧：'left' 复制原始文本、'right' 复制更改后文本
 *
 * 状态交互决策：纯读操作，不触碰对比状态机与 appMode，输入态 / 保留编辑态
 * （pane 头部存在的两种状态）下均可执行，也无 isRunning 顾虑（不写文本、
 * 不触发对比）。空侧不发起复制（复制空串无意义且「已复制」反馈会误导），
 * ZToast info 引导；成功 / 失败反馈统一走 copyWithToast（INT-003 抽取）。
 */
async function handleCopySide(side: 'left' | 'right'): Promise<void> {
  const label = side === 'left' ? '原始文本' : '更改后文本'
  const text = side === 'left' ? workbenchStore.leftText : workbenchStore.rightText
  if (text === '') {
    toastInfo(`「${label}」为空，没有可复制的内容`)
    return
  }
  await copyWithToast(text, '已复制')
}

/*
 * ============================================================================
 * pane 顶部栏统计（本任务起归 components/PaneHeader.vue）：徽标「N 字符 · M
 * 行」（原 InputEditor 底部统计条口径，替代原「N 行」）+ hover 统计悬浮
 * （行 / 字符的总计与变化量）的全部视图模型与样式随顶部栏一并迁入该组件，
 * App 只经 props / events 接线（见模板各 PaneHeader 用点）。
 * ============================================================================
 */

/*
 * ============================================================================
 * 侧边栏页签切换（本任务：INT-004 的历史抽屉内嵌化）：头部「文本对比 /
 * 历史」分段控件切换侧边栏主体 —— workbench 页 = 原选项分组列（现状），
 * history 页 = HistoryPanel 内嵌面板（原右侧滑出抽屉 HistoryDrawer 撤除）。
 * sidebarTab 是唯一显隐状态源（App 本地 ref，纯会话级 UI 态、不进 store、
 * 不持久化 —— 与侧边栏折叠态同语义）。切换只改「侧边栏里看什么」，不碰
 * 工作台 appMode（主区双栏 / 结果视图照常）。
 *
 * 历史入口语义变化：原头部「历史」按钮（带条目数徽标）只开抽屉、不打断
 * 侧边栏；现切换到 history 页签 —— 恢复动作把页签切回 workbench（恢复后
 * 视线显然该落在工作台结果上，停在历史列表没有下一步），App 在
 * handleRestoreHistory 内回写。
 * ============================================================================
 */

/** 侧边栏页签值：'workbench' = 选项分组列（现状），'history' = 历史面板 */
type SidebarTab = 'workbench' | 'history'

/** 侧边栏当前页签（会话级，不持久化；恢复历史成功后由编排切回 workbench） */
const sidebarTab = ref<SidebarTab>('workbench')

/** 侧边栏头部「文本对比 / 历史」分段候选（value 语义见 sidebarTab） */
const SIDEBAR_TAB_OPTIONS: { label: string; value: string }[] = [
  { label: '文本对比', value: 'workbench' },
  { label: '历史', value: 'history' },
]

/**
 * 页签切换回调（头部分段控件）：非 'history' 一律归一为 'workbench'
 * （两值控件，天然兜底 —— 与 setViewMode 同口径）。
 */
function setSidebarTab(value: string): void {
  sidebarTab.value = value === 'history' ? 'history' : 'workbench'
}

/*
 * ============================================================================
 * 本地历史（INT-004）：保存出口 + 内嵌历史面板接线。
 *
 * 保存出口（唯一）：下方对 diffStore.result 的 watch —— run() 产出 ok 结果的
 * 瞬间调 historyStore.saveFromResult()（autoSave 关闭时 store 内直接跳过）。
 * 刻意挂 watch 而非在各触发函数里补调用：显式对比（runAndShowResult）、实时
 * 防抖、选项自动重跑、合并重算（handleApplyHunk）、交换后重算五条路径全部
 * 以「result 落地」收口，watch 单点覆盖、不会漏挂新增路径；失败结果 / 空态
 * 短路（result 为 null 或 ok:false）不产生历史。去重（同输入只置顶更新一条）
 * 与节流（同身份键 3s 内跳过写盘）分别在 core/historyModel.ts 与
 * stores/history.ts 完成，此处不感知。
 *
 * 面板：头部「文本对比 / 历史」分段切换 sidebarTab（本任务起历史内嵌左侧
 * 栏，原右侧滑出抽屉撤除）；恢复链见 handleRestoreHistory。ctx：恢复触发
 * 的新结果同样经过保存 watch —— 身份键与被恢复条目相同，去重只置顶更新
 * 该条，不会膨胀。
 * ============================================================================
 */

watch(
  () => diffStore.result,
  (result) => {
    if (result !== null && isDiffOk(result)) {
      historyStore.saveFromResult()
    }
  },
)

/**
 * 历史面板「恢复」（HistoryPanel restore 事件的统一编排）：
 * 1. historyStore.restore(item) —— 写回 workbench 双侧文本、viewStore 选项
 *    与上下文行数、语言，随后 await diffStore.run() 重算（restore 内部完
 *    成，返回是否得到 ok 结果）；
 * 2. 切回 workbench 页签（无论成败 —— 恢复动作已消费，且两侧文本 / 选项
 *    已被改写，视线该落回工作台；原「关闭抽屉」的等价动作）；
 * 3. 切态与 runAndShowResult 同语义：ok → 结果态浏览恢复的差异；失败 /
 *    空态短路 → 已不在输入态时切结果态呈现错误块（与「保留编辑态重新对比
 *    失败」同路径），仍在输入态保持现状 —— 失败原因的即时反馈由既有 result
 *    watch 的 ZToast error 承担，重算期间主按钮「对比中…」承担进行中反馈。
 */
async function handleRestoreHistory(item: HistoryItem): Promise<void> {
  const restored = await historyStore.restore(item)
  sidebarTab.value = 'workbench'
  if (restored) {
    appMode.value = 'result'
    return
  }
  if (appMode.value !== 'input') {
    appMode.value = 'result'
  }
}

/*
 * ============================================================================
 * 选项变化自动重跑（UI-005 决策）：「忽略空白 / 忽略大小写 / 忽略空行 /
 * 上下文行数 / 自定义忽略规则」中任一影响引擎输入的选项变化后 ——
 * - 已有对比结果（result !== null）→ 立即重跑一次，让结果即时反映新选项：
 *   翻转开关的用户意图显然是「看看忽略后的差异」，旧结果继续展示会误导；
 *   且此刻引擎输入与上次成功对比一致，成本与显式对比同量级，run() 自带
 *   空态短路 / 重入守卫兜底。
 * - 尚无结果 → 不触发：避免用户还在编辑输入时因调开关而意外发起一次
 *   （可能是大文本的）计算；选项在下次「查找差异」/ 快捷键
 *   时自然生效。
 * 取舍说明：渲染类开关（viewMode / showCollapsed / wrapLongLines）与
 * language 只影响视图（UI-006/007/008 / INT-001 消费）、precision 由
 * ENG-004 缓存重投影承接，均不进本 watch，也不进 compareFull 的输入。
 * 启用中的规则存在非法正则（enabledRulesValid === false）时跳过重跑：
 * 编辑到一半的正则不把既有好结果顶成 invalid-regex 错误态，等补完合法后
 * 本 watch 随下一次变更自然触发。弹窗内改动同样经过本 watch —— 单一重跑
 * 出口，不在 SettingsDialog 重复接线。
 * ============================================================================
 */
watch(
  () => ({
    ignoreWhitespace: viewStore.ignoreWhitespace,
    ignoreCase: viewStore.ignoreCase,
    ignoreEmptyLines: viewStore.ignoreEmptyLines,
    contextLines: viewStore.contextLines,
    // 规则数组按值快照（内容/开关变化都能被 getter 依赖捕获并触发回调）
    rules: viewStore.ignoreRules.map((rule) => ({
      id: rule.id,
      pattern: rule.pattern,
      flags: rule.flags,
      enabled: rule.enabled,
    })),
  }),
  () => {
    if (diffStore.result === null || diffStore.isRunning) return
    if (!viewStore.enabledRulesValid) return
    // 后台刷新路径：直接 run()，不碰 appMode（保留编辑态里 result 静默更新、
    // 仍停在编辑态；态切换语义见状态机大注释）。空输入反馈由
    // runDiffWithEmptyFeedback 统一补充（UI-013）。
    void runDiffWithEmptyFeedback()
  },
)

/*
 * ============================================================================
 * 差异统计条与 hunk 导航（UI-010 引入，本任务自底部操作区上移至顶部工具条）：
 * - 成功 → 统计徽标行（工具条左端）：「+N」（--diff-add-text）/「−M」
 *   （--diff-del-text）/ 有修改对时追加「~K」徽标（modifiedPairs，compareFull
 *   骨架恒为 0、配对语义自 UI-006 起可达非零，展示层按有无徽标处理）+
 *   「H 处差异」（hunkCount）；
 * - 失败 → 错误摘要一行（too-large → 文件过大、invalid-regex → 正则无效、
 *   internal → 对比失败），完整错误态呈现归 UI-013；
 * - 导航按钮组（主按钮右侧的 ▲ 上一处 / 位置 2/5 / ▼ 下一处 图标按钮）：
 *   键盘（F3/Shift+F3）与按钮都走 navStore（单一出口，见 stores/nav.ts），
 *   此处只判可用性与位置文案；
 * - result 变化（重跑 / 清空 / 空态短路）→ 旧定位失效，watch 调
 *   navStore.reset()（任务指定的重置接线位置）。
 * ============================================================================
 */
watch(
  () => diffStore.result,
  () => {
    navStore.reset()
  },
)

/*
 * 窄窗提示条的「一次性」（UI-015）：窗口退出窄窗时重置关闭态 —— 下一episode
 * （再次变窄）提示重新可达；episode 内关闭后不再打扰。
 */
watch(
  () => viewStore.narrowWindow,
  (narrow) => {
    if (!narrow) narrowNoticeDismissed.value = false
  },
)

/*
 * 错误结果的短 Toast（UI-013）：错误结果落地的瞬间 ZToast error 一次，短暂
 * 引导视线；完整原因与后续动作由常驻的错误块（结果态）与顶部统计条承担，
 * toast 只提示「发生了」，不重复详情。挂在 result watch 上与触发来源解耦
 * —— 显式触发 / 实时防抖 / 选项重跑 / 合并后重算任何路径产生的错误结果都
 * 会经过这里；成功结果与空态短路（result 置 null）不触发。
 */
watch(
  () => diffStore.result,
  (result) => {
    if (result !== null && !isDiffOk(result)) {
      toastError(`对比失败：${summarizeError(result.error)}`)
    }
  },
)

function summarizeError(error: DiffError): string {
  switch (error.kind) {
    case 'too-large':
      return '文本超过大小/行数限制'
    case 'invalid-regex':
      return '忽略规则包含非法正则'
    default:
      return '对比失败'
  }
}

/** 字节数 → MB 文案（1 位小数；引擎上限 5MB 量级、实际值可更大，MB 足够） */
function formatBytesAsMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** 行数 → 千分位文案（10 万行级别的大数字加千分位分隔符更可读） */
function formatLineCount(lines: number): string {
  return `${lines.toLocaleString('en-US')} 行`
}

/*
 * 结果态错误块的完整呈现模型（UI-013）：按错误类别给出具体主文案 + 追加
 * 详情行 + 动作开关；无错误结果时为 null（模板不渲染）。文案策略：
 * - too-large：主文案「文本超过大小/行数限制，请缩减后重试」+ 大小 / 行数
 *   两维度的「实际 / 上限」详情行（MB 换算 1 位小数、行数千分位）。引擎
 *   checkPairLimits 恒带上全部四个字段（见 core/guards.ts），缺省守卫仅
 *   防御；「返回编辑」不在此重复 —— 工具栏按钮在错误态下本就可达；
 * - invalid-regex：主文案带出错 pattern + 「去设置修正」提示行 +
 *   openSettings 动作开关（弹窗开合态 settingsOpen 就在 App.vue，错误块
 *   的「打开设置」按钮直接置 true 即可，无需给 SettingsDialog 加接口）；
 * - internal：引擎原文 message 直出，不加工。
 */
const resultErrorView = computed(() => {
  const result = diffStore.result
  if (result === null || isDiffOk(result)) return null
  const error = result.error
  switch (error.kind) {
    case 'too-large': {
      const details: string[] = []
      if (error.limitBytes !== undefined && error.actualBytes !== undefined) {
        details.push(
          `文本大小 ${formatBytesAsMb(error.actualBytes)} / 上限 ${formatBytesAsMb(error.limitBytes)}`,
        )
      }
      if (error.limitLines !== undefined && error.actualLines !== undefined) {
        details.push(
          `文本行数 ${formatLineCount(error.actualLines)} / 上限 ${formatLineCount(error.limitLines)}`,
        )
      }
      return {
        kind: 'too-large' as const,
        text: '文本超过大小/行数限制，请缩减后重试',
        details,
        openSettings: false,
      }
    }
    case 'invalid-regex':
      return {
        kind: 'invalid-regex' as const,
        text: `忽略规则包含非法正则：${error.pattern}`,
        details: ['非法规则不会参与本次对比，请在设置中修正后重新对比'],
        openSettings: true,
      }
    case 'internal':
      return { kind: 'internal' as const, text: error.message, details: [], openSettings: false }
  }
})

const resultSummary = computed(() => {
  const r = diffStore.result
  if (r === null) return null
  // 用 isDiffOk 类型守卫判别（工程 strictNullChecks 关闭，布尔判别元的
  // 否定分支不自动收窄，守卫的肯定/否定双分支收窄均有效）。
  if (isDiffOk(r)) {
    return {
      ok: true as const,
      added: r.stats.addedLines,
      removed: r.stats.removedLines,
      // 修改对数量：> 0 时统计条才追加「~K」徽标（0 时徽标无信息量，隐藏）。
      modified: r.stats.modifiedPairs,
      hunks: r.stats.hunkCount,
    }
  }
  return { ok: false as const, text: summarizeError(r.error) }
})

/** 导航按钮可用性：无成功结果 / 没有任何差异块时禁用（hunks 为空无处可跳） */
const navDisabled = computed(() => {
  const summary = resultSummary.value
  return summary === null || !summary.ok || summary.hunks === 0
})

/**
 * 导航位置文案：「2/5」（currentIndex + 1 / hunkCount，1-based 展示）。
 * 仅在 navPositionVisible（已定位）时渲染，未定位的「—」文案不再出现，
 * 本值保留兜底（防御性渲染出口）。
 */
const navPositionText = computed(() => {
  const summary = resultSummary.value
  if (summary === null || !summary.ok || summary.hunks === 0 || navStore.currentIndex < 0) {
    return '—'
  }
  return `${navStore.currentIndex + 1}/${summary.hunks}`
})

/**
 * 导航页码可见性（本任务）：成功结果 + 有差异块 + 已定位（currentIndex ≥ 0）
 * 才渲染页码；重跑 / 初次进入结果态的「未定位」阶段页码整段隐藏（原「—」
 * 占位无信息量）。navStore.currentIndex 为响应式源，goNext / goPrev / reset
 * 即时反映。
 */
const navPositionVisible = computed(() => {
  const summary = resultSummary.value
  if (summary === null || !summary.ok || summary.hunks === 0) return false
  return navStore.currentIndex >= 0
})
</script>

<template>
  <div class="app-shell">
<!--
      UI-016 侧边栏布局：顶部工具栏整体迁入左侧可折叠侧边栏（本任务起折叠
      开关移至窗口左下角，见 aside 之后的 .sidebar-toggle）：
      - 分组结构：选项开关（四个 ZSwitch toggle 行）→ 视图（分段控件）→
        比对精度 / 语法高亮（ZSelect 下拉）→ 操作（动作下拉 + 按钮格）；
      - 侧边栏底部：「设置」入口（「实时对比」开关与「返回编辑」已先后撤除；
        左端留空位给左下角悬浮折叠开关）；
      - 「历史」入口在侧边栏头部（徽标复用 INT-004 样式）；
      - 折叠：左下角开关收起 / 展开（面板「收纳进开关」动画，见脚本区
        UI-016 大注释与样式区 .sidebar 段）；窄窗进入时自动收起。
    -->
    <div ref="appBodyEl" class="app-body">
    <aside
      id="app-sidebar"
      class="sidebar"
      :class="{ 'is-collapsed': sidebarCollapsed }"
      aria-label="对比选项"
    >
      <div class="sidebar-inner">
        <!--
          UI-016 侧边栏头部（本任务重构）：「文本对比 / 历史」分段控件切换
          侧边栏主体（sidebarTab，见脚本区「侧边栏页签切换」大注释）——
          workbench 页 = 下方选项分组列，history 页 = 内嵌历史面板
          HistoryPanel（原头部「历史」按钮 + 右侧滑出抽屉撤除）。折叠按钮
          已迁至窗口左下角（.sidebar-toggle，见 aside 之后）—— 头部不承担
          开合职责。
        -->
        <div class="sidebar-header">
          <UiSegmented
            :model-value="sidebarTab"
            :options="SIDEBAR_TAB_OPTIONS"
            aria-label="侧边栏内容切换"
            style="width: 100%;"
            @update:model-value="setSidebarTab"
          />
        </div>
        <!--
          侧边栏主体（本任务起按页签分流）：workbench 页 = 原选项分组列
          （现状结构原样保留），history 页 = 内嵌历史面板 HistoryPanel。
          两页互斥渲染（v-if），切换即整页换面。
        -->
        <div v-if="sidebarTab === 'workbench'" class="sidebar-body">
          <!--
            选项开关组：四个开关为左文右钮的 UiSwitch 行（对齐参考稿的 toggle
            列表）；两个引擎开关 + 两个渲染开关，v-model 直写 viewStore
            （「忽略空白 / 忽略大小写」变化经脚本区 watch 自动重跑）。
          -->
          <div class="sidebar-section" role="group" aria-label="对比选项">
            <div class="sidebar-option-row">
              <span class="sidebar-option-label">忽略空白</span>
              <UiSwitch v-model="viewStore.ignoreWhitespace" aria-label="忽略空白" />
            </div>
            <div class="sidebar-option-row">
              <span class="sidebar-option-label">忽略大小写</span>
              <UiSwitch v-model="viewStore.ignoreCase" aria-label="忽略大小写" />
            </div>
            <div class="sidebar-option-row">
              <span class="sidebar-option-label">折叠未变更</span>
              <UiSwitch v-model="viewStore.showCollapsed" aria-label="折叠未变更" />
            </div>
            <div class="sidebar-option-row">
              <span class="sidebar-option-label">换行</span>
              <UiSwitch v-model="viewStore.wrapLongLines" aria-label="换行" />
            </div>
          </div>

          <!-- 视图分组：分段控件吃满侧边栏宽度 -->
          <div class="sidebar-section" role="group" aria-label="视图模式">
            <h2 class="sidebar-section-title">视图</h2>
            <!--
              视图模式分段控件：并排 / 统一（value 处理器见 setViewMode）。
              回显消费 effectiveViewMode：窄窗自动降级时控件如实反映「当前看到
              的视图」，用户点选走 setViewMode（窄窗内点并排 = 坚持并排）。
            -->
            <UiSegmented
              :model-value="viewStore.effectiveViewMode"
              :options="VIEW_MODE_OPTIONS"
              aria-label="视图模式"
              @update:model-value="setViewMode"
            />
          </div>

          <div class="sidebar-section" role="group" aria-label="对比精度">
            <h2 class="sidebar-section-title">比对精度</h2>
            <!-- 精度分段控件：智能 / 行级 / 单词 / 字符（value 处理器见 setPrecision） -->
            <UiSegmented
              :model-value="viewStore.precision"
              :options="PRECISION_OPTIONS"
              aria-label="比对精度"
              @update:model-value="setPrecision"
            />
          </div>

          <div class="sidebar-section" role="group" aria-label="对比语言">
            <h2 class="sidebar-section-title">语法高亮</h2>
            <UiSelect
              :model-value="viewStore.language"
              :options="LANGUAGE_OPTIONS"
              aria-label="语法高亮语言"
              @update:model-value="setLanguage"
            />
          </div>

      <!--
         操作分组（UI-016 / 本任务精简后）：侧边栏只留「示例数据」满宽动作
         下拉（选中即回弹占位态）。原「粘贴并对比 / 复制报告 / 导出」三个
         入口已随本任务撤除；「交换 / 清空」在主区右上工具条（.main-toolbar），
         「复制原始 / 复制更改后」由两侧 pane 头部的「全部复制」取代（见
         下方各 pane 头部）。写文本的动作在对比进行中忽略点击（见脚本区
         UI-014 大注释）。
      -->

            <div class="sidebar-section" role="group" aria-label="操作便捷项">
        <h2 class="sidebar-section-title">操作</h2>
        <div class="sidebar-quick">
        <UiSelect
          :model-value="sampleValue"
          :options="SAMPLE_SELECT_OPTIONS"
          placeholder="示例数据"
          aria-label="载入示例数据"
          @update:model-value="handleSampleSelect"
        />
</div>
      </div>
        </div>
        <!--
          history 页：内嵌历史面板（本任务自右侧滑出抽屉迁入侧边栏主体）。
          搜索 / 恢复 / 删除 / 清空的能力与编排不变，恢复上抛后由
          handleRestoreHistory 切回 workbench 页签并进结果态。
        -->
        <div v-else class="sidebar-body">
          <HistoryPanel @restore="handleRestoreHistory" />
        </div>
        <!--
          侧边栏底部（本任务起撤空）：「设置」入口已迁主区顶部工具条最右端
          （与「交换」同一行，见 .main-toolbar-actions 尾部）；原结果态
          「返回编辑」按钮、「实时对比」开关此前已先后撤除 —— 底排不再有
          常驻内容，仅保留一条收尾分隔线。
        -->
        <div class="sidebar-footer" aria-hidden="true"></div>
      </div>
    </aside>

    <!--
      UI-016 折叠开关（本任务自侧边栏头部迁来）：恒驻窗口左下角的唯一
      开关 —— 展开态点击把侧边栏「收纳」进按钮（面板以按钮为缩聚原点
      收缩淡出，动画见 .sidebar.is-collapsed），收起态在原位点击让面板从
      按钮重新长出；按钮恒不卸载，是「侧边栏被收纳后」的把手。
      aria-expanded 如实反映侧边栏可见性，aria-controls 指向 aside 的 id。
      窄窗禁用（尺寸不足不允许展开）：hostNarrow 时 disabled + title 说明
      原因并指向分离指引（toggleSidebar 内另有兜底守卫，见其 JSDoc）。
    -->
    <button
      type="button"
      class="sidebar-toggle"
      :class="{ 'is-pulsing': sidebarTogglePulse, 'is-disabled-look': hostNarrow }"
      :disabled="hostNarrow"
      :aria-expanded="!sidebarCollapsed"
      aria-controls="app-sidebar"
      :aria-label="sidebarCollapsed ? '展开侧边栏' : '折叠侧边栏'"
      :aria-disabled="hostNarrow || undefined"
      :title="
        hostNarrow
          ? '当前窗口尺寸不足，无法展开侧边栏 —— 可在宿主设置中分离为独立窗口后使用'
          : sidebarCollapsed ? '展开侧边栏' : '折叠侧边栏'
      "
      @click="toggleSidebar"
    >
      <UiIcon :name="sidebarCollapsed ? 'chevron-right' : 'chevron-left'" :size="15" />
    </button>

    <!--
      「分离为独立窗口」指引卡（窄窗展开禁用的配套引导）：初始进入插件且
      宿主窄窗 + 仍未分离时，右上角显示一次性纸卡，引导用户到宿主右上角
      插件设置启用「自动分离为独立窗口」并点击「分离到独立窗口」—— 分离
      后窗口可自由拉宽，尺寸不足自然解除。显示条件与关闭语义见脚本区
      detachHintVisible / dismissDetachHint；检测到已分离即自动消失。
    -->
    <Transition name="detach-hint">
      <div v-if="detachHintVisible" class="detach-hint" role="status">
        <UiIcon name="detach" :size="15" class="detach-hint-icon" />
        <span class="detach-hint-text">
          窗口尺寸不足：可在右上角的插件设置中开启「自动分离为独立窗口」，分离到独立窗口后获得完整布局
        </span>
        <button
          type="button"
          class="detach-hint-close"
          aria-label="关闭提示"
          title="关闭提示"
          @click="dismissDetachHint"
        >
          <UiIcon name="x" :size="13" />
        </button>
      </div>
    </Transition>

    <!-- 主区（UI-016）：工具条 + 工作台（底部操作区已随统计条上移撤除） -->
    <div class="app-main">

    <!--
      主区顶部工具条：左侧 = 差异统计徽标条（+N/−M/~K/H 处差异 pill，错误时为
      错误摘要 —— 本任务自底部操作区上移），右侧动作列 = hunk 导航组（▲ 上一
      处 / ▼ 下一处 + 页码，主按钮左侧 —— 本任务自右侧迁来，页码未定位时不
      渲染）+ 主按钮「查找差异 / 重新编辑」+「清空 / 全部展开(收起) / 交换」
      快捷动作（三种工作台状态下恒在）。主按钮双态：输入态 = 查找差异
      （handleMainAction → runAndShowResult，成功进结果态），结果态 = 重新编辑
      （backToEditing，切回输入态、不清 result 缓存）；⌘/Ctrl+Enter 快捷键仍只
      承担「对比」（见 onGlobalKeydown）。其余动作复用 UI-014 的守卫链
      （isRunning 忽略 / 清空确认，见各处理器 JSDoc）；「全部展开 / 全部收起」
      双态按钮经结果视图 defineExpose 接线（canExpandAll / isAllExpanded /
      handleToggleCollapseAll，见脚本区 UI-017 大注释），无折叠条时禁用。
    -->
    <div class="main-toolbar" role="toolbar" aria-label="快捷操作">
      <!--
        左：差异统计徽标条（UI-010 起在底部，本任务上移）。成功 = +/−/~/
        处差异 pill；失败 = 错误摘要一行（完整错误态呈现归结果态错误块）。
      -->
      <div class="main-toolbar-side">
        <div
          v-if="resultSummary !== null"
          class="result-summary"
          :class="resultSummary.ok ? 'is-ok' : 'is-error'"
          role="status"
        >
          <template v-if="resultSummary.ok">
            <span class="stat-pill is-add">+{{ resultSummary.added }}</span>
            <span class="stat-pill is-del">−{{ resultSummary.removed }}</span>
            <span v-if="resultSummary.modified > 0" class="stat-pill is-mod">~{{ resultSummary.modified }}</span>
            <span class="stat-pill is-count">{{ resultSummary.hunks }} 处差异</span>
          </template>
          <template v-else>{{ resultSummary.text }}</template>
        </div>
      </div>
      <div class="main-toolbar-actions">
      <!--
        hunk 导航组（UI-010 起在底部 → 迁至主按钮右侧 → 本任务移到主按钮
        左侧）：仅在成功结果时渲染；hunks 为空（无差异）时按钮禁用（保持
        布局稳定）。组内顺序 = 页码（2/5，1-based）在「上一处 / 下一处」
        按钮左侧；尚未定位（currentIndex === -1，重跑 / 初次进入结果态的
        默认态）时页码整段不渲染（「—」无信息量，见 navPositionVisible）。
      -->
      <div
        v-if="resultSummary !== null && resultSummary.ok"
        class="hunk-nav"
        role="group"
        aria-label="差异块导航"
      >
        <span
          v-if="navPositionVisible"
          class="hunk-nav-position"
          aria-live="polite"
        >{{ navPositionText }}</span>
        <UiButton
          variant="secondary"
          class="hunk-nav-btn"
          :disabled="navDisabled"
          title="上一处差异（Shift+F3）"
          aria-label="上一处差异"
          @click="navStore.goPrev"
        >
          <UiIcon name="chevron-up" :size="14" />
        </UiButton>
        <UiButton
          variant="secondary"
          class="hunk-nav-btn"
          :disabled="navDisabled"
          title="下一处差异（F3）"
          aria-label="下一处差异"
          @click="navStore.goNext"
        >
          <UiIcon name="chevron-down" :size="14" />
        </UiButton>
      </div>
      <UiButton
        variant="primary"
        :disabled="diffStore.isRunning"
        :title="inResultMode ? '返回编辑器修改两侧文本' : '对比两侧文本（⌘/Ctrl+Enter）'"
        @click="handleMainAction"
      >
        <UiIcon :name="inResultMode ? 'pencil' : 'search'" :size="14" />{{ findDiffLabel }}
      </UiButton>
      <UiButton variant="secondary" title="清空两侧输入" @click="handleClearInputs">
        <UiIcon name="trash" :size="14" />清空
      </UiButton>
      <!--
        「全部展开 / 全部收起」双态按钮（本任务）：视图内存在未展开折叠条
        （isAllExpanded = false）→「全部展开」（expandAll）；全部展开后
        翻转为「全部收起」（collapseAll，把单条展开的探索一键还原）。无
        折叠条时按钮禁用（canExpandAll = false，双态翻转也随之停住）。
      -->
      <UiButton
        variant="secondary"
        :title="isAllExpanded ? '收起所有已展开的未更改行区段' : '展开所有被折叠的未更改行'"
        :disabled="!canExpandAll"
        @click="handleToggleCollapseAll"
      >
        <UiIcon :name="isAllExpanded ? 'fold' : 'unfold'" :size="14" />{{ isAllExpanded ? '全部收起' : '全部展开' }}
      </UiButton>
      <UiButton variant="secondary" title="交换左右两侧文本" @click="handleSwapSides">
        <UiIcon name="swap" :size="14" />交换
      </UiButton>
      <!--
        「设置」（本任务自侧边栏底部迁来）：主区顶部工具条最右端 —— 与
        「交换」同一行的行尾恒驻位（齿轮图标钮，开合态 settingsOpen 就在
        本组件）。结果态错误块（invalid-regex）的「打开设置」与它共用的
        settingsOpen 直达逻辑不变（openErrorSettings）。
      -->
      <UiButton
        variant="secondary"
        class="hunk-nav-btn"
        title="设置"
        aria-label="设置"
        @click="settingsOpen = true"
      >
        <UiIcon name="settings" :size="14" />
      </UiButton>
      </div>
    </div>

    <!--
      中部工作台（UI-006 起为输入态 / 结果态切换）：
      - 结果态（showResultView）渲染在 .result-stage 包裹层内（UI-013）：
        顶部可选「两侧相同」常驻提示条（isIdenticalResult），下方按视图模式
        分流（UI-006/007）：viewMode = 'split' 渲染并排视图（SplitDiffView），
        viewMode = 'unified' 渲染统一视图（UnifiedDiffView，单栏 +/−/空格 行 +
        hunk 头条，数据管道与渲染结构见组件文件头）；两者共用 .result-view
        的 flex 尺寸收缩约定；hunk 合并控制条经 applyHunk 事件应用更改并重算
        （UI-012；结果行点击不再进入编辑 —— 原保留编辑入口随本任务撤除，
        回编辑走主按钮「重新编辑」）；
      - 结果态失败通道（showResultError）：错误块呈现类别主文案 + 追加详情
        （too-large 的实际/上限等）+ 动作（invalid-regex 的「打开设置」，
        UI-013）；工具栏「返回编辑」仍可达，落地瞬间的短引导由 ZToast error
        承担（result watch）；
      - 输入态：双栏编辑器结构原样保留（切态时编辑器整体卸载 / 重挂载，
        文本以 workbench store 为唯一真源不受影响）。
    -->
    <main ref="workbenchEl" class="workbench">
      <!--
        感知加载态（UI-013）：重算进行中且已有旧结果时，工作台顶部的不确定
        进度条（absolute 覆盖、不参与布局，样式见 main.css）。compareFull
        同步执行很快，纯感知优化；首次对比（无旧结果）不显示，由主按钮
        「对比中…」承担反馈。
      -->
      <div v-if="showResultProgress" class="result-progress" aria-hidden="true"></div>
      <!--
        结果态包裹层（本任务重构）：查找差异后不再隐藏两侧顶部栏 —— 卡片首行
        渲染 .result-headers（两侧 PaneHeader 并排 + 中缝分隔线，与输入态
        pane 头部同构），编码选择 / 打开文件 / 粘贴 / 全部复制在结果态保持
        可达；经顶部栏改变任一侧内容或切换编码 = 视为「重新编辑后查找差异」
        （自动重算刷新，编排见脚本区 refreshResultAfterSideLoad /
        handleEncodingChange）。其下依次为可选提示条与结果视图 / 错误块，
        样式（.same-notice / .result-stage / .result-headers）见 main.css
        与本文件样式区。
      -->
      <div
        v-if="showResultView || showResultError"
        class="result-stage"
        :style="{ '--gutter-w': `${gutterWidthPx}px` }"
      >
        <!-- 两侧顶部栏：左右各占一半（对齐并排视图的两列分界），动作语义与输入态一致 -->
        <div class="result-headers">
          <PaneHeader
            side="left"
            :encoding="fileEncoding"
            @open="openLeftFile"
            @paste="pasteLeftClipboard"
            @copy="handleCopySide('left')"
            @encoding="handleEncodingChange"
          />
          <div class="result-headers-divider" aria-hidden="true"></div>
          <PaneHeader
            side="right"
            :encoding="fileEncoding"
            @open="openRightFile"
            @paste="pasteRightClipboard"
            @copy="handleCopySide('right')"
            @encoding="handleEncodingChange"
          />
        </div>
        <!--
          窄窗提示条（UI-015）：小窗口降级的轻量告知 —— 自动降级时说明原因、
          用户坚持并排时给出建议；可关闭（一次性，见脚本区 narrowNoticeVisible）。
          样式（.narrow-notice）见 main.css，与 .same-notice 同族。
        -->
        <div v-if="narrowNoticeVisible" class="narrow-notice" role="status">
          <span class="narrow-notice-text">{{ narrowNoticeText }}</span>
          <button
            type="button"
            class="narrow-notice-close"
            aria-label="关闭提示"
            @click="narrowNoticeDismissed = true"
          >×</button>
        </div>
        <template v-if="showResultView">
          <!--
            无差异提示条（UI-013）：判定条件见 isIdenticalResult。取舍：用常驻
            提示条而非 ZToast —— 「两侧相同」不是需要消失的瞬时事件，而是结果
            的持续属性，常驻条与结果同生同灭、不遮挡可浏览的 equal 行。
          -->
          <div v-if="isIdenticalResult" class="same-notice" role="status">
            ✓ 两侧文本相同，可继续浏览或返回编辑
          </div>
          <!--
            视图分流按 effectiveViewMode（UI-015）：窄窗自动降级时接管为统一
            视图（viewMode 不被改写，窗口变宽自动还原，见脚本区降级大注释）。
          -->
          <SplitDiffView
            v-if="viewStore.effectiveViewMode === 'split'"
            ref="splitViewRef"
            class="result-view"
            @apply-hunk="handleApplyHunk"
          />
          <UnifiedDiffView
            v-else
            ref="unifiedViewRef"
            class="result-view"
            @apply-hunk="handleApplyHunk"
          />
        </template>
        <!--
          结果态错误块（UI-013 强化）：标题 + 具体主文案（按错误类别，见
          resultErrorView）+ 追加详情行（too-large 的实际/上限等）+ 动作区
          （invalid-regex 提供「打开设置」直达修正）。工具栏「返回编辑」在
          错误态下仍可达（too-large 的回退出口），顶部栏同样可达 —— 可直接
          换文件 / 粘贴后自动重算；落地瞬间的短引导由 result watch 的
          ZToast error 承担，本块常驻完整详情。
        -->
        <div v-else class="result-error" role="alert">
          <p class="result-error-title">对比失败</p>
          <p class="result-error-text">{{ resultErrorView?.text ?? resultErrorText }}</p>
          <p
            v-for="line in resultErrorView?.details ?? []"
            :key="line"
            class="result-error-detail"
          >
            {{ line }}
          </p>
          <div v-if="resultErrorView?.openSettings" class="result-error-actions">
            <UiButton variant="secondary" @click="openErrorSettings">
              打开设置
            </UiButton>
          </div>
        </div>
      </div>
      <template v-else>
      <!--
        UI-001：左栏 CodeMirror 6 编辑器（原始文本）。v-model 直写 store.leftText。
        UI-003：整个 pane（header + 编辑器区域）是拖放目标——drop/dragover/
        dragenter/dragleave 绑在 capture 阶段（pane 是 CodeMirror contentDOM
        的祖先，需抢在其内置 drop handler 之前接管：原生实现会用 FileReader
        直读文件、文本只插入光标处，均与本侧载入语义冲突，见 useDropLoad.ts）；
        dragstart/dragend 绑在冒泡阶段，仅观察拖拽是否源自编辑器内部。
      -->
      <section
        class="editor-pane"
        aria-label="原始文本"
        @dragenter.capture="leftDrop.onDragEnter"
        @dragover.capture="leftDrop.onDragOver"
        @dragleave.capture="leftDrop.onDragLeave"
        @drop.capture="leftDrop.onDrop"
        @dragstart="leftDrop.onDragStart"
        @dragend="leftDrop.onDragEnd"
      >
        <!--
          pane 顶部栏（PaneHeader，本任务自内联模板抽取）：左侧「N 字符 · M 行」
          统计徽标（hover 弹统计悬浮），右侧编码选择器 + 打开文件 / 粘贴 /
          全部复制图标按钮。动作经事件回 App 编排 —— 结果态下打开 / 粘贴 /
          切编码即触发自动重算（见 refreshResultAfterSideLoad /
          handleEncodingChange）。
        -->
        <PaneHeader
          side="left"
          :encoding="fileEncoding"
          @open="openLeftFile"
          @paste="pasteLeftClipboard"
          @copy="handleCopySide('left')"
          @encoding="handleEncodingChange"
        />
        <div class="pane-body">
          <InputEditor
            ref="leftEditorRef"
            v-model="workbenchStore.leftText"
            side="left"
            label="原始文本"
            placeholder="粘贴或输入原始文本，也可拖入文件"
            :language="editorLanguage"
          />
        </div>
        <!--
          UI-003 拖拽覆盖层：外部拖入悬停时显示（isDragOver 由 dragenter/
          dragleave 深度计数驱动，见 useDropLoad.ts）。pointer-events: none
          让覆盖层不参与拖拽命中测试——事件目标始终是 pane 自身子树，覆盖层
          自身的插入不会扰动 enter/leave 计数（防闪烁配套措施）。
        -->
        <div v-if="leftDrop.isDragOver" class="drop-overlay" aria-hidden="true">
          <span class="drop-overlay-label">松开载入到「原始文本」</span>
        </div>
      </section>

      <div class="pane-divider" aria-hidden="true"></div>

      <!--
        UI-001：右栏 CodeMirror 6 编辑器（更改后文本）。
        UI-003：拖放绑定与覆盖层同左栏（说明见左栏注释）。
      -->
      <section
        class="editor-pane"
        aria-label="更改后文本"
        @dragenter.capture="rightDrop.onDragEnter"
        @dragover.capture="rightDrop.onDragOver"
        @dragleave.capture="rightDrop.onDragLeave"
        @drop.capture="rightDrop.onDrop"
        @dragstart="rightDrop.onDragStart"
        @dragend="rightDrop.onDragEnd"
      >
        <!-- pane 顶部栏（PaneHeader，结构与左栏对称，事件接线同左栏） -->
        <PaneHeader
          side="right"
          :encoding="fileEncoding"
          @open="openRightFile"
          @paste="pasteRightClipboard"
          @copy="handleCopySide('right')"
          @encoding="handleEncodingChange"
        />
        <div class="pane-body">
          <InputEditor
            ref="rightEditorRef"
            v-model="workbenchStore.rightText"
            side="right"
            label="更改后文本"
            placeholder="粘贴或输入更改后文本，也可拖入文件"
            :language="editorLanguage"
          />
        </div>
        <!-- UI-003 拖拽覆盖层（同左栏，pointer-events: none 防命中扰动） -->
        <div v-if="rightDrop.isDragOver" class="drop-overlay" aria-hidden="true">
          <span class="drop-overlay-label">松开载入到「更改后文本」</span>
        </div>
      </section>
      </template>
    </main>
    </div>
    </div>
  </div>

  <!--
    全局反馈（Scandi 重构后）：UiToastHost / UiConfirmDialog 各自读取本地
    composables 的模块级单例状态并渲染，无需 props 接线。Toast / 确认框均为
    fixed 定位（z-index 23000 / 22100），挂载位置不影响布局；确认弹窗的
    Esc / 焦点圈定 / 焦点还原由 reka-ui AlertDialog 内建。
  -->
  <UiToastHost />
  <UiConfirmDialog />

  <!-- UI-005：设置弹窗（上下文行数 / 自定义忽略规则 / 实时对比默认值） -->
  <SettingsDialog v-model:show="settingsOpen" />
</template>


<style scoped>
/*
 * ============================================================================
 * Scandi 版式（2026-08 北欧极简重构）：
 * 「亚麻桌面上放纸卡」—— 页面底为暖亚麻白（--bg-color），工作台里的编辑器
 * 与结果视图是两张纸卡（--surface 白面 + 发丝边 + 1px 轻阴影 + 大圆角），
 * 侧边栏是桌面左缘的浅色工具墙。全部颜色消费 main.css 令牌，无硬编码色值。
 * ============================================================================
 */

/*
 * FND-005 窗口最小尺寸与滚动策略：
 * .workbench 不设最小宽度 —— 允许容器真实收缩，App 以 ResizeObserver 观察
 * 其宽度，低于 620px 时并排结果视图自动降级为统一视图（见脚本区降级大注释）；
 * .app-shell 纵向 overflow: hidden（无页面级滚动，滚动只发生在 CodeMirror
 * 编辑器 / diff 视图内部）；横向 overflow-x: auto 作为最后防线。
 */
.app-shell {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  overflow-x: auto;
  background-color: var(--bg-color, #f7f5f1);
  color: var(--text-color, #2e2c28);
}

/*
 * ============================================================================
 * 左侧可折叠侧边栏：浅色工具墙 + 分组（小标题）+ 左下角折叠开关。
 * 结构：.app-body（横向 flex + relative）内 = 侧边栏 + 左下角悬浮开关
 * （恒驻，两种状态同一颗按钮）+ 主区（.app-main：工具条 + 工作台）。
 * - 折叠（「收纳进开关」）：.sidebar 宽度 248px（--sidebar-w）→ 0
 *   （.is-collapsed）承担布局收缩，内容经 .sidebar-inner 固定宽不换行
 *   挤压 → 过渡期内联控件不被挤变形；同时面板整体以左下角开关中心为
 *   transform-origin 缩聚（scale 0.02）+ 淡出 —— 视觉上面板被「装进」
 *   开关，展开为同一路径的逆放（从开关长出）；收起用 ease-in（被吸
 *   进去）、展开用 ease-out（长出来）；
 * - 窄窗自动收起见脚本区 UI-016 大注释（不自动展开）。
 * ============================================================================
 */
.app-body {
  /* relative：左下角悬浮折叠开关（.sidebar-toggle）的定位上下文 */
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  align-items: stretch;
}

.sidebar {
  --sidebar-w: 248px;
  flex: none;
  width: var(--sidebar-w);
  overflow: hidden;
  border-right: 1px solid var(--border-color, #e8e4dc);
  background-color: var(--bg-color, #f7f5f1);
  /*
   * 收缩原点 = 左下角开关中心（开关 left/bottom 各 12px、边长 28px，
   * 即距左 26px、距底 26px）：收起时面板整体向该点缩聚 + 淡出，落点
   * 恰是开关所在，读作「收纳进开关」；展开为同一路径的逆放。
   */
  transform-origin: 26px calc(100% - 26px);
  /* 展开（长出来）：ease-out 先快后慢，从开关弹出后稳稳落位 */
  transition:
    width 0.28s cubic-bezier(0.22, 1, 0.36, 1),
    transform 0.28s cubic-bezier(0.22, 1, 0.36, 1),
    opacity 0.22s ease-out,
    border-color 0.28s ease-out;
}

.sidebar.is-collapsed {
  width: 0;
  transform: scale(0.02);
  opacity: 0;
  border-right-color: transparent;
  pointer-events: none;
  /* 收起（被吸进去）：ease-in 先慢后快，尾段加速坠入开关 */
  transition:
    width 0.26s cubic-bezier(0.55, 0.06, 0.68, 0.19),
    transform 0.26s cubic-bezier(0.55, 0.06, 0.68, 0.19),
    opacity 0.24s ease-in,
    border-color 0.26s ease-in;
}

.sidebar-inner {
  width: var(--sidebar-w);
  height: 100%;
  display: flex;
  flex-direction: column;
}

/* 头部：页签分段控件（「文本对比 / 历史」切换，本任务替代原品牌 + 历史按钮） */
.sidebar-header {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--divider-color, #edeae3);
}

/* 主体：纵向滚动（侧边栏内控件高度超出时内滚，不撑破面板）。workbench /
   history 两页共用同一滚动容器形态（历史面板的内部排版见 HistoryPanel.vue）。 */
.sidebar-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

/* 分组：小标题 + 控件列；组间以发丝分隔线 + 呼吸间距区隔 */
.sidebar-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--divider-color, #edeae3);
}

/* 分组小标题：弱灰小字 + 略宽字距（安静的分类标记，不加图形装饰） */
.sidebar-section-title {
  margin: 0;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.6px;
  color: var(--text-secondary, #8a8377);
}

/* 开关行：标签居左、开关居右 */
.sidebar-option-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 26px;
  font-size: 12px;
  color: var(--text-color, #2e2c28);
}

.sidebar-option-label {
  font-size: 12px;
}

/* 便捷项列：控件满宽（本任务后只剩「示例数据」下拉，小按钮格撤除） */
.sidebar-quick {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

/*
 * 侧边栏底部（本任务起撤空）：「设置」入口已迁主区顶部工具条最右端
 * （.main-toolbar-actions 行尾，与「交换」同一行），原「返回编辑」/
 * 「实时对比」此前已先后撤除 —— 底排不再有常驻内容，仅保留收尾分隔线
 * 与左右内边距（与分组列的视觉底缘对齐，避免主体内容直接贴到面板底边）。
 */
.sidebar-footer {
  flex: none;
  min-height: 0;
  padding: 0 14px;
  border-top: 1px solid var(--divider-color, #edeae3);
}

/*
 * 禁用态（宿主窄窗，尺寸不足不允许展开）：与全局 .sidebar-toggle 段的
 * 活跃样式（hover 换色 / active 缩放）区别开 —— 禁用时指针禁用、
 * 文字与边线降到占位灰阶，hover 不再产生「可点」的暗示。原生 disabled
 * 已拦截点击与键盘，样式只承担「为什么不可点」的视觉传达（原因在
 * title 与指引卡里说明）。
 */
.sidebar-toggle:disabled,
.sidebar-toggle.is-disabled-look {
  cursor: not-allowed;
  color: var(--placeholder-color, #b6afa2);
  border-color: var(--border-color, #e8e4dc);
  background-color: var(--surface-2, #f1efe9);
}

.sidebar-toggle:disabled:hover,
.sidebar-toggle.is-disabled-look:hover {
  color: var(--placeholder-color, #b6afa2);
  border-color: var(--border-color, #e8e4dc);
}

/*
 * 折叠开关（本任务自侧边栏头部迁来）：恒驻窗口左下角的悬浮小方钮 ——
 * 收起后原位保留成为「侧边栏被收纳后」的把手；宽窗下侧边栏恒展开、开关
 * 实际不显，窄窗下禁用（尺寸不足不允许展开，见 :disabled 段样式注释）。
 * 纸卡样式（白面 + 发丝边 + 轻阴影）与工作台卡片同族，叠在侧边栏 / 主区
 * 两种背景上都清晰。
 */
.sidebar-toggle {
  position: absolute;
  left: 16px;
  bottom: 12px;
  z-index: 30;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 1px solid var(--border-color, #e8e4dc);
  border-radius: var(--radius-m, 8px);
  background-color: var(--surface, #ffffff);
  color: var(--text-secondary, #8a8377);
  cursor: pointer;
  box-shadow: var(--shadow-1);
  transition: background-color 0.12s var(--ease-quiet), border-color 0.12s var(--ease-quiet),
    color 0.12s var(--ease-quiet), transform 0.12s var(--ease-quiet);
}

.sidebar-toggle:hover {
  color: var(--text-color, #2e2c28);
  border-color: color-mix(in srgb, var(--primary-color, #4e7a60) 40%, var(--border-color, #e8e4dc));
}

/* 按压轻缩（transform 已进过渡，松手回弹） */
.sidebar-toggle:active {
  transform: scale(0.92);
}

.sidebar-toggle:focus-visible {
  outline: 1.5px solid var(--primary-color);
  outline-offset: 1px;
}

/*
 * 「吞入」脉冲（toggleSidebar 触发）：主色光环自按钮外扩一圈消散 ——
 * 与面板缩聚进按钮的动画同刻播放，给出「东西被装进来了」的落点反馈。
 */
.sidebar-toggle.is-pulsing {
  animation: sidebar-toggle-pulse 0.3s var(--ease-quiet);
}

@keyframes sidebar-toggle-pulse {
  from {
    box-shadow:
      var(--shadow-1),
      0 0 0 0 color-mix(in srgb, var(--primary-color, #4e7a60) 32%, transparent);
  }
  to {
    box-shadow:
      var(--shadow-1),
      0 0 0 9px color-mix(in srgb, var(--primary-color, #4e7a60) 0%, transparent);
  }
}

/*
 * 「分离为独立窗口」指引卡：初始进入插件且宿主窄窗 + 停靠时，右上角的
 * 一次性轻提示（纸卡浮层，与折叠开关同族 —— 白面 + 发丝边 + 轻阴影）。
 * 定位挂 .app-body（relative），右缘与主区卡片右缘对齐（16px）；z-index
 * 取 20，低于折叠开关（30）、远低于弹窗 / 抽屉（22000+）—— 纯提示层，
 * 不遮内容、可即时关闭（detach-hint-close）。文案一行截断（-webkit-line-
 * clamp 两行封顶）—— 窄窗里卡宽以 max-width 压缩，避免长文把窗口撑破。
 * 检测到已分离（onPluginDetach）时 detachHintVisible 失效，Transition
 * 走离场动画收起。
 */
.detach-hint {
  position: absolute;
  top: 12px;
  right: 16px;
  z-index: 20;
  display: flex;
  align-items: flex-start;
  gap: 8px;
  max-width: min(340px, calc(100% - 32px));
  padding: 10px 12px;
  border: 1px solid var(--border-color, #e8e4dc);
  border-radius: var(--radius-m, 8px);
  background-color: var(--surface, #ffffff);
  box-shadow: var(--shadow-2);
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-secondary, #8a8377);
}

/* 首图标：主色点缀（与文案里「右上角」的指向呼应），不参与换行压缩 */
.detach-hint-icon {
  flex: none;
  margin-top: 2px;
  color: var(--primary-color, #4e7a60);
}

.detach-hint-text {
  flex: 1 1 auto;
  min-width: 0;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  overflow: hidden;
}

/* 关闭按钮：轻量原生 button（与 .narrow-notice-close 同族，无背景描边） */
.detach-hint-close {
  appearance: none;
  flex: none;
  margin: 0;
  padding: 2px;
  border: none;
  border-radius: var(--radius-s, 6px);
  font-size: 12px;
  line-height: 1;
  background-color: transparent;
  color: var(--text-secondary, #8a8377);
  cursor: pointer;
  transition: background-color 0.12s var(--ease-quiet), color 0.12s var(--ease-quiet);
}

.detach-hint-close:hover {
  background-color: var(--hover-bg, #f2f0ea);
  color: var(--text-color, #2e2c28);
}

.detach-hint-close:focus-visible {
  outline: 1.5px solid var(--primary-color);
  outline-offset: 1px;
}

/* 进出场：从右上缘轻滑入 / 收回（与卡的方位呼应），透明度同步渐变 */
.detach-hint-enter-active,
.detach-hint-leave-active {
  transition:
    opacity 0.2s var(--ease-quiet),
    transform 0.2s var(--ease-quiet);
}

.detach-hint-enter-from,
.detach-hint-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

/* 主区（工具条 + 工作台列）：占满侧边栏右侧剩余空间 */
.app-main {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

/*
 * 主区顶部工具条：左端 = 差异统计徽标条（本任务自底部操作区上移），右端 =
 * 动作列（「查找差异 / 重新编辑」主按钮 + hunk 导航组 +「清空 / 全部展开 /
 * 交换」快捷动作）。与工作台同水平内边距（16px）对齐卡片右缘；底部不留白
 * —— 与下方工作台的 12px 上内边距合并为卡片上方呼吸空间。
 */
.main-toolbar {
  flex: none;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 10px 16px 0;
}

/*
 * 工具条左端：统计徽标条的容器。min-width: 0 允许统计条在窄窗下收缩裁切，
 * 不挤偏右端动作列。
 */
.main-toolbar-side {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: center;
}

/* 工具条右端动作列：主按钮 + 导航 + 快捷动作，恒驻不被压缩 */
.main-toolbar-actions {
  flex: none;
  display: flex;
  align-items: center;
  gap: 6px;
}

/*
 * 中部工作台：纸卡容器。padding + gap 构成「桌面留白」，子卡（编辑器 /
 * 结果视图）互不贴边。min-height: 0 保证子区域可收缩并内部滚动；
 * position: relative 是感知加载态进度条（.result-progress，main.css）的
 * 定位上下文。
 */
.workbench {
  flex: 1 1 auto;
  display: flex;
  gap: 12px;
  min-height: 0;
  padding: 12px 16px;
  position: relative;
}

/*
 * 结果态包裹层：纸卡（白面 + 发丝边 + 大圆角 + 轻阴影）。顶部承载「两侧
 * 相同」等提示条（卡内首行），下方结果视图占满剩余空间（滚动容器在
 * .result-view 内部）。overflow: hidden 让圆角裁掉行底色直角。
 */
.result-stage {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border-color, #e8e4dc);
  border-radius: var(--radius-l, 12px);
  background-color: var(--surface, #ffffff);
  box-shadow: var(--shadow-1);
  overflow: hidden;
}

/* 结果视图：占满工作台（单一滚动容器在组件内部） */
.result-view {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
}

/*
 * 结果态错误块：纸卡内居中呈现失败原因（标题 + 类别主文案 + 追加详情行 +
 * 动作区）；标题陶土红、正文次级暖灰，安静不刺眼。
 */
.result-error {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 24px;
  text-align: center;
}

.result-error-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--danger-color, #b3563e);
}

.result-error-text {
  margin: 0;
  font-size: 13px;
  color: var(--text-secondary, #8a8377);
}

/* 错误块追加详情行：比主文案再弱一档，等宽字体承载「大小 / 上限」数字 */
.result-error-detail {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 12px;
  color: color-mix(in srgb, var(--text-secondary, #8a8377) 85%, transparent);
}

/* 错误块动作区：与文案拉开间距 */
.result-error-actions {
  margin-top: 8px;
  display: flex;
  align-items: center;
  gap: 8px;
}

/*
 * 编辑器 pane：纸卡（同 .result-stage 的白面 + 发丝边 + 圆角 + 轻阴影）。
 * 两卡之间的呼吸感由 .workbench 的 gap 提供（原 1px 分隔线取消）。
 * position: relative 是拖拽覆盖层（.drop-overlay）的定位上下文。
 */
.editor-pane {
  flex: 1 1 50%;
  display: flex;
  flex-direction: column;
  min-width: 0;
  position: relative;
  border: 1px solid var(--border-color, #e8e4dc);
  border-radius: var(--radius-l, 12px);
  background-color: var(--surface, #ffffff);
  box-shadow: var(--shadow-1);
  overflow: hidden;
}

/*
 * 结果态顶部栏（本任务起常驻）：两侧 PaneHeader 并排（各占一半，对齐并排
 * 视图的两列分界），中缝细分隔线与 .split-gutter-r 的行分界同族。顶部栏
 * 自身的行内排版（内边距 / 徽标 / 动作钮）归 PaneHeader.vue 组件样式。
 */
.result-headers {
  flex: none;
  display: flex;
  align-items: stretch;
}

.result-headers > .pane-header {
  flex: 1 1 50%;
  min-width: 0;
}

.result-headers-divider {
  flex: none;
  width: 1px;
  background-color: var(--divider-color, #edeae3);
}

/* 编辑器挂载区域：内容自身滚动（CodeMirror 的 .cm-scroller） */
.pane-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
}

/*
 * 拖拽覆盖层：半透明暖白遮罩 + 主色虚线框 + 居中主色徽标文案。
 * pointer-events: none 是防闪烁的配套措施（覆盖层不参与拖拽命中测试，
 * 其插入 / 移除不会扰动 enter/leave 深度计数）。
 */
.drop-overlay {
  position: absolute;
  inset: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  border: 2px dashed color-mix(in srgb, var(--primary-color, #4e7a60) 70%, transparent);
  border-radius: inherit;
  background-color: color-mix(in srgb, var(--surface, #ffffff) 85%, transparent);
  pointer-events: none;
}

.drop-overlay-label {
  padding: 6px 14px;
  border-radius: var(--radius-m, 8px);
  font-size: 13px;
  font-weight: 600;
  color: var(--primary-color, #4e7a60);
  background-color: color-mix(in srgb, var(--primary-color, #4e7a60) 10%, var(--surface, #ffffff));
  box-shadow: var(--shadow-1);
}

/*
 * 统计徽标条容器（本任务自底部操作区上移至工具条左端）：小字号一行，轻底
 * 圆角（错误摘要为陶土红文案）。
 */
.result-summary {
  display: flex;
  align-items: center;
  gap: 6px;
  overflow: hidden;
  white-space: nowrap;
  padding: 3px 10px;
  border-radius: var(--radius-m, 8px);
  font-size: 12px;
  background-color: var(--hover-bg, #f2f0ea);
}

.result-summary.is-error {
  color: var(--danger-color, #b3563e);
  font-weight: 600;
}

/*
 * 统计徽标：pill 形 + 等宽字体（数字对齐、与 diff 视图同字体族）。
 * 各徽标底色由自身文字色透明化派生（color-mix）—— 浅色是淡彩、深色是暗彩，
 * 随 token 自动适配主题，无硬编码色值。
 */
.stat-pill {
  flex: none;
  padding: 1px 8px;
  border-radius: 999px;
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 600;
  line-height: 16px;
}

.stat-pill.is-add {
  color: var(--diff-add-text, #3f6d4b);
  background-color: color-mix(in srgb, var(--diff-add-text, #3f6d4b) 10%, transparent);
}

.stat-pill.is-del {
  color: var(--diff-del-text, #96482f);
  background-color: color-mix(in srgb, var(--diff-del-text, #96482f) 10%, transparent);
}

/* ~K 修改对徽标：浅雾蓝（信息语义，与 hunk 头同族色相） */
.stat-pill.is-mod {
  color: var(--accent-blue, #5e86a8);
  background-color: color-mix(in srgb, var(--accent-blue, #5e86a8) 10%, transparent);
}

/* 「H 处差异」计数徽标：中性弱化，让 +/− 数字成为视觉重心 */
.stat-pill.is-count {
  color: var(--text-secondary, #8a8377);
  background-color: color-mix(in srgb, var(--text-secondary, #8a8377) 12%, transparent);
  font-family: inherit;
  font-weight: 500;
}

/*
 * hunk 导航组（主按钮左侧）：页码（2/5）在 ▲/▼ 图标按钮左侧，未定位时
 * 页码不渲染。位置用等宽字体与 tabular-nums，跳转时数字宽度稳定不抖动。
 */
.hunk-nav {
  display: flex;
  align-items: center;
  gap: 6px;
}

/*
 * 图标按钮形态：去掉水平内边距、收窄为正方形，与文字按钮拉开密度层级。
 * :deep + 双类选择器恒胜过 UiButton 内部的 .ui-btn.size-small（两个类 +
 * scope 属性同分时依赖注入顺序，见 PaneHeader.pane-icon-btn 的同类说明）。
 */
.main-toolbar-actions :deep(.ui-btn.hunk-nav-btn) {
  padding: 0;
  width: 26px;
}

.hunk-nav-position {
  min-width: 36px;
  text-align: center;
  font-family: var(--font-mono);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: var(--text-secondary, #8a8377);
  overflow: hidden;
  white-space: nowrap;
}
</style>
