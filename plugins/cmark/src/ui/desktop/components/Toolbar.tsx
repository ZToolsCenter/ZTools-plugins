import { useState } from 'react'
import {
  Bold,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Highlighter,
  Image as ImageIcon,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  ListTodo,
  Minus,
  Quote,
  Sigma,
  Sparkles,
  SquareCode,
  SquareFunction,
  Strikethrough,
  Table,
  Underline,
} from 'lucide-react'

import { PromptDialog } from '../../shared/components/Dialogs'
import { useNotes } from '../../../service/store/notes'
import { notes } from '../../../runtime/legacy-bridge'

/**
 * 图标统一用 lucide（业界标准的一套富文本图标），不再自绘路径。
 * 24 网格缩到 15px 显示仍然清晰，线条比自绘的 16 网格细，显得更精致。
 */
const ico = { size: 15, strokeWidth: 1.8, absoluteStrokeWidth: false } as const

type Btn = {
  key: string
  title: string
  node: React.ReactNode
  run: () => void
}

export function Toolbar() {
  const api = useNotes((s) => s.editorApi)
  const sourceMode = useNotes((s) => s.sourceMode)
  const setMessage = useNotes((s) => s.setMessage)
  const marks = useNotes((s) => s.activeMarks)
  const block = useNotes((s) => s.activeBlock)
  const hidden = useNotes((s) => s.toolbarHidden)
  const setAiOpen = useNotes((s) => s.setAiOpen)
  const [linkOpen, setLinkOpen] = useState(false)

  const mark =
    (m: 'bold' | 'italic' | 'code' | 'strike' | 'highlight' | 'underline') => () =>
      api?.toggleMark(m)
  const blk =
    (k: 'paragraph' | 'blockquote' | 'bulleted-list' | 'numbered-list' | 'task-list') => () =>
      api?.toggleBlock(k)
  const head = (level: 1 | 2 | 3) => () => api?.toggleBlock('heading', level)
  const node = (k: 'codeblock' | 'table' | 'hr' | 'math') => () => api?.insertNode(k)

  const groups: Btn[][] = [
    [
      { key: 'ai', title: 'AI 生成', node: <Sparkles {...ico} />, run: () => setAiOpen(true) },
      { key: 'codeblock', title: '插入代码块 Ctrl+Shift+K', node: <SquareCode {...ico} />, run: node('codeblock') },
      { key: 'table', title: '插入表格 Ctrl+T', node: <Table {...ico} />, run: node('table') },
      {
        key: 'image',
        title: '插入图片文件',
        node: <ImageIcon {...ico} />,
        run: () => {
          // 必须用宿主对话框：渲染进程的 <input type="file"> 会把插件窗口挤到后台，
          // 文件框一关就找不到编辑器了
          const picked = notes().pickImageFile?.()
          if (!picked || !picked.ok || !picked.path) {
            if (picked && picked.canceled) return
            setMessage(picked?.message || '无法打开文件选择器', 2400)
            return
          }
          const r = notes().saveImageToWorkspace?.(picked.path, undefined, useNotes.getState().currentRel) as
            | { ok: boolean; rel?: string; message?: string }
            | undefined
          if (!r || !r.ok || !r.rel) {
            setMessage(r?.message || '图片插入失败', 2400)
            return
          }
          const name = String(picked.path).split(/[\\/]/).pop() || ''
          api?.insertImage(r.rel, name.replace(/\.[^.]+$/, ''))
        },
      },
    ],
    [
      { key: 'ol', title: '有序列表 Ctrl+Shift+[', node: <ListOrdered {...ico} />, run: blk('numbered-list') },
      { key: 'ul', title: '无序列表 Ctrl+Shift+]', node: <List {...ico} />, run: blk('bulleted-list') },
      { key: 'task', title: '任务列表 Ctrl+Shift+O', node: <ListTodo {...ico} />, run: blk('task-list') },
      { key: 'quote', title: '引用 Ctrl+Shift+Q', node: <Quote {...ico} />, run: blk('blockquote') },
    ],
    [
      { key: 'h1', title: '一级标题 Ctrl+1', node: <Heading1 {...ico} />, run: head(1) },
      { key: 'h2', title: '二级标题 Ctrl+2', node: <Heading2 {...ico} />, run: head(2) },
      { key: 'h3', title: '三级标题 Ctrl+3', node: <Heading3 {...ico} />, run: head(3) },
      { key: 'hr', title: '分割线', node: <Minus {...ico} />, run: node('hr') },
      {
        key: 'link',
        title: '超链接 Ctrl+K',
        node: <LinkIcon {...ico} />,
        run: () => setLinkOpen(true),
      },
      { key: 'mathBlock', title: '公式块', node: <Sigma {...ico} />, run: node('math') },
      {
        key: 'mathInline',
        title: '内联公式',
        node: <SquareFunction {...ico} />,
        run: () => api?.insertText('$$'),
      },
    ],
    [
      { key: 'bold', title: '加粗 Ctrl+B', node: <Bold {...ico} />, run: mark('bold') },
      { key: 'italic', title: '斜体 Ctrl+I', node: <Italic {...ico} />, run: mark('italic') },
      { key: 'underline', title: '下划线 Ctrl+U', node: <Underline {...ico} />, run: mark('underline') },
      { key: 'code', title: '内联代码', node: <Code {...ico} />, run: mark('code') },
      { key: 'strike', title: '删除线', node: <Strikethrough {...ico} />, run: mark('strike') },
      { key: 'highlight', title: '高亮', node: <Highlighter {...ico} />, run: mark('highlight') },
    ],
  ]

  const isActive = (key: string): boolean => {
    switch (key) {
      case 'bold':
      case 'italic':
      case 'underline':
      case 'code':
      case 'strike':
      case 'highlight':
      case 'link':
        return !!marks[key]
      case 'h1':
        return block.type === 'heading' && block.level === 1
      case 'h2':
        return block.type === 'heading' && block.level === 2
      case 'h3':
        return block.type === 'heading' && block.level === 3
      case 'ol':
        return block.type === 'numbered-list'
      case 'ul':
        return block.type === 'bulleted-list'
      case 'task':
        return block.type === 'list-item' && block.checked !== undefined
      case 'quote':
        return block.type === 'blockquote'
      case 'codeblock':
        return block.type === 'codeblock'
      case 'mathBlock':
        return block.type === 'math'
      default:
        return false
    }
  }

  if (hidden) return null

  return (
    <>
      {linkOpen && (
        <PromptDialog
          title="插入链接"
          defaultValue="https://"
          placeholder="https://"
          maxLength={2048}
          onSubmit={(v) => {
            setLinkOpen(false)
            const href = String(v || '').trim()
            if (href) api?.setLink(href)
          }}
          onCancel={() => setLinkOpen(false)}
        />
      )}
    <div
      className="editor-toolbar"
      title={sourceMode ? '源码模式下为纯文本编辑，格式化按钮不可用' : undefined}
    >
      {groups.map((g, gi) => (
        <div className="tb-group" key={gi}>
          {gi > 0 && <span className="tb-sep" />}
          {g.map((b) => (
            <button
              key={b.key}
              className={'tb-btn' + (isActive(b.key) ? ' is-on' : '')}
              title={b.title}
              disabled={!api || sourceMode}
              onMouseDown={(e) => e.preventDefault()}
              onClick={b.run}
            >
              {b.node}
            </button>
          ))}
        </div>
      ))}
    </div>
    </>
  )
}
