/**
 * 表格操作栏（对齐 V1.0.0 的做法）
 *
 * V1.0.0 是在 <table><caption> 里渲染一排图标按钮，caption 天然位于表格顶部、
 * 不参与表格布局、不遮挡内容，也不用绝对定位，所以永远不会跟富文本工具栏打架。
 * 这里照搬这个结构，按钮顺序也一致：
 *   上方插入行 / 下方插入行 / 删除行 | 左侧插入列 / 右侧插入列 / 删除列 | 左对齐 / 居中 / 右对齐 | 删除整个表格
 */
import { Fragment, useEffect, useRef, useState } from 'react'
import { MarkdownPlugin } from '@platejs/markdown'
import { Code2, Save } from 'lucide-react'
import { TablePlugin } from '@platejs/table/react'
import { getTableAbove } from '@platejs/table'
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDownToLine,
  ArrowLeftToLine,
  ArrowRightToLine,
  ArrowUpToLine,
  Columns3,
  Rows3,
  Trash2,
} from 'lucide-react'
import { useEditorPlugin } from 'platejs/react'


/** 把 Markdown 表格文本解析成 Plate 表格节点；失败返回 null */
function parseMarkdownTable(md: string): unknown | null {
  const lines = String(md || '')
    .replace(/\r/g, '')
    .split('\n')
    .filter((l) => l.trim())
  if (lines.length < 2) return null
  const split = (line: string) =>
    line
      .trim()
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((c) => c.trim())
  const header = split(lines[0])
  if (!header.length) return null
  const isSep = /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[1]) && lines[1].includes('-')
  const sepCells = isSep ? split(lines[1]) : []
  // 分隔行里的冒号就是列对齐：:--- 左、:---: 居中、---: 右
  const aligns = sepCells.map((c) => {
    const l = c.startsWith(':')
    const r = c.endsWith(':')
    return l && r ? 'center' : r ? 'right' : l ? 'left' : undefined
  })
  const bodyLines = isSep ? lines.slice(2) : lines.slice(1)
  const rows = [header, ...bodyLines.map(split)]
  const cols = Math.max(...rows.map((r) => r.length))
  return {
    type: 'table',
    // 列对齐必须挂在 table 节点上（渲染 + 序列化都读这个数组），单元格上的 align 只是即时样式
    ...(aligns.some(Boolean) ? { align: aligns.map((a) => a ?? null) } : {}),
    children: rows.map((cells, ri) => ({
      type: 'tr',
      children: Array.from({ length: cols }).map((_, ci) => ({
        type: ri === 0 ? 'th' : 'td',
        ...(aligns[ci] ? { align: aligns[ci] } : {}),
        children: [{ type: 'p', children: [{ text: cells[ci] ?? '' }] }],
      })),
    })),
  }
}

type Align = 'left' | 'center' | 'right'

/** 同一时刻只允许开一个表格代码浮层：打开新的先关掉旧的 */
let activeCodeClose: (() => void) | null = null

