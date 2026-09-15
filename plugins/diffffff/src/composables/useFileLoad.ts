/**
 * 「打开文件」载入链路（UI-002）。
 *
 * 流程（每侧 pane 头部「打开文件」按钮触发）：
 *   pickOpenFile 选文件（取消返回 null → 静默结束）
 *   → 目标侧已有内容时弹 ZConfirmDialog 确认覆盖（用户取消 → 静默结束，原内容不动）
 *   → readTextFile 按当前全局「打开编码」读取（INT-005，缺省 UTF-8；BOM 由
 *     preload 按 TextDecoder 标签语义剥除）
 *   → 成功写 store.setLeftText / setRightText 并记录来源文件路径
 *     （leftFilePath / rightFilePath，「打开编码」切换重读的依据）
 *   → 读取失败弹 ZToast 错误提示（含原始 message）。
 *
 * 反馈设施：ztools-ui 的 useToast / useConfirmDialog 内部持有模块级单例状态
 * （toastState / confirmState）；App.vue 已把该单例状态绑定到 ZToast /
 * ZConfirmDialog 组件 props 上（组件本身只读 props，不会自动订阅单例）。
 * 因此本文件直接调用 confirm() / error() 即可驱动渲染，无需传递组件实例。
 *
 * 静默降级：浏览器 dev / vite preview 环境没有 preload 注入的 window.services，
 * 访问其方法即抛 TypeError —— 整条链路包 try/catch 吞掉并 console.debug，
 * 沿用 usePluginLifecycle 的降级惯例；按钮仍可点击，但不产生任何副作用。
 *
 * 共享读路径：readFileIntoStore 是本文件抽出的「读文件 → 写 store → 错误
 * Toast」末端，UI-003 拖入文件（useDropLoad）复用同一路径，保证两条入口
 * 的编码策略与错误提示一致。
 *
 * 编码（INT-005）：载入编码为全局单值（两侧共用，App.vue 的 fileEncoding
 * ref 经 getEncoding getter 传入 useFileLoad / useDropLoad；决策理由：用户
 * 通常连续导入同源文件，单值比每侧独立更符合直觉）。readTextFile 的编码
 * 白名单见 preload services.js 的 ENCODING_MAP（utf-16be 仅 API 级，UI 暴露
 * UTF-8/GBK/UTF-16 三项）；GBK 等编码遇非法字节序列不抛错，按 TextDecoder
 * 标准以 U+FFFD 替换符呈现 —— 用户可感知乱码后切换编码重试。
 */
import { useConfirmDialog } from '../composables/useConfirm'
import { useToast } from '../composables/useToast'
import { workbenchStore } from '../stores/workbench'

/*
 * 错误 Toast 直接取自模块级：ztools-ui 的 useToast 状态是模块级单例
 * （toastState，App.vue 已绑定到 ZToast 组件），在组件 setup 之外调用
 * 只是拿到同一组闭包引用，无 setup 上下文依赖，安全。
 */
const { error: toastError } = useToast()

/** 目标侧别：与 InputEditor 的 data-side / store 字段一一对应 */
export type PaneSide = 'left' | 'right'

/**
 * 载入编码（INT-005，UI 层可选范围）：与 preload services.readTextFile
 * 白名单的交集 —— 'utf-16be' 是 API 级能力不进 UI，'utf8' 是 'utf-8' 的
 * 别名无需在 UI 重复。选项顺序即编码选择器的展示顺序（UTF-8 默认在前）。
 */
export type FileEncoding = 'utf-8' | 'gbk' | 'utf-16'

/**
 * 「打开文件」对话框过滤器：常用文本类扩展名在前，「所有文件」兜底。
 * 形状与 src/env.d.ts 中 Services.pickOpenFile 的参数约定一致。
 */
const OPEN_FILE_FILTERS: { name: string, extensions: string[] }[] = [
  {
    name: '文本文件',
    extensions: [
      'txt', 'md', 'json', 'js', 'ts', 'py', 'java', 'go',
      'sql', 'yaml', 'yml', 'html', 'css', 'xml', 'csv', 'log',
    ],
  },
  { name: '所有文件', extensions: ['*'] },
]

/** 覆盖确认弹窗文案（UI-002 要求：替换前确认「覆盖未保存内容」） */
const OVERWRITE_CONFIRM_MESSAGE = '该侧已有内容，覆盖未保存的修改？'

/**
 * 从文件路径提取 basename（INT-001：来源文件名记录用）。
 * 容忍 Windows / POSIX 混合分隔符；空路径返回 ''。
 */
function basenameOf(path: string): string {
  return path.split(/[\\/]/).pop() ?? ''
}

