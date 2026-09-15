/**
 * 拖拽载入（UI-003）：把文件 / 文本拖到单侧 pane（header + 编辑器区域）直接载入。
 *
 * 交互决策一（载入语义）：拖拽是**直接覆盖**目标侧，不弹「覆盖未保存内容」
 * 确认 —— 与「打开文件」按钮（useFileLoad）的确认语义刻意区分：
 * - 拖放的目标是用户瞄准某一侧后主动松手，意图明确等价于「用它替换这一侧」，
 *   弹确认反而打断拖放动线（确认框出现在松手之后，焦点与光标均脱离拖放语境）；
 * - 误操作的兜底仍在：CodeMirror 历史保留了本次全文替换事务，⌘/Ctrl+Z 可撤销；
 * - 「打开文件」按钮保留覆盖确认不变（其目标侧由对话框流程决定，误触成本更高）。
 *
 * 交互决策二（读路径）：文件拖入**不做 FileReader 渲染层直读**，统一取
 * File.path 走 preload（services.readTextFile，复用 useFileLoad 抽出的
 * readFileIntoStore）—— roadmap 指定文件载入收敛到受控的 preload 读路径
 * （编码 / BOM / 错误处理单点维护）。path 取不到时（纯浏览器 dev，或新版
 * Electron 改用 webUtils.getPathForFile 而移除 File.path）ZToast 提示改用
 * 「打开文件」按钮。
 *
 * 与 CodeMirror 原生拖放的边界（为何用 capture 阶段接管）：CM 的内置 drop
 * handler（@codemirror/view handlers.drop）会对拖入文件用 FileReader 直读并
 * 在光标处插入（绕过 preload 读路径），文本拖入也是光标处插入而非整侧覆盖。
 * pane 是 CM contentDOM 的祖先，把 drop / dragover 绑定在 capture 阶段即可
 * 抢在其监听之前对外部拖入 stopPropagation 整体接管；而**编辑器内部发起的
 * 选区拖拽**（dragstart 源在 .cm-content 内）完全放行，保留 CM 原生行为
 * （编辑器内移动选区 / 跨编辑器光标处插入），避免把「拖动选中文字微调位置」
 * 误判为「载入」而整侧覆盖。
 */
import { reactive, ref } from 'vue'
import { useToast } from './useToast'
import { readFileIntoStore, type FileEncoding, type PaneSide } from './useFileLoad'
import { workbenchStore } from '../stores/workbench'

/** 每侧 pane 的拖拽绑定：覆盖层可见性 + 挂到 pane 根元素上的拖拽事件处理器 */
export interface PaneDropBindings {
  /** 拖拽悬停中（外部拖入且悬于本 pane 内）：控制覆盖层显隐 */
  isDragOver: boolean
  /** dragenter（capture）：深度计数 +1，外部且受支持的拖入显示覆盖层 */
  onDragEnter: (event: DragEvent) => void
  /** dragover（capture）：preventDefault 放行 drop，并接管 CM 原生 dropCursor */
  onDragOver: (event: DragEvent) => void
  /** dragleave（capture）：深度计数 -1，归零隐藏覆盖层 */
  onDragLeave: (event: DragEvent) => void
  /** drop（capture）：隐藏覆盖层并载入（文件走 preload 读路径 / 文本直接覆盖） */
  onDrop: (event: DragEvent) => void
  /** dragstart（冒泡）：拖拽源在编辑器内容内时置位「编辑器内部拖拽」标记 */
  onDragStart: (event: DragEvent) => void
  /** dragend（冒泡）：拖拽结束（含取消 / 落在编辑器外部）复位标记 */
  onDragEnd: () => void
}

/*
 * 错误 Toast 直接取自模块级：ztools-ui 的 useToast 状态是模块级单例
 * （toastState，App.vue 已绑定到 ZToast 组件），在组件 setup 之外调用
 * 只是拿到同一组闭包引用，无 setup 上下文依赖（与 useFileLoad 一致）。
 */
const { error: toastError } = useToast()

/**
 * 编辑器内部拖拽进行中标记（dragstart 置位，dragend / drop 复位）。
 * 两侧 pane 共享一份：跨编辑器拖拽（左 → 右）同样要走「放行」分支。
 * 拖放规范保证 dragstart 先于本次拖拽的首个 dragenter 派发，因此
 * enter/over/leave/drop 读到的标记必然已就位。
 */
let draggingFromEditor = false

/**
 * 判断拖拽数据是否受支持（决定是否显示「松开载入」覆盖层）。
 *
 * @param event 拖拽事件（dragenter 阶段 types 可读，getData 则仅 drop 可用）
 * @returns 携带文件（types 含 'Files'）或纯文本（'text/plain'，容忍带
 *          charset 参数的变体）时 true；网页图片等其它数据为 false
 */
function isSupportedDrag(event: DragEvent): boolean {
  const types = event.dataTransfer?.types
  if (!types) return false
  for (const type of types) {
    if (type === 'Files' || type.startsWith('text/plain')) return true
  }
  return false
}

