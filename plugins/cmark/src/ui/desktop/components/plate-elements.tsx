/**
 * Plate 的元素 / 叶子渲染组件
 *
 * 这里刻意不用 PlateElement 包装，而是直接渲染原生元素并把 props.attributes 挂上：
 *   PlateElement 会把 DOM 属性限制在它的白名单内（contentEditable / href 都不放行），
 *   而我们的结构需要这些属性。
 *
 * 编辑行为（选区、拖拽、快捷键）由 Plate 插件负责，这里只管 DOM 结构与 class。
 * class 命名沿用项目既有约定（.h1 / .p / .code-editor / .block-img ...），
 * 这样 app.css 里那套样式可以直接复用。
 */
import { KEYS } from 'platejs'
import type { PlateElementProps, PlateLeafProps } from 'platejs/react'
import katex from 'katex'
import { Diagram } from './plate-diagram'
import { openEquationDialog } from './EquationDialog'
import { getTableAbove } from '@platejs/table'
import { useNotes } from '../../../service/store/notes'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useEditorRef, useEditorSelector, useSelected } from 'platejs/react'
import { TableToolbar } from './PlateTableToolbar'
import { notes } from '../../../runtime/legacy-bridge'

/* ---------------- 基础块 ---------------- */

export function ParagraphElement({ attributes, children, element, editor }: PlateElementProps) {
  const el = element as { checked?: boolean }

  // Plate 把 GFM 任务项解析成「带 checked 的段落」，不是独立节点类型
  if (el.checked !== undefined) {
    return (
      <div
        {...attributes}
        className={'p task-list-item' + (el.checked ? ' task-checked' : '')}
      >
        <span className="task-list-checkbox" contentEditable={false}>
          <input
            type="checkbox"
            checked={!!el.checked}
            onChange={(e) => {
              const path = editor.api.findPath(element)
              if (path) editor.tf.setNodes({ checked: e.target.checked } as never, { at: path })
            }}
          />
        </span>
        <span className="task-list-text">{children}</span>
      </div>
    )
  }

  return (
    <div {...attributes} className="p">
      {children}
    </div>
  )
}

function heading(level: number) {
  return function Heading({ attributes, children }: PlateElementProps) {
    return (
      <div {...attributes} className={'h' + level}>
        {children}
      </div>
    )
  }
}
export const H1Element = heading(1)
export const H2Element = heading(2)
export const H3Element = heading(3)
export const H4Element = heading(4)
export const H5Element = heading(5)
export const H6Element = heading(6)

export function BlockquoteElement({ attributes, children }: PlateElementProps) {
  return (
    <blockquote {...attributes} className="blockquote">
      {children}
    </blockquote>
  )
}

export function HrElement({ attributes, children, element }: PlateElementProps) {
  const onHrGapClick = useVoidGapClick(element)
  return (
    <div {...attributes} className="hr void-wrap" contentEditable={false} onClick={onHrGapClick}>
      <VoidGapBars />
      {children}
    </div>
  )
}

/* ---------------- 列表 ---------------- */

export function UlElement({ attributes, children }: PlateElementProps) {
  return (
    <ul {...attributes} className="ul">
      {children}
    </ul>
  )
}

export function OlElement({ attributes, children }: PlateElementProps) {
  return (
    <ol {...attributes} className="ol">
      {children}
    </ol>
  )
}

export function LiElement({ attributes, children }: PlateElementProps) {
  return (
    <li {...attributes} className="li">
      {children}
    </li>
  )
}

export function TodoListElement({ attributes, children, element, editor }: PlateElementProps) {
  const el = element as { checked?: boolean }
  return (
    <li {...attributes} className={'li task-list-item' + (el.checked ? ' task-checked' : '')}>
      <span className="task-list-checkbox" contentEditable={false}>
        <input
          type="checkbox"
          checked={!!el.checked}
          onChange={(e) => {
            const path = editor.api.findPath(element)
            if (path) editor.tf.setNodes({ checked: e.target.checked } as never, { at: path })
          }}
        />
      </span>
      {children}
    </li>
  )
}

/* ---------------- 代码块 ---------------- */


/* ================= 块级元素的上下落点 ================= */

/** 判定带的厚度（px），上下各一段 */
export const VOID_GAP = 10

/**
 * 在块级元素（代码块/表格/图片/分隔线）的上方或下方给出光标落点。
 * 这些块自身是 void，内部放不了光标；用户把两侧的空行删掉之后就彻底插不进内容了，
 * 所以这里让块的上下各留一条判定带，点一下就把光标送进去（没有段落就先建一个）。
 */
