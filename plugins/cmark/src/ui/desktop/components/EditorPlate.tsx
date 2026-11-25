/**
 * 编辑器：Plate（Slate 之上的一整套插件框架）
 *
 * 与之前手写 Slate 版的区别：
 *   - md 与树的转换交给 @platejs/markdown（底层 remark，CommonMark / GFM 标准）
 *   - 表格、代码块、图片、列表、公式、链接的编辑行为由插件提供
 *   - 渲染仍是 headless：DOM 由本项目自己的元素组件决定，样式沿用 app.css
 *
 * 与 store 的契约保持不变：
 *   读 content → deserialize 灌入；用户编辑 → serialize 回 setContent；保存走 store.save()
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Plate, PlateContent, ParagraphPlugin, createPlatePlugin, usePlateEditor } from 'platejs/react'
import { Text } from 'slate'
import {
  BasicMarksPlugin,
  HighlightPlugin,
  BlockquotePlugin,
  H1Plugin,
  H2Plugin,
  H3Plugin,
  H4Plugin,
  H5Plugin,
  H6Plugin,
  HorizontalRulePlugin,
} from '@platejs/basic-nodes/react'
import {
  TableCellHeaderPlugin,
  TableCellPlugin,
  TablePlugin,
  TableRowPlugin,
} from '@platejs/table/react'
import { CodeBlockPlugin, CodeLinePlugin, CodeSyntaxPlugin } from '@platejs/code-block/react'
import { common, createLowlight } from 'lowlight'

// 语法高亮引擎。common 只含常用语言（约 40 种），全量会明显增大包体积
const lowlight = createLowlight(common)
import { ListPlugin } from '@platejs/list/react'
import { EquationPlugin, InlineEquationPlugin } from '@platejs/math/react'
import { LinkPlugin } from '@platejs/link/react'
import { ImagePlugin } from '@platejs/media/react'
import { MarkdownPlugin } from '@platejs/markdown'
import { applyTableAligns, extractTableAligns, fillTableAligns, collectTableAligns } from '../../../core/domain/table-align'
import { flattenAutolinks } from '../../../core/domain/autolink'
import { tidyMarkdown } from '../../../core/domain/md-tidy'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import { KEYS } from 'platejs'
import { toggleList } from '@platejs/list'

import { preDeserialize, postDeserialize, markToPlaceholder, placeholderToMd, protectSyntax } from '../../../core/domain/md-marks'

/** HTML 属性转义：图片 URL 里出现 & 或引号时不能直接拼进 <img> */
const escHtmlAttr = (v: string): string =>
  String(v)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
import { useNotes } from '../../../service/store/notes'
import {
  BlockquoteElement,
  CodeBlockElement,
  CodeLineElement,
  CodeSyntaxLeaf,
  H1Element,
  H2Element,
  H3Element,
  H4Element,
  H5Element,
  H6Element,
  EquationElement,
  InlineEquationElement,
  HrElement,
  LinkElement,
  ImageElement,
  ParagraphElement,
  SearchHitLeaf,
  TableCellElement,
  TableElement,
  TableRowElement,
} from './plate-elements'
import { EquationDialogHost, openEquationDialog } from './EquationDialog'
import { notes } from '../../../runtime/legacy-bridge'

/**
 * remark-stringify 默认会往行末塞反斜杠（hard break），
 * 表格 / 引用 / 公式的行尾会被污染，必须显式关掉。
 * bullet / rule / emphasis 固定成项目习惯的写法，避免 * 与 _ 混用。
 */
const stringify = {
  hard: false,
  bullet: '-',
  rule: '-',
  emphasis: '*',
  strong: '*',
  fences: true,
} as const

/**
 * 搜索命中高亮。
 *
 * 关键约束：usePlateEditor 只在挂载时创建 editor，之后改 plugins 数组不会生效，
 * 所以插件必须是固定的、只建一次；搜索词通过模块级变量传入，
 * 词变化时调 editor.api.redecorate() 让 Plate 重新跑 decorate。
 */
let searchTermForDecorate = ''

export function setSearchTermForDecorate(t: string) {
  searchTermForDecorate = String(t || '')
}