/**
 * 处理文件放置：从 File 对象解析本地绝对路径，走 preload 读路径载入。
 *
 * File.path 的取舍：Electron 渲染层给拖入的 File 注入非标准 own 属性
 * `path`（绝对路径字符串）。用 Object.prototype.hasOwnProperty.call 探测
 * （而非直接 truthy 读取，避免依赖原型链上的同名访问器），再经全局
 * FileWithPath 声明（src/env.d.ts）收窄类型。取不到路径时——
 * - 不做 FileReader 渲染层直读：roadmap 指定文件载入统一走 preload
 *   （services.readTextFile）读路径，编码与错误处理单点受控；
 * - ZToast 提示改用「打开文件」按钮，并 console.debug 留排查信息。
 *
 * @param side 目标侧：'left' 写 leftText，'right' 写 rightText
 * @param file dataTransfer.files 的第一个文件（多文件拖入只取第一个）
 * @param encoding 解码编码（INT-005）：取当前全局「打开编码」（拖入与
 *        「打开文件」按钮共用同一全局值，调用时求值）
 */
function dropFileInto(side: PaneSide, file: File, encoding: FileEncoding): void {
  const hasOwnPath = Object.prototype.hasOwnProperty.call(file, 'path')
  const path = hasOwnPath ? (file as FileWithPath).path : undefined
  if (typeof path !== 'string' || path.length === 0) {
    console.debug(
      '[useDropLoad] 未能从 dataTransfer.files[0] 取到本地 path 属性' +
        '（纯浏览器 dev 环境，或该 Electron 版本已移除 File.path）',
      file,
    )
    toastError('未能获取文件路径，请使用「打开文件」按钮')
    return
  }
  // 直接覆盖目标侧（交互决策见文件头注释：不弹覆盖确认）；共用
  // useFileLoad 抽出的「读文件 → 错误 Toast」末端，与「打开文件」按钮
  // 的编码策略（当前全局「打开编码」，INT-005）、错误提示完全一致
  readFileIntoStore(side, path, encoding)
}

/**
 * 创建单侧 pane 的拖拽绑定（useDropLoad 内部工厂）。
 *
 * 两侧各自持有独立的深度计数与可见性（相互独立，互不串扰）；仅
 * 「编辑器内部拖拽」标记是共享的（拖拽操作同一时刻只有一处来源）。
 *
 * 返回值用 reactive 包装：模板中 isDragOver 直接作为布尔使用（嵌套在
 * 绑定对象里的 ref 会被 reactive 解包，免写 .value），处理器保持普通
 * 函数可直接作为事件监听器（与 workbenchStore 的 reactive 工厂同款写法）。
 *
 * @param side 绑定所属侧：'left' / 'right'
 * @param getEncoding 取当前全局「打开编码」（INT-005，drop 时求值而非
 *        绑定创建时快照，保证取到选择器最新值）
 */
