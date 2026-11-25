/**
 * 笔记导出：Markdown / HTML / PDF / 图片
 *
 * 唯一实现。任何导出入口（「更多」菜单、以后可能加的侧边栏/快捷键）都必须调这里，
 * 不要再各自写一份 —— 之前 ExportMenu.tsx 和 MoreMenu.tsx 各有一套，
 * 改了一套另一套还是旧的，用户点了没反应。
 *
 * 核心原则：导出必须和编辑区所见一致。
 * 所以不走 marked 重新渲染，而是直接把编辑区 DOM 快照下来，
 * 逐元素内联 computed style，连同图表 SVG、katex 公式、代码 token 配色一起带走。
 */

import { hasNotes, notes } from '../../runtime/legacy-bridge'
export type ExportKind = 'md' | 'html' | 'pdf' | 'image'

type Svc = {
  writeMarkdownFile?: (
    dir: string,
    name: string,
    content: string,
    paths: Array<string | { from: string; name: string }>
  ) => { ok?: boolean; canceled?: boolean; message?: string } | undefined
  writeHtmlFile?: (
    dir: string,
    name: string,
    html: string,
    extra?: string[],
    withKatex?: boolean,
    selfContained?: boolean,
    theme?: 'light' | 'dark'
  ) => { ok?: boolean; canceled?: boolean; message?: string } | undefined
  exportFile?: (
    type: 'pdf' | 'image',
    html: string,
    extraCss: string,
    cb: (err: Error | null, path?: string) => void,
    outDir?: string,
    theme?: 'light' | 'dark'
  ) => void
  dialogSaveExportFile?: (tmpPath: string, name: string, ext: string) => unknown
  getKatexCss?: () => string
  pickExportDir?: () => { ok: boolean; dir?: string; canceled?: boolean; message?: string }
}

/**
 * 宿主桥：只认 window.__CMARK。
 *
 * 不要再退回 window.services —— preload 里那份 services.js 是 V1.0.0 的另一套实现，
 * 与这里的调用约定不一致（缺 pickExportDir / getKatexCss，返回路径字符串而不是 {ok,...}）。
 * 退回它实测的后果是：md/html 导出一律被判成「已取消导出」（pickExportDir 取不到），
 * PDF/图片走它自己的 createBrowserWindow 路径会把渲染进程卡死。
 */
function svc(): Svc | undefined {
  return hasNotes() ? (notes() as unknown as Svc) : undefined
}

/* ================= 编辑区 DOM 快照 ================= */

/**
 * 交互元素不进导出物。
 * 新增任何只在编辑态出现的控件（按钮、滑杆、浮层、判定带），都必须加进这个列表，
 * 否则它会在鼠标悬停时被快照进去，出现在导出图片里。
 * 踩过：图片工具条从 .img-tools 改名成 .img-handle 时漏了这条，
 * 导出的长图里就带着缩放滑杆和两个按钮。
 */
const SNAPSHOT_STRIP = [
  '.void-gap',
  '.code-head',
  '.code-lang',
  '.code-lang-list',
  '.code-editor-copy',
  '.table-caption',
  '.table-float-toolbar',
  '.img-handle',
  '.img-tools',
  '.math-edit-pop',
  '.diagram-err',
  '.search-hit-mark',
  '.diagram-code-toggle',
  '.math-toggle',
  '.math-source',
  '.math-inline-toggle',
  '.table-code-panel',
]

