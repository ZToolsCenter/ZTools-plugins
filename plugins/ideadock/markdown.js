// ==================== Markdown 预览 ====================
// 从 app.js 抽出：marked/mermaid 初始化、分块渲染、大文本降级、
// 图片查看器（mdImageViewer 及缩放/旋转/复制/保存）、本地图片解析。
// 依赖 app.js 全局 $ 与共享常量 PREVIEW_TEXT_LIMIT，外部库 marked/
// mermaid/hljs/DOMPurify（均在 app.js 前加载）。renderMarkdown 被 app.js/
// ai.js 在运行期调用。必须在 app.js 之后加载；顶层注册 md-preview 与
// 图片查看器事件，依赖 DOM 元素已在 body 中。

let mdTimer = null
let mdRenderSeq = 0
let mermaidReady = false
const MD_MANUAL_PREVIEW_LIMIT = 1000000
const MD_CHUNK_SIZE = 30000
let mdRenderLightMode = false

function initMermaid() {
  if (typeof mermaid === 'undefined') return false
  if (mermaidReady) return true
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'loose',
    theme: 'base',
    themeVariables: {
      darkMode: false,
      background: 'transparent',
      mainBkg: '#f8fafc',
      secondBkg: '#eef6ff',
      tertiaryColor: '#f6f3ff',
      primaryColor: '#eef6ff',
      primaryTextColor: '#1f2937',
      primaryBorderColor: '#60a5fa',
      secondaryColor: '#f6f3ff',
      secondaryTextColor: '#1f2937',
      secondaryBorderColor: '#a78bfa',
      tertiaryTextColor: '#1f2937',
      tertiaryBorderColor: '#cbd5e1',
      lineColor: '#64748b',
      textColor: '#1f2937',
      labelTextColor: '#1f2937',
      edgeLabelBackground: '#ffffff',
      clusterBkg: '#f8fafc',
      clusterBorder: '#cbd5e1',
      fontFamily: '"Microsoft YaHei", "Segoe UI", sans-serif'
    },
    flowchart: { htmlLabels: true, useMaxWidth: true },
    sequence: { useMaxWidth: true },
    gantt: { useMaxWidth: true },
    journey: { useMaxWidth: true },
    timeline: { useMaxWidth: true },
    mindmap: { useMaxWidth: true }
  })
  mermaidReady = true
  return true
}

function renderMermaidDiagrams(root, seq) {
  const blocks = Array.from(root.querySelectorAll(
    'pre > code.language-mermaid, pre > code.lang-mermaid, pre > code.mermaid'
  ))
  if (!blocks.length) return
  if (!initMermaid()) {
    blocks.forEach(code => {
      const pre = code.parentElement
      if (pre) pre.classList.add('mermaid-error')
    })
    return
  }
  if (seq !== mdRenderSeq) return
  const diagrams = blocks.map((code, idx) => {
    const source = code.textContent || ''
    const wrap = document.createElement('div')
    wrap.className = 'mermaid-wrap'
    const diagram = document.createElement('div')
    diagram.className = 'mermaid'
    diagram.id = `mermaid-${Date.now()}-${idx}`
    diagram.textContent = source
    wrap.appendChild(diagram)
    code.parentElement.replaceWith(wrap)
    return { diagram, wrap, source }
  })
  Promise.resolve(mermaid.run({ nodes: diagrams.map(item => item.diagram) })).catch(err => {
    if (seq !== mdRenderSeq) return
    diagrams.forEach(({ wrap, source }) => {
      const error = document.createElement('div')
      error.className = 'mermaid-error-msg'
      error.textContent = err && err.message ? err.message : 'Mermaid render failed'
      const pre = document.createElement('pre')
      pre.className = 'mermaid-error'
      const code = document.createElement('code')
      code.textContent = source
      pre.appendChild(code)
      wrap.replaceChildren(error, pre)
    })
  })
}