function createPaneDropBindings(
  side: PaneSide,
  getEncoding: () => FileEncoding,
): PaneDropBindings {
  const isDragOver = ref(false)

  /*
   * dragenter / dragleave 深度计数（depth）：拖拽扫过 pane 时，事件目标
   * 在 pane 的子元素（标题栏 / 编辑器 / 行元素…）之间频繁切换，每次切换
   * 都是「leave 旧目标 → enter 新目标」一对事件（同一任务内先后派发，
   * Vue 在微任务里合并渲染）。逐事件布尔开关会因这对中间态把可见性瞬时
   * 归零再拉起而闪烁；计数器保证只有「真正离开 pane」（leave 后计数归零）
   * 才隐藏覆盖层，子元素间的穿越对计数净效果为零。
   */
  let depth = 0

  /**
   * dragenter（capture）：外部拖入进入 pane（含其任意子元素）时深度 +1。
   * 编辑器内部拖拽直接放行（不显示载入覆盖层，也不做任何干预）。
   */
  function onDragEnter(event: DragEvent): void {
    if (draggingFromEditor) return
    // 与 dragover 一起取消默认行为，向浏览器声明本区域允许放置
    //（MDN：dragenter 与 dragover 都取消默认行为才是完整的「允许放置」）
    event.preventDefault()
    depth += 1
    // 仅文件 / 纯文本拖入显示覆盖层；网页图片等不受支持的拖入不广告「载入」
    if (isSupportedDrag(event)) isDragOver.value = true
  }

  /**
   * dragover（capture）：悬停期间必须持续 preventDefault，浏览器才会在
   * 松开时派发 drop（HTML 拖放规范：不取消 dragover 默认行为即视为
   * 「不允许放置」，drop 根本不会触发——这是拖放生效的前提）。
   * 同时 stopPropagation 接管本次悬停，阻止 CM 内部 dropCursor 在覆盖层
   * 之下再画一个拖放位置光标条。
   */
  function onDragOver(event: DragEvent): void {
    if (draggingFromEditor) return // 放行：CM 的 dropCursor 指示条依赖原生 dragover
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
    event.stopPropagation()
  }

  /**
   * drop（capture）：松开鼠标——capture 先于 CM contentDOM 的内置 drop
   * handler 执行，外部拖入在此整体接管。
   */
  function onDrop(event: DragEvent): void {
    // 编辑器内部发起的选区拖拽：完全放行（同编辑器内移动选区 / 跨编辑器
    // 光标处插入，交给 CodeMirror 原生处理），仅复位覆盖层与标记
    if (draggingFromEditor) {
      draggingFromEditor = false
      depth = 0
      isDragOver.value = false
      return
    }

    /*
     * capture 阶段整体接管外部拖入：
     * - preventDefault：取消浏览器对拖入文件的默认动作（打开 / 导航到该
     *   文件，会把整个 Electron 窗口导航走）；
     * - stopPropagation：拦在 CM 内置 drop handler 之前，阻止其用
     *   FileReader 直读文件插入编辑器（绕过 preload 读路径），或把文本
     *   插入光标处（与「整侧覆盖」的载入语义冲突）。
     */
    event.preventDefault()
    event.stopPropagation()
    depth = 0
    isDragOver.value = false

    const dataTransfer = event.dataTransfer
    if (!dataTransfer) return

    // 1) 文件拖入：只取第一个文件，取本地路径走 preload 读路径（决策见文件头；
    //    编码取当前全局「打开编码」，与「打开文件」按钮一致）
    const file =
      dataTransfer.files && dataTransfer.files.length > 0 ? dataTransfer.files[0] : null
    if (file) {
      dropFileInto(side, file, getEncoding())
      return
    }

    // 2) 文本拖入：无文件且携带纯文本 → 与「粘贴等价」直接覆盖该侧
    //    （drop 阶段 getData 总可用；CM dragstart 设置的 "Text" 类型会被
    //    规范化为 text/plain，但编辑器内部拖拽已在上方放行，不会走到这里）
    const text = dataTransfer.getData('text/plain')
    if (text.length > 0) {
      if (side === 'left') {
        workbenchStore.setLeftText(text)
        // INT-001：内容不再来自文件，清除该侧来源文件名（语言检测回到内容启发式）
        workbenchStore.setLeftFileName('')
      } else {
        workbenchStore.setRightText(text)
        workbenchStore.setRightFileName('')
      }
      return
    }

    // 3) 其余拖拽数据（网页图片、编辑器外部元素拖拽等）不受支持：
    //    已在 drop 入口接管（阻止浏览器默认行为），内容侧静默忽略
    console.debug('[useDropLoad] 忽略不含文件与纯文本的拖拽数据', dataTransfer.types)
  }

  /**
   * dragleave（capture）：离开某个子元素时深度 -1，归零（含钳制负值）才
   * 隐藏覆盖层——子元素间穿越的 leave/enter 成对抵消，不引发闪烁。
   */
  function onDragLeave(): void {
    if (draggingFromEditor) return
    depth -= 1
    // drop 之后浏览器可能对已复位的目标补发一次 dragleave：钳制不为负
    if (depth <= 0) {
      depth = 0
      isDragOver.value = false
    }
  }

  /**
   * dragstart（冒泡，仅观察、不干预）：拖拽源在编辑器内容（.cm-content，
   * CM6 contentDOM 的稳定类名）内 → 标记为编辑器内部拖拽，后续 enter/
   * over/leave/drop 全部放行给 CM 原生行为。绑在冒泡阶段是为了让 CM 自己
   * 的 dragstart handler（设置 inputState.draggedContent 等）先正常完成。
   */
  function onDragStart(event: DragEvent): void {
    const target = event.target
    draggingFromEditor = target instanceof Element && target.closest('.cm-content') !== null
  }

  /** dragend（冒泡）：拖拽结束（取消 / 落点在外部 / 落点在编辑器内）复位标记 */
  function onDragEnd(): void {
    draggingFromEditor = false
  }

  return reactive({
    isDragOver,
    onDragEnter,
    onDragOver,
    onDragLeave,
    onDrop,
    onDragStart,
    onDragEnd,
  })
}

/**
 * 拖拽载入组合式函数（UI-003 主入口）。
 *
 * @param getEncoding 取当前全局「打开编码」（INT-005，App.vue 的
 *        fileEncoding ref 经 getter 传入，drop 时求值；缺省恒为 'utf-8'，
 *        兼容无编码感知的调用方）
 *
 * @returns 左右两侧各自的拖拽绑定（事件处理器 + 覆盖层可见性）。App.vue
 *          把每侧的 enter/over/leave/drop 绑定到 pane 根元素的 capture
 *          阶段、dragstart/dragend 绑定到冒泡阶段（原因见文件头注释），
 *          isDragOver 驱动该侧的拖拽覆盖层显隐。
 */
export function useDropLoad(
  getEncoding: () => FileEncoding = () => 'utf-8',
): { left: PaneDropBindings, right: PaneDropBindings } {
  return {
    left: createPaneDropBindings('left', getEncoding),
    right: createPaneDropBindings('right', getEncoding),
  }
}