export function placeBesideVoid(editor: unknown, element: unknown, dir: 'before' | 'after'): void {
  const ed = editor as {
    api?: Record<string, (...a: unknown[]) => unknown>
    tf?: Record<string, (...a: unknown[]) => unknown>
  }
  const path = findPathOf(ed, element)
  if (!path) return
  const at = dir === 'before' ? path.slice() : [path[0] + 1]

  const isUsableParagraph = (n: unknown): boolean => {
    const node = n as { type?: string; children?: { text?: string }[] } | undefined
    return (
      !!node &&
      node.type === KEYS.p &&
      Array.isArray(node.children) &&
      node.children.every((c) => typeof c.text === 'string')
    )
  }

  try {
    const entry = (ed.api?.node as unknown as (p: number[]) => [unknown, number[]] | undefined)?.(at)
    if (entry && isUsableParagraph(entry[0])) {
      // 已经有段落就复用，不再多插一个
      ;(ed.tf?.select as unknown as (p: unknown) => void)({ path: [...at, 0], offset: 0 })
    } else {
      ;(ed.tf?.insertNodes as unknown as (n: unknown, o: unknown) => void)(
        { type: KEYS.p, children: [{ text: '' }] },
        { at }
      )
      ;(ed.tf?.select as unknown as (p: unknown) => void)({ path: [...at, 0], offset: 0 })
    }
    ;(ed.tf?.focus as unknown as () => void)?.()
  } catch (err) {
    console.error('[void-gap]', err)
  }
}

/**
 * 块上下两条判定带。平时透明，鼠标进来画一条 2px 竖线，
 * 告诉用户「这里点一下能插内容」——相当于 ProseMirror gap cursor 的视觉提示。
 * 用绝对定位，不占文档流，也不参与 Slate 的节点结构。
 */
export function VoidGapBars() {
  // 判定带压在块的边缘上，mousedown 落到这里时编辑器会先按坐标把选区设进块里，
  // 于是操作栏闪一下（active 变 true）再被 click 的插入处理顶掉（active 变 false）。
  // 在 mousedown 就 preventDefault + 拦冒泡，选区根本不动，只留 click 去插内容。
  const hold = (ev: React.SyntheticEvent) => {
    ev.preventDefault()
    ev.stopPropagation()
  }
  return (
    <>
      <span
        className="void-gap void-gap-top"
        contentEditable={false}
        aria-hidden="true"
        onMouseDown={hold}
        onPointerDown={hold}
      />
      <span
        className="void-gap void-gap-bottom"
        contentEditable={false}
        aria-hidden="true"
        onMouseDown={hold}
        onPointerDown={hold}
      />
    </>
  )
}

/** 统一处理块上下判定带的点击 */
export function useVoidGapClick(element: unknown) {
  const editor = useEditorRef()
  return (ev: {
    clientY: number
    currentTarget: HTMLElement
    target?: EventTarget | null
    preventDefault: () => void
    stopPropagation: () => void
  }) => {
    // 点在块自己的浮动控件上（语言切换 / 复制）时，绝不能当成「上方插入行」
    const el = ev.target as HTMLElement | null
    if (el && typeof el.closest === 'function' && el.closest('.code-lang, .code-editor-copy, .code-lang-list')) {
      return
    }
    const r = ev.currentTarget.getBoundingClientRect()
    const y = ev.clientY - r.top
    // 点在块本身的内容上就不管，交回给编辑器
    if (y > VOID_GAP && y < r.height - VOID_GAP) return
    ev.preventDefault()
    ev.stopPropagation()
    placeBesideVoid(editor, element, y <= VOID_GAP ? 'before' : 'after')
  }
}

/**
 * 按对象身份在文档树里找 path。
 * Plate 的 api.findPath 依赖节点引用，setValue / 重载之后引用可能对不上，
 * 这里做一份自己的遍历，保证切语言一定能定位到块。
 */
function findPathOf(editor: unknown, node: unknown): number[] | null {
  const root = (editor as { children?: unknown[] } | null)?.children
  if (!Array.isArray(root) || !node) return null
  const stack: Array<[unknown[], number[]]> = [[root, []]]
  while (stack.length) {
    const item = stack.pop()
    if (!item) break
    const [arr, base] = item
    for (let i = 0; i < arr.length; i++) {
      const n = arr[i] as { children?: unknown[] } | null
      if (n === node) return [...base, i]
      if (n && Array.isArray(n.children)) stack.push([n.children, [...base, i]])
    }
  }
  return null
}

/** 常用语言（lowlight 的 common 子集里都支持） */
const CODE_LANGS = [
  'text', 'js', 'jsx', 'ts', 'tsx', 'json', 'html', 'css', 'scss',
  'python', 'java', 'c', 'cpp', 'csharp', 'go', 'rust', 'php', 'ruby',
  'sql', 'bash', 'shell', 'yaml', 'xml', 'markdown', 'diff',
  'mermaid', 'echarts',
]

