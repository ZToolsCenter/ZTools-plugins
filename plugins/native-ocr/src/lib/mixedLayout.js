// 图文混排（mixed text + formula）纯逻辑模块。
//
// 设计目标：把「可测试、与 DOM 无关」的布局/序列化逻辑从 App.vue 中抽离出来，
// 既方便 node 侧单元测试，也方便 UI 直接用客户端逻辑渲染（不依赖服务端的 markdown）。
//
// 所有坐标约定为像素坐标 [x1, y1, x2, y2]（左上角原点，与 detect/recognize 的 box 一致）。
// 输入 textLines / formulaBoxes 的 box 既支持 [x1,y1,x2,y2] 数组，也支持 {x,y,w,h} 对象。

// ---------------------------------------------------------------------------
// 基础几何工具
// ---------------------------------------------------------------------------

function toXyxy(box) {
  if (!box) return [0, 0, 0, 0]
  if (Array.isArray(box)) {
    const [a, b, c, d] = box
    return [Number(a) || 0, Number(b) || 0, Number(c) || 0, Number(d) || 0]
  }
  if (typeof box === 'object') {
    if ('x1' in box && 'y1' in box && 'x2' in box && 'y2' in box) {
      return [box.x1, box.y1, box.x2, box.y2]
    }
    if ('x' in box && 'y' in box && 'w' in box && 'h' in box) {
      return [box.x, box.y, box.x + box.w, box.y + box.h]
    }
  }
  return [0, 0, 0, 0]
}

// macOS Vision（`VNRecognizedTextObservation.boundingBox`）给出的是**归一化到 0..1、且原点在左下角**
// 的 {x,y,w,h}；而 MFD 检测出的公式框、以及本模块内部约定，都是**原图像素、原点在左上**的
// [x1,y1,x2,y2]。两者不换算就混用会导致文本行坐标整体塌缩到 0..1（既不与任何公式框相交，
// 又全部挤进同一行），使合并顺序与「丢弃公式区域内的文本行」判定静默失效。
// 本函数按图像自然尺寸把该形式转成像素坐标（y 轴翻转），并夹取到图像范围内。
// 0.7.14 修复：输入框同时支持两种「归一化底左」形态——
//   1) {x,y,w,h} 对象（Vision 原始输出）；
//   2) [x1, yBottom, x2, yTop] 数组（App.vue 的 normalizeMixedBox 已把对象转成数组再传进来，
//      语义为 [左, 底, 右, 顶]）。此前只认对象形态，数组读 box.x 得 undefined → 全部文本行
//      退化为 [0,0,0,0]，服务端合并时文本永不与公式框同行 → 公式字形原样保留为文本、
//      公式又整体追加在末尾（正是「公式作为文字识别一遍 + 公式又输出一遍」的根因）。
export function normalizedBottomLeftToPixels(lines = [], width, height) {
  const w = Number(width)
  const h = Number(height)
  const clampX = (v) => Math.min(Math.max(v, 0), w)
  const clampY = (v) => Math.min(Math.max(v, 0), h)
  const usable = Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0
  return (lines || []).map((line) => {
    const box = line && line.box ? line.box : {}
    // 兼容两种形态，统一拆成 [x, yBottom, x2, yTop]（归一化底左）。
    let x, y, x2, yTop
    if (Array.isArray(box)) {
      ;[x, y, x2, yTop] = box.map(Number)
    } else {
      x = Number(box.x)
      y = Number(box.y)
      x2 = Number(box.x) + Number(box.w)
      yTop = Number(box.y) + Number(box.h)
    }
    if (!usable || ![x, y, x2, yTop].every(Number.isFinite)) {
      return { ...line, box: [0, 0, 0, 0] }
    }
    // 取整：像素空间的下游用途是画框与 IoU 判定，整数更直观且免去浮点尾数噪声。
    return {
      ...line,
      box: [
        Math.round(clampX(x * w)),
        Math.round(clampY((1 - yTop) * h)),
        Math.round(clampX(x2 * w)),
        Math.round(clampY((1 - y) * h))
      ],
      // 逐字符框（Vision 的 boundingBox(for:)）与行框同属归一化底左坐标系，必须一并换算，
      // 否则 splitTextLinePieces 拿归一化字符框去比像素公式框，永远匹配不上而静默退化为旧行为。
      chars: Array.isArray(line.chars)
        ? line.chars.map((ch) => {
            const cb = ch && ch.box
            if (!cb) return { c: ch && ch.c, box: null }
            // 与行框一致：对象 {x,y,w,h} 与数组 [x, yBottom, x2, yTop] 两种形态都支持。
            let cx, cy, cx2, cTop
            if (Array.isArray(cb)) {
              ;[cx, cy, cx2, cTop] = cb.map(Number)
            } else {
              cx = Number(cb.x)
              cy = Number(cb.y)
              cx2 = Number(cb.x) + Number(cb.w)
              cTop = Number(cb.y) + Number(cb.h)
            }
            if (!usable || ![cx, cy, cx2, cTop].every(Number.isFinite)) {
              return { c: ch.c, box: null }
            }
            return {
              c: ch.c,
              box: [
                Math.round(clampX(cx * w)),
                Math.round(clampY((1 - cTop) * h)),
                Math.round(clampX(cx2 * w)),
                Math.round(clampY((1 - cy) * h))
              ]
            }
          })
        : line.chars
    }
  })
}