export function TableToolbar({ tableNode, onOpenChange }: { tableNode?: unknown; onOpenChange?: (open: boolean) => void }) {
  const { editor, tf } = useEditorPlugin(TablePlugin)
  // 查看表格 Markdown 源码：浮层贴在表格上方，不写进文档
  const [codeOpen, setCodeOpen] = useState(false)
  const [code, setCode] = useState('')
  const [edited, setEdited] = useState(false)
  const [errText, setErrText] = useState('')

  const codeAreaRef = useRef<HTMLTextAreaElement | null>(null)

  /** 把编辑后的 Markdown 写回表格节点（失败就提示，不动文档） */
  const applyCode = () => {
    const res = getTableAbove(editor as never) as [unknown, number[]] | undefined
    const path = res ? res[1] : null
    const node = parseMarkdownTable(code)
    if (!node) {
      setErrText('解析失败：至少要两行，第一行是表头，格式 | a | b |')
      return
    }
    if (!path) {
      setErrText('没有定位到表格，请先把光标放到表格里')
      return
    }
    try {
      editor.tf.removeNodes({ at: path })
      editor.tf.insertNodes(node as never, { at: path })
      setErrText('')
      setEdited(false)
      // 保存后保持展开，方便继续改；dirty 清掉后保存按钮自动恢复常态
    } catch (e) {
      setErrText('写回失败：' + ((e as Error)?.message || ''))
    }
  }

  const closeCode = () => {
    setCodeOpen(false)
    try {
      onOpenChange?.(false)
    } catch (e) {}
    if (activeCodeClose === closeCode) activeCodeClose = null
  }



  // 文本域高度跟随内容：表格代码通常就几行，让用户拖高度太别扭。
  // 超过视口 60% 才出现滚动条。
  useEffect(() => {
    if (!codeOpen) return
    const ta = codeAreaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    const max = Math.max(120, Math.round(window.innerHeight * 0.6))
    const h = Math.min(ta.scrollHeight + 2, max)
    ta.style.height = h + 'px'
    ta.style.overflowY = ta.scrollHeight + 2 > max ? 'auto' : 'hidden'
  }, [code, codeOpen])

  const toggleCode = () => {
    if (codeOpen) {
      closeCode()
      return
    }
    if (activeCodeClose) {
      try {
        activeCodeClose()
      } catch (e) {}
      activeCodeClose = null
    }

    // 取源码：任何一步失败都要把原因显示出来，不能点完没反应
    let md = ''
    try {
      const res = getTableAbove(editor as never) as [unknown, number[]] | undefined
      const node = tableNode || (res ? res[0] : undefined)
      if (!node) {
        md = '（没有定位到表格，请先把光标放到表格里再点）'
      } else {
        md = String(editor.getApi(MarkdownPlugin).markdown.serialize({ value: [node] as never }) || '')
        if (!md.trim()) md = '（这个表格没有可序列化的内容）'
      }
    } catch (e) {
      const msg = e && (e as Error).message ? (e as Error).message : '未知错误'
      md = '（读取表格代码失败：' + msg + '）'
      console.error('[table-code]', e)
    }
    setCode(md.replace(/\n+$/, ''))
    setCodeOpen(true)
    try {
      onOpenChange?.(true)
    } catch (e) {}
    activeCodeClose = closeCode
  }


  /** 把整列所有单元格的 align 设成同一个值（V1.0.0 也是按列设置） */
  const setColumnAlign = (align: Align) => {
    try {
      const res = getTableAbove(editor as never) as [unknown, number[]] | undefined
      const sel = editor.selection
      if (!res || !sel) return
      const [tableNode, tablePath] = res
      const rel = sel.anchor.path.slice(tablePath.length)
      const colIdx = rel[1]
      if (typeof colIdx !== 'number') return
      const rows = ((tableNode as { children?: unknown[] }).children || []).length
      const t = tableNode as { align?: Array<string | null> }
      // 关键：渲染（renderers.tsx）和 markdown 序列化都只认 table 节点上的 align 数组。
      // 以前只把 align 写到每个单元格上，看着当场生效，切换文件就还原。
      const aligns = Array.isArray(t.align) ? [...t.align] : []
      aligns[colIdx] = align
      try {
        editor.tf.setNodes({ align: aligns } as never, { at: tablePath })
      } catch (e) {}
      for (let r = 0; r < rows; r++) {
        try {
          editor.tf.setNodes({ align } as never, { at: [...tablePath, r, colIdx] })
        } catch (e) {
          /* 该行没有这一列（合并表头等情况），跳过 */
        }
      }
    } catch (e) {
      console.error('[table-align]', e)
    }
  }

  const items: Array<{ k: string; tip: string; icon: React.ReactNode; run: () => void; sep?: boolean; danger?: boolean; cls?: string }> = [
    {
      k: 'rowUp',
      tip: '上方插入行',
      icon: <ArrowUpToLine size={15} strokeWidth={1.8} />,
      run: () => tf.insert.tableRow({ before: true }),
    },
    { k: 'rowDown', tip: '下方插入行', icon: <ArrowDownToLine size={15} strokeWidth={1.8} />, run: () => tf.insert.tableRow() },
    { k: 'delRow', tip: '删除行', icon: <Rows3 size={15} strokeWidth={1.8} />, run: () => tf.remove.tableRow(), danger: true },
    {
      k: 'colLeft',
      tip: '左侧插入列',
      icon: <ArrowLeftToLine size={15} strokeWidth={1.8} />,
      run: () => tf.insert.tableColumn({ before: true }),
    },
    { k: 'colRight', tip: '右侧插入列', icon: <ArrowRightToLine size={15} strokeWidth={1.8} />, run: () => tf.insert.tableColumn() },
    { k: 'delCol', tip: '删除列', icon: <Columns3 size={15} strokeWidth={1.8} />, run: () => tf.remove.tableColumn(), sep: true, danger: true },
    { k: 'alignLeft', tip: '列左对齐', icon: <AlignLeft size={15} strokeWidth={1.8} />, run: () => setColumnAlign('left') },
    { k: 'alignCenter', tip: '列居中对齐', icon: <AlignCenter size={15} strokeWidth={1.8} />, run: () => setColumnAlign('center') },
    { k: 'alignRight', tip: '列右对齐', icon: <AlignRight size={15} strokeWidth={1.8} />, run: () => setColumnAlign('right'), sep: true },
    { k: 'delTable', tip: '删除整个表格', icon: <Trash2 size={15} strokeWidth={1.8} />, run: () => tf.remove.table(), danger: true },
    // 保存按钮只在「浮层展开且内容有改动」时出现，紧挨在「显示代码」左边
    ...(codeOpen && edited
      ? [
          {
            k: 'saveCode',
            tip: '保存表格代码',
            icon: <Save size={15} strokeWidth={1.8} />,
            run: () => {},
            cls: 'tc-right is-dirty',
          },
        ]
      : []),
    {
      k: 'viewCode',
      tip: '查看/隐藏表格代码',
      icon: <Code2 size={15} strokeWidth={1.8} />,
      run: () => {},
      cls: 'tc-right' + (codeOpen ? ' is-on' : ''),
    },
  ]

  return (
    <Fragment>
      {/* 浮层直接挂在操作栏内部（absolute 定位在它下方）：
          这样操作栏 pinned 时两者一起动，视觉上是一个整体 */}
      {codeOpen ? (
        <div
          className="table-code-panel"
          contentEditable={false}
          onMouseDown={(ev) => {
            ev.stopPropagation()
            const t = ev.target as HTMLElement
            if (t && !t.closest('textarea, input, button')) ev.preventDefault()
          }}
          onMouseUp={(ev) => ev.stopPropagation()}
          onPointerDown={(ev) => ev.stopPropagation()}
          onClick={(ev) => ev.stopPropagation()}
          onDoubleClick={(ev) => ev.stopPropagation()}
          onKeyDown={(ev) => ev.stopPropagation()}
        >
          <textarea
            ref={codeAreaRef}
            className="table-code-body"
            value={code}
            spellCheck={false}
            onChange={(ev) => {
              setCode(ev.target.value)
              setEdited(true)
            }}
          />
          {errText ? <div className="table-code-err">{errText}</div> : null}
        </div>
      ) : null}
      {items.map((it, idx) => {
        // 靠右的按钮组：只有组内第一个吃 margin-left:auto，否则两个 auto 会平分空隙
        const firstRight = it.cls?.includes('tc-right') && items.findIndex((x) => x.cls?.includes('tc-right')) === idx
        return (
        <Fragment key={it.k}>
          <button
            type="button"
            title={it.tip}
            className={'tc-btn' + (it.danger ? ' danger' : '') + (it.cls ? ' ' + it.cls : '') + (firstRight ? ' tc-right-first' : '')}
            onMouseDown={(e) => e.preventDefault()}
            onClick={(ev) => {
              if (it.k === 'viewCode') {
                ev.preventDefault()
                try {
                  toggleCode()
                } catch (err) {
                  console.error('[table-toolbar] viewCode', err)
                }
                return
              }
              if (it.k === 'saveCode') {
                ev.preventDefault()
                try {
                  applyCode()
                } catch (err) {
                  console.error('[table-toolbar] saveCode', err)
                }
                return
              }
              try {
                it.run()
                editor.tf.focus()
              } catch (err) {
                console.error('[table-toolbar]', it.k, err)
              }
            }}
          >
            {it.icon}
          </button>
          {/* 空 span 是分组分隔，::after 画竖线，规则来自 V1.0.0 */}
          {it.sep ? <span /> : null}
        </Fragment>
        )
      })}
    </Fragment>
  )
}