export function CodeBlockElement({ attributes, children, element }: PlateElementProps) {
  const editorRef = useEditorRef()
  const el = element as { lang?: string; children?: { text?: string }[] }
  const curLang = String(el.lang || 'text').toLowerCase()
  // 只有代码块被激活（selection 落在块内）才显示语言切换
  const selected = useSelected()
  // 只读模式下不允许改语言，标签显示但不可点
  const locked = useNotes((s) => s.locked)
  const onVoidGapClick = useVoidGapClick(element)
  const [langOpen, setLangOpen] = useState(false)
  // 图表块（mermaid/echarts）默认只显示渲染结果，源码折叠；
  // 图形右上角 hover 出按钮，点击展开/隐藏源码
  const [showSource, setShowSource] = useState(false)
  const [menuAt, setMenuAt] = useState({ top: 0, left: 0 })
  const langBtnRef = useRef<HTMLButtonElement>(null)
  const langMenuRef = useRef<HTMLDivElement>(null)
  const langPathRef = useRef<number[] | null>(null)

  // 当前语言不在常用列表里时（sh / py / c++ / plaintext），也要能在菜单里看到并标为选中
  const langOptions = CODE_LANGS.includes(curLang) ? CODE_LANGS : [curLang, ...CODE_LANGS]

  useEffect(() => {
    if (!langOpen) return
    const close = (ev: MouseEvent) => {
      const t = ev.target as Node
      if (langBtnRef.current && langBtnRef.current.contains(t)) return
      // 菜单本身也要排除：真实鼠标点击是 mousedown -> click，
      // 只判断按钮的话菜单会在 click 之前被卸载，点了等于没点
      if (langMenuRef.current && langMenuRef.current.contains(t)) return
      setLangOpen(false)
    }
    const esc = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') setLangOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', esc)
    }
  }, [langOpen])
  const lang = (el.lang || '').toLowerCase()
  const isDiagram = lang === 'mermaid' || lang === 'echarts'
  // 代码块里是 code_line 节点，文本在更下一层，必须递归取
  // 代码块是一串 code_line，行与行之间必须补回换行，否则 mermaid 会把它挤成一行
  const pick = (nodes: unknown[]): string =>
    (nodes || [])
      .map((n) => {
        const node = n as { text?: string; children?: unknown[]; type?: string }
        if (typeof node.text === 'string') return node.text
        const inner = node.children ? pick(node.children) : ''
        return node.type === 'code_line' ? inner : inner
      })
      .join('\n')
  const code = pick(el.children || [])
    .split('\n')
    .map((line) => line.replace(/\n+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+|\n+$/g, '')

  const copy = () => {
    try {
      void navigator.clipboard.writeText(code)
    } catch (e) {}
  }

  return (
    <div
      className={
        'code-block-wrap void-wrap' +
        (selected ? ' active' : '') +
        // 图表在"只显示渲染结果"状态下，代码块本身是隐藏的，
        // 复制/语言按钮挂在 wrap 上不受影响，会孤零零留在那里 —— 这里同步标记
        (isDiagram && code.trim() && !showSource ? ' is-source-hidden' : '') +
        // 语言下拉是 portal 到 body 的，鼠标移到面板上就离开了 wrap，
        // hover 一断两个按钮就消失；打开面板期间用这个类把按钮钉住
        (langOpen ? ' is-lang-open' : '')
      }
      onClick={onVoidGapClick}
    >
      <VoidGapBars />
      {/* 语言切换与复制按钮同显同隐：都随代码块 hover 出现（不再要求光标落进来） */}
          <button
            ref={langBtnRef}
            type="button"
            className={'code-lang' + (locked ? ' is-locked' : '')}
            contentEditable={false}
            disabled={locked}
            onMouseDown={(ev) => {
              // 不阻止的话按钮抢走焦点 -> Slate selection 离开代码块 ->
              // selected 变 false -> 按钮被卸载，菜单根本没机会出现
              ev.preventDefault()
            }}
            onClick={(ev) => {
              ev.stopPropagation()
              if (locked) return
              setLangOpen((v) => !v)
              try {
                const ed = editorRef as unknown as { api?: { findPath?: (n: unknown) => number[] } }
                langPathRef.current = ed.api?.findPath?.(element) || findPathOf(editorRef, element)
              } catch (err) {
                langPathRef.current = findPathOf(editorRef, element)
                console.error('[code-lang findPath]', err)
              }
              try {
                const r = langBtnRef.current?.getBoundingClientRect()
                const wrapEl = langBtnRef.current?.closest('.code-block-wrap') as HTMLElement | null
                const copyEl = wrapEl?.querySelector(':scope > .code-editor-copy') as HTMLElement | null
                const cr = copyEl?.getBoundingClientRect()
                const MENU_W = 150 // 与 .code-lang-list 的 width 一致
                const GAP = 6
                if (r && cr) {
                  // 下拉框放在复制按钮左侧：右边缘贴住复制按钮左边，纵向从语言按钮底部展开
                  let left = cr.left - MENU_W - GAP
                  if (left < 8) left = Math.max(8, r.left)
                  setMenuAt({ top: r.bottom + 4, left })
                } else if (r) {
                  setMenuAt({ top: r.bottom + 4, left: r.left })
                }
              } catch (err) {
                console.error('[code-lang rect]', err)
              }
            }}
            title="切换代码语言"
          >
            {curLang}
          </button>

      <button
        type="button"
        className="code-editor-copy"
        contentEditable={false}
        onClick={(ev) => {
          ev.stopPropagation()
          copy()
        }}
        title="复制代码"
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      </button>

      {langOpen && !locked
        ? createPortal(
            <div
              ref={langMenuRef}
              className="code-lang-list"
              contentEditable={false}
              style={{ top: menuAt.top, left: menuAt.left }}
              onMouseDown={(ev) => ev.preventDefault()}
            >
              {langOptions.map((l) => (
                <div
                  key={l}
                  className={'code-lang-item' + (l === curLang ? ' on' : '')}
                  onMouseDown={(ev) => {
                    ev.preventDefault()
                    ev.stopPropagation()
                    const p = langPathRef.current
                    const ed = editorRef as unknown as {
                      tf?: { setNodes?: (props: unknown, opts: unknown) => void }
                    }
                    if (p) {
                      try {
                        ed.tf?.setNodes?.({ lang: l }, { at: p })
                      } catch (err) {
                        console.error('[code-lang]', err)
                      }
                    }
                    setLangOpen(false)
                  }}
                >
                  {l}
                </div>
              ))}
            </div>,
            document.body
          )
        : null}

      <pre
        {...attributes}
        className={
          'code-editor' + (isDiagram && code.trim() ? (showSource ? '' : ' is-source-hidden') : '')
        }
        data-lang={el.lang || ''}
      >
        {children}
      </pre>

      {isDiagram && code.trim() ? (
        <div className="diagram-box" contentEditable={false}>
          {/* 按钮挂在整个渲染区（diagram-box）上，而不是图形画布上：
              图形居中时画布比渲染区窄，挂在画布上会跑到图形右上角去 */}
          <button
            type="button"
            className={'diagram-code-toggle' + (showSource ? ' is-on' : '')}
            contentEditable={false}
            onMouseDown={(ev) => ev.preventDefault()}
            onClick={(ev) => {
              ev.stopPropagation()
              setShowSource((v) => !v)
            }}
            title={showSource ? '隐藏源码' : '显示源码'}
          >
            {/* 图案与表格操作栏的「显示源码」一致：</> 而不是 <> */}
            <svg
              viewBox="0 0 24 24"
              width="15"
              height="15"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m18 16 4-4-4-4" />
              <path d="m6 8-4 4 4 4" />
              <path d="m14.5 4-5 16" />
            </svg>
          </button>
          <div className={'diagram-canvas' + (lang === 'echarts' ? ' is-full' : '')}>
            <Diagram kind={lang as 'mermaid' | 'echarts'} code={code} />
          </div>
        </div>
      ) : null}
    </div>
  )
}