function boxWidth(box) {
  return Math.max(0, box[2] - box[0])
}

function boxHeight(box) {
  return Math.max(0, box[3] - box[1])
}

function boxArea(box) {
  return boxWidth(box) * boxHeight(box)
}

function horizontalOverlap(a, b) {
  return Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]))
}

function verticalOverlap(a, b) {
  return Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]))
}

export function iou(a, b) {
  const areaA = boxArea(a)
  const areaB = boxArea(b)
  if (areaA <= 0 || areaB <= 0) return 0
  const inter = horizontalOverlap(a, b) * verticalOverlap(a, b)
  if (inter <= 0) return 0
  const union = areaA + areaB - inter
  return union > 0 ? inter / union : 0
}

// 一个 item 与某条「行带」（该行已收集 item 的纵向包络）的纵向重叠比例。
function verticalOverlapRatio(item, band) {
  const ov = verticalOverlap(item, band)
  const h = Math.min(boxHeight(item), boxHeight(band))
  return h > 0 ? ov / h : 0
}

function bandOf(items) {
  let y1 = Infinity
  let y2 = -Infinity
  let x1 = Infinity
  let x2 = -Infinity
  for (const it of items) {
    y1 = Math.min(y1, it.box[1])
    y2 = Math.max(y2, it.box[3])
    x1 = Math.min(x1, it.box[0])
    x2 = Math.max(x2, it.box[2])
  }
  return [x1, y1, x2, y2]
}

// 把一个文本行按公式框的横向区间切成**有序片段**（文本段 / 公式段交替），
// 从而得到真正的「图文混排」阅读顺序。
//
// 为什么需要它：Vision 会把「一行里既有文字又有行内公式」的整行读成**一条** observation，
// 其 boundingBox 横跨整行（含公式区）。若不做切分，只能把整行文本当成一段、公式再跟在其后，
// 渲染出来就是「先整行文字、再堆公式」，顺序是错的（且公式字形还会在文本里重复出现）。
// 有了逐字符框（Vision `boundingBox(for:)`），就能精确定位哪些字符落在公式区内并替换为公式段。
//
// 缺少 chars、长度不匹配、或没有任何字符落在公式区内时返回 null，调用方退回旧行为（安全降级）。
export function splitTextLinePieces(line, formulaItems) {
  const text = line && line.text != null ? String(line.text) : ''
  const chars = line && Array.isArray(line.chars) ? line.chars : null
  if (!text || !chars || chars.length !== text.length) return null
  if (!formulaItems || !formulaItems.length) return null
  if (!Array.isArray(line.box) || line.box[2] <= line.box[0]) return null

  const owner = new Array(text.length).fill(-1)
  for (let fi = 0; fi < formulaItems.length; fi += 1) {
    const f = formulaItems[fi]
    const fx1 = f.box[0]
    const fx2 = f.box[2]
    for (let i = 0; i < text.length; i += 1) {
      if (owner[i] !== -1) continue
      const cb = chars[i] && chars[i].box
      if (!cb) continue
      const cx = (cb[0] + cb[2]) / 2
      // 容差 1px：字符框与公式框来自两个独立模型，边界处常有 1px 内的错位。
      if (cx >= fx1 - 1 && cx <= fx2 + 1 && verticalOverlap(cb, f.box) > 0) owner[i] = fi
    }
  }
  // 平滑：Vision 对空白字符返回零面积框（x=0,w=0），其 center 落在所有公式区间之外，
  // 于是夹在公式字符序列中间的空格会「打断」归属，导致同一公式被切成两段（重复输出）
  // 外加一个只含空格的文本段。若某未归属字符两侧最近的非空归属字符属于同一公式，
  // 说明该字符本就夹在公式内部，直接并入。
  for (let i = 1; i < text.length - 1; i += 1) {
    if (owner[i] !== -1) continue
    let prev = i - 1
    while (prev >= 0 && owner[prev] === -1) prev -= 1
    let next = i + 1
    while (next < text.length && owner[next] === -1) next += 1
    if (prev >= 0 && next < text.length && owner[prev] === owner[next]) owner[i] = owner[prev]
  }
  if (!owner.some((o) => o !== -1)) return null

  const pieces = []
  let run = ''
  let runX1 = null
  let runX2 = null
  const flush = () => {
    if (!run) return
    pieces.push({
      type: 'text',
      text: run,
      latex: '',
      box: [runX1 == null ? line.box[0] : runX1, line.box[1], runX2 == null ? line.box[2] : runX2, line.box[3]],
      score: line.score
    })
    run = ''
    runX1 = null
    runX2 = null
  }
  let i = 0
  while (i < text.length) {
    const o = owner[i]
    if (o === -1) {
      // Vision 对空白字符（空格）返回零面积框（x=0,y=1,w=0,h=0）。若直接采用会把
      // runX1 拉回 0，使「紧跟在公式后的空格开头文本段」在排序时跑到行首。
      // 故只采信面积为正的字符框，其余仅贡献字符本身。
      const cb = chars[i] && chars[i].box
      const usableCb = cb && cb[2] - cb[0] > 0 && cb[3] - cb[1] > 0 ? cb : null
      run += text[i]
      if (usableCb) {
        if (runX1 == null) runX1 = usableCb[0]
        runX2 = usableCb[2]
      }
      i += 1
    } else {
      flush()
      const f = formulaItems[o]
      pieces.push({
        type: f.kind,
        latex: f.latex,
        text: '',
        box: f.box,
        score: f.score,
        formulaIndex: o
      })
      while (i < text.length && owner[i] === o) i += 1
    }
  }
  flush()
  return pieces
}