const SearchHitPlugin = createPlatePlugin({
  key: 'searchHit',
  // 关键：mark 插件必须声明 isLeaf，否则 render.leaf 不会被调用（对照 BoldPlugin）
  node: { isLeaf: true },
  render: { leaf: SearchHitLeaf },
  decorate: ({ entry }) => {
    const q = searchTermForDecorate.trim().toLowerCase()
    if (!q) return []
    const arr = entry as unknown
    let node: unknown
    let path: number[] | undefined
    if (Array.isArray(arr)) {
      node = arr[0]
      path = arr[1] as number[]
    } else if (arr && typeof arr === 'object') {
      const e = arr as { node?: unknown; path?: number[] }
      node = e.node
      path = e.path
    }
    if (!Array.isArray(path)) return []
    if (!Text.isText(node as never)) return []
    const text = ((node as { text?: string }).text || '').toLowerCase()
    if (!text) return []
    const ranges: { anchor: { path: number[]; offset: number }; focus: { path: number[]; offset: number }; searchHit: boolean }[] = []
    let idx = text.indexOf(q)
    while (idx >= 0) {
      ranges.push({
        anchor: { path, offset: idx },
        focus: { path, offset: idx + q.length },
        searchHit: true,
      })
      idx = text.indexOf(q, idx + q.length)
    }
    return ranges as never
  },
})

const EMPTY = [{ type: KEYS.p, children: [{ text: '' }] }]

/**
 * 表格和代码块都是 void 元素，内部不能放光标。
 * 如果两个 void 相邻、或文档首尾是 void，用户就没有任何可落点，
 * 表现为「在这两个区域中间怎么按回车都没用」。
 * 载入时在每个空隙补一个空段落，给出可编辑的位置。
 */
