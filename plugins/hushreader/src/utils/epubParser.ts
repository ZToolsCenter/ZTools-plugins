import type { Chapter } from '../stores/reader'
import { preprocessText } from './txtParser'

/**
 * 解析 EPUB 文件，返回章节数组（纯文本）
 * 改进版：正确处理多行文本、日文支持、跳过插图章节
 */
export async function parseEpub(file: File): Promise<{
  title: string
  author: string
  description: string
  chapters: Chapter[]
  coverUrl?: string
}> {
  const ePub = (await import('epubjs')).default

  const arrayBuffer = await file.arrayBuffer()
  const book = ePub(arrayBuffer as ArrayBuffer)
  await book.ready

  const metadata = await book.loaded.metadata
  const title = (metadata as any).title || file.name.replace(/\.epub$/i, '')
  const author = (metadata as any).creator || ''
  const description = (metadata as any).description || ''

  // 尝试获取封面
  let coverUrl: string | undefined
  try {
    const cover = await (book as any).coverUrl()
    if (cover) {
      try {
        const resp = await fetch(cover)
        const blob = await resp.blob()
        coverUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(reader.result as string)
          reader.onerror = reject
          reader.readAsDataURL(blob)
        })
      } catch {
        coverUrl = cover
      }
    }
  } catch { }

  const spine = (book as any).spine
  const items: any[] = spine?.items || []

  const chapters: Chapter[] = []
  let idx = 0

  for (const item of items) {
    try {
      const section = (book as any).spine.get(item.href || item.idref)
      if (!section) continue

      await section.load((book as any).load.bind(book))

      const doc = section.document || section.contentDocument || null
      if (!doc) {
        section.unload?.()
        continue
      }

      const extracted = extractTextFromDoc(doc)

      if (extracted.text.trim().length < 20) {
        section.unload?.()
        continue
      }

      // 章节标题：优先从 toc 取，其次从 heading 取
      const chapterTitle = extracted.heading || `第 ${idx + 1} 章`

      chapters.push({
        index: idx++,
        title: chapterTitle,
        content: extracted.text
      })

      section.unload?.()
    } catch (e) {
      console.warn('章节解析失败', item.href, e)
    }
  }

  // 如果 spine 遍历章节太少，尝试从 toc 补充（某些epub结构不同）
  if (chapters.length === 0) {
    try {
      const toc = await (book as any).loaded.navigation
      if (toc?.toc?.length) {
        for (const navItem of toc.toc) {
          const section = (book as any).spine.get(navItem.href)
          if (!section) continue

          await section.load((book as any).load.bind(book))

          const doc = section.document || section.contentDocument || null
          if (!doc) { section.unload?.(); continue }

          const extracted = extractTextFromDoc(doc)
          if (extracted.text.trim().length < 20) { section.unload?.(); continue }
          chapters.push({
            index: idx++,
            title: navItem.label?.trim() || extracted.heading || `第 ${idx + 1} 章`,
            content: extracted.text
          })
          section.unload?.()
        }
      }
    } catch (e) {
      console.warn('TOC fallback failed', e)
    }
  }

  try { book.destroy() } catch { }

  return { title, author, description, chapters, coverUrl }
}

interface ExtractResult {
  heading: string
  text: string
}

/**
 * 从 DOM 文档提取纯文本
 * - 合并多行为段落
 * - 段落间空一行
 * - 移除注音/标注
 * - 保留基本缩进
 */
function extractTextFromDoc(doc: Document): ExtractResult {
  if (!doc) {
    return { heading: '', text: '' }
  }

  const removeSelectors = [
    'script', 'style', 'head', 'nav', 'aside',
    'ruby rt', 'ruby rp',
    '.footnote', '.footnotes', '[epub\\:type="footnote"]',
    '[epub\\:type="endnote"]', '[epub\\:type="toc"]',
    'img', 'figure', 'svg', 'math'
  ]
  removeSelectors.forEach(sel => {
    try {
      doc.querySelectorAll(sel).forEach(el => el.remove())
    } catch { }
  })

  const headingEl = doc.querySelector('h1, h2, h3, h4')
  const heading = headingEl?.textContent?.trim() || ''

  const body = doc.body || doc.documentElement
  if (!body) {
    return { heading, text: '' }
  }

  const paragraphs: string[] = []

  // 块级元素直接提取为段落
  const BLOCK_TAGS = new Set([
    'p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'li', 'td', 'th', 'blockquote', 'pre', 'section',
    'article', 'header', 'footer', 'main'
  ])

  function isBlock(el: Element): boolean {
    return BLOCK_TAGS.has(el.tagName.toLowerCase())
  }

  function hasBlockChild(el: Element): boolean {
    return Array.from(el.children).some(c => isBlock(c))
  }

  function extractNode(node: Node) {
    if (node.nodeType === Node.TEXT_NODE) {
      // 文本节点由父块元素处理，这里跳过顶层游离文本
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return

    const el = node as Element
    const tag = el.tagName.toLowerCase()

    if (!isBlock(el) || hasBlockChild(el)) {
      // 非块级或混合容器：递归处理子节点
      el.childNodes.forEach(child => extractNode(child))
      return
    }

    // 纯块级叶子节点：提取文本
    const raw = el.textContent?.replace(/\s+/g, ' ').trim() || ''
    if (!raw) return
    paragraphs.push(raw)
  }

  body.childNodes.forEach(child => extractNode(child))

  // 后处理：合并过短行、去除全空段落
  const cleaned = paragraphs
    .map(p => p.trimEnd())
    .filter(p => p.trim().length > 0)

  return {
    heading,
    text: preprocessText(cleaned.join('\n'))
  }
}
