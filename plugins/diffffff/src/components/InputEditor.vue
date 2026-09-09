<!--
  InputEditor（UI-001）：双栏输入编辑器组件，左右两侧复用。

  - 基于 CodeMirror 6：行号、焦点行高亮、空态占位、撤销/重做；
  - 唯一数据源是 workbench store：内部编辑经 updateListener → emit 提交，
    外部变更（草稿恢复 / 后续拖入文件、交换两侧）经 watch 全文替换回显；
  - 原「N 字符 · M 行」底部统计条已撤除（本任务起统计上移至 pane 顶部栏
    PaneHeader 左侧，编辑器区域整体让给内容）；
  - 主题色全部消费 main.css / ztools-ui 既有 CSS 变量（见下方 cmTheme 注释），
    不硬编码第二套配色；
  - 语法高亮（INT-001）：经 props.language（App 传入 viewStore.effectiveLanguage，
    auto 时已是检测结果）+ 动态 Compartment 切换编辑器语言扩展 —— 语言变更
    watch 重配，编辑行为（v-model / 统计 / 聚焦 / 撤销历史）不受影响。
-->
<script lang="ts">
/**
 * 模块级共享层：两侧编辑器实例复用的静态扩展与主题。
 *
 * 放在独立 <script> 块（模块作用域）而非 <script setup>（实例作用域）：
 * 两个实例共享同一份 Extension 实例（CM 扩展是不可变描述，可安全复用），
 * EditorView.theme() 也只生成一次样式模块，避免向 <head> 重复注入相同 CSS。
 */
import { history, historyKeymap } from '@codemirror/commands'
import { Compartment, EditorState, type Extension } from '@codemirror/state'
import {
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  placeholder,
} from '@codemirror/view'
import { getLanguageExtension, syntaxHighlightingExtension } from '../core/highlight'

/**
 * 轻量主题（不引入主题包）：全部颜色/字体消费既有 token，
 * 随 ztools-ui 宿主主题（:root / html.dark）自动切换深浅。
 * - 背景      透明 → 透出宿主 --bg-color；
 * - 文字/光标  --text-color / --primary-color（ztools-ui 宿主变量）；
 * - 行号栏    --diff-gutter-bg + --border-color 分隔线（main.css token）；
 * - 排版      --font-mono + --diff-font-size / --diff-line-height（与 diff 视图同源）；
 * - 焦点行    用 color-mix 从 --text-color 派生的中性高亮（不新增主题色）；
 * - 占位      --placeholder-color（ztools-ui 宿主变量）。
 */
const cmTheme = EditorView.theme({
  // 编辑器根：透明背景 + 统一排版（baseTheme 的 dotted #212121 聚焦描边
  // 由下方 '&.cm-focused' 条目覆盖，见 REL-001 注释）
  '&': {
    backgroundColor: 'transparent',
    color: 'var(--text-color)',
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--diff-font-size)',
    height: '100%',
  },
  // REL-001：聚焦可见性 —— 覆盖 baseTheme 的 dotted #212121 聚焦描边
  //（浅色下尚可辨、深色主题下近黑描边不可见），改走宿主 --primary-color，
  // 深浅主题均为可辨的焦点指示（Tab 进入编辑器时的落点可见）
  '&.cm-focused': {
    outline: '1px solid var(--primary-color)',
  },
  // 覆盖 baseTheme 对 .cm-scroller 写死的 monospace 与 1.4 行高，
  // 使行高与后续 diff 视图逐行对齐（--diff-line-height）
  '.cm-scroller': {
    fontFamily: 'var(--font-mono)',
    lineHeight: 'var(--diff-line-height)',
  },
  '.cm-content': {
    padding: '8px 0',
    caretColor: 'var(--primary-color)',
  },
  '.cm-line': {
    padding: '0 12px',
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: 'var(--primary-color)',
  },
  '.cm-gutters': {
    backgroundColor: 'var(--diff-gutter-bg)',
    color: 'var(--text-color)',
    borderRight: '1px solid var(--border-color)',
  },
  '.cm-lineNumbers .cm-gutterElement': {
    color: 'color-mix(in srgb, var(--text-color) 55%, transparent)',
    padding: '0 8px 0 6px',
    minWidth: '28px',
  },
  '.cm-activeLine': {
    backgroundColor: 'color-mix(in srgb, var(--text-color) 7%, transparent)',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'color-mix(in srgb, var(--text-color) 12%, transparent)',
  },
  '.cm-placeholder': {
    color: 'var(--placeholder-color)',
  },
})