/** 需要内联的样式属性：只留影响视觉的，避免把布局/交互状态也带出去 */
const SNAPSHOT_PROPS = [
  'color',
  'background-color',
  'background-image',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'line-height',
  'letter-spacing',
  'text-align',
  'text-decoration-line',
  'text-transform',
  'white-space',
  'word-break',
  'overflow-wrap',
  'vertical-align',
  'list-style-type',
  'list-style-position',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'border-top-width',
  'border-top-style',
  'border-top-color',
  'border-right-width',
  'border-right-style',
  'border-right-color',
  'border-bottom-width',
  'border-bottom-style',
  'border-bottom-color',
  'border-left-width',
  'border-left-style',
  'border-left-color',
  'border-top-left-radius',
  'border-top-right-radius',
  'border-bottom-left-radius',
  'border-bottom-right-radius',
  'border-collapse',
  'border-spacing',
  'display',
  'box-sizing',
  'max-width',
  'min-width',
  'max-height',
  'min-height',
  'width',
  'height',
  'opacity',
  // zoom 必须和 width/height 一起内联。
  // 被缩放的元素，computed width/height 是未缩放的原始值（实测图片 828px），
  // 而容器高度是按缩放后算的（393px）。只抄尺寸不抄 zoom，图片就会按 828px 撑开、
  // 溢出容器四百多像素，直接盖住下面的正文。
  'zoom',
  // —— 定位与布局：这一组漏了会导致整块内容飞掉 ——
  // ECharts 的 SVG 是 position:absolute，靠 .diagram-canvas 的 position:relative 兜住；
  // 不内联 position，导出后容器变 static，图形会相对外层祖先定位、直接错位。
  'position',
  'top',
  'left',
  'right',
  'bottom',
  'z-index',
  'float',
  'overflow',
  'overflow-x',
  'overflow-y',
  'justify-content',
  'align-items',
  'align-self',
  'flex-direction',
  'flex-wrap',
  'flex-grow',
  'flex-shrink',
  'gap',
  'row-gap',
  'column-gap',
  'table-layout',
  'text-overflow',
]

const SKIP_VALUES = new Set(['', 'none', 'normal', 'auto', '0px', 'rgba(0, 0, 0, 0)', 'transparent'])

function inlineStyles(el: HTMLElement, isRoot = false) {
  // katex 的上下标定位完全写在自己元素的内联 style 里
  // （strut 的 height+vertical-align、vlist 的 height、内部 span 的 top），
  // 我们一旦 setAttribute('style', ...) 就会把这些值整体冲掉，
  // 上标立刻掉到基线下面变成下标。所以 katex 子树原样保留，一个字都不动。
  if (!isRoot && el.closest('.katex')) return
  try {
    const cs = window.getComputedStyle(el)
    let s = ''
    for (const p of SNAPSHOT_PROPS) {
      const v = cs.getPropertyValue(p)
      if (!v || SKIP_VALUES.has(v)) continue
      // 根节点不要把 display/宽高抄进去，否则导出页面被钉死
      if (isRoot && (p === 'display' || p === 'width' || p === 'height' || p === 'max-width')) continue
      // 编辑器根上的 white-space: pre-wrap 会让导出物保留源码换行，视觉和编辑器不一致
      if (isRoot && (p === 'white-space' || p === 'overflow-wrap' || p === 'word-break')) continue
      s += p + ':' + v + ';'
    }
    if (s) el.setAttribute('style', s)
    else el.removeAttribute('style')
  } catch {
    /* getComputedStyle 对已卸载节点会抛，忽略 */
  }
  for (const c of Array.from(el.children)) {
    if (c instanceof HTMLElement) inlineStyles(c)
  }
}

/**
 * 把编辑区当前 DOM 直接快照成导出用 HTML。
 *
 * 关键点：cloneNode 出来的节点不在文档流里，getComputedStyle 读不到真实样式
 * （h1 的字号、.token 的配色全部读成空，实测内联成功的元素只有 18 个）。
 * 必须先挂到一个离屏容器里、保持和编辑器同样的宽度，读完再摘下来（136 个）。
 */