const mdEscapeHtml = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// 把公式注册为 marked 的 token，随词法分析走，天然避开代码块 / 代码 span（与 GitHub 同构）。
// 行内 $...$ 沿用 Pandoc 规则降低货币误伤：开 $ 后非空格、闭 $ 前非空格、闭 $ 后不接数字、内部 \$ 视为转义。
// 统一输出 \(...\) / \[...\] 交给 MathJax，故 MathJax 配置里已不再监听裸 $，正文里的 $5 不会被误当公式。
let markedReady = false
function setupMarked() {
  if (markedReady || typeof marked === 'undefined') return markedReady
  const mathInline = {
    name: 'mathInline', level: 'inline',
    start(src) { const m = src.match(/(?<!\\)\$|\\[([]/); return m ? m.index : undefined },
    tokenizer(src) {
      let m = /^(?<!\\)\$\$([\s\S]+?)\$\$/.exec(src) || /^\\\[([\s\S]+?)\\\]/.exec(src)
      if (m) return { type: 'mathInline', raw: m[0], text: m[1], display: true }
      m = /^(?<!\\)\$(?!\s)(?:\\.|[^\n$])+?(?<!\s)\$(?!\d)/.exec(src)
      if (m) return { type: 'mathInline', raw: m[0], text: m[0].slice(1, -1), display: false }
      m = /^\\\(([\s\S]+?)\\\)/.exec(src)
      if (m) return { type: 'mathInline', raw: m[0], text: m[1], display: false }
    },
    renderer(t) {
      const tex = mdEscapeHtml(t.text)
      return t.display ? `\\[${tex}\\]` : `\\(${tex}\\)`
    }
  }
  const renderer = {
    code(token) {
      const lang = (token.lang || '').match(/\S*/)[0]
      // mermaid 保持原样，供 renderMermaidDiagrams 后处理；不走高亮
      if (lang === 'mermaid') {
        return `<pre><code class="language-mermaid">${mdEscapeHtml(token.text)}</code></pre>\n`
      }
      // 与 GitHub 一致：仅在指定了已知语言时高亮，不做自动探测（避免误判散文）
      if (!mdRenderLightMode && lang && window.hljs && hljs.getLanguage(lang)) {
        const body = hljs.highlight(token.text, { language: lang, ignoreIllegals: true }).value
        return `<pre><code class="hljs language-${lang}">${body}</code></pre>\n`
      }
      return `<pre><code class="hljs">${mdEscapeHtml(token.text)}</code></pre>\n`
    },
    image(token) {
      const href = token.href || ''
      const alt = mdEscapeHtml(token.text || '')
      const title = token.title ? ` title="${mdEscapeHtml(token.title)}"` : ''
      // 本地图片：只输出 data-imgid 占位（能过 DOMPurify），src 在渲染后由 resolveLocalImages 异步塞入
      if (href.startsWith('img://')) {
        return `<img data-imgid="${mdEscapeHtml(href.slice(6))}" alt="${alt}"${title} class="md-local-img">`
      }
      return `<img src="${mdEscapeHtml(href)}" alt="${alt}"${title}>`
    }
  }
  marked.use({ extensions: [mathInline], renderer })
  markedReady = true
  return true
}

function formatSize(chars) {
  return chars >= 10000 ? `${Math.round(chars / 10000)}万字符` : `${chars}字符`
}

function setLargeMarkdownNotice(textLength) {
  $('md-preview').innerHTML = `
    <div class="md-large-notice">
      <div class="md-large-title">内容较大，已跳过自动预览</div>
      <div class="md-large-meta">${formatSize(textLength)}。自动预览上限为 ${formatSize(PREVIEW_TEXT_LIMIT)}。</div>
      <div class="md-large-actions">
        <button type="button" class="btn-mini" data-md-action="sample">预览前 ${formatSize(PREVIEW_TEXT_LIMIT)}</button>
        <button type="button" class="btn-mini" data-md-action="full">异步全文预览（降级）</button>
      </div>
    </div>`
}

function splitMarkdownChunks(text, maxLen = MD_CHUNK_SIZE) {
  const chunks = []
  let current = ''
  const parts = text.split(/(\n(?=#{1,3}\s)|\n{2,})/)
  for (let i = 0; i < parts.length; i += 2) {
    const part = (parts[i] || '') + (parts[i + 1] || '')
    if (!part) continue
    if (current && current.length + part.length > maxLen) {
      chunks.push(current)
      current = ''
    }
    if (part.length > maxLen) {
      for (let pos = 0; pos < part.length; pos += maxLen) chunks.push(part.slice(pos, pos + maxLen))
    } else {
      current += part
    }
  }
  if (current) chunks.push(current)
  return chunks
}

function idle() {
  return new Promise(resolve => {
    if ('requestIdleCallback' in window) requestIdleCallback(resolve, { timeout: 80 })
    else setTimeout(resolve, 0)
  })
}

async function renderMarkdownChunked(text, seq) {
  setupMarked()
  const root = $('md-preview')
  root.innerHTML = '<div class="md-large-notice"><div class="md-large-title">正在异步预览...</div><div class="md-large-meta">大文件预览已降级：跳过代码高亮、公式和图表渲染。</div></div>'
  const chunks = splitMarkdownChunks(text)
  const progress = document.createElement('div')
  progress.className = 'md-large-progress'
  progress.textContent = `0 / ${chunks.length}`
  root.appendChild(progress)
  try {
    for (let i = 0; i < chunks.length; i++) {
      if (seq !== mdRenderSeq) return
      await idle()
      if (seq !== mdRenderSeq) return
      mdRenderLightMode = true
      let raw = ''
      try {
        raw = marked.parse(chunks[i])
      } finally {
        mdRenderLightMode = false
      }
      const part = document.createElement('div')
      part.className = 'md-chunk'
      part.innerHTML = window.DOMPurify ? DOMPurify.sanitize(raw) : raw
      root.insertBefore(part, progress)
      progress.textContent = `${i + 1} / ${chunks.length}`
    }
    progress.textContent = `完成：${chunks.length} 批`
    resolveLocalImages(root)
  } finally {
    mdRenderLightMode = false
  }
}

function renderMarkdown(opts = {}) {
  const seq = ++mdRenderSeq
  const text = $('editor').value
  const manual = opts.manual === true
  const sample = opts.sample === true
  if (text.length > PREVIEW_TEXT_LIMIT && !manual && !sample) {
    setLargeMarkdownNotice(text.length)
    return
  }
  if (typeof marked === 'undefined') {
    $('md-preview').innerHTML = '<p style="color:#f28b82">marked.js 未加载</p>'
    return
  }
  if (manual && text.length > MD_MANUAL_PREVIEW_LIMIT) {
    $('md-preview').innerHTML = `<p style="color:#f28b82">内容超过 ${formatSize(MD_MANUAL_PREVIEW_LIMIT)}，完整预览仍可能卡顿。已改为预览前 ${formatSize(PREVIEW_TEXT_LIMIT)}。</p>`
    return renderMarkdown({ sample: true })
  }
  if (manual && text.length > PREVIEW_TEXT_LIMIT) {
    renderMarkdownChunked(text, seq)
    return
  }
  setupMarked()
  const source = sample
    ? text.slice(0, PREVIEW_TEXT_LIMIT) + `\n\n> 仅预览前 ${formatSize(PREVIEW_TEXT_LIMIT)}，完整内容未渲染。`
    : text
  mdRenderLightMode = source.length > PREVIEW_TEXT_LIMIT
  let raw = ''
  try {
    raw = marked.parse(source)
  } finally {
    mdRenderLightMode = false
  }
  $('md-preview').innerHTML = window.DOMPurify ? DOMPurify.sanitize(raw) : raw
  resolveLocalImages($('md-preview'))
  if (source.length <= PREVIEW_TEXT_LIMIT) renderMermaidDiagrams($('md-preview'), seq)
  if (source.length <= PREVIEW_TEXT_LIMIT && window.MathJax && MathJax.typesetPromise) {
    if (MathJax.typesetClear) MathJax.typesetClear([$('md-preview')])
    MathJax.typesetPromise([$('md-preview')]).catch(() => {})
  }
}

$('md-preview').addEventListener('click', e => {
  const btn = e.target.closest('[data-md-action]')
  if (!btn) return
  if (btn.dataset.mdAction === 'sample') renderMarkdown({ sample: true })
  if (btn.dataset.mdAction === 'full') renderMarkdown({ manual: true })
})

// Markdown image viewer
const mdImageViewer = {
  images: [],
  index: 0,
  fit: true,
  scale: 1,
  rotation: 0,
  panX: 0,
  panY: 0,
  dragging: false,
  dragStartX: 0,
  dragStartY: 0,
  dragPanX: 0,
  dragPanY: 0
}

function getMarkdownPreviewImages() {
  return Array.from($('md-preview').querySelectorAll('img'))
    .filter(img => img.src && !img.classList.contains('md-img-missing'))
}

function resetMdImageViewerView() {
  mdImageViewer.fit = true
  mdImageViewer.scale = 1
  mdImageViewer.rotation = 0
  mdImageViewer.panX = 0
  mdImageViewer.panY = 0
}

function applyMdImageViewerTransform() {
  $('md-image-viewer-img').style.transform = `translate(${mdImageViewer.panX}px, ${mdImageViewer.panY}px) rotate(${mdImageViewer.rotation}deg)`
}

function renderMdImageViewer() {
  const item = mdImageViewer.images[mdImageViewer.index]
  if (!item) return
  const img = $('md-image-viewer-img')
  const title = item.alt || item.title || item.src
  img.draggable = false
  img.src = item.src
  img.alt = item.alt || ''
  img.classList.toggle('is-actual', !mdImageViewer.fit)
  img.style.width = mdImageViewer.fit ? '' : `${Math.max(1, Math.round((img.naturalWidth || 1) * mdImageViewer.scale))}px`
  applyMdImageViewerTransform()
  $('md-img-counter').textContent = `${mdImageViewer.index + 1} / ${mdImageViewer.images.length}`
  $('md-img-title').textContent = title
  $('md-img-prev').disabled = mdImageViewer.images.length < 2
  $('md-img-next').disabled = mdImageViewer.images.length < 2
  requestAnimationFrame(() => {
    const stage = $('md-image-viewer-stage')
    stage.scrollLeft = Math.max(0, (stage.scrollWidth - stage.clientWidth) / 2)
    stage.scrollTop = Math.max(0, (stage.scrollHeight - stage.clientHeight) / 2)
  })
}

function openMdImageViewer(targetImg) {
  mdImageViewer.images = getMarkdownPreviewImages().map(img => ({
    src: img.currentSrc || img.src,
    alt: img.alt || '',
    title: img.title || ''
  }))
  const src = targetImg.currentSrc || targetImg.src
  const found = mdImageViewer.images.findIndex(item => item.src === src)
  mdImageViewer.index = found >= 0 ? found : 0
  resetMdImageViewerView()
  $('md-image-viewer').style.display = ''
  renderMdImageViewer()
}

function closeMdImageViewer() {
  $('md-image-viewer').style.display = 'none'
  $('md-image-viewer-img').removeAttribute('src')
}

function stepMdImageViewer(delta) {
  if (mdImageViewer.images.length < 2) return
  mdImageViewer.index = (mdImageViewer.index + delta + mdImageViewer.images.length) % mdImageViewer.images.length
  resetMdImageViewerView()
  renderMdImageViewer()
}

function zoomMdImageViewer(delta) {
  mdImageViewer.fit = false
  mdImageViewer.scale = Math.min(8, Math.max(0.1, mdImageViewer.scale * delta))
  renderMdImageViewer()
}

function setMdImageViewerActual() {
  mdImageViewer.fit = false
  mdImageViewer.scale = 1
  renderMdImageViewer()
}

function fitMdImageViewer() {
  mdImageViewer.fit = true
  mdImageViewer.scale = 1
  renderMdImageViewer()
}

function rotateMdImageViewer() {
  mdImageViewer.rotation = (mdImageViewer.rotation + 90) % 360
  renderMdImageViewer()
}

function mdImageFilename(item) {
  const base = (item.alt || item.title || 'markdown-image')
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, '')
    .replace(/\s+/g, '-')
    .replace(/[.\s-]+$/, '')
    .slice(0, 60) || 'markdown-image'
  const mime = /^data:([^;,]+)/.exec(item.src || '')?.[1] || ''
  const ext = mime.includes('png') ? 'png'
    : mime.includes('gif') ? 'gif'
      : mime.includes('jpeg') || mime.includes('jpg') ? 'jpg'
        : mime.includes('webp') ? 'webp'
          : 'png'
  return `${base}.${ext}`
}

async function copyMdViewerImage() {
  const item = mdImageViewer.images[mdImageViewer.index]
  if (!item || !navigator.clipboard || !window.ClipboardItem) {
    showToast('Copy image is unavailable')
    return
  }
  try {
    const res = await fetch(item.src)
    const blob = await res.blob()
    await navigator.clipboard.write([new ClipboardItem({ [blob.type || 'image/png']: blob })])
    showToast('Image copied')
  } catch {
    showToast('Copy image failed')
  }
}

function saveMdViewerImage() {
  const item = mdImageViewer.images[mdImageViewer.index]
  if (!item) return
  const a = document.createElement('a')
  a.href = item.src
  a.download = mdImageFilename(item)
  document.body.appendChild(a)
  a.click()
  a.remove()
}

$('md-preview').addEventListener('dblclick', e => {
  const img = e.target.closest('img')
  if (!img || !$('md-preview').contains(img) || !img.src || img.classList.contains('md-img-missing')) return
  e.preventDefault()
  openMdImageViewer(img)
})

$('md-image-viewer-img').addEventListener('load', renderMdImageViewer)
$('md-image-viewer-backdrop').addEventListener('click', closeMdImageViewer)
$('md-img-close').addEventListener('click', closeMdImageViewer)
$('md-img-prev').addEventListener('click', () => stepMdImageViewer(-1))
$('md-img-next').addEventListener('click', () => stepMdImageViewer(1))
$('md-img-zoom-out').addEventListener('click', () => zoomMdImageViewer(0.8))
$('md-img-zoom-in').addEventListener('click', () => zoomMdImageViewer(1.25))
$('md-img-fit').addEventListener('click', fitMdImageViewer)
$('md-img-actual').addEventListener('click', setMdImageViewerActual)
$('md-img-rotate').addEventListener('click', rotateMdImageViewer)
$('md-img-copy').addEventListener('click', copyMdViewerImage)
$('md-img-save').addEventListener('click', saveMdViewerImage)
$('md-image-viewer-stage').addEventListener('wheel', e => {
  if ($('md-image-viewer').style.display === 'none') return
  e.preventDefault()
  zoomMdImageViewer(e.deltaY < 0 ? 1.12 : 1 / 1.12)
}, { passive: false })
$('md-image-viewer-stage').addEventListener('mousedown', e => {
  if ($('md-image-viewer').style.display === 'none' || e.button !== 0) return
  const stage = $('md-image-viewer-stage')
  mdImageViewer.dragging = true
  mdImageViewer.dragStartX = e.clientX
  mdImageViewer.dragStartY = e.clientY
  mdImageViewer.dragPanX = mdImageViewer.panX
  mdImageViewer.dragPanY = mdImageViewer.panY
  stage.classList.add('is-dragging')
  e.preventDefault()
})
document.addEventListener('mousemove', e => {
  if (!mdImageViewer.dragging) return
  mdImageViewer.panX = mdImageViewer.dragPanX + e.clientX - mdImageViewer.dragStartX
  mdImageViewer.panY = mdImageViewer.dragPanY + e.clientY - mdImageViewer.dragStartY
  applyMdImageViewerTransform()
  e.preventDefault()
})
document.addEventListener('mouseup', () => {
  if (!mdImageViewer.dragging) return
  mdImageViewer.dragging = false
  $('md-image-viewer-stage').classList.remove('is-dragging')
})

document.addEventListener('keydown', e => {
  if ($('md-image-viewer').style.display === 'none') return
  if (e.key === 'Escape') closeMdImageViewer()
  else if (e.key === 'ArrowLeft') stepMdImageViewer(-1)
  else if (e.key === 'ArrowRight') stepMdImageViewer(1)
  else if (e.key === '+' || e.key === '=') zoomMdImageViewer(1.25)
  else if (e.key === '-') zoomMdImageViewer(0.8)
  else if (e.key === '0') fitMdImageViewer()
  else return
  e.preventDefault()
})

// 把 img://id 占位符解析成真实图片：从 uTools 附件取回转 data URI，同步塞进 src
function resolveLocalImages(root) {
  root.querySelectorAll('img[data-imgid]').forEach(img => {
    const url = window.textTool && window.textTool.getImageDataUrl
      ? window.textTool.getImageDataUrl(img.getAttribute('data-imgid'))
      : null
    if (url) {
      img.src = url
    } else {
      img.classList.add('md-img-missing')
      img.alt = (img.alt || '图片') + '（已丢失）'
    }
  })
}
