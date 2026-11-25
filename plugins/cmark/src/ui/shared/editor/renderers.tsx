/**
 * Slate 渲染层
 *
 * 所有块类型与行内格式的 DOM 结构都在这里，视觉对齐 V1.0.0。
 * 交互型块（代码块、图片、公式、表格）各自带自己的工具条/菜单。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Editor as SlateEditor, Element as SlateElement, Node, Path, Transforms, Range } from 'slate'
import { ReactEditor, useSlateStatic, type RenderElementProps, type RenderLeafProps } from 'slate-react'
import katex from 'katex'
import type { CMarkElement, LeafFormat } from '../../../core/domain/slate-model'
import { useNotes } from '../../../service/store/notes'
import { notes } from '../../../runtime/legacy-bridge'


/** attachment:<digest> 或工作区相对路径 → 可给 <img src> 用的地址 */
function resolveImage(url: string): string {
  if (!url) return ''
  const bridge = notes() as unknown as { resolveImageUrl?: (s: string) => string }
  try {
    if (bridge?.resolveImageUrl) return bridge.resolveImageUrl(url)
  } catch (e) {}
  return url
}

/* ---------------- 代码块 ---------------- */

const LANGS = [
  ['', '纯文本'],
  ['js', 'JavaScript'],
  ['ts', 'TypeScript'],
  ['jsx', 'JSX'],
  ['tsx', 'TSX'],
  ['json', 'JSON'],
  ['html', 'HTML'],
  ['css', 'CSS'],
  ['scss', 'SCSS'],
  ['python', 'Python'],
  ['java', 'Java'],
  ['csharp', 'C#'],
  ['go', 'Go'],
  ['rust', 'Rust'],
  ['sql', 'SQL'],
  ['bash', 'Shell'],
  ['powershell', 'PowerShell'],
  ['yaml', 'YAML'],
  ['xml', 'XML'],
  ['markdown', 'Markdown'],
  ['diff', 'Diff'],
  ['mermaid', 'Mermaid'],
  ['echarts', 'ECharts'],
] as const

function CodeBlock({ attributes, children, element }: RenderElementProps) {
  const editor = useSlateStatic()
  const el = element as { lang?: string; type: string; children: LeafFormat[] }
  const [copied, setCopied] = useState(false)
  const codeText = el.children.map((c) => c.text).join('')
  const isDiagram = el.lang === 'mermaid' || el.lang === 'echarts'

  const changeLang = useCallback(
    (lang: string) => {
      const path = ReactEditor.findPath(editor, element)
      Transforms.setNodes(editor, { lang } as never, { at: path })
    },
    [editor, element]
  )

  const copy = useCallback(() => {
    const text = el.children.map((c) => c.text).join('')
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1400)
    })
  }, [el.children])

  return (
    <pre {...attributes} className="code-editor" data-lang={el.lang || ''}>
      <div className="code-head" contentEditable={false}>
        <select
          className="code-lang"
          value={el.lang || ''}
          onChange={(e) => changeLang(e.target.value)}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {LANGS.map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
        <button className="code-editor-copy" onClick={copy} type="button" title="复制代码">
          {copied ? '已复制' : '复制'}
        </button>
      </div>
      <code>{children}</code>
      {isDiagram && codeText.trim() ? (
        <div className="diagram-box" contentEditable={false}>
          <Diagram kind={el.lang as 'mermaid' | 'echarts'} code={codeText} />
        </div>
      ) : null}
    </pre>
  )
}

