const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

/**
 * 转义 HTML 特殊字符，作为所有渲染路径的前置安全步骤。
 * @param text 原始文本。
 * @returns 转义后的文本。
 */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char])
}

/**
 * 渲染行内语法，输入必须已转义。
 * @param escaped 已转义文本。
 * @returns 行内 HTML。
 */
function renderInline(escaped: string): string {
  return escaped
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(
      /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
    )
}

/**
 * 渲染任务文本为安全 HTML；先整体转义再套用有限语法，避免注入。
 * @param text 任务原始文本。
 * @returns 可用于 v-html 的 HTML 字符串。
 */
export function renderMarkdown(text: string): string {
  const escaped = escapeHtml(text)
  const segments = escaped.split(/^```$/m)
  return segments
    .map((segment, index) => {
      if (index % 2 === 1) {
        return `<pre class="md-code-block"><code>${segment.replace(/^\n+|\n+$/g, '')}</code></pre>`
      }
      return segment
        .split('\n')
        .map((line) => renderInline(line))
        .join('<br />')
    })
    .join('')
}