/**
 * 静态扩展集（两侧共享同一实例）：
 * - lineNumbers：行号（UI-001 要求）；
 * - highlightActiveLine + highlightActiveLineGutter：焦点行高亮（均来自 @codemirror/view）；
 * - history + historyKeymap：撤销/重做（⌘/Ctrl+Z 等，编辑器基础体验；
 *   @codemirror/commands 已随 FND-002 安装）；
 * - syntaxHighlightingExtension（INT-001）：tok-* class 型高亮样式（颜色经
 *   main.css 的 .tok-* / --syntax-* 承载，与结果视图同一色板）—— 无语言
 *   （compartment 为空）时无效果，有语言时与语言 compartment 配合产出语法色；
 * - 不含 EditorView.lineWrapping：输入态不换行——行号与物理行 1:1 对应、
 *   长行横向滚动；它独立于 UI-005 结果态的「换行」开关（结果态是渲染层行为）。
 */
const sharedExtensions: Extension[] = [
  lineNumbers(),
  highlightActiveLineGutter(),
  highlightActiveLine(),
  history(),
  keymap.of(historyKeymap),
  syntaxHighlightingExtension,
  cmTheme,
]
</script>

<script setup lang="ts">
/**
 * 组件实例层：props/emits、双向绑定、统计条与生命周期。
 */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

/** 组件 props */
interface Props {
  /** 双向绑定的文本（唯一数据源是 workbench store） */
  modelValue: string
  /** 空文档占位提示（CodeMirror placeholder 扩展） */
  placeholder?: string
  /** 无障碍标签：写入编辑器 contentDOM 的 aria-label（如「原始文本」/「更改后文本」） */
  label?: string
  /** 所属侧别：写入根节点 data-side，供后续单侧能力（拖入/交换/合并箭头）按侧定位 */
  side: 'left' | 'right'
  /**
   * 编辑器语言（INT-001）：viewStore.LANGUAGE_OPTIONS 口径的语言 id。
   * 'plaintext' / 未知语言 = 无语法高亮；变更时经动态 Compartment 重配
   * （auto 已由 App 侧解析为检测结果，组件内不做二次检测）。
   */
  language?: string
}

const props = withDefaults(defineProps<Props>(), {
  placeholder: '粘贴或输入文本，或拖入文件',
  label: '',
  // INT-001：默认无语言（纯文本，无语法高亮）；App 传入 viewStore.effectiveLanguage
  language: 'plaintext',
})

/** 内部编辑 → 提交 store 的出口（App.vue 以 v-model 绑定 store 字段） */
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

/** CodeMirror 挂载宿主元素 */
const editorHost = ref<HTMLDivElement | null>(null)

/**
 * 语言 compartment（INT-001）：语言扩展的动态换装槽。每实例独立持有
 * （compartment 的效果只作用于所属 EditorState），onMounted 以初始语言
 * 装配、props.language 变化时经 watch 重配；编辑行为（v-model / 统计 /
 * 聚焦 / 撤销历史）不受重配影响 —— reconfigure 是纯配置事务，不改文档。
 */
const languageCompartment = new Compartment()

/** EditorView 实例（onMounted 创建，onBeforeUnmount 销毁） */
let view: EditorView | null = null

/**
 * 外部 → 内部全文替换进行中的标记：
 * dispatch 是同步的，updateListener 会在 dispatch 内同步触发；
 * 打标记把「外部回显」与「用户编辑」区分开，避免回显被再次 emit 形成
 * emit → store → props → emit 的多余回环。
 */
let applyingExternal = false

/**
 * 聚焦编辑器（defineExpose 给父组件）：
 * FND-005 聚焦链路的落点——onPluginEnter → App.focusLeftEditor → 本方法 → EditorView.focus()。
 */
function focus(): void {
  view?.focus()
}

/**
 * 聚焦并定位到指定行（defineExpose 给父组件，UI-011 结果态点击编辑用）：
 * 把光标锚点放到第 lineNo 行（1-based）行首，随事务 scrollIntoView 滚动到
 * 可见后聚焦。纯选区事务（无 doc 变更）：不触发 updateListener 的 emit 路径
 * （updateListener 只认 docChanged），也不进入撤销历史。
 *
 * 定位精度取舍：lineNo 是「run() 落下结果时」的行号 —— 文本自此未变（刚进入
 * 保留编辑态 / 实时对比已刷新结果）时定位精确；用户已改动文本而结果未刷新
 * （实时关闭）时行号可能漂移，按钳制后的最近合法行近似定位（1-based 越界
 * 钳到首/末行），不保证行内容对应 —— 精确定位需要先重算结果，与「返回结果
 * 不重算」的状态机语义冲突，故接受近似。
 */