export function CodeLineElement({ attributes, children }: PlateElementProps) {
  return (
    <div {...attributes} className="code-line">
      {children}
    </div>
  )
}

/** 语法高亮的 token：Plate 会把命中片段标上 syntaxTokenType */
/**
 * lowlight / highlight.js 的类名映射到 app.css 里那套 Prism 命名
 *
 * Plate 53 的 decoration 给 leaf 加的是 className（'hljs-keyword' 这种）
 * 和 code_syntax: true，**没有** syntaxTokenType 字段。
 * 之前读 syntaxTokenType 永远取不到值，所以语法高亮一直是纯色。
 */
const HLJS_ALIAS: Record<string, string> = {
  'hljs-built_in': 'builtin',
  'hljs-regexp': 'regex',
  'hljs-attr': 'attr-name',
  'hljs-attribute': 'attr-name',
  'hljs-literal': 'boolean',
  'hljs-selector-tag': 'selector',
  'hljs-selector-class': 'selector',
  'hljs-selector-id': 'selector',
  'hljs-meta': 'important',
  'hljs-section': 'property',
  'hljs-params': 'variable',
}

function toTokenClasses(raw: string): string {
  const out: string[] = []
  for (const c of String(raw || '').split(/\s+/).filter(Boolean)) {
    if (c === 'hljs-title') out.push('function')
    else if (c === 'class_' || c === 'hljs-class') out.push('class-name')
    else if (c.endsWith('_')) continue // hljs 的 function_ / class_ 是内部标记，别当类名
    else out.push(HLJS_ALIAS[c] ?? (c.startsWith('hljs-') ? c.slice(5) : c))
  }
  const uniq = [...new Set(out)]
  // lowlight 对类定义会输出 "hljs-title class_"，只需保留 class-name
  if (uniq.includes('class-name')) return uniq.filter((c) => c !== 'function').join(' ')
  return uniq.join(' ')
}

