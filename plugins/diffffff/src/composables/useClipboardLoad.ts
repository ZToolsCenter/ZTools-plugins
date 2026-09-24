/**
 * ============================================================================
 * 剪贴板载入 composable（INT-006：从剪贴板载入单侧）
 * ============================================================================
 *
 * 两块职责：
 * 1. 读取降级链（readClipboardTextOrNotify）：ztools services.readClipboardText
 *    优先（宿主 preload 注入，剪贴板为空/读取失败返回空串，语义见
 *    src/env.d.ts），浏览器 dev / preview 无 window.services 时降级
 *    navigator.clipboard.readText()（非安全上下文下 clipboard 为 undefined、
 *    权限拒绝时 readText 抛错，汇入「无法读取剪贴板」通道）；
 * 2. 单侧粘贴（useClipboardLoad().pasteIntoSide）：读剪贴板 → 空串 toast
 *    info「剪贴板为空」→ 目标侧已有内容弹覆盖确认（与「打开文件」语义一致）
 *    → 写入该侧。
 *
 * 大文本：超 DIFF_LIMITS 的剪贴板内容照常写入，本层不预拦截 —— 写入本身
 * 无上限（编辑器亦不设限），越界反馈由对比时 compareFull 的 too-large
 * 错误链路统一兜底（错误块 + 底部摘要条 + ZToast error）；在此预拦截需要
 * 复刻引擎阈值，双份上限易漂移。
 * ============================================================================
 */
import { useConfirmDialog } from './useConfirm'
import { useToast } from './useToast'
import { workbenchStore } from '../stores/workbench'
import type { PaneSide } from './useFileLoad'

/*
 * info Toast 直接取自模块级：ztools-ui 的 useToast 状态是模块级单例
 * （toastState，App.vue 已绑定到 ZToast 组件），在组件 setup 之外调用
 * 只是拿到同一组闭包引用，无 setup 上下文依赖（与 useFileLoad 一致）。
 */
const { info: toastInfo } = useToast()

/** 剪贴板为空的提示文案（空串是 services 契约的「空/失败」返回值） */
const EMPTY_CLIPBOARD_MESSAGE = '剪贴板为空'

/** 降级路径读取失败的提示文案（services 路径的失败已按契约归入空串语义） */
const UNREADABLE_CLIPBOARD_MESSAGE = '无法读取剪贴板'

/**
 * 单侧粘贴覆盖确认文案：与 useFileLoad 的 OVERWRITE_CONFIRM_MESSAGE 逐字
 * 一致（任务要求与「打开文件」语义一致，该常量未导出故在此重复声明，
 * 两处文案需同步维护）。
 */
const OVERWRITE_CONFIRM_MESSAGE = '该侧已有内容，覆盖未保存的修改？'

/**
 * 读取系统剪贴板纯文本：宿主 services 优先、浏览器剪贴板降级（读取本体，
 * 不含反馈）。services 路径按契约返回空串表达「空/失败」；降级路径的
 * navigator.clipboard.readText() 在非安全上下文（clipboard 为 undefined）
 * 或权限拒绝（NotAllowedError）时抛错，由调用方汇入失败通道。
 */
async function readClipboardViaHostOrClipboard(): Promise<string> {
  // services 探测：ZTools 宿主有 preload 注入；浏览器 dev / preview 无
  // window.services，typeof 属性探测不抛错（与 App.vue 导出路径同款探测）。
  const services =
    typeof window.services === 'object' && window.services !== null ? window.services : null
  if (services !== null && typeof services.readClipboardText === 'function') {
    return services.readClipboardText()
  }
  // 浏览器 dev 降级：宿主剪贴板 API 不可用，走标准异步剪贴板（浏览器环境
  // 首次调用会触发权限弹窗；拒绝 / 非安全上下文抛错 → 调用方 toast info）。
  return navigator.clipboard.readText()
}

/**
 * 读取剪贴板文本并统一处理「空 / 不可读」反馈（INT-006 单侧「粘贴」的
 * 读取出口）。
 *
 * @returns 剪贴板文本（保证非空）；null = 剪贴板为空或读取失败 —— 两种
 *          情况都已在此 toast info（空 →「剪贴板为空」、降级路径读取失败
 *          →「无法读取剪贴板」），调用方拿到 null 静默结束即可，无需重复
 *          反馈。services 路径的底层读取失败按 env.d.ts 契约返回空串、
 *          与「剪贴板为空」同义呈现，不做二次区分。
 */
