/**
 * HTML 书签解析器
 * 支持解析 Chrome/Edge/Firefox 导出的 Netscape Bookmark File Format
 */

export interface ParsedBookmark {
  title: string
  url: string
  addDate?: number
  icon?: string
  folderPath: string[] // 完整文件夹路径，如 ['书签栏', '开发工具', '前端']
}

export interface ParsedFolder {
  name: string
  path: string[]
  bookmarks: ParsedBookmark[]
  children: ParsedFolder[]
}

export interface ParseResult {
  folders: ParsedFolder[]
  flatBookmarks: ParsedBookmark[]
  stats: {
    totalBookmarks: number
    totalFolders: number
  }
}

/**
 * 解析 HTML 书签文件
 */
export function parseHtmlBookmarks(html: string): ParseResult {
  const parser = new DOMParser()
  const doc = parser.parseFromString(html, 'text/html')
  
  const folders: ParsedFolder[] = []
  const flatBookmarks: ParsedBookmark[] = []
  let totalFolders = 0
  
  // 查找根级别的 DL 元素
  const rootDL = doc.querySelector('DL, dl')
  if (!rootDL) {
    return { folders, flatBookmarks, stats: { totalBookmarks: 0, totalFolders: 0 } }
  }
  
  // 递归解析文件夹结构
  function parseFolder(dlElement: Element, parentPath: string[]): ParsedFolder[] {
    const result: ParsedFolder[] = []
    const children = dlElement.children
    
    for (let i = 0; i < children.length; i++) {
      const dt = children[i]
      if (dt.tagName.toUpperCase() !== 'DT') continue
      
      // 检查是否是文件夹（包含 H3 标签）
      const h3 = dt.querySelector(':scope > H3, :scope > h3')
      if (h3) {
        totalFolders++
        const folderName = h3.textContent?.trim() || '未命名文件夹'
        const currentPath = [...parentPath, folderName]
        
        const folder: ParsedFolder = {
          name: folderName,
          path: currentPath,
          bookmarks: [],
          children: []
        }
        
        // 查找紧随其后的 DL 元素（子内容）
        const nextDL = dt.querySelector(':scope > DL, :scope > dl')
        if (nextDL) {
          // 递归解析子文件夹
          folder.children = parseFolder(nextDL, currentPath)
          
          // 解析当前层级的书签
          const bookmarkDTs = nextDL.querySelectorAll(':scope > DT > A, :scope > dt > a')
          bookmarkDTs.forEach(a => {
            const bookmark = parseBookmarkAnchor(a as HTMLAnchorElement, currentPath)
            if (bookmark) {
              folder.bookmarks.push(bookmark)
              flatBookmarks.push(bookmark)
            }
          })
        }
        
        result.push(folder)
      } else {
        // 检查是否是书签（包含 A 标签）
        const a = dt.querySelector(':scope > A, :scope > a') as HTMLAnchorElement
        if (a) {
          const bookmark = parseBookmarkAnchor(a, parentPath)
          if (bookmark) {
            flatBookmarks.push(bookmark)
          }
        }
      }
    }
    
    return result
  }
  
  // 解析单个书签锚点
  function parseBookmarkAnchor(a: HTMLAnchorElement, folderPath: string[]): ParsedBookmark | null {
    const url = a.getAttribute('href') || a.getAttribute('HREF')
    if (!url || !url.startsWith('http')) return null
    
    const title = a.textContent?.trim() || url
    const addDateStr = a.getAttribute('add_date') || a.getAttribute('ADD_DATE')
    const icon = a.getAttribute('icon') || a.getAttribute('ICON')
    
    let addDate: number | undefined
    if (addDateStr) {
      const parsed = parseInt(addDateStr, 10)
      // Chrome 使用秒级时间戳，需要转换为毫秒
      addDate = parsed > 1e12 ? parsed : parsed * 1000
    }
    
    return {
      title,
      url,
      addDate,
      icon: icon || undefined,
      folderPath
    }
  }
  
  // 开始解析
  folders.push(...parseFolder(rootDL, []))
  
  return {
    folders,
    flatBookmarks,
    stats: {
      totalBookmarks: flatBookmarks.length,
      totalFolders
    }
  }
}

/**
 * 检测文件内容是否为 HTML 书签格式
 */
export function isHtmlBookmarkFile(content: string): boolean {
  const trimmed = content.trim().toLowerCase()
  return (
    trimmed.includes('<!doctype netscape-bookmark-file') ||
    trimmed.includes('netscape-bookmark-file') ||
    (trimmed.includes('<dt>') && trimmed.includes('<a href='))
  )
}