/** 图表预览：mermaid 画流程图/时序图，echarts 用 option JSON 画图 */
function Diagram({ kind, code }: { kind: 'mermaid' | 'echarts'; code: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    let alive = true
    let chart: { dispose: () => void } | null = null
    void (async () => {
      if (!ref.current) return
      try {
        if (kind === 'mermaid') {
          const mermaid = (await import('mermaid')).default
          mermaid.initialize({ startOnLoad: false, theme: 'default', securityLevel: 'loose' })
          const id = 'mmd-' + Math.random().toString(36).slice(2, 9)
          const { svg } = await mermaid.render(id, code)
          if (alive && ref.current) ref.current.innerHTML = svg
        } else {
          const echarts = await import('echarts')
          // 同一 DOM 上重复 init 会报 "already initialized"，先清掉旧实例
          const existing = echarts.getInstanceByDom(ref.current as HTMLDivElement)
          if (existing) existing.dispose()
          const inst = echarts.init(ref.current as HTMLDivElement)
          inst.setOption(JSON.parse(code))
          chart = inst
        }
        if (alive) setErr('')
      } catch (e) {
        if (alive) setErr((e as Error)?.message || '渲染失败')
      }
    })()
    return () => {
      alive = false
      // cleanup 提到外层：之前写在 async IIFE 里，返回值被丢弃，实例从不释放
      if (chart) {
        try { chart.dispose() } catch (e) {}
        chart = null
      }
    }
  }, [kind, code])

  return (
    <>
      <div
        className="diagram-canvas"
        ref={ref}
        style={kind === 'echarts' ? { width: '100%', height: 320 } : undefined}
      />
      {err ? <div className="diagram-err">{err}</div> : null}
    </>
  )
}

/* ---------------- 图片 ---------------- */

function ImageBlock({ attributes, children, element }: RenderElementProps) {
  const editor = useSlateStatic()
  const el = element as { url: string; alt?: string; width?: number }
  const imgRef = useRef<HTMLImageElement>(null)

  const resize = useCallback(
    (deltaX: number) => {
      const path = ReactEditor.findPath(editor, element)
      void path
      // 之前用 document.querySelector 按写死的空 data-image-path 找图，永远拿到 null，
      // 基准恒为 400，第一下手感会突然跳变。改用 ref 直接拿真实宽度。
      const img = imgRef.current
      const base = el.width || (img ? img.naturalWidth || img.clientWidth : 400)
      const next = Math.max(60, Math.round(base + deltaX))
      Transforms.setNodes(editor, { width: next } as never, { at: path })
    },
    [editor, element, el.width]
  )

  return (
    <div {...attributes} className="block-img" data-image-path="">
      <div className="image-wrap" contentEditable={false} style={{ width: el.width ? el.width + 'px' : undefined }}>
        <img ref={imgRef} src={resolveImage(el.url)} alt={el.alt || ''} draggable={false} />
        <span
          className="image-resize"
          onMouseDown={(e) => {
            e.preventDefault()
            const startX = e.clientX
            const onMove = (ev: MouseEvent) => resize(ev.clientX - startX)
            const onUp = () => {
              window.removeEventListener('mousemove', onMove)
              window.removeEventListener('mouseup', onUp)
            }
            window.addEventListener('mousemove', onMove)
            window.addEventListener('mouseup', onUp)
          }}
        />
      </div>
      <span className="image-caption">{el.alt || ''}</span>
      {children}
    </div>
  )
}

/* ---------------- 公式块 ---------------- */

function MathBlock({ attributes, children, element }: RenderElementProps) {
  const el = element as { value: string }
  const ref = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!ref.current) return
    try {
      katex.render(el.value || '', ref.current, { displayMode: true, throwOnError: false })
    } catch (e) {
      if (ref.current) ref.current.textContent = el.value || ''
    }
  }, [el.value])

  return (
    <div {...attributes} className="math-leaf">
      <span className="math-render" contentEditable={false} ref={ref} />
      <span className="math-source">{children}</span>
    </div>
  )
}

/* ---------------- 表格 ---------------- */

function TableCell({ attributes, children, element }: RenderElementProps) {
  const editor = useSlateStatic()
  // 对齐信息存在 table 节点的 align 数组上（GFM 的 :---: / ---: / :---），
  // 这里沿路径往上取，按列索引套到 td 上；否则编辑器里看不出对齐效果
  let align: 'left' | 'center' | 'right' | undefined
  try {
    const path = ReactEditor.findPath(editor, element)
    const tablePath = path.slice(0, path.length - 2)
    const table = Node.get(editor, tablePath) as { align?: string[] }
    const col = path[path.length - 1]
    const a = (table.align || [])[col]
    if (a === 'center') align = 'center'
    else if (a === 'right') align = 'right'
    else if (a === 'left') align = 'left'
  } catch (e) {}
  return (
    <td {...attributes} style={align ? { textAlign: align } : undefined}>
      {children}
    </td>
  )
}