/**
 * 读取本地文件并写入对应侧 store（共享读路径，UI-002 / UI-003 共用）。
 *
 * 「打开文件」按钮（openFileInto）与「拖入文件」（useDropLoad）共用的
 * 末端「读文件 → 写 store → 错误 Toast」步骤，保证两条入口的编码策略与
 * 错误提示完全一致。
 *
 * @param side 目标侧：'left' 写 leftText，'right' 写 rightText
 * @param path 文件本地绝对路径（preload services.readTextFile 消费）
 * @param encoding 解码编码（INT-005）：取当前全局「打开编码」（App.vue
 *        ref），缺省 'utf-8'（兼容无编码感知的调用方）；非法值由 preload
 *        白名单拒绝（抛中文错误 → 下方 catch 弹 Toast）
 *
 * 行为边界（分层与抽取前一致）：
 * - 只消化「读取失败」：以 ZToast 呈现（含原始 message），目标侧内容不变；
 * - 编码与字节序列不匹配（如 GBK 文件按 UTF-8 读）不属「读取失败」：
 *   TextDecoder 以 U+FFFD 替换符呈现，内容照常写入，用户感知乱码后可在
 *   pane 头部切换编码重新载入（tooltip 已提示）；
 * - 「无 window.services 的降级」由调用方外层 try/catch 负责——openFileInto
 *   在调用前已通过 pickOpenFile 确认 services 可用；useDropLoad 自行兜底；
 * - INT-001：读取成功时把来源文件名（basename）写入 workbench store 的
 *   leftFileName / rightFileName（语言检测扩展名优先级的线索来源）；
 * - 本任务：读取成功时同时把来源绝对路径写入 leftFilePath / rightFilePath
 *   （「打开编码」切换时按新编码重读的依据；须在 set*FileName 之后调用 ——
 *   文件名 setter 会先清空路径，耦合约定见 workbench store 更新方法注释）。
 */
export function readFileIntoStore(
  side: PaneSide,
  path: string,
  encoding: FileEncoding = 'utf-8',
): void {
  try {
    const content = window.services.readTextFile(path, encoding)
    if (side === 'left') {
      workbenchStore.setLeftText(content)
      workbenchStore.setLeftFileName(basenameOf(path))
      workbenchStore.setLeftFilePath(path)
    } else {
      workbenchStore.setRightText(content)
      workbenchStore.setRightFileName(basenameOf(path))
      workbenchStore.setRightFilePath(path)
    }
  } catch (error) {
    // 读取失败：ZToast 错误提示（含原始 message），目标侧内容保持不变
    const message = error instanceof Error ? error.message : String(error)
    toastError(`读取文件失败：${message}`)
  }
}

/**
 * 「打开文件」组合式函数。
 *
 * 可在多个组件调用（useToast/useConfirmDialog 状态为模块级单例，行为一致）；
 * 当前由 App.vue 调用一次，供两侧 pane 头部按钮共用。
 *
 * @param getEncoding 取当前全局「打开编码」（INT-005，App.vue 的
 *        fileEncoding ref 经 getter 传入 —— getter 而非快照，保证每次打开
 *        文件都取选择器当前值；缺省恒为 'utf-8'，兼容无编码感知的调用方）
 */
export function useFileLoad(
  getEncoding: () => FileEncoding = () => 'utf-8',
): { openFileInto: (side: PaneSide) => Promise<void> } {
  const { confirm } = useConfirmDialog()

  /**
   * 打开文件并载入到指定侧（UI-002 主入口）。
   *
   * @param side 目标侧：'left' 写 leftText，'right' 写 rightText
   * @returns 恒 resolve 的 Promise：所有出口（取消/失败/降级）都在内部消化，
   *          不向调用方抛错，调用方无需 await 处理结果
   *
   * 各出口（确认流程状态机）：
   * - pickOpenFile 返回 null（用户取消选择）→ 静默结束；
   * - 目标侧文本非空 → 弹覆盖确认；用户取消 → 保留原内容，静默结束；
   * - 目标侧为空 → 跳过确认直接载入；
   * - readTextFile 抛错（文件不存在/读取失败/编码不在白名单等）→ ZToast
   *   错误（含原始 message），原内容不变；
   * - 无 window.services（浏览器 dev 降级）或其它非预期异常 → console.debug
   *   后静默结束；
   * - 成功 → store.setLeftText / setRightText(content)，编辑器经 watch 回显。
   */
  async function openFileInto(side: PaneSide): Promise<void> {
    try {
      // 1) 弹系统「打开文件」对话框（同步桥接）。浏览器 dev 无 window.services
      //    时，属性访问即抛 TypeError → 外层 catch 静默降级。
      const path = window.services.pickOpenFile(OPEN_FILE_FILTERS)
      if (path === null) return // 用户取消选择文件

      // 2) 覆盖确认：目标侧已有内容（非空）才弹；空侧直接载入不打扰。
      //    confirm() 由 App.vue 渲染的 ZConfirmDialog 兑现（resolve true/false）。
      const currentText = side === 'left' ? workbenchStore.leftText : workbenchStore.rightText
      if (currentText.length > 0) {
        const confirmed = await confirm({
          title: '打开文件',
          message: OVERWRITE_CONFIRM_MESSAGE,
          type: 'warning',
          confirmText: '覆盖',
          cancelText: '取消',
        })
        if (!confirmed) return // 用户取消覆盖，保留未保存内容
      }

      // 3) 读取（按当前全局「打开编码」，INT-005）并写入对应侧 store：
      //    共用 readFileIntoStore（UI-003 拖入文件同走此路径；读取失败在其
      //    内部弹 ZToast）
      readFileIntoStore(side, path, getEncoding())
    } catch (error) {
      // 静默降级：浏览器 dev / preview 无 preload services（window.services 未定义）
      // 等非预期异常吞掉并留调试信息，不阻塞页面（沿用 usePluginLifecycle 惯例）
      console.debug('[useFileLoad] 打开文件不可用，已静默降级', error)
    }
  }

  return { openFileInto }
}