// ---------------------------------------------------------------------------
// 合并与排序：把文本行 + 公式框按阅读顺序整理成 segments
//
// 规则（与服务端一致）：
//  1) 文本行若与任一**独立公式**框 IoU > 0.1，或公式框横向跨度覆盖了该文本行 >60% 宽度，
//     则视为「文本行处于公式区域内」，丢弃该文本行（公式由公式识别负责）。
//     注意：行内公式的重合**不**触发丢弃（见下方注释）。
//  2) 剩余 item 按纵向重叠 > 0.5 归到同一行。
//  3) 行间按 y 自上而下，行内按 x 自左向右，生成最终 segments。
//  4) lineNumber 从 0 开始，每行递增。
// ---------------------------------------------------------------------------

export function mergeAndOrderSegments({ textLines = [], formulaBoxes = [] } = {}) {
  const items = []
  for (const t of textLines || []) {
    items.push({
      kind: 'text',
      text: t.text != null ? String(t.text) : '',
      box: toXyxy(t.box),
      score: Number.isFinite(t.score) ? t.score : 1,
      latex: '',
      // 逐字符框：用于把整行文本按公式区间切开（真交错渲染）。缺失时为 undefined。
      chars: Array.isArray(t.chars)
        ? t.chars.map((c) => ({ c: c && c.c, box: c && c.box ? toXyxy(c.box) : null }))
        : undefined
    })
  }
  for (const f of formulaBoxes || []) {
    const type = f.type === 'isolated' ? 'isolated' : 'embedding'
    items.push({
      kind: type,
      text: '',
      box: toXyxy(f.box),
      score: Number.isFinite(f.score) ? f.score : 1,
      latex: f.latex != null ? String(f.latex) : ''
    })
  }

  const formulas = items.filter((it) => it.kind !== 'text')

  const kept = items.filter((item) => {
    if (item.kind !== 'text') return true
    for (const f of formulas) {
      // 只有「独立公式」才可能整行就是公式，此时丢弃该文本行是正确的。
      // 行内公式（embedding）按定义就嵌在文本行内部，它与宿主行的重合绝不能
      // 导致整行被丢弃 —— 实测 Vision 会把整行文字读成一条 observation，
      // 若按 IoU>0.1 一刀切，含行内公式的整行文字会被静默丢掉（已复现：
      // mixed.jpg 底行「其中～利用 Gumbel-Softmax…」整行消失）。
      if (f.kind === 'isolated' && iou(item.box, f.box) > 0.1) return false
      // 仅当公式框与文本行在纵向上真正重叠（同一行）时，才用横向覆盖率判断，
      // 避免远处（不同行）但横向跨度很大的公式框误伤无关文本行。
      // 该规则仍然适用于行内公式：整行几乎被公式占满时，文本行确实没有多少文字。
      if (verticalOverlap(item.box, f.box) > 0) {
        const overlapW = horizontalOverlap(item.box, f.box)
        const coverage = boxWidth(item.box) > 0 ? overlapW / boxWidth(item.box) : 0
        if (coverage > 0.6) return false
      }
    }
    return true
  })

  const sorted = [...kept].sort((a, b) => a.box[1] - b.box[1] || a.box[0] - b.box[0])

  const lines = []
  for (const item of sorted) {
    let placed = false
    for (const line of lines) {
      const band = bandOf(line)
      if (verticalOverlapRatio(item.box, band) > 0.5) {
        line.push(item)
        placed = true
        break
      }
    }
    if (!placed) lines.push([item])
  }

  lines.sort((a, b) => bandOf(a)[1] - bandOf(b)[1])

  const segments = []
  lines.forEach((line, lineIndex) => {
    line.sort((a, b) => a.box[0] - b.box[0])
    const formulaItems = line.filter((it) => it.kind !== 'text')
    const textItems = line.filter((it) => it.kind === 'text')

    // 优先：用逐字符框把文本行按公式区间切开，得到真正交错的顺序。
    const pieces = []
    const consumed = new Set()
    let split = false
    for (const ti of textItems) {
      const parts = splitTextLinePieces(ti, formulaItems)
      if (parts) {
        split = true
        for (const p of parts) {
          if (p.type !== 'text') consumed.add(p.formulaIndex)
          pieces.push(p)
        }
      } else {
        pieces.push({ type: 'text', text: ti.text, latex: '', box: ti.box, score: ti.score })
      }
    }
    // 未被任何文本行「吃掉」的公式（含 split 失败的兜底）按自身框补回。
    formulaItems.forEach((f, fi) => {
      if (split && consumed.has(fi)) return
      pieces.push({ type: f.kind, latex: f.latex, text: '', box: f.box, score: f.score })
    })

    // 行内按 x 自左向右。文本段的 box 由字符框推出，因此能与公式段正确交错排序。
    pieces.sort((a, b) => a.box[0] - b.box[0] || a.box[2] - b.box[2])

    for (const p of pieces) {
      segments.push({
        type: p.type,
        text: p.text != null ? p.text : '',
        latex: p.latex != null ? p.latex : '',
        box: p.box,
        score: Number.isFinite(p.score) ? p.score : 1,
        lineNumber: lineIndex
      })
    }
  })
  return segments
}

