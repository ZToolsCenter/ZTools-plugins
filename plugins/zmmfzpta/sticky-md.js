/** 自动生成：请勿手工编辑。源文件 src/components/page/tool/sticky-notes/markdown.js */
/* 由 scripts/gen-sticky-md.js 在构建时生成（npm run gen:sticky-md / npm run build） */
;(function (global) {
/** 便签轻量 Markdown：主界面与悬浮窗共用同一套语法 */

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** 旧版 contenteditable 富文本 */
function looksLikeHtml(src) {
  const s = String(src || '')
  // 避免把 Markdown 里偶尔出现的 < 误判；需较像完整标签
  return /<\/?(div|p|br\s*\/?|b|i|u|ul|ol|li|span|h[1-6]|strong|em|strike|s|font|input)\b[^>]*>/i.test(s)
}

function stripToPlain(src) {
  const s = String(src || '')
  if (!s) return ''
  if (looksLikeHtml(s)) {
    return s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
  }
  return s
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`\n]+`/g, ' ')
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_~>`#-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function inlineMd(text) {
  let s = escapeHtml(text)
  s = s.replace(/`([^`\n]+)`/g, '<code>$1</code>')
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
  s = s.replace(/__([^_\n]+)__/g, '<strong>$1</strong>')
  s = s.replace(/~~([^~\n]+)~~/g, '<del>$1</del>')
  // 斜体：避免贪婪回溯，限制单行
  s = s.replace(/(^|[\s(])\*([^*\n]+)\*(?=$|[\s).,!?:;])/g, '$1<em>$2</em>')
  s = s.replace(/(^|[\s(])_([^_\n]+)_(?=$|[\s).,!?:;])/g, '$1<em>$2</em>')
  // 图片：![alt](url) —— 必须在链接之前处理，避免被链接正则吃掉
  s = s.replace(
    /!\[([^\]]*)]\(([^)\s]+)\)/g,
    '<img class="md-img" alt="$1" src="$2" loading="lazy" />'
  )
  s = s.replace(
    /\[([^\]]+)]\((https?:\/\/[^)\s]+)\)/g,
    '<a class="md-link" href="$2" rel="noopener noreferrer">$1</a>'
  )
  return s
}

function isTableRow(line) {
  const s = String(line || '').trim()
  return s.includes('|') && /^\|?.+\|.+\|?$/.test(s)
}

function isTableSeparator(line) {
  const cells = splitTableCells(line)
  return cells.length > 1 && cells.every(c => /^:?-{3,}:?$/.test(c.trim()))
}

function splitTableCells(line) {
  let s = String(line || '').trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|')) s = s.slice(0, -1)
  return s.split('|').map(c => c.trim())
}

/**
 * 渲染 Markdown → HTML（常用子集）
 */
