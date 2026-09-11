/**
 * 图标服务模块
 * 从 DuckDuckGo 和目标网站获取图标，返回 base64 格式
 */

// 超时控制包装器
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Timeout')), ms)
    )
  ])
}

// 从 DuckDuckGo Icons 服务获取图标
async function fetchFromDuckDuckGo(host) {
  try {
    const ddgUrl = `https://icons.duckduckgo.com/ip3/${host}.ico`
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 5000)

    const response = await withTimeout(
      fetch(ddgUrl, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        signal: controller.signal
      }),
      5000
    )

    clearTimeout(timeoutId)

    if (!response.ok) return null

    const buffer = await response.arrayBuffer()
    const base64 = Buffer.from(buffer).toString('base64')
    const mimeType = response.headers.get('content-type') || 'image/x-icon'

    return {
      icon: `data:${mimeType};base64,${base64}`,
      source: 'ddg',
      mimeType
    }
  } catch {
    return null
  }
}

// 从 HTML 中提取图标 URL
function extractIconUrlFromHtml(html, baseUrl) {
  // 简单的正则匹配，提取 icon 链接
  const patterns = [
    /<link[^>]+rel=["']apple-touch-icon["'][^>]*href=["']([^"']+)["']/i,
    /<link[^>]+rel=["']icon["'][^>]*href=["']([^"']+)["']/i,
    /<link[^>]+rel=["']shortcut icon["'][^>]*href=["']([^"']+)["']/i,
  ]

  for (const pattern of patterns) {
    const match = html.match(pattern)
    if (match && match[1]) {
      let iconUrl = match[1]
      // 转换相对路径为绝对路径
      if (iconUrl.startsWith('//')) {
        iconUrl = 'https:' + iconUrl
      } else if (iconUrl.startsWith('/')) {
        const baseObj = new URL(baseUrl)
        iconUrl = baseObj.origin + iconUrl
      } else if (!iconUrl.startsWith('http')) {
        iconUrl = new URL(iconUrl, baseUrl).href
      }
      return iconUrl
    }
  }

  // 尝试 og:image
  const ogMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
  if (ogMatch && ogMatch[1]) {
    let iconUrl = ogMatch[1]
    if (iconUrl.startsWith('//')) {
      iconUrl = 'https:' + iconUrl
    } else if (!iconUrl.startsWith('http')) {
      iconUrl = new URL(iconUrl, baseUrl).href
    }
    return iconUrl
  }

  return null
}


// 从 HTML 中提取标题
function extractTitleFromHtml(html) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  if (match && match[1]) {
    return match[1].trim()
  }
  return null
}

// 从 HTML 中提取简介
function extractDescriptionFromHtml(html) {
  // 1. 尝试 <meta name="description">
  const descMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) ||
                    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i)
  if (descMatch && descMatch[1]) {
    return descMatch[1].trim()
  }

  // 2. 尝试 og:description
  const ogDescMatch = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i) ||
                      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["']/i)
  if (ogDescMatch && ogDescMatch[1]) {
    return ogDescMatch[1].trim()
  }

  return null
}

// 从网页 HTML 获取图标和元数据
async function fetchFromHtml(url) {
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 8000)

    const response = await withTimeout(
      fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        },
        signal: controller.signal
      }),
      8000
    )

    clearTimeout(timeoutId)

    if (!response.ok) return null

    const html = await response.text()
    const iconUrl = extractIconUrlFromHtml(html, url)
    const title = extractTitleFromHtml(html)
    const description = extractDescriptionFromHtml(html)

    let iconData = null
    if (iconUrl) {
      // 下载图标
      try {
        const iconResponse = await withTimeout(
          fetch(iconUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
              'Referer': url
            }
          }),
          5000
        )

        if (iconResponse.ok) {
          const buffer = await iconResponse.arrayBuffer()
          const base64 = Buffer.from(buffer).toString('base64')
          const mimeType = iconResponse.headers.get('content-type') || 'image/png'
          iconData = `data:${mimeType};base64,${base64}`
        }
      } catch (e) {
        // 图标下载失败不影响其他元数据
      }
    }

    return {
      icon: iconData,
      title,
      description,
      source: 'html'
    }
  } catch {
    return null
  }
}

/**
 * 获取网站图标及元数据（主入口）
 * @param {string} url - 网站 URL
 * @returns {Promise<Object|null>} - { url, icon, title, description, source, mimeType } 或 null
 */
export async function fetchSiteIcon(url) {
  let validatedUrl
  try {
    validatedUrl = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`)
  } catch {
    return null
  }

  if (validatedUrl.protocol !== 'http:' && validatedUrl.protocol !== 'https:') {
    return null
  }

  const origin = validatedUrl.origin
  const host = validatedUrl.host

  // 1. 同时尝试获取 HTML（因为需要标题和简介）
  const htmlResult = await fetchFromHtml(origin)
  
  // 2. 如果 HTML 没拿到图标，尝试 DuckDuckGo 兜底
  if (!htmlResult?.icon) {
    const ddgResult = await fetchFromDuckDuckGo(host)
    if (ddgResult) {
      return { 
        url: origin, 
        ...htmlResult, // 包含可能拿到的 title 和 description
        ...ddgResult 
      }
    }
  }

  if (htmlResult) {
    return { url: origin, ...htmlResult }
  }

  return null
}
