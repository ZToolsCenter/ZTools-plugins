import { ONLINE_SEARCH_PAGE_SIZE, type SearchResult, type SearchSource } from '@/types/search'
import axios from 'axios'
import * as cheerio from 'cheerio'

// 处理跨域问题的代理前缀
const PROXY_PREFIX = ''  // 移除代理前缀，直接使用完整URL

// 搜索API配置
const API_CONFIG = {
  baidu: {
    url: `${PROXY_PREFIX}/baidu/search/acjson`,
    params: (query: string) => ({
      tn: 'resultjson_com',
      word: query,
      queryWord: query,
      ie: 'utf-8',
      oe: 'utf-8',
      pn: '0',
      rn: '30'
    })
  },
  sougou: {
    url: `${PROXY_PREFIX}/sougou/pics/json.jsp`,
    params: (query: string) => ({
      query,
      st: '5',
      start: '0',
      len: '30'
    })
  }
}

// 构建URL with params
const buildUrl = (baseUrl: string, params: Record<string, string>) => {
  const url = new URL(baseUrl, window.location.origin)
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.append(key, value)
  })
  return url.toString()
}

// 生成唯一ID
const generateId = (url: string, source: SearchSource): string => {
  return `${source}_${url.split('/').pop()?.split('.')[0] || Date.now()}`
}

// 验证图片URL是否可访问
const isImageAccessible = async (url: string, timeout: number = 3000): Promise<boolean> => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)

  try {
    const response = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
      headers: {
        'Accept': 'image/*'
      }
    })
    const contentType = response.headers.get('content-type')
    return response.ok && (contentType?.startsWith('image/') ?? false)
  } catch {
    return true // 超时或错误时默认可访问，让后续加载时处理
  } finally {
    clearTimeout(timer)
  }
}

// 并发控制工具
const withConcurrency = async <T, R>(
  items: T[],
  mapper: (item: T) => Promise<R>,
  concurrency: number = 8
): Promise<R[]> => {
  const results: R[] = []
  let index = 0

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const currentIndex = index++
      results[currentIndex] = await mapper(items[currentIndex])
    }
  })

  await Promise.all(workers)
  return results
}

// 验证并过滤图片结果
const filterValidImages = async (
  results: SearchResult[],
  options: { skipValidation?: boolean; concurrency?: number } = {}
): Promise<SearchResult[]> => {
  // 如果设置了跳过验证，直接返回结果
  if (options.skipValidation) {
    return results
  }

  const concurrency = options.concurrency ?? 6

  const validations = await withConcurrency(
    results,
    async (result) => {
      const isValid = await isImageAccessible(result.url)
      return { result, isValid }
    },
    concurrency
  )

  return validations
    .filter(({ isValid }) => isValid)
    .map(({ result }) => result)
}

// 搜索百度图片
export const searchBaidu = async (
  query: string,
  page: number = 1,
  options: { gifOnly?: boolean } = {}
): Promise<SearchResult[]> => {
  try {
    const pn = (page - 1) * ONLINE_SEARCH_PAGE_SIZE
    // 如果没有查询词，使用默认的"表情包"关键词
    const searchQuery = query || '表情包'
    const url = `https://image.baidu.com/search/acjson?tn=resultjson_com&logid=${Date.now()}&ipn=rj&ct=201326592&is=&fp=result&fr=&word=${encodeURIComponent(searchQuery)}&queryWord=${encodeURIComponent(searchQuery)}&cl=2&lm=-1&ie=utf-8&oe=utf-8&adpicid=&st=-1&z=&ic=0&hd=&latest=&copyright=&s=&se=&tab=&width=&height=&face=0&istype=2&qc=&nc=1&expermode=&nojc=&isAsync=&pn=${pn}&rn=${ONLINE_SEARCH_PAGE_SIZE}&gsm=1e`
    
    const response = await fetch(url, {
      headers: {
        'Accept': '*/*',
        'Accept-Language': 'zh-CN,zh;q=0.9'
      }
    })
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }
    
    const data = await response.json()
    
    const IRRELEVANT_TITLE_KEYWORDS = /商品|广告|新闻|壁纸|海报|banner|素材网|千图|摄图|包图/i

    // 过滤并转换数据
    const results = (data.data || [])
      .filter((item: any) => {
        if (!item.thumbURL) return false

        // 维度过滤：排除极端宽高比和过大尺寸的图片
        const w = Number(item.width)
        const h = Number(item.height)
        if (w && h) {
          const ratio = w / h
          if (ratio > 3 || ratio < 1 / 3) return false
          if (w > 2000 || h > 2000) return false
        }

        // 标题相关性过滤
        const title = item.fromPageTitleEnc || ''
        if (title && IRRELEVANT_TITLE_KEYWORDS.test(title)) return false

        if (!options.gifOnly) return item.type !== 'gif'

        return item.type === 'gif'
          || item.thumbURL?.toLowerCase().includes('.gif')
          || item.middleURL?.toLowerCase().includes('.gif')
      })
      .map((item: any) => ({
        id: generateId(item.thumbURL, 'baidu'),
        url: item.thumbURL,
        previewUrl: item.middleURL || item.thumbURL,
        thumbnailUrl: item.thumbURL,
        title: item.fromPageTitleEnc || '未命名表情',
        gifCandidate: options.gifOnly
          ? item.type === 'gif'
            || item.thumbURL?.toLowerCase().includes('.gif')
            || item.middleURL?.toLowerCase().includes('.gif')
          : false,
        source: 'baidu',
        originalUrl: item.middleURL || item.thumbURL
      }))

    // 验证并过滤图片
    return await filterValidImages(results)
  } catch (err) {
    console.error('Baidu search failed:', err)
    return []
  }
}