export async function readClipboardTextOrNotify(): Promise<string | null> {
  let text: string
  try {
    text = await readClipboardViaHostOrClipboard()
  } catch (error) {
    // 降级路径读取失败（权限拒绝 / 非安全上下文 clipboard 缺失等）：
    // toast info 引导 + console.debug 留排查信息（沿用 useFileLoad 惯例）
    console.debug('[useClipboardLoad] 读取剪贴板失败', error)
    toastInfo(UNREADABLE_CLIPBOARD_MESSAGE)
    return null
  }
  if (text === '') {
    toastInfo(EMPTY_CLIPBOARD_MESSAGE)
    return null
  }
  return text
}

/**
 * 把文本写入单侧并清除该侧来源文件名（INT-006 单侧「粘贴」的写入原语）。
 * 清除文件名的理由与文本拖入一致
 * （useDropLoad）：粘贴内容不再来自文件，语言检测的扩展名线索失效，回
 * 到内容启发式。不做覆盖确认 —— 确认属调用方的编排职责（pasteIntoSide
 * 在写入前自行确认）。
 *
 * @param side 目标侧：'left' 写 leftText，'right' 写 rightText
 * @param text 待写入文本（调用方保证非空 —— 空剪贴板已在读取出口拦截）
 */
export function writeTextIntoSide(side: PaneSide, text: string): void {
  if (side === 'left') {
    workbenchStore.setLeftText(text)
    workbenchStore.setLeftFileName('')
  } else {
    workbenchStore.setRightText(text)
    workbenchStore.setRightFileName('')
  }
}

/**
 * 剪贴板载入组合式函数（INT-006：单侧「粘贴」按钮的完整链路）。
 *
 * 可在多个组件调用（useConfirmDialog 状态为模块级单例，行为一致）；
 * 当前由 App.vue 调用一次，供两侧 pane 头部「粘贴」按钮共用。
 *
 * @returns pasteIntoSide：读取剪贴板写入指定侧（恒 resolve，全部出口
 *          在内部消化，调用方无需 await 处理结果）
 */
export function useClipboardLoad(): {
  pasteIntoSide: (side: PaneSide) => Promise<void>
} {
  const { confirm } = useConfirmDialog()

  /**
   * 读取剪贴板并载入到指定侧（pane 头部「粘贴」按钮主入口）。
   *
   * @param side 目标侧：'left' 写 leftText，'right' 写 rightText
   *
   * 各出口：
   * - 剪贴板为空 / 读取失败 → readClipboardTextOrNotify 已 toast info，
   *   返回 null 静默结束，目标侧内容不变；
   * - 目标侧文本非空 → 弹覆盖确认（文案与「打开文件」一致）；用户取消 →
   *   保留原内容静默结束；目标侧为空 → 跳过确认直接写入；
   * - 成功 → 写入该侧并清来源文件名（见 writeTextIntoSide）。
   *
   * 刻意不做 isRunning 守卫（与示例/交换/清空三个写文本动作的差别）：
   * 本动作只写文本、不触发对比（重算由实时防抖 watch 或显式触发承接），
   * 不存在「先写后 run 撞重入守卫」的中间态；对比进行中写入与用户在
   * 编辑器里打字等价，无额外风险。
   */
  async function pasteIntoSide(side: PaneSide): Promise<void> {
    const text = await readClipboardTextOrNotify()
    if (text === null) return
    const currentText = side === 'left' ? workbenchStore.leftText : workbenchStore.rightText
    if (currentText.length > 0) {
      const confirmed = await confirm({
        title: '粘贴',
        message: OVERWRITE_CONFIRM_MESSAGE,
        type: 'warning',
        confirmText: '覆盖',
        cancelText: '取消',
      })
      if (!confirmed) return // 用户取消覆盖，保留未保存内容
    }
    writeTextIntoSide(side, text)
  }

  return { pasteIntoSide }
}