export function CodeSyntaxLeaf({ attributes, children, leaf }: PlateLeafProps) {
  const raw = (leaf as unknown as { className?: string }).className || ''
  const tokens = toTokenClasses(raw)
  const inherited = (attributes as unknown as { className?: string } | undefined)?.className
  const className = tokens ? ['token', tokens, inherited].filter(Boolean).join(' ') : inherited
  return (
    <span {...attributes} className={className}>
      {children}
    </span>
  )
}

/* ---------------- 表格 ---------------- */

export function TableElement({ attributes, children, element }: PlateElementProps) {
  const locked = useNotes((s) => s.locked)
  const onVoidGapClick = useVoidGapClick(element)
  // 操作栏悬浮：自己算位置并直接写 DOM 样式。
  // 不用 sticky（受父容器高度限制，表格一短就钉不住），
  // 也不用 React state（每次 scroll 都重渲染，视觉上会闪）。
  const barRef = useRef<HTMLDivElement>(null)
  // 浮层展开期间操作栏必须保持可见：点按钮会让选区离开表格、active 变 false，
  // 否则整条操作栏（连同保存按钮）会当场消失
  const [codeOpen, setCodeOpen] = useState(false)

  useEffect(() => {
    const bar = barRef.current
    const wrap = bar?.closest('.table-wrap') as HTMLElement | null
    if (!bar || !wrap) return
    let raf = 0

    const reset = () => {
      bar.classList.remove('is-pinned')
      bar.style.position = ''
      bar.style.top = ''
      bar.style.left = ''
      bar.style.width = ''
    }

    const upd = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        let sc: HTMLElement | null = wrap.parentElement
        while (sc && sc !== document.body) {
          const cs = getComputedStyle(sc)
          if (/(auto|scroll)/.test(cs.overflowY)) break
          sc = sc.parentElement
        }
        if (!sc || sc === document.body) {
          reset()
          return
        }
        const wr = wrap.getBoundingClientRect()
        const sr = sc.getBoundingClientRect()
        const barH = bar.offsetHeight || 30
        // 表格顶部滚过容器顶部、且表格还没整块滚出去时，把操作栏钉在容器顶部
        if (wr.top < sr.top && wr.bottom > sr.top + barH) {
          bar.classList.add('is-pinned')
          bar.style.position = 'fixed'
          bar.style.top = Math.round(sr.top) + 'px'
          bar.style.left = Math.round(wr.left) + 'px'
          bar.style.width = Math.round(wr.width) + 'px'
        } else {
          reset()
        }
      })
    }

    upd()
    window.addEventListener('scroll', upd, true)
    window.addEventListener('resize', upd)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('scroll', upd, true)
      window.removeEventListener('resize', upd)
    }
  }, [])

  // 光标落在这个表格里时才显示操作栏（V1.0.0 是 caption 的 hidden 属性）
  const active = useEditorSelector((ed: any) => {
    try {
      const res = getTableAbove(ed as never) as [unknown, number[]] | undefined
      if (!res) return false
      const mine = (ed.api as unknown as { findPath?: (n: unknown) => number[] }).findPath?.(element)
      if (!mine) return false
      return res[1].join(',') === mine.join(',')
    } catch (e) {
      return false
    }
  }, [element])

  return (
    // 外面必须再包一层：border-collapse: collapse 下 <table> 自己的 padding
    // 会被单元格吃掉，elementFromPoint 落在 td 上，判定带等于不存在。
    <div
      className={'table-wrap void-wrap' + ((active || codeOpen) && !locked ? ' is-bar-open' : '')}
      onClick={onVoidGapClick}
    >
      <VoidGapBars />
      {/* 操作栏必须放在 <table> 外面：table-caption 上的 position: sticky 在 Chrome 里
          不生效（实测滚出视口后 top 变成 -21），放进 .table-wrap 里的普通 div 才能钉住顶部。
          只读状态下不显示，避免误触。 */}
      {/* 常驻挂载、只切显隐：条件渲染会导致点按钮时（选区变化 -> active=false）
          整条工具栏卸载，表格代码浮层的状态一起丢掉、刚打开就消失 */}
      {/* 只在光标位于本表格内时显示（不常显）；只读状态下也隐藏 */}
      <div
        ref={barRef}
        className={'table-sticky-bar' + ((active || codeOpen) && !locked ? '' : ' is-hidden')}
        contentEditable={false}
        aria-hidden={!active || locked}
        /* 操作栏在 .table-wrap 内部，而 wrap 上挂了 onVoidGapClick（点上方/下方插入段落）；
           不拦冒泡的话，点「显示源码」这类按钮会顺带触发表格上方的插入操作 */
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <TableToolbar tableNode={element} onOpenChange={setCodeOpen} />
      </div>
      <table {...attributes} className="table">
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

export function TableRowElement({ attributes, children }: PlateElementProps) {
  return (
    <tr {...attributes} className="table-row">
      {children}
    </tr>
  )
}

export function TableCellElement({ attributes, children, element }: PlateElementProps) {
  const el = element as { header?: boolean; align?: 'left' | 'center' | 'right'; type?: string }
  // Plate 的 markdown 解析用节点类型 th/td 区分表头，不是 header 布尔字段。
  // 之前只读 el.header，导致所有表头都没加上 is-header，字重和普通行一样。
  const isHeader = !!el.header || String(el.type || '') === 'th'
  return (
    <td
      {...attributes}
      className={'table-cell' + (isHeader ? ' is-header' : '')}
      style={el.align ? { textAlign: el.align } : undefined}
    >
      {children}
    </td>
  )
}

/* ---------------- 图片 ---------------- */

export function ImageElement({ attributes, children, element }: PlateElementProps) {
  const onImgGapClick = useVoidGapClick(element)
  const editor = useEditorRef()
  const locked = useNotes((s) => s.locked)
  const pathRef = useRef<number[] | null>(null)
  const el = element as { url?: string; alt?: string; caption?: string; width?: unknown }
  // 宽度写在节点自己身上（width，单位 px），序列化时会写成 <img ... width="320">。
  // 这样 Obsidian / Typora / VS Code 打开同一份 md 也能看到一样的尺寸 ——
  // 早期版本把缩放比例存在 .cmark/image-style.json 里，别的编辑器完全不认，等于白存。
  const widthPx = (() => {
    const w = Number(el.width)
    return Number.isFinite(w) && w > 0 ? Math.round(w) : 0
  })()
  const imgRef = useRef<HTMLImageElement | null>(null)
  // 拖动时先用本地状态出画面，避免等 React 状态树更新才跟手
  const [dragW, setDragW] = useState<number | null>(null)
  const [, setNatTick] = useState(0) // 图片加载完才知道原图宽度，用它触发一次重算
  const shownW = dragW ?? widthPx
  /** 当前显示宽度相对原图宽度的百分比；没设宽度就是 100 */
  const pct = (() => {
    const natW = imgRef.current?.naturalWidth || 0
    if (!shownW || !natW) return 100
    return Math.min(100, Math.max(10, Math.round((shownW / natW) * 100)))
  })()

  // 拖滑杆时每移动一格都写节点会把序列化/保存刷爆，停顿 300ms 后再落盘
  const saveTimer = useRef<number | null>(null)
  const persistZoom = (v: number) => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      try {
        const p = findPathOf(editor, element)
        if (!p) return
        const natW = imgRef.current?.naturalWidth || 0
        const tf = (editor as unknown as { tf?: { setNodes?: (props: Record<string, unknown>, o: unknown) => void } }).tf
        if (v >= 100) tf?.setNodes?.({ width: null }, { at: p })
        else if (natW > 0) tf?.setNodes?.({ width: Math.round((natW * v) / 100) }, { at: p })
      } catch (err) {
        console.error('[img-zoom]', err)
      }
    }, 300)
  }
  // Plate 的 img 节点把说明存在 caption 上（可能是字符串、{text} 或节点数组），alt 常是空的
  const rawCap = (el as { caption?: unknown }).caption
  const capText = (() => {
    if (!rawCap) return ''
    if (typeof rawCap === 'string') return rawCap
    if (Array.isArray(rawCap)) {
      return rawCap
        .map((n) => {
          const node = n as { text?: string; children?: unknown[] }
          if (typeof node.text === 'string') return node.text
          if (Array.isArray(node.children)) {
            return node.children.map((c) => String((c as { text?: string })?.text || '')).join('')
          }
          return ''
        })
        .join('')
    }
    const obj = rawCap as { text?: string }
    return typeof obj.text === 'string' ? obj.text : ''
  })()
  const imgAlt = el.alt || capText
  const bridge = notes() as unknown as
    | { resolveImageUrl?: (s: string, noteRel?: string) => string }
    | undefined
  let src = el.url || ''
  try {
    // 图片路径是相对当前笔记的，解析时必须带上笔记 rel，否则子目录里的笔记找不到图
    const noteRel = useNotes.getState().currentRel
    if (bridge?.resolveImageUrl) src = bridge.resolveImageUrl(el.url || '', noteRel)
  } catch (e) {}

  // 对齐 V1.0.0：工具条常驻 DOM，靠 CSS 的 .block-img:hover 显隐，
  // 点图片不再弹"图片说明(alt)"输入框 —— 那个改名框没有意义，
  // markdown 里图片说明就写在 ]( 前面，要改直接改源码。
  /** file:///D:/x/y.png → D:\x\y.png */
  const srcToPath = (u: string) => {
    const raw = decodeURIComponent(u.replace(/^file:\/\/\/?/i, ''))
    return raw.replace(/\//g, '\\')
  }

  /** 拖动滑杆调比例：先改本地 state 立刻出画面，停顿后再写回节点 */
  const onZoom = (ev: React.ChangeEvent<HTMLInputElement>) => {
    ev.stopPropagation()
    const v = Math.min(100, Math.max(10, Number(ev.target.value) || 100))
    const natW = imgRef.current?.naturalWidth || 0
    setDragW(v >= 100 || !natW ? null : Math.max(1, Math.round((natW * v) / 100)))
    persistZoom(v)
  }

  const openImgFile = (ev: React.MouseEvent) => {
    ev.stopPropagation()
    ev.preventDefault()
    try {
      const zt = (window as unknown as {
        ztools?: { shellOpenPath?: (p: string) => void; shellOpenExternal?: (u: string) => void }
      }).ztools
      if (/^file:/i.test(src)) zt?.shellOpenPath?.(srcToPath(src))
      else if (/^https?:/i.test(src)) zt?.shellOpenExternal?.(src)
    } catch (err) {
      console.error('[img-open]', err)
    }
  }

  const removeImg = () => {
    pathRef.current = findPathOf(editor, element)
    const p = pathRef.current
    if (p) {
      try {
        ;(editor as unknown as { tf?: { removeNodes?: (o: unknown) => void } }).tf?.removeNodes?.({ at: p })
      } catch (err) {
        console.error('[img-del]', err)
      }
    }
  }

  const toolBar = locked ? null : (
    <div className="img-handle" contentEditable={false} onClick={(ev) => ev.stopPropagation()}>
      <span className="img-zoom" title="拖动调整图片大小">
        <input
          type="range"
          className="img-zoom-range"
          min={10}
          max={100}
          step={5}
          value={pct}
          onChange={onZoom}
          onClick={(ev) => ev.stopPropagation()}
          onMouseDown={(ev) => ev.stopPropagation()}
        />
        <span className="img-zoom-val">{pct}%</span>
      </span>
      <button type="button" title="打开图片" onClick={openImgFile}>
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9.5 2.5h4v4" />
          <path d="M13.5 2.5L7.5 8.5" />
          <path d="M12 9.5v3a1.5 1.5 0 01-1.5 1.5h-6A1.5 1.5 0 013 12.5v-6A1.5 1.5 0 014.5 5h3" />
        </svg>
      </button>
      <button type="button" className="danger" title="删除图片" onClick={removeImg}>
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 4.5h10" />
          <path d="M6.5 4.5V3h3v1.5" />
          <path d="M4.5 4.5l.6 8a1 1 0 001 .9h3.8a1 1 0 001-.9l.6-8" />
        </svg>
      </button>
    </div>
  )

  // 附件找不到时不要留一个空白 img，给个明确的占位提示
  if (!src) {
    return (
      <div
        {...attributes}
        className="block-img is-broken void-wrap"
        contentEditable={false}
        onClick={(ev) => {
          onImgGapClick(ev)
        }}
      >
        <VoidGapBars />
        <span className="img-missing">图片附件找不到：{imgAlt || el.url || '(无 URL)'}</span>
        {toolBar}
        {children}
      </div>
    )
  }

  return (
    <div {...attributes} className="block-img void-wrap" onClick={onImgGapClick}>
      <VoidGapBars />
      <img
        ref={imgRef}
        src={src}
        alt={imgAlt}
        style={shownW ? { width: shownW + 'px', maxWidth: '100%' } : undefined}
        onLoad={() => setNatTick((t) => t + 1)}
        contentEditable={false}
        draggable={false}
        onClick={(ev) => {
          ev.stopPropagation()
        }}
        title={locked ? '' : '点击显示图片操作'}
      />
      {toolBar}
      {children}
    </div>
  )
}

