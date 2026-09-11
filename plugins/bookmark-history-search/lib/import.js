// 解析导入的书签文件：
// 1) Netscape 书签 HTML（浏览器「导出书签」的标准格式，.html/.htm）
// 2) Chrome JSON（User Data/<Profile>/Bookmarks 同构）
const fs = require('fs')
const path = require('path')

// 解析 Netscape 书签 HTML：<DT><A HREF="url" ADD_DATE="...">标题</A>，H3 是文件夹
// 逐行解析，遇到 </DL> 弹出文件夹栈（保证层级正确）
function parseNetscapeHTML(content) {
  const out = []
  const folderStack = []
  const lines = content.split(/\r?\n/)
  for (const raw of lines) {
    const line = raw.trim()
    const h3 = line.match(/^<DT><H3[^>]*>([\s\S]*?)<\/H3>/i)
    if (h3) {
      folderStack.push(cleanText(h3[1]))
      continue
    }
    const a = line.match(/^<DT><A\s+HREF="([^"]*)"[^>]*>([\s\S]*?)<\/A>/i)
    if (a) {
      const url = a[1]
      const title = cleanText(a[2])
      if (/^https?:/i.test(url) || /^file:/i.test(url)) {
        out.push({
          title: title || url,
          url,
          folder: folderStack.join(' / '),
          source: 'imported',
          browser: 'import'
        })
      }
      continue
    }
    if (/<\/DL>/i.test(line)) {
      folderStack.pop()
    }
  }
  return out
}

function cleanText(s) {
  return (s || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim()
}

// 解析 Chrome JSON 书签（复用 books.js 的 walk 逻辑）
function parseChromeJSON(content) {
  const out = []
  try {
    const data = JSON.parse(content)
    const walk = (node, folderPath) => {
      if (!node || typeof node !== 'object') return
      if (node.type === 'url') {
        const url = node.url || ''
        if (/^https?:/i.test(url) || /^file:/i.test(url)) {
          out.push({
            title: node.name || node.title || url,
            url,
            folder: folderPath || '',
            source: 'imported',
            browser: 'import'
          })
        }
      } else if (node.type === 'folder' || Array.isArray(node.children)) {
        const folder = folderPath ? folderPath + ' / ' + (node.name || '') : (node.name || '')
        ;(node.children || []).forEach(c => walk(c, folder))
      }
    }
    const roots = data && data.roots
    if (!roots) return []
    walk(roots.bookmark_bar, '')
    walk(roots.other, '')
    walk(roots.synced, '')
  } catch (e) {
    return []
  }
  return out
}

// 根据扩展名选择解析器
function parseBookmarkFile(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  const content = fs.readFileSync(filePath, 'utf-8')
  if (ext === '.json') return parseChromeJSON(content)
  if (ext === '.html' || ext === '.htm') return parseNetscapeHTML(content)
  // 无扩展名/未知：嗅探内容
  const trimmed = content.trim()
  if (trimmed.startsWith('{')) return parseChromeJSON(content)
  if (/<DT>/i.test(trimmed) || /<!DOCTYPE NETSCAPE/i.test(trimmed)) return parseNetscapeHTML(content)
  return []
}

module.exports = { parseNetscapeHTML, parseChromeJSON, parseBookmarkFile }