// ---------------------------------------------------------------------------
// 序列化：segments -> Markdown / 纯文本 / LaTeX / HTML
// ---------------------------------------------------------------------------

function escapeHtml(text) {
  return String(text == null ? '' : text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

// 行内公式用 $…$，独立公式用 $$…$$ 单独成块；文本与行内公式按阅读顺序直接拼接，
// 行号变化（且非独立公式）时插入换行。
export function segmentsToMarkdown(segments = []) {
  let md = ''
  let prevLine = null
  for (const seg of segments) {
    let piece = ''
    if (seg.type === 'isolated') {
      piece = '\n\n$$' + (seg.latex != null ? seg.latex : '').trim() + '$$\n\n'
    } else if (seg.type === 'embedding') {
      piece = '$' + (seg.latex != null ? seg.latex : '') + '$'
    } else {
      piece = seg.text != null ? seg.text : ''
    }
    if (prevLine !== null && seg.type !== 'isolated' && seg.lineNumber !== prevLine) {
      md += '\n'
    }
    // 相邻两个公式会拼出 `$$`（如 `$a$$b$`）。Markdown/KaTeX 把 `$$` 当作「行间公式」定界符，
    // 会让整行解析错位。故当已累积内容以 `$` 结尾、且本段以 `$` 开头时插入一个空格隔断
    // （纯文本内容零改动，且同时挡住「独立公式紧跟行内公式」拼成 `$$$` 的情况）。
    // 该规则与 bin/onnx_mixed_server.mjs 的 joinMarkdownParts 保持一致。
    if (md.endsWith('$') && piece.startsWith('$')) md += ' '
    md += piece
    prevLine = seg.lineNumber
  }
  return md
}

// Markdown -> segments 的逆变换（用于「编辑源文后重新渲染」）。
// 解析规则与 segmentsToMarkdown 完全对应：先抽取 $$…$$ 独立公式，
// 行内文本再用 $…$ 抽取行内公式；换行对应 lineNumber 递增。
export function markdownToSegments(md = '') {
  const segments = []
  let lineNumber = 0

  const flushLine = (text) => {
    if (!text) return
    const inlineRe = /\$([^$\n]+?)\$/g
    let last = 0
    let mm
    while ((mm = inlineRe.exec(text))) {
      if (mm.index > last) {
        segments.push({ type: 'text', text: text.slice(last, mm.index), latex: '', lineNumber })
      }
      segments.push({ type: 'embedding', latex: mm[1], lineNumber })
      last = inlineRe.lastIndex
    }
    if (last < text.length) {
      segments.push({ type: 'text', text: text.slice(last), latex: '', lineNumber })
    }
  }

  const displayRe = /\$\$([^$]+?)\$\$/g
  let cursor = 0
  let dm
  while ((dm = displayRe.exec(md))) {
    const before = md.slice(cursor, dm.index)
    const beforeLines = before.split('\n')
    beforeLines.forEach((line, idx) => {
      if (idx > 0) lineNumber += 1
      flushLine(line)
    })
    lineNumber += 1
    segments.push({ type: 'isolated', latex: dm[1].trim(), lineNumber })
    cursor = displayRe.lastIndex
  }
  const rest = md.slice(cursor)
  rest.split('\n').forEach((line, idx) => {
    if (idx > 0) lineNumber += 1
    flushLine(line)
  })

  return segments
}

// 纯文本：文本原样，行内公式输出其 latex，独立公式单独成行。
export function segmentsToPlainText(segments = []) {
  let out = ''
  let prevLine = null
  for (const seg of segments) {
    let piece = ''
    if (seg.type === 'isolated') {
      piece = `\n${(seg.latex != null ? seg.latex : '').trim()}\n`
    } else if (seg.type === 'embedding') {
      piece = seg.latex != null ? String(seg.latex) : ''
    } else {
      piece = seg.text != null ? seg.text : ''
    }
    if (prevLine !== null && seg.type !== 'isolated' && seg.lineNumber !== prevLine) {
      out += '\n'
    }
    out += piece
    prevLine = seg.lineNumber
  }
  return out
}

// 仅公式拼接：跳过文本，行内公式连续拼接，独立公式单独成行。
export function segmentsToLatex(segments = []) {
  let out = ''
  let prevLine = null
  for (const seg of segments) {
    if (seg.type === 'text') continue
    const latex = seg.latex != null ? seg.latex : ''
    const piece = seg.type === 'isolated' ? `\n${latex}\n` : latex
    if (prevLine !== null && seg.type !== 'isolated' && seg.lineNumber !== prevLine) {
      out += '\n'
    }
    out += piece
    prevLine = seg.lineNumber
  }
  return out.trim()
}

// HTML：接受 renderMath(latex, displayMode) 回调，保持本模块与 KaTeX 解耦、可测试。
// 文本做 HTML 转义；行内公式包 inline-math span，独立公式包 display-math div。
export function segmentsToHtml(segments = [], { renderMath } = {}) {
  const render = typeof renderMath === 'function'
    ? renderMath
    : (latex, displayMode) => `<code class="raw-latex">${
      displayMode ? `$$${escapeHtml(latex)}$$` : `$${escapeHtml(latex)}$`
    }</code>`

  let html = ''
  let prevLine = null
  segments.forEach((seg, idx) => {
    if (seg.type === 'isolated') {
      const body = render(seg.latex != null ? seg.latex : '', true)
      html += `\n<div class="display-math" data-mixed-index="${idx}">${body}</div>\n`
      prevLine = seg.lineNumber
      return
    }
    let piece
    if (seg.type === 'embedding') {
      piece = `<span class="inline-math" data-mixed-index="${idx}">${render(seg.latex != null ? seg.latex : '', false)}</span>`
    } else {
      piece = escapeHtml(seg.text != null ? seg.text : '')
    }
    if (prevLine !== null && prevLine !== seg.lineNumber) {
      html += '<br>\n'
    }
    html += piece
    prevLine = seg.lineNumber
  })
  return html
}

export default {
  mergeAndOrderSegments,
  splitTextLinePieces,
  normalizedBottomLeftToPixels,
  segmentsToMarkdown,
  markdownToSegments,
  segmentsToPlainText,
  segmentsToLatex,
  segmentsToHtml,
  iou
}