export function snapshotEditorHtml(noteRel?: string): { html: string; ok: boolean; message?: string } {
  const src = document.querySelector('.plate-content') as HTMLElement | null
  if (!src) return { html: '', ok: false, message: '编辑区未就绪，请先打开笔记' }

  const clone = src.cloneNode(true) as HTMLElement

  // 0) canvas 兜底换 img。
  //    cloneNode 只复制 DOM 结构，canvas 的位图内容不会跟着走 —— 快照里是一块空白。
  //    ECharts 现在已改用 svg renderer，正常不会走到这里；
  //    但如果以后有别的库往笔记里画 canvas（或旧笔记缓存了 canvas 实例），
  //    这一步能保证导出物不是空画布。必须在删交互元素之前做，保证两边 canvas 顺序一致。
  const srcCanvases = Array.from(src.querySelectorAll('canvas'))
  if (srcCanvases.length) {
    const dstCanvases = Array.from(clone.querySelectorAll('canvas'))
    srcCanvases.forEach((cv, i) => {
      const dst = dstCanvases[i]
      if (!dst) return
      let data = ''
      try {
        data = cv.toDataURL('image/png')
      } catch {
        return // 跨域污染的画布取不出来，保持原样
      }
      if (!data || data === 'data:,') return
      const cs = window.getComputedStyle(cv)
      const img = document.createElement('img')
      img.setAttribute('src', data)
      img.setAttribute('alt', cv.getAttribute('aria-label') || 'chart')
      // 物理像素写属性、CSS 像素写样式，高清屏下不糊
      if (cv.width) img.setAttribute('width', String(cv.width))
      if (cv.height) img.setAttribute('height', String(cv.height))
      img.setAttribute('style', 'display:block;width:' + cs.width + ';height:' + cs.height + ';')
      dst.replaceWith(img)
    })
  }

  // 1) 去掉交互元素
  for (const sel of SNAPSHOT_STRIP) {
    clone.querySelectorAll(sel).forEach((n) => n.remove())
  }

  // 2) 图表源码块：编辑器把 mermaid/echarts 渲染图追加在源码块后面，
  //    导出时只保留渲染结果，否则源码和图片会重复出现
  clone.querySelectorAll('.diagram-box').forEach((box) => {
    let prev = box.previousElementSibling
    while (prev) {
      const cls = prev.className || ''
      if (typeof cls === 'string' && /code-block-wrap|code-editor/.test(cls)) {
        prev.remove()
        break
      }
      prev = prev.previousElementSibling
    }
  })

  // 3) 去掉 Slate / Plate 的内部属性（根节点也要清，querySelectorAll 不含它自己）
  const allNodes: HTMLElement[] = [clone, ...Array.from(clone.querySelectorAll('*'))].filter(
    (n): n is HTMLElement => n instanceof HTMLElement
  )
  for (const el of allNodes) {
    for (const attr of Array.from(el.attributes)) {
      if (
        /^(data-slate|contenteditable|spellcheck|autocapitalize|autocorrect|role|translate|zindex)/i.test(attr.name)
      ) {
        el.removeAttribute(attr.name)
      }
    }
  }

  // 4) 图片转 base64（导出物要能脱离本机路径）
  const bridge = notes() as unknown as
    | {
        resolveImageUrl?: (s: string, rel?: string) => string
        readFileAsDataUri?: (p: string) => string | null
      }
    | undefined
  clone.querySelectorAll('img').forEach((img) => {
    const raw = img.getAttribute('src') || ''
    if (!raw || /^(https?:|data:)/i.test(raw)) return
    const abs = /^file:/i.test(raw) ? raw : bridge?.resolveImageUrl?.(raw, noteRel)
    const data = abs ? bridge?.readFileAsDataUri?.(abs) : null
    if (data) img.setAttribute('src', data)
    else if (abs) img.setAttribute('src', abs)
  })

  // 4.5) 图表 SVG 补 viewBox。
  //      echarts / mermaid 生成的 SVG 只写 width/height 属性、没有 viewBox，
  //      宽度是跟着编辑器窗口走的（实测 1648），而导出窗口只有 980。
  //      没有 viewBox 时 max-width 只能裁不能缩，图右边就被切掉了。
  //      补上 viewBox 再把尺寸交给 CSS，就能等比缩放铺满导出页。
  const svgs = Array.from(clone.querySelectorAll('.diagram-canvas svg, .diagram-box svg')) as SVGElement[]
  for (const svg of svgs) {
    const w = parseFloat(svg.getAttribute('width') || '')
    const h = parseFloat(svg.getAttribute('height') || '')
    if (!w || !h || svg.getAttribute('viewBox')) continue
    svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h)
    svg.removeAttribute('width')
    svg.removeAttribute('height')
    svg.setAttribute('style', 'display:block;width:100%;height:auto;max-width:100%;')
  }

  // 5) 离屏挂载 → 内联 computed style → 摘下
  const rect = src.getBoundingClientRect()
  const host = document.createElement('div')
  host.setAttribute(
    'style',
    'position:fixed;left:-99999px;top:0;width:' +
      Math.max(200, Math.round(rect.width)) +
      'px;pointer-events:none;visibility:hidden;z-index:-1'
  )
  host.appendChild(clone)
  document.body.appendChild(host)
  try {
    const srcEls: HTMLElement[] = [src]
    const dstEls: HTMLElement[] = [clone]
    const collect = (el: HTMLElement, bag: HTMLElement[]) => {
      for (const c of Array.from(el.children)) {
        if (c instanceof HTMLElement) {
          bag.push(c)
          collect(c, bag)
        }
      }
    }
    collect(src, srcEls)
    collect(clone, dstEls)
    const n = Math.min(srcEls.length, dstEls.length)
    for (let i = 0; i < n; i++) {
      inlineStyles(dstEls[i], i === 0)
    }
    return { html: clone.outerHTML, ok: true }
  } finally {
    host.removeChild(clone)
    document.body.removeChild(host)
  }
}