function renderMarkdown(src) {
  const raw = String(src || '').replace(/\r\n/g, '\n')
  if (!raw.trim()) return ''

  const lines = raw.split('\n')
  const out = []
  let i = 0
  let inCode = false
  let codeBuf = []
  let para = []
  // 防止异常分支不推进行号导致死循环
  const guardMax = lines.length * 3 + 32
  let guard = 0

  function flushPara() {
    if (!para.length) return
    out.push(`<p>${inlineMd(para.join(' '))}</p>`)
    para = []
  }

  while (i < lines.length) {
    if (++guard > guardMax) break
    const line = lines[i]
    const prevI = i

    if (line.startsWith('```')) {
      flushPara()
      if (inCode) {
        out.push(`<pre><code>${escapeHtml(codeBuf.join('\n'))}</code></pre>`)
        codeBuf = []
        inCode = false
      } else {
        inCode = true
      }
      i += 1
      continue
    }

    if (inCode) {
      codeBuf.push(line)
      i += 1
      continue
    }

    if (/^\s*-{3,}\s*$/.test(line) || /^\s*\*{3,}\s*$/.test(line)) {
      flushPara()
      out.push('<hr />')
      i += 1
      continue
    }

    if (isTableRow(line) && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      flushPara()
      const headers = splitTableCells(line)
      i += 2
      const rows = []
      while (i < lines.length && isTableRow(lines[i])) {
        rows.push(splitTableCells(lines[i]))
        i += 1
      }
      const thead = `<thead><tr>${headers.map(h => `<th>${inlineMd(h)}</th>`).join('')}</tr></thead>`
      const tbody = rows.length
        ? `<tbody>${rows.map(row => `<tr>${headers.map((_, idx) => `<td>${inlineMd(row[idx] || '')}</td>`).join('')}</tr>`).join('')}</tbody>`
        : ''
      out.push(`<table class="md-table">${thead}${tbody}</table>`)
      continue
    }

    const heading = /^(#{1,6})\s+(.+)$/.exec(line)
    if (heading) {
      flushPara()
      const lv = heading[1].length
      out.push(`<h${lv}>${inlineMd(heading[2].trim())}</h${lv}>`)
      i += 1
      continue
    }

    if (/^>\s?/.test(line)) {
      flushPara()
      const quote = []
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        quote.push(lines[i].replace(/^>\s?/, ''))
        i += 1
      }
      out.push(`<blockquote><p>${inlineMd(quote.join(' '))}</p></blockquote>`)
      continue
    }

    // 待办优先；无序排除 "- [" 开头，避免和待办冲突
    const todo = /^(\s*)[-*+]\s+\[([ xX])](?:\s+(.*))?$/.exec(line)
    const ol = /^(\s*)\d+\.\s+(.+)$/.exec(line)
    const ul = !todo && /^(\s*)[-*+]\s+(?!\[)(.+)$/.exec(line)

    if (todo || ul || ol) {
      flushPara()
      const ordered = !!ol && !todo && !ul
      const tag = ordered ? 'ol' : 'ul'
      const items = []
      while (i < lines.length) {
        const t = /^(\s*)[-*+]\s+\[([ xX])](?:\s+(.*))?$/.exec(lines[i])
        const o = /^(\s*)\d+\.\s+(.+)$/.exec(lines[i])
        const u = /^(\s*)[-*+]\s+(?!\[)(.+)$/.exec(lines[i])
        if (ordered) {
          if (!o) break
          items.push(`<li>${inlineMd(o[2])}</li>`)
        } else if (t) {
          const checked = /x/i.test(t[2]) ? ' checked' : ''
          const lineIdx = i
          items.push(
            `<li class="md-todo"><label class="md-todo__row"><input type="checkbox" data-md-todo="${lineIdx}"${checked} /><span>${inlineMd(t[3] || '')}</span></label></li>`
          )
        } else if (u) {
          items.push(`<li>${inlineMd(u[2])}</li>`)
        } else {
          break
        }
        i += 1
      }
      if (items.length) {
        out.push(`<${tag}>${items.join('')}</${tag}>`)
      } else {
        // 进了列表分支却解析不出项：当普通段落，并强制推进，杜绝死循环
        para.push(line.trim())
        i += 1
      }
      continue
    }

    if (!line.trim()) {
      flushPara()
      i += 1
      continue
    }

    para.push(line.trim())
    i += 1

    // 双重保险：本轮未推进则强制 +1
    if (i === prevI) i += 1
  }

  if (inCode) {
    out.push(`<pre><code>${escapeHtml(codeBuf.join('\n'))}</code></pre>`)
  }
  flushPara()
  return out.join('\n')
}

function renderNoteHtml(src) {
  const s = String(src || '')
  if (!s) return ''
  if (looksLikeHtml(s)) return s
  return renderMarkdown(s)
}

/**
 * 渲染并解析 sticky-img 引用为 data URL（主应用 + 浮窗共用）
 * sticky-img:xxx.jpg → data:image/jpeg;base64,...（通过 preload 读取磁盘文件）
 */
function renderNoteHtmlResolved(src) {
  const html = renderNoteHtml(src)
  if (!html) return ''
  return resolveStickyImg(html)
}

/** 把 HTML 中所有 sticky-img:xxx 替换为 data URL */
function resolveStickyImg(html) {
  if (!html || html.indexOf('sticky-img:') < 0) return html
  if (typeof window === 'undefined' || typeof window.readStickyImage !== 'function') return html
  return html.replace(/sticky-img:([A-Za-z0-9_\-]+\.[A-Za-z]{2,4})/g, (_, name) => {
    const url = window.readStickyImage(name)
    return url || ''
  })
}

/** 切换指定行的待办 checkbox：- [ ] ↔ - [x] */
function toggleTodoLine(src, lineIndex) {
  const lines = String(src || '').replace(/\r\n/g, '\n').split('\n')
  const idx = Number(lineIndex)
  if (!Number.isInteger(idx) || idx < 0 || idx >= lines.length) return String(src || '')
  const m = /^(\s*[-*+]\s+)\[([ xX])](.*)$/.exec(lines[idx])
  if (!m) return String(src || '')
  const mark = /x/i.test(m[2]) ? ' ' : 'x'
  lines[idx] = `${m[1]}[${mark}]${m[3]}`
  return lines.join('\n')
}

function wrapSelection(text, start, end, before, after = before) {
  const a = text.slice(0, start)
  const sel = text.slice(start, end)
  const b = text.slice(end)
  const next = `${a}${before}${sel || '文本'}${after}${b}`
  return {
    text: next,
    selectionStart: start + before.length,
    selectionEnd: start + before.length + (sel || '文本').length,
  }
}

function prefixLines(text, start, end, prefix) {
  const a = text.slice(0, start)
  const mid = text.slice(start, end)
  const b = text.slice(end)
  const lines = (mid || '列表项').split('\n').map(l => (l.startsWith(prefix) ? l : prefix + l))
  const nextMid = lines.join('\n')
  return {
    text: a + nextMid + b,
    selectionStart: start,
    selectionEnd: start + nextMid.length,
  }
}


  global.StickyMD = {
    escapeHtml: escapeHtml,
    looksLikeHtml: looksLikeHtml,
    renderMarkdown: renderMarkdown,
    renderNoteHtml: renderNoteHtml,
    renderNoteHtmlResolved: renderNoteHtmlResolved,
    toggleTodoLine: toggleTodoLine
  }
})(typeof window !== 'undefined' ? window : globalThis)