function focusLine(lineNo: number): void {
  if (view === null) return
  const doc = view.state.doc
  const line = doc.line(Math.min(Math.max(1, Math.round(lineNo)), doc.lines))
  view.dispatch({
    selection: { anchor: line.from },
    scrollIntoView: true,
  })
  view.focus()
}

defineExpose({ focus, focusLine })

onMounted(() => {
  if (!editorHost.value) return
  const state = EditorState.create({
    // 挂载时的 props.modelValue 即初始文档（草稿恢复发生在 App.onMounted，
    // 晚于本组件挂载，后续变化走下方 watch 回显，两个时序均覆盖）
    doc: props.modelValue,
    extensions: [
      ...sharedExtensions,
      // INT-001：语言扩展（动态 compartment，变更经下方 watch 重配；
      // plaintext / 未注册语言 getLanguageExtension 返回 null → 空扩展）
      languageCompartment.of(getLanguageExtension(props.language) ?? []),
      // 空态占位（placeholder 扩展来自 @codemirror/view）
      placeholder(props.placeholder),
      // contentDOM 无障碍名。placeholder / label 均为挂载时读取：
      // 本应用中二者是每侧固定的静态文案，无运行期变更场景（不做 Compartment 动态换装）
      props.label ? EditorView.contentAttributes.of({ 'aria-label': props.label }) : [],
      // 内部编辑 → 提交 store：每个 docChanged 事务 emit 一次最新全文。
      // 不加防抖：CM 事务本身已是输入粒度的天然合批（粘贴/撤销为单事务），
      // store 是内存 reactive 写入，逐事务提交开销可忽略。
      EditorView.updateListener.of((update) => {
        if (!update.docChanged) return
        if (applyingExternal) return // 外部回显，非用户编辑
        emit('update:modelValue', update.state.doc.toString())
      }),
    ],
  })
  view = new EditorView({ state, parent: editorHost.value })
})

onBeforeUnmount(() => {
  // 释放 EditorView（样式观察器、DOM、插件状态），HMR 与组件卸载均安全
  view?.destroy()
  view = null
})

/*
 * 语言变更（INT-001）：props.language 变化 → 经语言 compartment 重配编辑器
 * 高亮。纯配置事务（无 doc 变更）：不触发 updateListener 的 emit 路径、
 * 不进入撤销历史、光标与选区保持不动 —— 编辑行为不受影响。
 */
watch(
  () => props.language ?? 'plaintext',
  (lang) => {
    if (view === null) return
    const next = getLanguageExtension(lang)
    if (next !== null) {
      view.dispatch({ effects: languageCompartment.reconfigure(next) })
    } else {
      view.dispatch({ effects: languageCompartment.reconfigure([]) })
    }
  },
)

watch(
  () => props.modelValue,
  (value) => {
    if (!view) return
    const current = view.state.doc.toString()
    // 相等短路：内部编辑的 emit → store → props 回环、以及外部重复赋值
    // （如草稿恢复写入相同内容）时不再 dispatch，避免全文替换导致光标与滚动位置重置。
    // （doc.toString() 每次变更 O(n)，与全文替换同量级，可接受）
    if (value === current) return
    applyingExternal = true
    try {
      // 全文替换：选区随 changes 自动映射（映射到插入点附近），不强制重置到文档头
      view.dispatch({ changes: { from: 0, to: current.length, insert: value } })
    } finally {
      applyingExternal = false
    }
  },
)
</script>

<template>
  <div class="input-editor" :data-side="side">
    <!-- CodeMirror EditorView 挂载点：内部 .cm-scroller 自滚动，不撑破外壳 -->
    <div ref="editorHost" class="input-editor-host"></div>
  </div>
</template>

<style scoped>
/*
 * 组件布局：纵向 flex 填满宿主（App.vue 的 .pane-body）——
 * 编辑区 flex:1 内部滚动（.cm-scroller）。
 */
.input-editor {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.input-editor-host {
  flex: 1 1 auto;
  min-height: 0;
}
</style>
