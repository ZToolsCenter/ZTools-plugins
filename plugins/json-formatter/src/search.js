/** 查找按字面量匹配，保留原始字符串中的 UTF-16 位置。 */
export function findMatches(text, query, caseSensitive = false) {
  if (!query) return []
  const pattern = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return [...text.matchAll(new RegExp(pattern, caseSensitive ? 'gu' : 'giu'))]
    .map((match) => ({ start: match.index, end: match.index + match[0].length }))
}

/** 为一个文本区域创建独立的查找替换栏。onReplace 返回是否成功。 */
export function createSearch({ container, toggle, editor, label, onReplace }) {
  container.innerHTML = `
    <div class="search-row">
      <input class="search-query" type="text" placeholder="查找内容" aria-label="${label}查找内容" autocomplete="off" spellcheck="false" />
      <span class="search-count" role="status" aria-live="polite"></span>
      <button class="mini-button search-prev" type="button" title="上一个（Shift + Enter）" aria-label="上一个匹配">↑</button>
      <button class="mini-button search-next" type="button" title="下一个（Enter）" aria-label="下一个匹配">↓</button>
      <button class="mini-button search-close" type="button" title="关闭（Esc）" aria-label="关闭查找替换">×</button>
    </div>
    <div class="search-row">
      <input class="search-replacement" type="text" placeholder="替换为（可留空）" aria-label="${label}替换内容" autocomplete="off" spellcheck="false" />
      <button class="mini-button search-replace" type="button">替换</button>
      <button class="mini-button search-replace-all" type="button">全部替换</button>
    </div>
    <label class="search-case"><input type="checkbox" />区分大小写</label>`
  const query = container.querySelector('.search-query')
  const replacement = container.querySelector('.search-replacement')
  const caseSensitive = container.querySelector('input[type="checkbox"]')
  const count = container.querySelector('.search-count')
  const previous = container.querySelector('.search-prev')
  const next = container.querySelector('.search-next')
  const replace = container.querySelector('.search-replace')
  const replaceAll = container.querySelector('.search-replace-all')
  let matches = []
  let active = -1
  // textarea 的选区失焦后不可见，用独立背景层持续显示匹配内容。
  const highlights = document.createElement('div')
  highlights.className = 'search-highlights'
  highlights.setAttribute('aria-hidden', 'true')
  const highlightText = document.createElement('div')
  highlightText.className = 'search-highlight-text'
  highlights.append(highlightText)
  editor.before(highlights)

  function syncHighlights() {
    highlightText.style.width = `${editor.clientWidth}px`
    highlightText.style.transform = `translate(${-editor.scrollLeft}px, ${-editor.scrollTop}px)`
  }

  function renderHighlights() {
    highlightText.replaceChildren()
    highlights.hidden = container.hidden || !matches.length
    if (highlights.hidden) return
    const fragment = document.createDocumentFragment()
    let position = 0
    matches.forEach((match, index) => {
      fragment.append(document.createTextNode(editor.value.slice(position, match.start)))
      const mark = document.createElement('mark')
      mark.className = index === active ? 'search-match current-match' : 'search-match'
      mark.textContent = editor.value.slice(match.start, match.end)
      fragment.append(mark)
      position = match.end
    })
    fragment.append(document.createTextNode(editor.value.slice(position) + '\n'))
    highlightText.append(fragment)
    syncHighlights()
  }

  editor.addEventListener('scroll', syncHighlights)
  new ResizeObserver(syncHighlights).observe(editor)

  function updateControls() {
    count.textContent = !query.value ? '输入关键词' : matches.length ? `${active + 1} / ${matches.length}` : '无匹配'
    for (const button of [previous, next, replace, replaceAll]) button.disabled = matches.length === 0
    renderHighlights()
  }

  function selectMatch() {
    updateControls()
    if (active < 0) return
    const match = matches[active]
    editor.setSelectionRange(match.start, match.end)
    const marker = highlightText.querySelector('.current-match')
    const rect = marker.getClientRects()[0]
    const top = rect.top - editor.getBoundingClientRect().top + editor.scrollTop
    if (top < editor.scrollTop || top + rect.height > editor.scrollTop + editor.clientHeight) {
      editor.scrollTop = Math.max(0, top - editor.clientHeight / 2)
      editor.dispatchEvent(new Event('scroll'))
    }
    syncHighlights()
  }

  function refresh(position = editor.selectionStart, select = true) {
    if (container.hidden) return
    matches = findMatches(editor.value, query.value, caseSensitive.checked)
    active = matches.findIndex((match) => match.start >= position)
    if (active < 0 && matches.length) active = 0
    if (select) selectMatch()
    else updateControls()
  }

  function open(focusReplacement = false) {
    container.hidden = false
    toggle.setAttribute('aria-expanded', 'true')
    const selected = editor.value.slice(editor.selectionStart, editor.selectionEnd)
    if (selected && !selected.includes('\n')) query.value = selected
    refresh()
    const field = focusReplacement ? replacement : query
    field.focus()
    field.select()
  }

  function close() {
    container.hidden = true
    highlights.hidden = true
    toggle.setAttribute('aria-expanded', 'false')
    editor.focus()
  }

  function navigate(direction) {
    if (!matches.length) return
    active = (active + direction + matches.length) % matches.length
    selectMatch()
  }

  function apply(all) {
    if (!matches.length) return
    const ranges = all ? matches : [matches[active]]
    const position = all ? 0 : ranges[0].start + replacement.value.length
    if (onReplace(ranges, replacement.value)) refresh(position)
  }

  toggle.addEventListener('click', () => container.hidden ? open() : close())
  container.querySelector('.search-close').addEventListener('click', close)
  query.addEventListener('input', () => refresh(0))
  caseSensitive.addEventListener('change', () => refresh(0))
  previous.addEventListener('click', () => navigate(-1))
  next.addEventListener('click', () => navigate(1))
  replace.addEventListener('click', () => apply(false))
  replaceAll.addEventListener('click', () => apply(true))
  container.addEventListener('keydown', (event) => {
    if (event.isComposing) return
    if (event.key === 'Escape') { event.preventDefault(); close() }
    if (event.key === 'Enter' && (event.target === replacement || event.target === query)) {
      event.preventDefault()
      if (event.target === replacement) apply(event.ctrlKey || event.metaKey)
      else if (event.target === query) navigate(event.shiftKey ? -1 : 1)
    }
  })
  editor.addEventListener('keydown', (event) => {
    if (!container.hidden && event.key === 'Escape') { event.preventDefault(); close() }
  })
  updateControls()
  // 输入内容变化时只更新计数，避免正在打字的光标跳到匹配位置。
  return { open, refresh: (position) => refresh(position, false) }
}