export function Editor() {
  const content = useNotes((s) => s.content)
  const currentRel = useNotes((s) => s.currentRel)
  const setContent = useNotes((s) => s.setContent)
  const locked = useNotes((s) => s.locked)
  const bodyFontSize = useNotes((s) => s.bodyFontSize)
  const sourceMode = useNotes((s) => s.sourceMode)
  // 只认「当前笔记内查找」的词：目录树过滤词（s.searchTerm）跟正文高亮不是一回事
  const searchTerm = useNotes((s) => s.findTerm)
  const setEditorApi = useNotes((s) => s.setEditorApi)
  const setEditor = useNotes((s) => s.setEditor)
  const setActive = useNotes((s) => s.setActive)
  const loadRevision = useNotes((s) => s.loadRevision)
  // 源码模式的行号：和 textarea 用同一套字号/行高，滚动时同步
  const sourceTaRef = useRef<HTMLTextAreaElement>(null)
  // 行号列的滚动偏移。不用容器自己的 scrollTop（会被浏览器意外改动导致整列错位），
  // 改成 transform 平移内层，偏移完全由 textarea 的滚动量决定。
  const [sourceScroll, setSourceScroll] = useState(0)
  // 行号列宽度跟着位数走：两位数字不需要 48px 那么宽
  const gutterWidth = useMemo(() => {
    const digits = Math.max(2, String(Math.max(1, String(content || '').split('\n').length)).length)
    return digits * 8 + 10
  }, [content])

  const lineNums = useMemo(() => {
    const n = Math.max(1, String(content || '').split('\n').length)
    return Array.from({ length: n }, (_, i) => i + 1)
  }, [content])


  /** 把本地图片文件存进工作区 assets/ 并插入到光标处 */
  const uploadImageFile = async (file: File) => {
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const fr = new FileReader()
        fr.onload = () => resolve(String(fr.result || ''))
        fr.onerror = () => reject(new Error('read failed'))
        fr.readAsDataURL(file)
      })
      const r = notes().saveImageToWorkspace?.('', dataUrl, useNotes.getState().currentRel) as
        | { ok: boolean; rel?: string; message?: string }
        | undefined
      if (!r || !r.ok || !r.rel) {
        useNotes.getState().setMessage(r?.message || '图片保存失败', 2400)
        return
      }
      editor.tf.insertNodes({
        type: 'img',
        url: r.rel,
        caption: [{ text: file.name.replace(/\.[^.]+$/, '') }],
        children: [{ text: '' }],
      } as never)
    } catch (err) {
      useNotes.getState().setMessage('图片插入失败', 2400)
    }
  }

  /** 灌入内容期间会触发 onValueChange，用它挡住回写，避免「打开即脏」 */
  const loadingRef = useRef(false)

  const plugins = useMemo(
    () => [
      ParagraphPlugin.configure({ render: { node: ParagraphElement } }),
      H1Plugin.configure({ render: { node: H1Element } }),
      H2Plugin.configure({ render: { node: H2Element } }),
      H3Plugin.configure({ render: { node: H3Element } }),
      H4Plugin.configure({ render: { node: H4Element } }),
      H5Plugin.configure({ render: { node: H5Element } }),
      H6Plugin.configure({ render: { node: H6Element } }),
      BlockquotePlugin.configure({ render: { node: BlockquoteElement } }),
      HorizontalRulePlugin.configure({ render: { node: HrElement } }),
      BasicMarksPlugin,
      // BasicMarksPlugin 不含 Highlight，必须单独注册
      HighlightPlugin,
      // BasicMarksPlugin 里没有 Highlight，必须单独注册，否则 ==高亮== 只去掉标记不渲染
      TablePlugin.configure({ render: { node: TableElement } }),
      TableRowPlugin.configure({ render: { node: TableRowElement } }),
      TableCellPlugin.configure({ render: { node: TableCellElement } }),
      TableCellHeaderPlugin.configure({ render: { node: TableCellElement } }),
      CodeBlockPlugin.configure({
        options: { lowlight, defaultLanguage: 'text' },
        render: { node: CodeBlockElement },
      }),
      CodeLinePlugin.configure({ render: { node: CodeLineElement } }),
      // CodeSyntaxLeaf 是 leaf 组件，之前错配成 render.node 导致渲染器从不触发、语法高亮全无
      // 两个插件都要给 lowlight：实测只配 CodeBlockPlugin 时 token 恒为 0
      CodeSyntaxPlugin.configure({ options: { lowlight }, render: { leaf: CodeSyntaxLeaf } }),
      ListPlugin,
      EquationPlugin.configure({ render: { node: EquationElement } }),
      InlineEquationPlugin.configure({ render: { node: InlineEquationElement } }),
      LinkPlugin.configure({ render: { node: LinkElement } }),
      ImagePlugin.configure({ render: { node: ImageElement } }),
      SearchHitPlugin,
      MarkdownPlugin.configure({
        options: {
          // GFM 才有表格、任务列表、删除线；公式要 remark-math
          remarkPlugins: [remarkGfm, remarkMath],
          remarkStringifyOptions: stringify,
          rules: {
            // 图片尺寸：有 width 就写成 HTML <img src width>，没有就走默认 ![alt](url)。
            //
            // 为什么是 HTML 而不是 markdown 语法：markdown 本身没有图片尺寸标准，
            // {width=50%} 这类属性扩展只有 pandoc 系认；HTML img 的 width 属性
            // Obsidian / Typora / VS Code / GitHub 都认，是唯一能跨编辑器生效的写法。
            // 只在用户真的拖过缩放条时才生成 HTML，没动过的图片源文件保持干净。
            //
            // 反序列化方向由 md-marks.ts 的 preDeserialize + restoreHtmlImgs 负责：
            // remark-mdx 见到不带 /> 的 <img> 会直接抛错，所以必须在解析前摘走。
            img: {
              // 类型上 @platejs/markdown 声明 serialize 只返回 mdast Image，
              // 但运行时允许返回 paragraph / html（它自己的默认 img 规则就返回 paragraph），
              // 所以这里显式放宽类型。
              serialize: ((node: Record<string, unknown>) => {
                const url = String(node.url || '')
                const cap = Array.isArray(node.caption) ? (node.caption as Array<{ text?: string }>) : []
                const alt = cap.map((c) => String((c && c.text) || '')).join('')
                const w = Number(node.width)
                const pctW = typeof node.widthPct === 'string' ? node.widthPct : ''
                let widthAttr = ''
                if (Number.isFinite(w) && w > 0) widthAttr = ' width="' + Math.round(w) + '"'
                else if (pctW) widthAttr = ' width="' + escHtmlAttr(pctW) + '"'

                if (!widthAttr) {
                  return {
                    type: 'paragraph',
                    children: [
                      {
                        type: 'image',
                        url,
                        alt: alt || undefined,
                        title: typeof node.title === 'string' ? node.title : undefined,
                      },
                    ],
                  }
                }
                return {
                  type: 'html',
                  value:
                    '<img src="' + escHtmlAttr(url) + '" alt="' + escHtmlAttr(alt) + '"' + widthAttr + '>',
                }
              }) as never,
            },
          },
        },
      }),
    ],
    []
  )

  const editor = usePlateEditor({ plugins })

  // PlateContent 不透传 onKeyDown（@platejs/react 没有这个 prop），
  // 之前在它上面挂的快捷键和代码块跳出其实从来没生效过。
  // 改成 window capture 阶段监听，和搜索上下键用的是同一套可靠做法。
  const editorRefLive = useRef(editor)
  editorRefLive.current = editor

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (locked) return
      const ed = editorRefLive.current as unknown as {
        api?: Record<string, (...a: unknown[]) => unknown>
        tf?: Record<string, (...a: unknown[]) => unknown>
        selection?: { anchor?: { path: number[]; offset: number }; focus?: { path: number[]; offset: number } }
        children?: unknown[]
      }
      if (!ed?.api || !ed?.tf) return

      const target = ev.target as HTMLElement | null
      if (target && !target.closest('.plate-content')) return
      if ((ev as unknown as { isComposing?: boolean }).isComposing) return

      // ---------- 1) 代码块逃逸：只在最后一行按 ↓ 时跳出去 ----------
      // 回车不做逃逸：写代码经常要在末尾留空行，回车一按就跳出去会打断输入。
      // 跳出给三个明确入口：↓ 键、块下方判定带、点下方段落。
      const isDown = ev.key === 'ArrowDown' && !ev.shiftKey && !ev.ctrlKey && !ev.metaKey
      if (isDown) {
        try {
          const lineEntry = (ed.api.block as unknown as () => [Record<string, unknown>, number[]] | undefined)()
          const line = lineEntry?.[0] as { type?: string; children?: { text?: string }[] } | undefined
          if (line && line.type === 'code_line') {
            const linePath = lineEntry![1]
            const parentEntry = (ed.api.parent as unknown as (p: number[]) => [Record<string, unknown>, number[]] | undefined)(linePath)
            if (parentEntry) {
              const [block, blockPath] = parentEntry
              const lines = Array.isArray(block.children) ? (block.children as unknown[]) : []
              const atLastLine = linePath[linePath.length - 1] === lines.length - 1
              const lineText = (line.children || []).map((c) => String(c.text || '')).join('')
              const sel = ed.selection
              const atEnd = !!sel?.focus && sel.focus.offset >= lineText.length

              if (atLastLine && atEnd) {
                ev.preventDefault()
                ev.stopPropagation()
                const after = blockPath.slice()
                after[after.length - 1] = after[after.length - 1] + 1
                const nextNode = (ed.api.node as unknown as (p: number[]) => [Record<string, unknown>] | undefined)(after)
                if (!nextNode) {
                  ;(ed.tf.insertNodes as unknown as (n: unknown, o: unknown) => void)(
                    { type: KEYS.p, children: [{ text: '' }] },
                    { at: after }
                  )
                }
                ;(ed.tf.select as unknown as (p: unknown) => void)({ path: [...after, 0], offset: 0 })
                return
              }
            }
          }
        } catch (err) {
          console.error('[code-escape]', err)
        }
      }

      // ---------- 2) 快捷键 ----------
      if (ev.altKey) return
      const mod = ev.ctrlKey || ev.metaKey
      if (!mod) return
      const api = useNotes.getState().editorApi
      if (!api) return
      const key = ev.key.toLowerCase()

      if (ev.shiftKey) {
        if (key === 'k') { ev.preventDefault(); api.insertNode('codeblock') }
        else if (key === 'q') { ev.preventDefault(); api.toggleBlock('blockquote') }
        else if (key === 'o') { ev.preventDefault(); api.toggleBlock('task-list') }
        else if (ev.code === 'BracketLeft' || key === '{') { ev.preventDefault(); api.toggleBlock('numbered-list') }
        else if (ev.code === 'BracketRight' || key === '}') { ev.preventDefault(); api.toggleBlock('bulleted-list') }
        return
      }

      if (key === 't') { ev.preventDefault(); api.insertNode('table') }
      else if (key === '0') { ev.preventDefault(); api.toggleBlock('paragraph') }
      else if (/^[1-6]$/.test(key)) { ev.preventDefault(); api.toggleBlock('heading', Number(key) as 1 | 2 | 3) }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [locked])

  /**
   * 切到某个命中文件后，把正文里第一处高亮滚进视野。
   * 命中可能在屏幕外（长笔记尤其明显），不滚的话切过去等于什么都没看到。
   */
  useEffect(() => {
    if (!String(searchTerm || '').trim()) return
    if (!currentRel) return
    const timer = window.setTimeout(() => {
      const el = document.querySelector('.search-hit-mark')
      if (!(el instanceof HTMLElement)) return
      try {
        el.scrollIntoView({ block: 'center', inline: 'nearest' })
      } catch (e) {}
    }, 380)
    return () => window.clearTimeout(timer)
    // 不监听 content：一边搜索一边改正文时，每敲一次都会被拽回第一处命中
  }, [currentRel, searchTerm])

  /**
   * 渲染期就把词交给 decorate。
   * effect 要等这次渲染提交后才跑，那一帧 decorate 读到的还是旧词，
   * 表现为高亮慢一拍；渲染期赋值 + effect 只负责 redecorate 就没有这个空窗。
   */
  setSearchTermForDecorate(searchTerm)

  /** 搜索词变化：触发重新装饰（editor 只在挂载时建，插件不能重建） */
  useEffect(() => {
    try {
      ;(editor.api as unknown as { redecorate?: () => void }).redecorate?.()
    } catch (e) {}
  }, [searchTerm, editor])

  /** 切笔记：把 md 灌进去 */
  useEffect(() => {
    if (!currentRel) return
    try {
      const srcMd = content || ''
      const parsedRaw = postDeserialize(
        editor.getApi(MarkdownPlugin).markdown.deserialize(preDeserialize(srcMd)) as never,
      ) as unknown as unknown[]
      // 裸 URL / 裸邮箱会被 GFM autolink 变成链接，序列化又写成 <mailto:...> / [x](x)，
      // 等于擅自改写用户原文。这里把"文字就是地址"的链接拆回纯文本。
      let parsed = parsedRaw
      try {
        parsed = flattenAutolinks(parsedRaw as unknown[]) as unknown as typeof parsedRaw
      } catch (e) {}
      // 表格列对齐只存在于 markdown 的分隔行里，Plate 的表格规则不读它 ——
      // 不在这里回填，用户改完对齐切个文件就还原
      try {
        fillTableAligns(parsed as unknown[], extractTableAligns(srcMd))
      } catch (e) {}
      // 不再往树里补空段落：那会改变源码的渲染结果（块上下凭空多出空行）。
      // 插入位置改由块元素自己的上下判定带负责（点一下就在块前/块后落光标，
      // 只在该处确实没有段落时才新建），见 plate-elements.tsx 的 placeBesideVoid。
      const value = parsed as unknown[]
      loadingRef.current = true
      editor.tf.setValue((value && value.length ? value : EMPTY) as never)
      window.setTimeout(() => {
        loadingRef.current = false
      }, 0)
    } catch (e) {
      console.error('[cmark] deserialize 失败', e)
      loadingRef.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentRel, sourceMode, loadRevision])

  /** 字号：与 V1.0.0 的 12..16 五档一致 */
  const wrapStyle = useMemo(
    () => ({ ['--cmark-body-font-size' as string]: bodyFontSize + 'px' }),
    [bodyFontSize]
  )

  /** 把编辑器能力交给 store：顶部工具栏、AI 插入都走这套接口 */
  useEffect(() => {
    const MARKS: Record<string, string> = {
      bold: KEYS.bold,
      italic: KEYS.italic,
      underline: KEYS.underline,
      code: KEYS.code,
      strike: KEYS.strikethrough,
      highlight: KEYS.highlight,
    }

    setEditorApi({
      toggleMark(mark) {
        const key = MARKS[mark]
        if (!key) return
        try {
          // 选区是否已整段带这个 mark（决定这次是开还是关）
          const alreadyOn = !!editor.api.mark(key)

          if (key === 'highlight' && !alreadyOn) {
            // 高亮只作用于选中的这段文字，不保持"继续输入也高亮"。
            // 不能用 toggleMark 后再 removeMark：toggleMark 的写入是异步的，
            // removeMark 会先跑，结果 mark 一条都没写进 text。
            // 这里直接同步给选中的叶子打标记，再清掉"待输入"状态。
            editor.tf.setNodes({ [key]: true } as never, {
              match: (n) => Text.isText(n),
              split: true,
            })
            // 折叠光标到高亮文字末尾：否则选区还亮着，用户一打字就把刚高亮的字替换掉
            editor.tf.collapse({ edge: 'focus' })
            // 段中场景顺手挪到下一个文本节点开头，这样输入用的是普通文本的格式
            const sel = editor.selection
            if (sel) {
              const next = [...sel.focus.path]
              next[next.length - 1] += 1
              try {
                const pp = next.slice(0, next.length - 1)
                const parent = editor.api.node(pp)?.[0] as { children?: unknown[] } | undefined
                const idx = next[next.length - 1]
                if (parent && Array.isArray(parent.children) && idx < parent.children.length) {
                  editor.tf.select({ path: next, offset: 0 })
                }
              } catch (err) {
                console.error('[highlight-next]', err)
              }
            }
            // 高亮落在段末时后面没有文本节点，Slate 会沿路径继承 mark（继续高亮）。
            // 清 marks 必须用空对象而不是 null：null 会让 Slate 回退到继承相邻叶子，
            // 空对象才表示「明确不加任何 mark」。
            const edm = editor as unknown as { marks?: Record<string, unknown> | null }
            edm.marks = {}
            return
          }

          editor.tf.toggleMark(key)
        } catch (e) {}
      },
      setLink(href: string) {
        try {
          const sel = editor.selection
          if (!sel) return
          const collapsed =
            sel.anchor.offset === sel.focus.offset && sel.anchor.path.join() === sel.focus.path.join()
          if (collapsed) {
            // 没有选中文字：插入链接文字本身
            editor.tf.insertNodes({ type: KEYS.link, url: href, children: [{ text: href }] } as never)
          } else {
            // 选中了文字：把选区包成链接。link 在 Plate 里是 element，不是 leaf mark，
            // 之前写成 { text, a:url } 会被当普通文本，保存后 URL 直接丢
            editor.tf.wrapNodes({ type: KEYS.link, url: href, children: [] } as never, { split: true })
          }
        } catch (err) {
          console.error('[setLink]', err)
        }
      },
      toggleBlock(kind, level) {
        try {
          if (kind === 'heading') {
            const key = KEYS[('h' + (level || 1)) as 'h1']
            editor.tf.toggleBlock(key)
          } else if (kind === 'blockquote') {
            editor.tf.toggleBlock(KEYS.blockquote)
          } else if (kind === 'paragraph') {
            editor.tf.toggleBlock(KEYS.p)
          } else {
            const style = kind === 'numbered-list' ? 'decimal' : kind === 'task-list' ? 'todo' : 'disc'
            toggleList(editor as never, style as never)
          }
        } catch (e) {}
      },
      insertNode(kind) {
        try {
          if (kind === 'codeblock') {
            // 代码块后面必须留一个段落：它能接住光标，否则用户只能一直待在块里
            editor.tf.insertNodes([
              {
                type: KEYS.codeBlock,
                lang: 'js',
                children: [{ type: KEYS.codeLine, children: [{ text: '' }] }],
              },
              { type: KEYS.p, children: [{ text: '' }] },
            ] as never)
            // 光标回到代码块第一行
            const idx = editor.children.findIndex((n) => (n as { type?: string }).type === KEYS.codeBlock)
            if (idx >= 0) editor.tf.select({ path: [idx, 0, 0], offset: 0 })
          } else if (kind === 'table') {
            editor.tf.insertNodes([{
              type: KEYS.table,
              children: [
                {
                  type: KEYS.tr,
                  children: [
                    { type: KEYS.th, children: [{ type: KEYS.p, children: [{ text: '列一' }] }] },
                    { type: KEYS.th, children: [{ type: KEYS.p, children: [{ text: '列二' }] }] },
                  ],
                },
                {
                  type: KEYS.tr,
                  children: [
                    { type: KEYS.td, children: [{ type: KEYS.p, children: [{ text: '' }] }] },
                    { type: KEYS.td, children: [{ type: KEYS.p, children: [{ text: '' }] }] },
                  ],
                },
              ],
            } as never, { type: KEYS.p, children: [{ text: '' }] }] as never)
          } else if (kind === 'hr') {
            editor.tf.insertNodes({ type: KEYS.hr, children: [{ text: '' }] } as never)
          } else if (kind === 'math') {
            // 先弹窗写 LaTeX，确定后再插入节点 —— 插入和编辑共用同一个弹窗，
            // 也不用去猜刚插入节点的路径
            openEquationDialog({
              tex: '',
              title: '插入公式',
              onApply: (next) => {
                try {
                  editor.tf.insertNodes({
                    type: KEYS.equation,
                    texExpression: next,
                    children: [{ text: '' }],
                  } as never)
                } catch (err) {
                  console.error('[insert-equation]', err)
                }
              },
            })
          }
        } catch (e) {}
      },
      insertText(text: string) {
        try {
          editor.tf.insertText(text)
        } catch (e) {}
      },
      insertImage(rel: string, alt?: string) {
        try {
          editor.tf.insertNodes({
            type: 'img',
            url: rel,
            caption: [{ text: alt || '' }],
            children: [{ text: '' }],
          } as never)
        } catch (e) {}
      },
      insertMarkdown(md: string) {
        try {
          const nodes = postDeserialize(
          editor.getApi(MarkdownPlugin).markdown.deserialize(preDeserialize(md)) as never,
        )
          editor.tf.insertNodes(nodes as never)
        } catch (e) {}
      },
      focus() {
        try {
          editor.tf.focus()
        } catch (e) {}
      },
    })

    return () => setEditorApi(null)
  }, [editor, setEditorApi, sourceMode])

  /**
   * 把编辑器实例交给 store：SearchDialog（笔记内查找）要靠它取选区、定位命中。
   * 之前只有旧版 Editor.tsx 调过 setEditor，换成 EditorPlate 后没人调，
   * store.editor 永远是 null —— App 里那段 `editorInstance ? <SearchDialog/>` 就永远不渲染，
   * Ctrl+Shift+F 按下去什么都不出现。
   */
  useEffect(() => {
    if (sourceMode) return
    // Plate 自带一份 slate 类型，和 store 里声明的 SlateEditor 名义上不同；
    // 运行时是同一个编辑器对象（selection / children 都在），这里只是过类型。
    setEditor(editor as unknown as Parameters<typeof setEditor>[0])
    return () => setEditor(null)
  }, [editor, setEditor, sourceMode])

  // 源码模式是纯文本编辑，富文本 API 一律不可用：置空后工具栏按钮自动 disabled，
  // 不会再出现「点了没反应」的错觉
  useEffect(() => {
    if (sourceMode) setEditorApi(null)
  }, [sourceMode, setEditorApi])

  // 源码模式：直接编辑 Markdown 原文，不经过 Plate
  if (sourceMode) {
    return (
      <div className={'plate-host is-source' + (locked ? ' is-locked' : '')} style={wrapStyle}>
        <div className="source-gutter" style={{ width: gutterWidth }} aria-hidden="true">
          <div className="source-gutter-inner" style={{ transform: `translateY(-${sourceScroll}px)` }}>
            {lineNums.map((n) => (
              <div key={n} className="source-ln">
                {n}
              </div>
            ))}
          </div>
        </div>
        <textarea
          ref={sourceTaRef}
          className="source-editor"
          value={content}
          spellCheck={false}
          readOnly={locked}
          onChange={(e) => setContent(e.target.value)}
          onScroll={() => setSourceScroll(sourceTaRef.current?.scrollTop || 0)}
        />
      </div>
    )
  }

  return (
    <div className={'plate-host' + (locked ? ' is-locked' : '')} style={wrapStyle}>
      {/* 公式弹窗宿主：块级/行内公式的编辑按钮和「插入公式」都触发它 */}
      <EquationDialogHost />
      <Plate
        editor={editor}
        onValueChange={({ value }) => {
          if (loadingRef.current) return
          try {
            {
              // mark → 占位符 → 序列化 → 占位符 → 真实标记
              // 直接序列化会把 Plate 不认识的 mark（highlight/sub/sup）丢掉
              try {
                // 序列化前同样降级：用户在编辑器里敲出裸 URL / 邮箱时，link 插件可能已把它变成链接，
                // 不在这里拦掉就会写回 [x](x) / <x@y.com>
                let cleanValue: unknown[] = stripSynthetic(value as any[])
                try {
                  cleanValue = flattenAutolinks(cleanValue) as unknown[]
                } catch (e) {}
                const withPh = markToPlaceholder(protectSyntax(cleanValue as any) as never)
                const raw = editor.getApi(MarkdownPlugin).markdown.serialize({ value: withPh as never })
                // 序列化器统一写 `---`，这里按节点上的 align 还原成 `:---:` / `---:`
                let outMd = placeholderToMd(raw)
                try {
                  outMd = applyTableAligns(outMd, collectTableAligns(value as unknown[]))
                } catch (e) {}
                // 收尾：remark 会把正文里的 @ . 转义成 \@ \.（怕被当成 autolink），
                // 还会在末尾堆空行，这里统一还原/压缩
                try {
                  outMd = tidyMarkdown(outMd)
                } catch (e) {}
                setContent(outMd)
              } catch (err) {
                // 序列化抛错时绝不能静默：一旦吞掉，setContent 不再被调用，
                // 此后所有输入既不写回也不自动保存，用户完全无感知
                console.error('[serialize]', err)
                useNotes
                  .getState()
                  .setMessage('保存失败：' + ((err as Error)?.message || '序列化出错'), 5000)
              }
            }
          } catch (e) {}
          try {
            const m = editor.api.marks() as Record<string, unknown> | null
            const b = editor.api.block() as
              | { type?: string; level?: number; listStyleType?: string; checked?: unknown }
              | undefined

            // Toolbar 的 isActive 认的是 'heading' / 'bulleted-list' 这套旧名字，
            // 而 Plate 的节点类型是 h1..h6 / p + listStyleType / code_block。
            // 不在这里翻译，工具栏的按下态永远不会亮。
            const t = String(b?.type || 'p')
            let block: { type: string; level?: number; checked?: boolean } = { type: 'paragraph' }
            if (/^h[1-6]$/.test(t)) block = { type: 'heading', level: Number(t[1]) }
            else if (t === 'blockquote') block = { type: 'blockquote' }
            else if (t === 'code_block') block = { type: 'codeblock' }
            else if (t === 'equation') block = { type: 'math' }
            else if (t === 'p') {
              if (b?.checked !== undefined) block = { type: 'list-item', checked: !!b.checked }
              else if (b?.listStyleType === 'disc') block = { type: 'bulleted-list' }
              else if (b?.listStyleType === 'decimal') block = { type: 'numbered-list' }
            }

            setActive(
              {
                bold: !!m?.bold,
                italic: !!m?.italic,
                underline: !!m?.underline,
                code: !!m?.code,
                strike: !!m?.strikethrough,
                highlight: !!m?.highlight,
                link: !!(m?.link || m?.url),
              },
              block
            )
          } catch (e) {}
        }}
      >
        <PlateContent
          className="plate-content"
          readOnly={locked}
          spellCheck={false}
          onPaste={(ev) => {
            // 剪贴板里的图片有时只在 items 里、files 为空。
            // 只查 files 会漏掉这种情况，浏览器就会按默认行为插一个 data:base64 的 img，
            // 结果图片被内联进 md 文件，而不是落到附件目录。
            const dt = ev.clipboardData
            if (!dt) return

            let imgFile: File | null = null

            if (dt.files && dt.files.length) {
              for (const f of Array.from(dt.files)) {
                if (f.type.startsWith('image/')) {
                  imgFile = f
                  break
                }
              }
            }

            if (!imgFile && dt.items) {
              for (const it of Array.from(dt.items)) {
                if (it.kind === 'file' && it.type.startsWith('image/')) {
                  const f = it.getAsFile()
                  if (f) {
                    imgFile = f
                    break
                  }
                }
              }
            }

            if (!imgFile) return

            // 必须拦住，否则浏览器/插件还会再插一次 base64 的图
            ev.preventDefault()
            ev.stopPropagation()
            void uploadImageFile(imgFile)
          }}
        />
      </Plate>
    </div>
  )
}/** 序列化前剔除合成节点（当前已不再往树里插合成段落，保留作防御） */
function stripSynthetic(nodes: any[]): any[] {
  const out: any[] = []
  for (const n of Array.isArray(nodes) ? nodes : []) {
    if (n && n.synthetic) continue
    if (Array.isArray(n?.children)) out.push({ ...n, children: stripSynthetic(n.children) })
    else out.push(n)
  }
  return out
}


