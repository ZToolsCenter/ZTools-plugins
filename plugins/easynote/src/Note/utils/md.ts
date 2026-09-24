import { marked } from 'marked'

// GFM + 换行转 <br>，更贴近便签书写习惯
marked.setOptions({
  gfm: true,
  breaks: true
})

/** 将 Markdown 渲染为 HTML */
export function renderMarkdown(src: string): string {
  if (!src) return ''
  return marked.parse(src) as string
}

/** 从 Markdown 提取标题：首个标题或首段非空文本 */
export function extractTitle(src: string): string {
  if (!src) return '无标题'
  const lines = src.split('\n')
  for (const line of lines) {
    const m = /^#{1,6}\s+(.+)$/.exec(line.trim())
    if (m) return m[1].trim()
  }
  for (const line of lines) {
    const t = line.trim()
    if (t) return t.replace(/[#*`>_~\-\[\]]/g, '').slice(0, 40)
  }
  return '无标题'
}

/** 将 Markdown 剥离为纯文本，用于"复制纯文本" */
export function toPlainText(src: string): string {
  if (!src) return ''
  let s = src
  // 代码块：保留内容，去掉围栏
  s = s.replace(/```[\s\S]*?```/g, (m) =>
    m.replace(/^```[^\n]*\n?/, '').replace(/```$/, '')
  )
  // 行内代码
  s = s.replace(/`([^`]+)`/g, '$1')
  // 图片 -> alt
  s = s.replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
  // 链接 -> 文本
  s = s.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
  // 加粗 / 斜体 / 删除线
  s = s.replace(/\*\*([^*]+)\*\*/g, '$1')
  s = s.replace(/\*([^*]+)\*/g, '$1')
  s = s.replace(/__([^_]+)__/g, '$1')
  s = s.replace(/_([^_]+)_/g, '$1')
  s = s.replace(/~~([^~]+)~~/g, '$1')
  // 标题井号
  s = s.replace(/^#{1,6}\s+/gm, '')
  // 引用
  s = s.replace(/^>\s?/gm, '')
  // 无序 / 有序列表标记
  s = s.replace(/^\s*[-*+]\s+/gm, '')
  s = s.replace(/^\s*\d+\.\s+/gm, '')
  // 水平线
  s = s.replace(/^[-*_]{3,}$/gm, '')
  return s.trim()
}

/** CommonMark 可转义的 ASCII 标点：remark-stringify 防语意冲突时会给它们加 \（如 \&） */
const ESCAPABLE_CHARS = "[!\"#$%&'()*+,\\-./:;<=>?@[\\\\\\]^_`{|}~]"

/**
 * 还原 remark-stringify（Milkdown 序列化器）留下的痕迹：
 * - 硬换行被序列化成行尾 \（CommonMark 硬换行写法），还原为普通换行
 * - & # * 等标点被加防冲突转义（\&），还原为原字符
 * - 段落间隔比视觉上多一行（段落边界 = \n\n），按少一行还原：
 *   按 1 次 Enter（\n\n）→ 单换行，按多次（\n{3,}）→ 保留一个空行
 *   这样"粘贴的行"与"手动 Enter 的行"复制出来处理一致
 * 代码围栏内不动：里面的 \ 和空行是用户写的字面量，不是序列化加的。
 */
function unescapeSerialized(src: string): string {
  return src
    .split(/(```[\s\S]*?```)/g)
    .map((part, i) => {
      if (i % 2 === 1) return part // 奇数段是围栏代码块，原样保留
      return part
        .replace(/\\\r?\n/g, '\n')
        .replace(new RegExp(`\\\\(${ESCAPABLE_CHARS})`, 'g'), '$1')
        .replace(/\n{2,}/g, (m) => '\n'.repeat(m.length - 1))
    })
    .join('')
}

/** 净化 Markdown 内容：移除 <br> 空行，合并连续空行，清理序列化转义 */
export function normalizeContent(src: string): string {
  if (!src) return ''
  // 移除 <br /> 独立行（包括 > <br /> 块引用内空行）
  const withoutBr = src
    .split('\n')
    .filter(line => !/^(\s*>\s+)?<br\s*\/?>\s*$/i.test(line.trim()))
    .join('\n')
  const unescaped = unescapeSerialized(withoutBr)
  return unescaped
    // 移除尾部空引用行（空段落残留）
    .replace(/(?:\n\s*>\s*)+\s*$/, '')
    .trim()
}