/* ---------------- 公式 ---------------- */

export function EquationElement({ attributes, children, element }: PlateElementProps) {
  const el = element as { texExpression?: string; value?: string }
  const editor = useEditorRef()
  const tex = el.texExpression || el.value || ''
  let html = ''
  try {
    html = katex.renderToString(tex, { throwOnError: false, displayMode: true })
  } catch (e) {
    html = ''
  }

  // 对齐 V1.0.0：公式本身是 contentEditable=false 的渲染结果，
  // 点击只是把光标定位到它旁边。改 LaTeX 走右上角按钮弹窗。
  const selectNode = () => {
    const p = findPathOf(editor, element)
    if (!p) return
    try {
      ;(editor as unknown as { tf?: { select?: (at: number[]) => void } }).tf?.select?.(p)
    } catch (err) {
      console.error('[equation-select]', err)
    }
  }

  const edit = () => {
    const path = findPathOf(editor, element)
    openEquationDialog({
      tex,
      title: '编辑公式',
      onApply: (next) => {
        if (!path) return
        const ed = editor as unknown as {
          tf?: { setNodes?: (props: unknown, opts: unknown) => void }
        }
        try {
          ed.tf?.setNodes?.({ texExpression: next }, { at: path })
        } catch (err) {
          console.error('[equation-edit]', err)
        }
      },
    })
  }

  return (
    <div
      {...attributes}
      className="math-leaf"
      contentEditable={false}
      onClick={(ev) => {
        ev.stopPropagation()
        selectNode()
      }}
    >
      <div className="math-canvas">
        {/* 和图表一致：悬浮才出现按钮，点开是弹窗编辑 */}
        <button
          type="button"
          className="math-toggle"
          contentEditable={false}
          onMouseDown={(ev) => ev.preventDefault()}
          onClick={(ev) => {
            ev.stopPropagation()
            edit()
          }}
          title="编辑公式"
        >
          <svg
            viewBox="0 0 24 24"
            width="13"
            height="13"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m9 6-6 6 6 6" />
            <path d="m15 6 6 6-6 6" />
          </svg>
        </button>
        <div className="math-render" dangerouslySetInnerHTML={{ __html: html }} />
      </div>
      {children}
    </div>
  )
}

