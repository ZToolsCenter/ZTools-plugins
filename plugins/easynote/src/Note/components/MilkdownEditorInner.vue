<template>
  <Milkdown />
</template>

<script setup lang="ts">
import { Milkdown, useEditor } from '@milkdown/vue'
import { Editor, rootCtx, defaultValueCtx, editorViewOptionsCtx } from '@milkdown/kit/core'
import { $prose } from '@milkdown/kit/utils'
import { DOMParser as PMDOMParser, Fragment, Slice } from '@milkdown/prose/model'
import { Plugin, PluginKey, TextSelection } from '@milkdown/prose/state'
import { commonmark } from '@milkdown/kit/preset/commonmark'
import { history } from '@milkdown/kit/plugin/history'
import { nord } from '@milkdown/theme-nord'
import '@milkdown/theme-nord/style.css'
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener'

const props = defineProps<{ modelValue: string }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: string): void }>()

// 粘贴后若文档末尾是代码块，自动补一个空段落：否则代码块贴在末尾时下方没有可落点，
// 用户没法继续写内容（就是「粘贴代码后出不来」的直接成因之一）。
// 只对粘贴事务生效，避免影响普通编辑（否则块尾空段落会变成删不掉的幽灵节点）。
const trailingParagraph = $prose(
  () =>
    new Plugin({
      key: new PluginKey('easynote-trailing-paragraph'),
      appendTransaction: (trs, _oldState, newState) => {
        if (!trs.some((tr) => tr.getMeta('uiEvent') === 'paste')) return null
        const last = newState.doc.lastChild
        if (!last || last.type.name !== 'code_block') return null
        return newState.tr.insert(newState.doc.content.size, newState.schema.nodes.paragraph.create())
      }
    })
)

/** 在代码块下方新建段落并把光标移进去；deleteTrailingNewline 为 true 时顺带吃掉块尾的空行 */
function exitCodeBlock(view: import('@milkdown/prose/view').EditorView, deleteTrailingNewline: boolean) {
  const { state } = view
  const { $from } = state.selection
  const tr = deleteTrailingNewline ? state.tr.delete($from.pos - 1, $from.pos) : state.tr
  // 删了换行符的话，块尾位置整体前移 1，需要经 mapping 换算
  const pos = deleteTrailingNewline ? tr.mapping.map($from.after()) : $from.after()
  tr.insert(pos, state.schema.nodes.paragraph.create())
  tr.setSelection(TextSelection.near(tr.doc.resolve(pos + 1))).scrollIntoView()
  view.dispatch(tr)
}

// useEditor 必须在 MilkdownProvider 的子组件中调用（inject provider 提供的 context）。
// 回调返回「未 create 的 Editor」，由 Milkdown 组件内部（useGetEditor）负责 create()。
useEditor((root) =>
  Editor.make()
    .config(nord)
    .config((ctx) => {
      ctx.set(rootCtx, root)
      ctx.set(defaultValueCtx, props.modelValue || '')
      // 纯文本粘贴保结构：单换行→硬换行，k 个连续换行→段落边界 + (k-1) 个空段落。
      // ProseMirror 默认把每个 \n 都拆成独立段落，贴 4 行文本会变成 4 个段落（序列化后行间多空行）。
      ctx.update(editorViewOptionsCtx, (prev) => ({
        ...prev,
        clipboardTextParser: (text, $context) => {
          const schema = $context.doc.type.schema
          // 代码块内粘贴：作为纯文本插入并保留换行。
          // 默认解析出的是「段落切片」，塞进代码块这种只吃纯文本的节点时换行会丢。
          if ($context.parent.type.name === 'code_block') {
            return new Slice(Fragment.from(schema.text(text.replace(/\r\n?/g, '\n'))), 0, 0)
          }
          const dom = document.createElement('div')
          let p: HTMLParagraphElement | null = null
          let pending = 0
          for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
            if (!p) {
              if (!line) continue // 开头的空行忽略
              p = document.createElement('p')
              p.appendChild(document.createTextNode(line))
              dom.appendChild(p)
              continue
            }
            if (!line) {
              pending++
              continue
            }
            // 本行与前一行之间共 k = pending + 1 个换行
            const k = pending + 1
            if (k === 1) {
              p.appendChild(document.createElement('br'))
            } else {
              for (let i = 0; i < k - 1; i++) dom.appendChild(document.createElement('p'))
              p = document.createElement('p')
              dom.appendChild(p)
            }
            pending = 0
            p.appendChild(document.createTextNode(line))
          }
          return PMDOMParser.fromSchema(schema).parseSlice(dom)
        },
        // 代码块跳出：编辑器键位链里没有任何「从代码块出来」的绑定（Enter 被默认的
        // newlineInCodeBlock 永远截胡，连 Mod-Enter 也是），这里用直接 view props（优先级最高）
        // 补上两条出路；返回 false 时继续走原有键位链，不影响其它行为。
        handleKeyDown: (view, event) => {
          const { state } = view
          const { selection } = state
          if (!(selection instanceof TextSelection) || !selection.empty) return false
          const { $from } = selection
          if ($from.parent.type.name !== 'code_block') return false

          // Ctrl/Cmd+Enter：在代码块任意位置跳出，下方新建段落
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            exitCodeBlock(view, false)
            return true
          }

          // Enter：光标在块尾的空行上时跳出（其余情况维持默认的块内换行）
          if (event.key === 'Enter' && !event.shiftKey) {
            const parent = $from.parent
            if ($from.parentOffset === parent.content.size && parent.textContent.endsWith('\n')) {
              exitCodeBlock(view, true)
              return true
            }
          }

          return false
        }
      }))
      ctx.get(listenerCtx).markdownUpdated((_ctx, markdown) => {
        if (markdown !== props.modelValue) emit('update:modelValue', markdown)
      })
    })
    .use(commonmark)
    .use(history) // 撤销/重做历史（Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z）：commonmark 预设不含 history，不加载则 Ctrl+Z 完全无效
    .use(trailingParagraph)
    .use(listener)
)
</script>
