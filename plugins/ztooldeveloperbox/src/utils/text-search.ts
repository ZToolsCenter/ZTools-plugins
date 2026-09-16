export type TextMatch = {
  start: number
  end: number
}

export type SearchOptions = {
  caseSensitive: boolean
  wholeWord: boolean
  useRegex: boolean
}

const WORD_CHAR = /[\w-]/

function isWholeWord(text: string, start: number, end: number) {
  const before = start > 0 ? text[start - 1] : ''
  const after = end < text.length ? text[end] : ''
  return !WORD_CHAR.test(before) && !WORD_CHAR.test(after)
}

function collectRegexMatches(text: string, query: string, options: SearchOptions): TextMatch[] {
  try {
    const flags = options.caseSensitive ? 'g' : 'gi'
    const regex = new RegExp(query, flags)
    const result: TextMatch[] = []
    let match: RegExpExecArray | null

    while ((match = regex.exec(text)) !== null) {
      const start = match.index
      const end = start + match[0].length

      if (options.wholeWord && !isWholeWord(text, start, end)) {
        if (match[0].length === 0) regex.lastIndex++
        continue
      }

      result.push({ start, end })
      if (match[0].length === 0) regex.lastIndex++
    }

    return result
  } catch {
    return []
  }
}

function collectPlainMatches(text: string, query: string, options: SearchOptions): TextMatch[] {
  const result: TextMatch[] = []
  const source = options.caseSensitive ? text : text.toLowerCase()
  const target = options.caseSensitive ? query : query.toLowerCase()
  let start = 0

  while (start <= source.length - target.length) {
    const index = source.indexOf(target, start)
    if (index === -1) break

    const end = index + target.length
    if (!options.wholeWord || isWholeWord(text, index, end)) {
      result.push({ start: index, end })
    }
    start = index + 1
  }

  return result
}

export function collectMatches(text: string, query: string, options: SearchOptions): TextMatch[] {
  if (!query) return []
  if (options.useRegex) return collectRegexMatches(text, query, options)
  return collectPlainMatches(text, query, options)
}

export function replaceAllText(
  text: string,
  query: string,
  replacement: string,
  options: SearchOptions
): string {
  const matches = collectMatches(text, query, options)
  if (!matches.length) return text

  let result = ''
  let last = 0

  for (const match of matches) {
    result += text.slice(last, match.start) + replacement
    last = match.end
  }

  return result + text.slice(last)
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function buildHighlightHtml(
  text: string,
  matches: TextMatch[],
  currentIndex: number
): string {
  if (!matches.length) {
    return `${escapeHtml(text)}\n`
  }

  let html = ''
  let last = 0

  matches.forEach((match, index) => {
    html += escapeHtml(text.slice(last, match.start))
    const className = index === currentIndex ? 'editor-mark editor-mark--current' : 'editor-mark'
    html += `<mark class="${className}">${escapeHtml(text.slice(match.start, match.end))}</mark>`
    last = match.end
  })

  html += escapeHtml(text.slice(last))
  return `${html}\n`
}

export type ScrollToMatchOptions = {
  focusEditor?: boolean
}

export function scrollTextareaToMatch(
  textarea: HTMLTextAreaElement,
  match: TextMatch,
  highlightRoot?: HTMLElement | null,
  options: ScrollToMatchOptions = {}
) {
  const focusEditor = options.focusEditor ?? true

  if (highlightRoot) {
    const mark = highlightRoot.querySelector('.editor-mark--current')
    if (mark instanceof HTMLElement) {
      scrollContainerToElement(highlightRoot, mark)
      textarea.scrollTop = highlightRoot.scrollTop
      textarea.scrollLeft = highlightRoot.scrollLeft
      if (focusEditor) {
        textarea.focus()
        textarea.setSelectionRange(match.start, match.end)
      }
      return
    }
  }

  scrollTextareaToMatchByMirror(textarea, match)
  if (focusEditor) {
    textarea.focus()
    textarea.setSelectionRange(match.start, match.end)
  }
}

function scrollContainerToElement(container: HTMLElement, element: HTMLElement) {
  const containerRect = container.getBoundingClientRect()
  const elementRect = element.getBoundingClientRect()

  const offsetTop = elementRect.top - containerRect.top + container.scrollTop
  const offsetLeft = elementRect.left - containerRect.left + container.scrollLeft

  const targetTop = offsetTop - container.clientHeight / 2 + elementRect.height / 2
  const targetLeft = offsetLeft - container.clientWidth / 2 + elementRect.width / 2

  container.scrollTop = Math.max(0, targetTop)
  container.scrollLeft = Math.max(0, targetLeft)
}

function scrollTextareaToMatchByMirror(textarea: HTMLTextAreaElement, match: TextMatch) {
  const style = window.getComputedStyle(textarea)
  const mirror = document.createElement('div')
  const text = textarea.value
  const before = text.slice(0, match.start)
  const matched = text.slice(match.start, match.end) || ' '
  const after = text.slice(match.end)

  mirror.style.position = 'absolute'
  mirror.style.visibility = 'hidden'
  mirror.style.top = '0'
  mirror.style.left = '-99999px'
  mirror.style.overflow = 'hidden'
  mirror.style.width = `${textarea.clientWidth}px`
  mirror.style.fontFamily = style.fontFamily
  mirror.style.fontSize = style.fontSize
  mirror.style.fontWeight = style.fontWeight
  mirror.style.fontStyle = style.fontStyle
  mirror.style.lineHeight = style.lineHeight
  mirror.style.letterSpacing = style.letterSpacing
  mirror.style.padding = style.padding
  mirror.style.border = style.border
  mirror.style.boxSizing = style.boxSizing
  mirror.style.whiteSpace = style.whiteSpace
  mirror.style.wordBreak = style.wordBreak
  mirror.style.overflowWrap = style.overflowWrap

  mirror.textContent = ''
  mirror.append(document.createTextNode(before))
  const marker = document.createElement('span')
  marker.textContent = matched
  mirror.append(marker)
  mirror.append(document.createTextNode(after))

  document.body.appendChild(mirror)

  const markerTop = marker.offsetTop
  const markerLeft = marker.offsetLeft
  const markerHeight = marker.offsetHeight || parseFloat(style.lineHeight) || 19.5
  const markerWidth = marker.offsetWidth || 8

  document.body.removeChild(mirror)

  textarea.scrollTop = Math.max(0, markerTop - textarea.clientHeight / 2 + markerHeight / 2)
  textarea.scrollLeft = Math.max(0, markerLeft - textarea.clientWidth / 2 + markerWidth / 2)
}