/** 行内公式：不配渲染器的话节点存在但界面上是空白 */
export function InlineEquationElement({ attributes, children, element }: PlateElementProps) {
  const el = element as { texExpression?: string; value?: string }
  const tex = el.texExpression || el.value || ''
  let html = ''
  try {
    html = katex.renderToString(tex, { throwOnError: false, displayMode: false })
  } catch (e) {
    html = ''
  }
  const editor = useEditorRef()
  const edit = () => {
    const path = findPathOf(editor, element)
    openEquationDialog({
      tex,
      title: '编辑行内公式',
      onApply: (next) => {
        if (!path) return
        const ed = editor as unknown as {
          tf?: { setNodes?: (props: unknown, opts: unknown) => void }
        }
        try {
          ed.tf?.setNodes?.({ texExpression: next }, { at: path })
        } catch (err) {
          console.error('[inline-equation-edit]', err)
        }
      },
    })
  }

  return (
    <span {...attributes} className="math-inline" contentEditable={false}>
      <span className="math-inline-body" dangerouslySetInnerHTML={{ __html: html }} />
      <button
        type="button"
        className="math-inline-toggle"
        contentEditable={false}
        onMouseDown={(ev) => ev.preventDefault()}
        onClick={(ev) => {
          ev.stopPropagation()
          edit()
        }}
        title="编辑行内公式"
      >
        <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m9 6-6 6 6 6" />
          <path d="m15 6 6 6-6 6" />
        </svg>
      </button>
      {children}
    </span>
  )
}