// 搜索搜狗图片
export const searchSougou = async (query: string, page: number = 1): Promise<SearchResult[]> => {
  try {
    // 如果没有查询词，使用默认的"表情包"关键词
    const searchQuery = query || '表情包'
    // 使用新的搜狗表情包 API
    const url = `https://cn.apihz.cn/api/img/apihzbqbsougou.php?id=10004937&key=huhabiaoqingbao&page=${page}&words=${encodeURIComponent(searchQuery)}`
    
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json'
      }
    })

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    const data = await response.json()
    
    // 检查API返回的状态
    if (data.code !== 200) {
      console.error('API error:', data.msg || '未知错误')
      return []
    }
    
    // 确保返回的数据有效
    if (!data.res || !Array.isArray(data.res)) {
      console.error('Invalid data format:', data)
      return []
    }

    // 转换数据格式
    const results = data.res
      .filter((url: string) => {
        // 确保URL是有效的字符串
        return typeof url === 'string' && url.startsWith('http')
      })
      .map((url: string) => ({
        id: generateId(url, 'sougou'),
        url: url,
        title: searchQuery || '未命名表情',
        source: 'sougou' as const,
        originalUrl: url
      }))

    // 添加调试日志
    console.log('Sougou search results:', {
      query: searchQuery,
      page,
      resultsCount: results.length,
      firstResult: results[0]
    })

    return results

  } catch (error) {
    console.error('Sougou search failed:', error)
    return []
  }
}

// 搜索 Bing 图片
export const searchBing = async (
  query: string,
  page: number = 1,
  options: { gifOnly?: boolean } = {}
): Promise<SearchResult[]> => {
  try {
    const offset = (page - 1) * ONLINE_SEARCH_PAGE_SIZE
    // 如果没有查询词，使用默认的"表情包"关键词
    const searchQuery = query || '表情包'
    const url = `https://cn.bing.com/images/async?q=${encodeURIComponent(searchQuery)}&first=${offset}&count=${ONLINE_SEARCH_PAGE_SIZE}&mmasync=1`
    
    const response = await fetch(url, {
      headers: {
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'zh-CN,zh;q=0.9'
      }
    })
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }
    
    const html = await response.text()
    
    // 使用正则表达式提取图片信息
    const results: SearchResult[] = []
    const regex = /murl&quot;:&quot;(.*?)&quot;.*?t&quot;:&quot;(.*?)&quot;/g
    let match
    
    while ((match = regex.exec(html)) !== null) {
      const [, url, title] = match
      if (url && (options.gifOnly || !url.includes('.gif'))) {
        results.push({
          id: generateId(url, 'bing'),
          url: url,
          title: title || '未命名表情',
          gifCandidate: options.gifOnly && url.toLowerCase().includes('.gif'),
          source: 'bing',
          originalUrl: url
        })
      }
    }
    
    // 验证并过滤图片
    return await filterValidImages(results)
  } catch (err) {
    console.error('Bing search failed:', err)
    return []
  }
}

// 搜索发表情网
export const searchFaBiaoQing = async (query: string, page: number = 1): Promise<SearchResult[]> => {
  try {
    // 使用正确的发表情网搜索接口
    const url = `/fabiaoqing/search/bqb/keyword/${encodeURIComponent(query)}/type/bq/page/${page}.html`
    
    const response = await fetch(url, {
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
      }
    })

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    const html = await response.text()
    
    // 更新正则表达式以匹配新的HTML结构
    const imgRegex = /<img\s+class="ui\s+image"[^>]*src="([^"]+)"[^>]*title="([^"]+)"[^>]*>/g
    const results: SearchResult[] = []
    let match

    while ((match = imgRegex.exec(html)) !== null) {
      const [, url, title] = match
      if (url && url.startsWith('http')) {
        results.push({
          id: generateId(url, 'fabiaoqing'),
          title: title || query || '未命名表情',
          url: url,
          originalUrl: url,
          source: 'fabiaoqing'
        })
      }
    }

    // 添加调试日志
    console.log('FaBiaoQing search results:', {
      query,
      page,
      resultsCount: results.length,
      firstResult: results[0]
    })

    return results
  } catch (error) {
    console.error('FaBiaoQing search failed:', error)
    return []
  }
}

