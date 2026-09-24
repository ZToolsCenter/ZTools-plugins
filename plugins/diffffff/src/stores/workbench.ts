/**
 * 工作台状态 store（FND-005）。
 *
 * 组合式 reactive 单例（刻意不引 Pinia）：本插件是单视图应用，只需一份
 * 跨组件共享的状态，模块级 reactive 对象即可满足，后续 UI-001 / M1 直接
 * import 复用，无额外依赖与 Provider 样板。
 *
 * 定位（状态承接点）：
 * - UI-001（CodeMirror 6 编辑器）以本 store 为唯一数据源：编辑器 change
 *   回调走 setLeftText / setRightText，回显绑定 leftText / rightText，
 *   store 形状保持不变；
 * - M1（diff 引擎）从 leftText / rightText 取两侧文本作为计算输入；
 * - FND-005（composables/usePluginLifecycle.ts）负责本状态的
 *   dbStorage 持久化恢复 / 保存（key 'workbench.draft'）；
 * - INT-001（语言自动检测）新增 leftFileName / rightFileName：记录两侧
 *   内容的「来源文件名」，供 detectLanguagePair 的扩展名优先级消费。
 *   文件名字段不进 DraftState（不持久化 —— 草稿恢复后内容可能已与原文件
 *   无关，扩展名线索失效，检测自然落到内容启发式）；
 * - 本任务新增 leftFilePath / rightFilePath：来源文件绝对路径（会话态，
 *   不持久化），供「打开编码」切换时按新编码重读来源文件（消费编排见
 *   App.vue 的 handleEncodingChange；与文件名的耦合约定见更新方法注释）。
 */
import { reactive } from 'vue'

/** 草稿持久化结构：ztools.dbStorage key 'workbench.draft' 的载荷（FND-005） */
export interface DraftState {
  leftText: string
  rightText: string
}

/** 对外 store 形状：两侧文本 + 来源文件名/路径 + 对应更新方法 */
export interface WorkbenchStore extends DraftState {
  /** 左侧（原始文本）来源文件名（basename，'' = 无文件来源 / 已清空） */
  leftFileName: string
  /** 右侧（更改后文本）来源文件名（basename，'' = 无文件来源 / 已清空） */
  rightFileName: string
  /**
   * 左侧来源文件绝对路径（'' = 无文件来源 / 已失效）。会话态：不进
   * DraftState（不持久化 —— 重开后草稿内容可能已与原文件无关）。
   * 消费方：「打开编码」切换时按新编码重读来源文件（App.vue 编排）。
   */
  leftFilePath: string
  /** 右侧来源文件绝对路径（语义同 leftFilePath） */
  rightFilePath: string
  setLeftText: (value: string) => void
  setRightText: (value: string) => void
  setLeftFileName: (value: string) => void
  setRightFileName: (value: string) => void
  setLeftFilePath: (value: string) => void
  setRightFilePath: (value: string) => void
  /** 交换两侧：文本与来源文件名 / 路径一起互换（UI-014「交换」按钮语义） */
  swapSides: () => void
  /** 清空两侧：文本置空 + 文件名 / 路径清空（UI-014「清空」按钮 / 示例载入共用语义） */
  clearSides: () => void
}

/*
 * 更新方法：先声明普通函数、再并入 reactive 单例，
 * 不依赖 this，保证任何方式调用（含解构转发）行为一致。
 *
 * set*FileName 与来源路径的耦合约定：文件名清空（''）= 内容不再来自文件
 * （粘贴 / 文本拖入 / 示例载入 / 清空共用语义），此时来源路径一并失效 ——
 * 路径的维护收敛在两处：set*FileName 清空、set*FilePath 写入（文件成功
 * 读取后调用，须在 set*FileName 之后，见 useFileLoad.readFileIntoStore）。
 */
function setLeftText(value: string): void {
  workbenchStore.leftText = value
}

function setRightText(value: string): void {
  workbenchStore.rightText = value
}

function setLeftFileName(value: string): void {
  workbenchStore.leftFileName = value
  workbenchStore.leftFilePath = ''
}

function setRightFileName(value: string): void {
  workbenchStore.rightFileName = value
  workbenchStore.rightFilePath = ''
}

function setLeftFilePath(value: string): void {
  workbenchStore.leftFilePath = value
}

function setRightFilePath(value: string): void {
  workbenchStore.rightFilePath = value
}

function swapSides(): void {
  const leftText = workbenchStore.leftText
  const rightText = workbenchStore.rightText
  const leftName = workbenchStore.leftFileName
  const rightName = workbenchStore.rightFileName
  const leftPath = workbenchStore.leftFilePath
  const rightPath = workbenchStore.rightFilePath
  workbenchStore.leftText = rightText
  workbenchStore.rightText = leftText
  // 文件名随内容互换：交换后各侧的「来源文件」也跟着换侧（INT-001）；
  // 来源路径与文件名同进退（切编码重读的目标文件跟着内容走）
  workbenchStore.leftFileName = rightName
  workbenchStore.rightFileName = leftName
  workbenchStore.leftFilePath = rightPath
  workbenchStore.rightFilePath = leftPath
}

function clearSides(): void {
  workbenchStore.leftText = ''
  workbenchStore.rightText = ''
  workbenchStore.leftFileName = ''
  workbenchStore.rightFileName = ''
  workbenchStore.leftFilePath = ''
  workbenchStore.rightFilePath = ''
}

/**
 * 工作台单例 store。
 *
 * 左右初始均为空字符串：真正的「上次内容」由 usePluginLifecycle 在
 * onMounted 时从 dbStorage 恢复；浏览器 dev / preview 环境无宿主
 * 存储时保持空值（静默降级）。文件名初始 ''（无文件来源，语言检测走
 * 内容启发式兜底）。
 */
export const workbenchStore: WorkbenchStore = reactive({
  leftText: '',
  rightText: '',
  leftFileName: '',
  rightFileName: '',
  leftFilePath: '',
  rightFilePath: '',
  setLeftText,
  setRightText,
  setLeftFileName,
  setRightFileName,
  setLeftFilePath,
  setRightFilePath,
  swapSides,
  clearSides,
})