/* ---------------- 搜索命中 ---------------- */

/** decorate 给命中区间打了 searchHit 标记，这里把它渲染成 <mark> */
export function SearchHitLeaf({ attributes, children }: PlateLeafProps) {
  return (
    <mark {...attributes} className="search-hit-mark">
      {children}
    </mark>
  )
}

/* ---------------- 链接 ---------------- */

/**
 * 链接在节点树里是 element（{ type:'a', url, children }），不是 leaf。
 * 之前配成 render.leaf，渲染器永远不触发，所以页面上一个 <a> 都不生成。
 */
export function LinkElement({ attributes, children, element }: PlateElementProps) {
  const el = element as { url?: string }
  const href = el.url || ''
  return (
    <a
      {...attributes}
      className="link"
      href={href}
      title={href}
      onClick={(e: React.MouseEvent) => {
        e.preventDefault()
        void notes().openExternal?.(href)
      }}
    >
      {children}
    </a>
  )
}

/** 链接是 mark 级（Plate 的 link 是 leaf），不是 element */
export function LinkLeaf({ attributes, children, leaf }: PlateLeafProps) {
  const l = leaf as { url?: string; link?: string }
  const href = l.url || l.link || ''
  return (
    <a
      {...attributes}
      className="link"
      href={href}
      title={href}
      onClick={(e: React.MouseEvent) => {
        e.preventDefault()
        void notes().openExternal?.(href)
      }}
    >
      {children}
    </a>
  )
}
