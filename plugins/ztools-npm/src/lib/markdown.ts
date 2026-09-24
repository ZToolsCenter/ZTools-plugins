function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function safeHref(u: string): string {
  // u 已被 escapeHtml 处理过：只需校验协议（转义不影响协议字母），不再二次转义
  if (/^(javascript|data|vbscript):/i.test(u)) return '#'
  return u
}

// 行内：先转义 HTML，再用占位符保护行内代码（避免内部被粗体/斜体/链接误处理），最后还原
function inline(src: string): string {
  let t = escapeHtml(src)
  const codeSpans: string[] = []
  t = t.replace(/`([^`]+)`/g, (_m, c) => {
    codeSpans.push(`<code>${c}</code>`)
    return `\u0000${codeSpans.length - 1}\u0000`
  })
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  t = t.replace(/(^|[^*])\*([^*\s][^*]*)\*(?!\*)/g, '$1<em>$2</em>')
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label, url) => `<a href="${safeHref(url)}" target="_blank" rel="noopener">${label}</a>`)
  return t.replace(/\u0000(\d+)\u0000/g, (_m, i) => codeSpans[Number(i)])
}

export function renderMarkdown(src: string): string {
  if (!src) return ''
  const lines = src.replace(/\r\n/g, '\n').split('\n')
  const html: string[] = []
  let inCode = false
  let codeLang = ''
  let codeBuf: string[] = []
  let listType: 'ul' | 'ol' | null = null
  let listBuf: string[] = []

  const closeList = () => {
    if (listType) {
      html.push(`<${listType}>${listBuf.join('')}</${listType}>`)
      listType = null
      listBuf = []
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const t = line.trim()

    if (t.startsWith('```')) {
      if (inCode) {
        html.push(`<pre><code class="lang-${escapeHtml(codeLang)}">${escapeHtml(codeBuf.join('\n'))}</code></pre>`)
        codeBuf = []
        inCode = false
      } else {
        closeList()
        inCode = true
        codeLang = t.slice(3).trim()
      }
      continue
    }
    if (inCode) { codeBuf.push(line); continue }
    if (t === '') { closeList(); continue }

    const heading = /^(#{1,6})\s+(.*)$/.exec(t)
    if (heading) {
      closeList()
      const level = heading[1].length
      html.push(`<h${level}>${inline(heading[2])}</h${level}>`)
      continue
    }

    if (/^([-*_])\s*(\1\s*){2,}$/.test(t)) { closeList(); html.push('<hr>'); continue }

    // 表格：连续 | 行，第二行为分隔行
    if (t.startsWith('|')) {
      const rows = [line]
      while (i + 1 < lines.length && lines[i + 1].trim().startsWith('|')) {
        rows.push(lines[++i])
      }
      const isTable = rows.length >= 2 && rows[1].includes('-') && /^[|:\s-]+$/.test(rows[1].trim())
      if (isTable) {
        const parseRow = (r: string) =>
          r.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim())
        const header = parseRow(rows[0])
        const body = rows.slice(2).map(parseRow)
        let out = '<table><thead><tr>' + header.map(h => `<th>${inline(h)}</th>`).join('') + '</tr></thead><tbody>'
        for (const b of body) out += '<tr>' + b.map(c => `<td>${inline(c)}</td>`).join('') + '</tr>'
        out += '</tbody></table>'
        closeList()
        html.push(out)
        continue
      }
      closeList()
      for (const r of rows) html.push(`<p>${inline(r.trim().replace(/^\|/, '').replace(/\|$/, ''))}</p>`)
      continue
    }

    const ul = /^\s*[-*+]\s+(.*)$/.exec(line)
    if (ul) {
      if (listType !== 'ul') { closeList(); listType = 'ul' }
      listBuf.push(`<li>${inline(ul[1])}</li>`)
      continue
    }
    const ol = /^\s*\d+\.\s+(.*)$/.exec(line)
    if (ol) {
      if (listType !== 'ol') { closeList(); listType = 'ol' }
      listBuf.push(`<li>${inline(ol[1])}</li>`)
      continue
    }
    closeList()

    const bq = /^\s*>\s?(.*)$/.exec(line)
    if (bq) { html.push(`<blockquote>${inline(bq[1])}</blockquote>`); continue }

    html.push(`<p>${inline(line)}</p>`)
  }

  if (inCode) {
    html.push(`<pre><code class="lang-${escapeHtml(codeLang)}">${escapeHtml(codeBuf.join('\n'))}</code></pre>`)
  }
  closeList()
  return html.join('\n')
}