/* ---------------- Element ---------------- */

export function RenderElement(props: RenderElementProps) {
  const el = props.element as CMarkElement

  switch (el.type) {
    case 'heading': {
      // V1.0.0 的标题是 div.h1 … div.h6（CSS 里只有 .h1~.h6 与 h1 的合并选择器，
      // 真正的 ::after 装饰线挂在 class 上），这里保持同样的结构
      const lv = Math.min(6, Math.max(1, el.level || 1))
      return (
        <div {...props.attributes} className={'h' + lv}>
          {props.children}
        </div>
      )
    }
    case 'blockquote':
      return <blockquote {...props.attributes}>{props.children}</blockquote>
    case 'bulleted-list':
      return <ul {...props.attributes}>{props.children}</ul>
    case 'numbered-list':
      return <ol {...props.attributes}>{props.children}</ol>
    case 'list-item': {
      const li = el as { checked?: boolean }
      if (li.checked === undefined) return <li {...props.attributes}>{props.children}</li>
      return (
        <li {...props.attributes} className={'task-list-item' + (li.checked ? ' task-checked' : '')}>
          <TaskCheckbox element={props.element} checked={!!li.checked} />
          {props.children}
        </li>
      )
    }
    case 'table':
      return (
        <table {...props.attributes}>
          <tbody>{props.children}</tbody>
        </table>
      )
    case 'table-row':
      return <tr {...props.attributes}>{props.children}</tr>
    case 'table-cell':
      return <TableCell {...props} />
    case 'codeblock':
      return <CodeBlock {...props} />
    case 'image':
      return <ImageBlock {...props} />
    case 'math':
      return <MathBlock {...props} />
    case 'hr':
      return (
        <div {...props.attributes} className="hr" contentEditable={false}>
          {props.children}
        </div>
      )
    default:
      return <p {...props.attributes}>{props.children}</p>
  }
}

/** 任务复选框：勾选状态写回节点，序列化成 - [x] / - [ ] */
function TaskCheckbox({ element, checked }: { element: CMarkElement; checked: boolean }) {
  const editor = useSlateStatic()
  const locked = useNotes((s) => s.locked)
  const setMessage = useNotes((s) => s.setMessage)
  return (
    <span className="task-list-checkbox" contentEditable={false}>
      <input
        type="checkbox"
        checked={checked}
        disabled={locked}
        onChange={(e) => {
          if (locked) {
            setMessage('该笔记已设为只读', 2000)
            return
          }
          const path = ReactEditor.findPath(editor, element)
          Transforms.setNodes(editor, { checked: e.target.checked } as never, { at: path })
        }}
      />
    </span>
  )
}

/* ---------------- Leaf ---------------- */

export function RenderLeaf({ attributes, children, leaf }: RenderLeafProps) {
  const l = leaf as LeafFormat & { searchHit?: boolean }
  let out = children
  if (l.searchHit) out = <span className="search-hit-mark">{out}</span>
  if (l.bold) out = <strong>{out}</strong>
  if (l.italic) out = <em>{out}</em>
  if (l.underline) out = <u>{out}</u>
  if (l.strike) out = <s>{out}</s>
  if (l.highlight) out = <mark>{out}</mark>
  if (l.code) out = <code>{out}</code>
  if (l.link) {
    out = (
      <a
        href={l.link}
        onClick={(e) => {
          e.preventDefault()
          void notes().openExternal?.(l.link as string)
        }}
        title={l.link}
      >
        {out}
      </a>
    )
  }
  return <span {...attributes}>{out}</span>
}

/* ---------------- 空块占位 ---------------- */

/** 给每个块算出它是不是"当前选中的空块"，用来显示占位提示 */
export function useEmptyBlockInfo() {
  return null
}

void SlateEditor
void SlateElement
void Node
void Path
void Range