/** 导出附件：纯路径，或「源文件 + 目标文件名」（同名图片改名后必须成对传） */
export type ExportAttachment = string | { from: string; name: string }

/**
 * 把正文里的本地图片解析成绝对路径，供导出时一起复制；同时把引用改写成 ./文件名。
 *
 * 为什么必须做：笔记里的图片有三种写法（相对笔记 ../.cmark/attachments/x.png、
 * 相对工作区 assets/x.png、私有协议 attachment:<digest>），导出到别的目录后
 * 一个都打不开 —— md 能看，图全是断的。
 *
 * 三条硬约束（都踩过）：
 *   1. 代码块 / 行内代码里的 `![x](a.png)` 是示例文本，改写它等于改坏用户原文；
 *   2. 同名不同目录必须改名，且新名字要一起交给 preload —— 它按 basename 落盘，
 *      只传路径会把两张图写成同一个文件，正文里的 ./a-2.png 根本不存在；
 *   3. 名字里有空格或括号时 destination 必须用尖括号包住，否则 Markdown 解析不出路径。
 */
function collectMdImages(
  content: string,
  rel: string
): { text: string; attachments: ExportAttachment[]; missing: number } {
  const api = notes() as unknown as { resolveImageUrl?: (src: string, noteRel?: string) => string }
  const resolve = api.resolveImageUrl
  if (!resolve || !content) return { text: content, attachments: [], missing: 0 }

  const nameOf = (abs: string) => abs.split(/[\\/]/).pop() || 'image.png'
  const used = new Set<string>()
  const byAbs = new Map<string, string>()
  const attachments: ExportAttachment[] = []
  let missing = 0

  const unique = (base: string) => {
    if (!used.has(base)) {
      used.add(base)
      return base
    }
    const dot = base.lastIndexOf('.')
    const stem = dot > 0 ? base.slice(0, dot) : base
    const ext = dot > 0 ? base.slice(dot) : ''
    let i = 2
    let cand = `${stem}-${i}${ext}`
    while (used.has(cand)) {
      i++
      cand = `${stem}-${i}${ext}`
    }
    used.add(cand)
    return cand
  }

  const IMG = /(!\[[^\]]*\]\()(<[^>]*>|[^)\s]+)((?:\s+"[^"]*")?\))/g

  const rewrite = (seg: string) =>
    seg.replace(IMG, (m, head: string, rawSrc: string, tail: string) => {
      const src = rawSrc.startsWith('<') ? rawSrc.slice(1, -1) : rawSrc
      if (!src || /^(https?:|data:|mailto:)/i.test(src)) return m
      let fileUrl = ''
      try {
        fileUrl = resolve(src, rel) || ''
      } catch (e) {
        fileUrl = ''
      }
      if (!fileUrl) {
        missing++
        return m
      }
      let abs = ''
      try {
        const u = new URL(fileUrl)
        let p = decodeURIComponent(u.pathname)
        if (/^\/[A-Za-z]:\//.test(p)) p = p.slice(1) // /D:/x.png → D:/x.png
        abs = p // 保持正斜杠：Node 的 fs 接口两条斜杠都接受，少一次转换少一个错
      } catch (e) {
        missing++
        return m
      }
      // Windows 路径大小写不敏感，同一张图不能因为大小写差异被当成两张
      const key = abs.toLowerCase()
      let name = byAbs.get(key)
      if (!name) {
        name = unique(nameOf(abs))
        byAbs.set(key, name)
        attachments.push({ from: abs, name })
      }
      const dest = /[\s()<>]/.test(name) ? '<./' + name + '>' : './' + name
      return head + dest + tail
    })

  // 先切出代码段（``` 围栏与 `行内`），只改写非代码段
  const parts = content.split(/(```[\s\S]*?```|`[^`\n]*`)/)
  const text = parts.map((seg, i) => (i % 2 === 1 ? seg : rewrite(seg))).join('')

  return { text, attachments, missing }
}

/* ================= 导出主流程 ================= */

type PickDirResult = { ok: true; dir: string } | { ok: false; canceled?: boolean; message?: string }

/** 三态：成功 / 用户取消 / 宿主不支持。「不支持」不能也报成「已取消导出」 */
function pickExportDir(): PickDirResult {
  const api = svc()
  if (!api?.pickExportDir) return { ok: false, message: '导出失败：宿主不支持选择导出目录' }
  try {
    const r = api.pickExportDir()
    if (!r) return { ok: false, message: '导出失败：选择目录没有返回结果' }
    if (r.canceled) return { ok: false, canceled: true }
    if (!r.ok || !r.dir) return { ok: false, canceled: true }
    return { ok: true, dir: r.dir }
  } catch (err) {
    console.error('[pickExportDir]', err)
    return { ok: false, message: '导出失败：' + ((err as Error)?.message || '选择目录出错') }
  }
}

/** 笔记自身所在目录（小写、正斜杠、去掉尾部斜杠），用于拦截「导出到自己目录」 */
function noteDirOf(rel: string): string {
  try {
    const api = notes() as unknown as { absOf?: (r: string) => string }
    const abs = String(api.absOf?.(rel) || '')
    if (!abs) return ''
    const s = abs.split(/[\\/]/).filter(Boolean).join('/').toLowerCase()
    return s.slice(0, s.lastIndexOf('/')).toLowerCase()
  } catch (e) {
    return ''
  }
}

const normDir = (p: string) => p.split(/[\\/]/).filter(Boolean).join('/').toLowerCase()

export type ExportOptions = {
  rel: string
  content: string
  setMessage: (msg: string, ms?: number) => void
  setBusy?: (kind: ExportKind | null) => void
}

/**
 * 导出笔记。所有入口共用这一个函数。
 * 成功/取消/失败都会通过 setMessage 反馈，不再出现"点了没反应"或"取消了还显示已导出"。
 */
export async function exportNote(kind: ExportKind, opts: ExportOptions): Promise<void> {
  const { rel, content, setMessage, setBusy } = opts
  if (!rel) return
  const S = svc()
  const baseName = rel.split('/').pop()!.replace(/\.(md|markdown)$/i, '') || '未命名'
  // 导出跟随当前主题：深色主题就该导出深色文档，
  // 否则深色文字配白色壳，和编辑区看到的完全是两回事
  const theme: 'light' | 'dark' =
    document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'

  setBusy?.(kind)
  try {
    if (!S) {
      setMessage('导出失败：宿主接口不可用（__CMARK 未注入）', 3600)
      return
    }

    // Markdown 直接写原文，不经过任何渲染
    if (kind === 'md') {
      const picked = pickExportDir()
      if (!picked.ok) {
        if (picked.canceled) setMessage('已取消导出', 1600)
        else setMessage(picked.message || '导出失败', 3600)
        return
      }
      const dir = picked.dir
      // 导出到笔记自己的目录 = 拿改写后的内容覆盖原笔记（图片引用会被写坏），必须拦住
      if (noteDirOf(rel) && noteDirOf(rel) === normDir(dir)) {
        setMessage('导出目录不能是笔记所在目录（会覆盖原笔记），请换一个目录', 4200)
        return
      }
      // 图片必须一起带走：正文里是相对笔记/工作区的路径或 attachment: 私有协议，
      // 原样导出到别的目录必然全断图
      const imgs = collectMdImages(content, rel)
      const r = S.writeMarkdownFile?.(dir, baseName, imgs.text, imgs.attachments)
      if (!r) {
        setMessage('导出失败：宿主未实现 writeMarkdownFile', 3600)
        return
      }
      if (r.canceled) {
        setMessage('已取消导出', 1600)
        return
      }
      if (!r.ok) {
        setMessage('导出失败：' + (r.message || '未知错误'), 3600)
        return
      }
      if (imgs.missing > 0) {
        // 不能静默：引用的图找不到时保留原路径，用户要知道有几张没跟上
        setMessage(`已导出 Markdown（${imgs.missing} 张图片未找到，已保留原引用）`, 4200)
      } else {
        setMessage(imgs.attachments.length ? `已导出 Markdown（含 ${imgs.attachments.length} 张图片）` : '已导出 Markdown', 2400)
      }
      return
    }

    // 其余三种都基于编辑区快照
    const snap = snapshotEditorHtml(rel)
    if (!snap.ok) {
      setMessage(snap.message || '导出失败：编辑区未就绪', 3600)
      return
    }

    // katex 的上下标靠自己的 CSS 精确定位（.vlist / .msupsub / vertical-align 组合），
    // 靠 insertCSS 注入在隐藏窗口里时机会飘，直接写进文档最稳
    const katexCss = S.getKatexCss?.() || ''
    const html = katexCss ? '<style>' + katexCss + '</style>' + snap.html : snap.html
    const hasMath = /class="katex/.test(html)

    if (kind === 'html') {
      const picked = pickExportDir()
      if (!picked.ok) {
        if (picked.canceled) setMessage('已取消导出', 1600)
        else setMessage(picked.message || '导出失败', 3600)
        return
      }
      const dir = picked.dir
      if (noteDirOf(rel) && noteDirOf(rel) === normDir(dir)) {
        setMessage('导出目录不能是笔记所在目录（会覆盖同名文件），请换一个目录', 4200)
        return
      }
      // selfContained = true：快照已内联全部样式，不能再套 github-markdown.css，
      // 否则那套样式会覆盖内联结果，导出的东西又和编辑区不一样
      const r = S.writeHtmlFile?.(dir, baseName, html, [], hasMath, true, theme)
      if (!r) {
        setMessage('导出失败：宿主未实现 writeHtmlFile', 3600)
        return
      }
      if (r.canceled) {
        setMessage('已取消导出', 1600)
        return
      }
      if (!r.ok) {
        setMessage('导出失败：' + (r.message || '未知错误'), 3600)
        return
      }
      setMessage('已导出 HTML', 2000)
      return
    }

    // PDF / 图片
    await new Promise<void>((resolve) => {
      const done = (msg: string, ms?: number) => {
        setMessage(msg, ms)
        resolve()
      }
      const cb = S.exportFile
      if (!cb) {
        done('导出失败：宿主未实现 exportFile', 3600)
        return
      }
      cb(kind, html, '', (err, path) => {
        if (err) {
          done('导出失败：' + err.message, 3600)
          return
        }
        if (!path) {
          done('导出失败：渲染窗口没有返回文件', 3600)
          return
        }
        let saved: unknown
        try {
          saved = S.dialogSaveExportFile?.(path, baseName, kind === 'image' ? 'png' : 'pdf')
        } catch (e) {
          done('导出失败：' + ((e as Error)?.message || ''), 3600)
          return
        }
        // null = 用户在保存框里取消了；{ok:false} = 保存失败（占用/无权限/磁盘满）；
        // undefined = 老版 preload 不返回值，按成功处理
        if (saved === null) {
          done('已取消导出', 1600)
          return
        }
        const saveRes = saved as { ok?: boolean; message?: string } | undefined
        if (saveRes && saveRes.ok === false) {
          done('导出失败：' + (saveRes.message || '保存失败'), 4000)
          return
        }
        // 成功也必须给反馈：以前这条链路全程静默，用户以为点了没反应
        done(kind === 'image' ? '已导出图像' : '已导出 PDF', 2000)
      }, undefined, theme)
    })
  } catch (e) {
    setMessage('导出失败：' + ((e as Error)?.message || ''), 3600)
  } finally {
    setBusy?.(null)
  }
}