// 搜索斗图啦
export const searchDouTu = async (keyword: string, page: number): Promise<SearchResult[]> => {
  try {
    // 如果没有关键词，使用默认的"表情包"关键词
    const searchKeyword = keyword || '表情包'
    
    const response = await axios.get('https://www.52doutu.cn/api/', {
      params: {
        types: 'search',
        action: 'searchpic',
        wd: searchKeyword,
        limit: ONLINE_SEARCH_PAGE_SIZE,
        offset: (page - 1) * ONLINE_SEARCH_PAGE_SIZE
      },
      headers: {
        'Accept': 'application/json',
        'Referer': 'https://www.52doutu.cn/'
      }
    })

    const results = response.data?.data?.list || []
    
    return results.map((item: any): SearchResult => ({
      id: item.id || Date.now().toString() + Math.random(),
      url: item.url || '',
      title: item.title || searchKeyword || '表情包',
      originalUrl: item.original_url || item.url || '',
      source: 'doutu'
    }))
  } catch (error) {
    console.error('Doutu search failed:', error)
    return []
  }
}

// 更新 searchApiHz 函数
export const searchApiHz = async (query: string, page: number): Promise<SearchResult[]> => {
  try {
    // 确保有搜索关键词
    if (!query.trim()) {
      query = '表情包' // 默认搜索关键词
    }

    // 添加 limit 参数来增加返回数量
    const limit = ONLINE_SEARCH_PAGE_SIZE
    const url = `https://cn.apihz.cn/api/img/apihzbqb.php?id=10004937&key=huhabiaoqingbao&type=2&page=${page}&words=${encodeURIComponent(query)}&limit=${limit}`
    
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json'
      }
    })
    
    if (!response.ok) {
      throw new Error('Network response was not ok')
    }

    const data = await response.json()
    
    // 检查API返回的状态
    if (data.code !== 200) {
      console.error('API error:', data.msg || '未知错误')
      return []
    }
    
    // 确保返回的数据有效
    if (!data.res || !Array.isArray(data.res)) {
      console.error('Invalid data format:', data)
      return []
    }

    // 转换数据格式并添加错误处理
    const results = data.res
      .filter((url: string) => {
        try {
          // 确保URL是有效的字符串并且是正确的URL格式
          return typeof url === 'string' && 
                 url.startsWith('http') && 
                 new URL(url).href === url
        } catch {
          return false // 如果URL格式无效，过滤掉
        }
      })
      .map((url: string) => ({
        id: generateId(url, 'apihz'),
        url: url.replace(/\\/g, ''), // 移除可能的转义字符
        title: query || '未命名表情',
        gifCandidate: /\.gif(?:$|[?#])/i.test(url),
        source: 'apihz' as const,
        originalUrl: url.replace(/\\/g, '') // 同样处理 originalUrl
      }))

    // 添加更详细的调试日志
    console.log('ApiHz search results:', {
      query,
      page,
      limit,
      maxPage: data.maxpage,
      count: data.count,
      requestedUrl: url,
      resultsCount: results.length,
      rawResultsCount: data.res.length,
      firstResult: results[0],
      rawResponse: data
    })

    return results

  } catch (error) {
    console.error('ApiHz search failed:', error)
    return []
  }
}

/**
 * 搜索斗了个图
 */
export const searchDogetu = async (query: string, page: number): Promise<SearchResult[]> => {
  try {
    // 构建URL和参数
    let url = 'https://www.dogetu.com/search.html'
    let params: { page: number; keyword?: string } = { 
      page, 
      keyword: query 
    }
    
    // 如果没有关键词，加载最新表情包
    if (!query) {
      url = 'https://www.dogetu.com/biaoqing.html'
      params = { page }
    }

    const response = await axios.get(url, { params })
    const $ = cheerio.load(response.data)
    
    const results: SearchResult[] = []
    $('.item-pic>a>img').each((_, img) => {
      const element = $(img)
      const url = element.attr('src') || ''
      const title = element.attr('alt') || '表情包'
      
      if (url) {
        results.push({
          id: generateId(url, 'dogetu'),
          title,
          url,
          gifCandidate: /\.gif(?:$|[?#])/i.test(url),
          originalUrl: url,
          source: 'dogetu' as const
        })
      }
    })

    return results
  } catch (error) {
    console.error('搜索斗了个图失败:', error)
    return []
  }
} 
