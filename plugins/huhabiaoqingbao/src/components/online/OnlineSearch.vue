<template>
  <div class="online-search">
    <!-- 固定在顶部的控件容器 -->
    <div class="fixed-controls">
      <!-- 集成的搜索框和站点选择器 -->
      <div class="integrated-search">
        <div class="search-container">
          <div class="search-input-group">
            <el-input v-model="searchQuery" placeholder="搜索..." :disabled="loading" @keyup.enter="handleSearch"
              class="search-input">
              <template #suffix>
                <button
                  type="button"
                  class="search-trigger"
                  :disabled="loading"
                  @click="handleSearch"
                >
                  <el-icon v-if="!loading">
                    <Search />
                  </el-icon>
                  <el-icon v-else class="is-loading">
                    <Loading />
                  </el-icon>
                </button>
              </template>
            </el-input>
          </div>

          <div class="site-selector">
            <div class="site-selector-track">
              <div class="site-selector-slider" :style="sliderStyle"></div>
              <div v-for="site in sites" :key="site.value" class="site-option"
                :class="{ active: currentSite === site.value }" @click="handleSiteSelect(site.value)">
                {{ site.label }}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 内容区域添加上边距，避免被固定区域遮挡 -->
    <div class="content-wrapper">
      <!-- 搜索结果 -->
      <div class="search-results">
        <el-scrollbar ref="scrollbarRef">
          <!-- 空状态提示 -->
          <div v-if="!searchResults.length && !loading" class="empty-state">
            <el-icon class="empty-icon">
              <Search />
            </el-icon>
            <h3>开始搜索表情包</h3>
            <p>输入关键词，从海量表情包中找到你想要的</p>
            <div class="example-keywords">
              <el-tag v-for="keyword in defaultSearchTerms.slice(0, 4)" :key="keyword" class="keyword-tag"
                @click="handleKeywordClick(keyword)">
                {{ keyword }}
              </el-tag>
            </div>
          </div>

          <!-- 现有的结果网格 -->
          <div v-else class="results-grid">
              <div
              v-for="item in searchResults"
              :key="getResultKey(item)"
              class="result-item"
              :class="{ 'gif-result-item': shouldUseGifProgressiveLoading(item) }"
            >
              <el-image :src="getGridImageUrl(item)" fit="contain" loading="lazy" @click="handlePreview(item)"
                @error="handleImageError(item)">
                <template #error>
                  <div class="image-error">
                    <el-icon>
                      <Picture />
                    </el-icon>
                    <span>加载失败</span>
                  </div>
                </template>
              </el-image>

              <!-- 悬浮操作按钮 -->
              <div class="hover-actions">
                <el-tooltip content="复制到剪贴板" placement="top" :show-after="500">
                  <el-button circle size="small" @click="handleCopy(item)" class="action-button">
                    <el-icon>
                      <CopyDocument />
                    </el-icon>
                  </el-button>
                </el-tooltip>

                <el-tooltip content="保存到本地" placement="top" :show-after="500">
                  <el-button circle size="small" @click="handleSave(item)" class="action-button">
                    <el-icon>
                      <Download />
                    </el-icon>
                  </el-button>
                </el-tooltip>

                <!-- 发送按钮 -->
                <el-tooltip content="发送到聊天窗口" placement="top" :show-after="500">
                  <el-button circle size="small" @click.stop="handleSend(item)" class="action-button">
                    <el-icon>
                      <Position />
                    </el-icon>
                  </el-button>
                </el-tooltip>
              </div>
            </div>
          </div>

          <!-- 加载状态 -->
          <div v-if="loading" class="loading-state">
            <transition name="gif-wash">
              <div v-if="currentSite === 'gif'" class="gif-cleaning-notice">
                <div class="notice-orbit">
                  <span class="orbit-ring orbit-ring-outer"></span>
                  <span class="orbit-ring orbit-ring-inner"></span>
                  <span class="orbit-core"></span>
                </div>
                <div class="notice-copy">
                  <p class="notice-title">动图清洗中，请耐心等待</p>
                  <p class="notice-subtitle">正在筛选可用动图并去除静态结果</p>
                </div>
                <div class="notice-dots" aria-hidden="true">
                  <span></span>
                  <span></span>
                  <span></span>
                </div>
              </div>
            </transition>
            <div class="skeleton-grid">
              <div v-for="i in getCurrentPageSize()" :key="i" class="skeleton-item">
                <div class="skeleton-image pulse-animation">
                  <div class="skeleton-overlay">
                    <el-icon class="loading-icon rotating">
                      <Loading />
                    </el-icon>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- 修改加载更多触发器的样式和位置 -->
          <div ref="loadMoreTrigger" v-if="!isLastPage && searchResults.length > 0" class="load-more-trigger">
            <el-button :loading="false" @click="handleLoadMore" class="load-more-button" round>
              <span class="button-content">
                <el-icon v-if="loading" class="is-loading">
                  <Loading />
                </el-icon>
                <span>{{ loading ? '加载中...' : '加载更多' }}</span>
              </span>
            </el-button>
          </div>

          <!-- 添加自动加载触发器 -->
          <div ref="autoLoadTrigger" v-show="!isLastPage && searchResults.length > 0" class="auto-load-trigger"></div>

          <!-- 无更多数据提示 -->
          <div v-if="isLastPage && searchResults.length > 0" class="no-more">
            没有更多数据了
          </div>
        </el-scrollbar>
      </div>
    </div>

    <!-- 自定义图片预览组件 -->
    <el-image-viewer v-if="showViewer" :url-list="[previewImage]" :initial-index="0" :zoom-rate="1.2"
      :hide-on-click-modal="true" @close="showViewer = false" />

    <!-- 返回顶部按钮 -->
    <el-backtop :right="20" :bottom="20" target=".el-scrollbar__wrap" :visibility-height="200" class="custom-backtop">
      <el-icon>
        <Top />
      </el-icon>
    </el-backtop>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, nextTick, computed, onBeforeUnmount, watch } from 'vue'
import { useRoute } from 'vue-router'
import { Search, Picture, Download, CopyDocument, Position, Loading, Top } from '@element-plus/icons-vue'
import { ElMessage, ElImageViewer } from 'element-plus'
import { useEmoticonStore } from '@/store/emoticon'
import { searchBaidu, searchBing, searchSougou, searchApiHz, searchDogetu } from '@/api/search'
import { ONLINE_SEARCH_PAGE_SIZE, type SearchResult, type SearchSource } from '@/types/search'
import type { Emoticon } from '@/types/index'
import { validateAnimatedImageUrl, evaluateGifConfidence, preloadValidationCache } from '@/utils/animatedImage'
import axios from 'axios'
import { load } from 'cheerio'

const props = defineProps<{
  initialQuery?: string
}>()

const route = useRoute()
const store = useEmoticonStore()
const searchQuery = ref(props.initialQuery || (route.query.q as string) || '')

watch(() => props.initialQuery, (newQuery) => {
  if (newQuery) {
    searchQuery.value = newQuery
    handleSearch()
  }
})

// 添加默认检索词配置
const defaultSearchTerms = [
  '熊猫人', '暴漫', '萌宠', '猫咪', '狗狗', '狗子', '蔡徐坤', '萌宝', '熊猫', '兔斯基', '热门'
]

// 纯检索词配置 - 这些词不会自动添加"表情包"等后缀
const pureSearchTerms = ['动图', 'gif', '动态', '动画', '动']

const loading = ref(false)
const searchResults = ref<SearchResult[]>([])
const currentPage = ref(1)
const isLastPage = ref(false)
const scrollbarRef = ref<any>(null)

// 恢复 Intersection Observer 相关的变量
const loadMoreTrigger = ref<HTMLElement | null>(null)
const autoLoadTrigger = ref<HTMLElement | null>(null)
let observer: IntersectionObserver | null = null

// 图片预览相关状态
const showViewer = ref(false)
const previewImage = ref('')

// 添加站点配置
const sites = [
  { label: '百度', value: 'baidu' },
  { label: '搜狗', value: 'sougou' },
  { label: '必应', value: 'bing' },
  { label: 'ApiHz', value: 'apihz' },
  { label: '斗图啦', value: 'doutula' },
  { label: '斗个图', value: 'dogetu' },
  { label: 'Gif', value: 'gif' }
] as const

// 初始化currentSite为'baidu'，确保初始状态正确
const currentSite = ref<SearchSource>('baidu')
const GIF_PAGE_SIZE = 30
const gifAggregateSites: SearchSource[] = ['baidu', 'sougou', 'doutula']
const gifSiteResultLimit = 15
const gifSiteRequestTimeout = 1800
const gifValidationConcurrency = 16
const gifValidationTimeout = 3500
const gifResultTargetCount = GIF_PAGE_SIZE
const gifHighConfidenceThreshold = 80

// 计算当前选中站点的索引
const currentSiteIndex = computed(() =>
  sites.findIndex(site => site.value === currentSite.value)
)

// 响应式列数计算
const getGridColumns = () => {
  // 确保在服务器端渲染或初始加载时有默认值
  if (typeof window === 'undefined' || !window.innerWidth) return 7

  if (window.innerWidth <= 480) return 2
  if (window.innerWidth <= 768) return 4
  return 7
}

// 动态计算滑块位置
const getSliderPosition = () => {
  const columns = getGridColumns()
  const index = currentSiteIndex.value
  return {
    left: `${(100 / columns) * (index % columns)}%`,
    width: `${100 / columns}%`
  }
}

const getResultKey = (item: SearchResult) => item.id || item.originalUrl || item.url

const shouldUseGifProgressiveLoading = (item: SearchResult) => (
  currentSite.value === 'gif'
  || item.gifCandidate === true
)

const getGifStillUrl = (item: SearchResult) => (
  item.thumbnailUrl
  || item.url
)

const getGifAnimatedUrl = (item: SearchResult) => (
  item.previewUrl
  || item.originalUrl
  || item.url
)

const getGridImageUrl = (item: SearchResult) => {
  if (!shouldUseGifProgressiveLoading(item)) {
    return item.url
  }

  return getGifStillUrl(item)
}

const getCurrentPageSize = () => currentSite.value === 'gif' ? GIF_PAGE_SIZE : ONLINE_SEARCH_PAGE_SIZE

// 计算滑块样式，确保初始加载时正确显示
const sliderStyle = computed(() => {
  windowWidth.value

  // 确保在初始加载时返回正确的样式
  if (typeof window === 'undefined') {
    return {
      left: '0%',
      width: '14.285%' // 100% / 7 columns
    }
  }

  return getSliderPosition()
})

// 添加响应式状态
const windowWidth = ref(window.innerWidth)

// 监听窗口大小变化
const handleResize = () => {
  windowWidth.value = window.innerWidth
}

onMounted(() => {
  // 进入页面时自动执行一次检索
  handleSearch()

  // 添加窗口大小变化监听
  window.addEventListener('resize', handleResize)

  // 强制更新滑块位置，确保初始状态正确
  nextTick(() => {
    // 强制重新计算滑块位置
    const slider = document.querySelector('.site-selector-slider')
    if (slider) {
      const position = getSliderPosition()
      slider.setAttribute('style', `left: ${position.left}; width: ${position.width};`)
    }
  })
})

// 组件卸载时清理事件监听器
onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize)
  if (observer) {
    observer.disconnect()
  }
})

// 添加点击加载更多的处理函数
const handleLoadMore = async () => {
  if (loading.value || isLastPage.value) return
  currentPage.value++
  await loadMore()
}

// 修改重置搜索状态的函数
const resetSearch = () => {
  currentPage.value = 1
  isLastPage.value = false
  searchResults.value = []
  loading.value = false

  // 重新创建observer
  if (observer) {
    observer.disconnect()
  }
  nextTick(() => {
    if (autoLoadTrigger.value && !isLastPage.value) {
      observer = new IntersectionObserver(
        async (entries) => {
          const target = entries[0]
          if (target.isIntersecting && !loading.value && !isLastPage.value && searchResults.value.length > 0) {
            await handleLoadMore()
          }
        },
        {
          root: null,
          rootMargin: '100px',
          threshold: 0
        }
      )
      observer.observe(autoLoadTrigger.value)
    }
  })
}

const getRandomDefaultTerm = () => {
  const randomIndex = Math.floor(Math.random() * defaultSearchTerms.length)
  return defaultSearchTerms[randomIndex]
}

const buildStandardQuery = (rawQuery: string, site: SearchSource) => {
  let query = rawQuery.trim()

  if (!query) {
    return `${getRandomDefaultTerm()}表情包`
  }

  if (pureSearchTerms.includes(query.toLowerCase())) {
    return query
  }

  if (!query.includes('表情') && !['doutula'].includes(site)) {
    query = `${query}表情`
  }

  return query
}

const buildGifQuery = (rawQuery: string) => {
  let query = rawQuery.trim()

  if (!query) {
    query = getRandomDefaultTerm()
  }

  if (!/(gif|动图|动态|动画)/i.test(query)) {
    query = `${query} gif`
  }

  return query
}

const getResultLabel = () => currentSite.value === 'gif' ? 'GIF动图' : '表情包'

const searchBySite = async (
  site: SearchSource,
  query: string,
  page: number,
  options: { gifOnly?: boolean; skipLastPageTracking?: boolean; skipTranslation?: boolean } = {}
): Promise<SearchResult[]> => {
  switch (site) {
    case 'baidu':
      return searchBaidu(query, page, { gifOnly: options.gifOnly })
    case 'bing':
      return searchBing(query, page, { gifOnly: options.gifOnly })
    case 'sougou':
      return searchSougou(query, page)
    case 'apihz':
      return searchApiHz(query, page)
    case 'dogetu':
      return searchDogetu(query, page)
    case 'doutula':
      return searchDoutula(query, page)
    default:
      return []
  }
}

const getImageUrl = (item: SearchResult) => item.originalUrl || item.url

const dedupeResultsByCanonicalUrl = (results: SearchResult[]) => results.filter((item, index, array) => {
  const imageUrl = getImageUrl(item)
  return array.findIndex(candidate => getImageUrl(candidate) === imageUrl) === index
})

const isGifLikeUrl = (url?: string) => Boolean(url && /\.gif(?:$|[?#])/i.test(url))

const getGifPriority = (item: SearchResult) => {
  let score = 0

  if (item.gifCandidate) score += 20
  if (isGifLikeUrl(item.originalUrl)) score += 10
  if (isGifLikeUrl(item.url)) score += 5

  return score
}

const prioritizeGifResults = (results: SearchResult[]) => (
  [...results].sort((left, right) => getGifPriority(right) - getGifPriority(left))
)

const getAnimatedCandidateUrls = (item: SearchResult) => Array.from(new Set(
  [item.previewUrl, item.originalUrl, item.url].filter((url): url is string => Boolean(url && url.startsWith('http')))
))

const resolveAnimatedResult = async (item: SearchResult): Promise<SearchResult | null> => {
  const candidateUrls = getAnimatedCandidateUrls(item)
  const stillUrl = item.thumbnailUrl || item.url

  // 先检查高置信度URL（无需网络请求）
  for (const candidateUrl of candidateUrls) {
    const confidence = evaluateGifConfidence(candidateUrl)
    if (confidence.score >= gifHighConfidenceThreshold) {
      return buildResolvedResult(item, candidateUrl, stillUrl)
    }
  }

  // 所有候选URL并行验证，第一个返回true的结果即被采纳
  const validationPromises = candidateUrls.map(async (candidateUrl) => {
    const isAnimated = await validateAnimatedImageUrl(candidateUrl, {
      timeout: gifValidationTimeout
    })
    return isAnimated ? candidateUrl : null
  })

  const results = await Promise.all(validationPromises)
  const animatedUrl = results.find(url => url !== null)

  if (animatedUrl) {
    return buildResolvedResult(item, animatedUrl, stillUrl)
  }

  return null
}

const buildResolvedResult = (item: SearchResult, url: string, stillUrl: string): SearchResult => ({
  ...item,
  url: stillUrl || url,
  previewUrl: item.previewUrl || url,
  thumbnailUrl: stillUrl || item.thumbnailUrl || url,
  originalUrl: item.originalUrl || url,
  gifCandidate: true
})

const withTimeout = async <T>(promise: Promise<T>, timeout: number, fallbackValue: T): Promise<T> => {
  let timer: number | null = null

  const timeoutPromise = new Promise<T>((resolve) => {
    timer = window.setTimeout(() => resolve(fallbackValue), timeout)
  })

  const result = await Promise.race([promise, timeoutPromise])
  if (timer !== null) {
    window.clearTimeout(timer)
  }

  return result
}

const filterAnimatedGifResults = async (results: SearchResult[]) => {
  const prioritizedResults = prioritizeGifResults(dedupeResultsByCanonicalUrl(results))
  const validatedResults: SearchResult[] = []

  // 预加载缓存
  const allUrls = prioritizedResults.flatMap(item => getAnimatedCandidateUrls(item))
  const cachedResults = preloadValidationCache(allUrls)

  // 按置信度排序，高置信度的优先处理
  const resultsWithConfidence = prioritizedResults.map(item => {
    const urls = getAnimatedCandidateUrls(item)
    const maxConfidence = Math.max(...urls.map(url => evaluateGifConfidence(url).score))
    return { item, confidence: maxConfidence, urls }
  }).sort((a, b) => b.confidence - a.confidence)

  // 首先处理高置信度的结果（直接认为是动画GIF）
  for (const { item, confidence, urls } of resultsWithConfidence) {
    if (validatedResults.length >= gifResultTargetCount) {
      break
    }

    // 高置信度直接接受
    if (confidence >= gifHighConfidenceThreshold) {
      const bestUrl = item.previewUrl || item.originalUrl || urls[0] || item.url
      validatedResults.push({
        ...item,
        url: item.thumbnailUrl || item.url || bestUrl,
        previewUrl: item.previewUrl || bestUrl,
        thumbnailUrl: item.thumbnailUrl || item.url || bestUrl,
        originalUrl: item.originalUrl || bestUrl,
        gifCandidate: true
      })
      continue
    }

    // 检查缓存
    let foundAnimated = false
    for (const url of urls) {
      if (cachedResults[url] === true) {
        validatedResults.push({
          ...item,
          url: item.thumbnailUrl || item.url || url,
          previewUrl: item.previewUrl || url,
          thumbnailUrl: item.thumbnailUrl || item.url || url,
          originalUrl: item.originalUrl || url,
          gifCandidate: true
        })
        foundAnimated = true
        break
      }
    }
    if (foundAnimated) continue
  }

  // 过滤掉不需要验证的项：已缓存为false的 或 缓存已命中的
  const remainingResults = resultsWithConfidence
    .filter(({ confidence, urls }) => {
      if (confidence >= gifHighConfidenceThreshold) return false
      // 至少有一个URL不在false缓存中，才需要验证
      return urls.some(url => cachedResults[url] !== false)
    })
    .map(({ item }) => item)

  // 流式并发验证：维护活跃请求数，一个完成立即启动下一个
  let activeCount = 0
  let nextIndex = 0

  await new Promise<void>((resolve) => {
    let resolved = false

    const checkDone = () => {
      if (resolved) return
      if (validatedResults.length >= gifResultTargetCount || (activeCount === 0 && nextIndex >= remainingResults.length)) {
        resolved = true
        resolve()
      }
    }

    const runNext = () => {
      if (resolved || nextIndex >= remainingResults.length) {
        checkDone()
        return
      }

      const item = remainingResults[nextIndex++]
      activeCount++

      resolveAnimatedResult(item).then(resolved_item => {
        if (resolved_item && !resolved) {
          if (!validatedResults.some(c => c.url === resolved_item.url)) {
            validatedResults.push(resolved_item)
          }
        }
      }).catch(() => {
        // 忽略错误
      }).finally(() => {
        activeCount--
        if (validatedResults.length >= gifResultTargetCount) {
          checkDone()
        } else {
          runNext()
        }
      })
    }

    // 启动初始并发 workers
    const workers = Math.min(gifValidationConcurrency, remainingResults.length)
    for (let i = 0; i < workers; i++) {
      runNext()
    }
  })

  return validatedResults
}

const searchGifResults = async (query: string, page: number) => {
  const siteResults = await Promise.all(
    gifAggregateSites.map(site =>
      withTimeout(
        searchBySite(site, query, page, {
          gifOnly: true,
          skipLastPageTracking: true,
          skipTranslation: true
        }).catch(() => []),
        gifSiteRequestTimeout,
        [] as SearchResult[]
      )
    )
  )

  const mergedResults = siteResults.flatMap(result => result.slice(0, gifSiteResultLimit))

  return await filterAnimatedGifResults(mergedResults)
}

// 加载更多数据
const loadMore = async () => {
  if (loading.value || isLastPage.value) return

  loading.value = true

  try {
    const rawQuery = searchQuery.value.trim()
    let isFallbackSearch = false
    const query = currentSite.value === 'gif'
      ? buildGifQuery(rawQuery)
      : buildStandardQuery(rawQuery, currentSite.value)

    let newResults = currentSite.value === 'gif'
      ? await searchGifResults(query, currentPage.value)
      : await searchBySite(currentSite.value, query, currentPage.value)

    newResults = newResults.slice(0, getCurrentPageSize())

    // 如果没有新结果，且当前使用的是默认检索词，则尝试去掉检索词重新搜索
    if (newResults.length === 0 && !rawQuery) {
      isFallbackSearch = true
      console.log('使用默认检索词未找到结果，尝试去掉检索词重新搜索')

      newResults = currentSite.value === 'gif'
        ? await searchGifResults('', currentPage.value)
        : await searchBySite(currentSite.value, '', currentPage.value)

      newResults = newResults.slice(0, getCurrentPageSize())
    }

    // 如果仍然没有新结果
    if (newResults.length === 0) {
      isLastPage.value = true
      if (currentPage.value === 1) {
        if (isFallbackSearch) {
          ElMessage.warning(`即使去掉检索词也未找到相关${getResultLabel()}`)
        } else {
          ElMessage.warning(`没有找到相关${getResultLabel()}`)
        }
      }
      return
    }

    // 去重处理
    const existingUrls = new Set(searchResults.value.map(item => getImageUrl(item)))
    const uniqueResults = newResults.filter(item => !existingUrls.has(getImageUrl(item)))

    if (uniqueResults.length > 0) {
      searchResults.value.push(...uniqueResults)
    } else {
      isLastPage.value = true
    }

  } catch (err) {
    console.error('Load more failed:', err)
    ElMessage.error('加载失败，请重试')
    currentPage.value-- // 回退页码，允许重试
  } finally {
    loading.value = false
  }
}

// 添加站点选择处理函数
const handleSiteSelect = (siteValue: SearchSource) => {
  currentSite.value = siteValue
  resetSearch()
  loadMore()
}

// 修改搜索处理函数
const handleSearch = async () => {
  if (loading.value) return
  resetSearch()
  await loadMore()
}

// 保存表情包
const handleSave = async (item: SearchResult) => {
  try {
    const imageUrl = item.originalUrl || item.url
    const response = await axios.get(imageUrl, {
      responseType: 'blob',
      headers: {
        'Accept': 'image/*'
      }
    })

    const blob = response.data
    const fileName = `${item.title || '表情包'}_${Date.now()}.${blob.type.split('/')[1] || 'png'}`
    const file = new File([blob], fileName, { type: blob.type })

    // 创建新的表情包对象
    const emoticon: Emoticon = {
      id: generateId(),
      name: item.title || fileName,
      url: '',
      type: blob.type,
      favorite: false,
      createdAt: Date.now(), // 修改为数字类型时间戳
      createTime: Date.now(),
      updateTime: Date.now(),
      tags: []
    }

    await store.addEmoticon(emoticon, file)
    ElMessage.success('保存成功')
  } catch (err) {
    console.error('Save failed:', err)
    ElMessage.error('保存失败，请稍后重试')
  }
}

// 添加生成ID的工具函数
const generateId = (): string => {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
};

// 添加 GIF 检测函数
const isGifImage = async (blob: Blob): Promise<boolean> => {
  // 方法1: 检查MIME类型
  if (blob.type === 'image/gif') {
    return true
  }

  // 方法2: 检查文件头部标识
  try {
    const buffer = await blob.arrayBuffer()
    const uint8Arr = new Uint8Array(buffer)

    // GIF文件头部标识为 "GIF87a" 或 "GIF89a"
    const header = String.fromCharCode(...uint8Arr.slice(0, 6))
    return header === 'GIF87a' || header === 'GIF89a'
  } catch {
    // 如果无法读取文件头，回退到使用MIME类型判断
    return blob.type === 'image/gif'
  }
}

// 修改复制函数中的 GIF 检测部分
const handleCopy = async (item: SearchResult) => {
  try {
    const imageUrl = item.originalUrl || item.url

    const loadingMessage = ElMessage({
      type: 'info',
      message: '正在复制...',
      duration: 0
    })

    try {
      // 获取图片数据
      const response = await axios.get(imageUrl, {
        responseType: 'blob',
        headers: {
          'Accept': 'image/*'
        }
      })

      const blob = response.data

      // 使用更精确的 GIF 检测
      const isGif = await isGifImage(blob)

      if (isGif) {
        // 1. 创建临时文件
        const tempFileName = `temp_${Date.now()}.gif`
        const tempPath = window.preload.utils.getTempPath(tempFileName)

        // 2. 将blob转换为buffer并写入临时文件
        const arrayBuffer = await blob.arrayBuffer()
        const buffer = new Uint8Array(arrayBuffer)
        await window.preload.fs.writeFile(tempPath, buffer)

        // 3. 使用 ztools.copyFile 复制 GIF 文件到剪贴板
        window.ztools.copyFile(tempPath)

        loadingMessage.close()
        ElMessage({
          message: 'GIF已复制到剪贴板，可直接粘贴使用',
          type: 'success',
          duration: 3000,
          showClose: true
        })

        // 4. 30秒后删除临时文件
        setTimeout(async () => {
          try {
            await window.preload.fs.unlink(tempPath)
          } catch (err) {
            console.error('Failed to delete temp file:', err)
          }
        }, 30000)
      } else {
        // 非GIF图片使用Canvas方法
        // 创建一个临时的 img 元素
        const img = document.createElement('img')
        img.crossOrigin = 'anonymous' // 允许跨域
        img.src = URL.createObjectURL(blob)

        // 等待图片加载
        await new Promise((resolve, reject) => {
          img.onload = resolve
          img.onerror = reject
        })

        // 创建 canvas
        const canvas = document.createElement('canvas')
        canvas.width = img.naturalWidth
        canvas.height = img.naturalHeight

        // 将图片绘制到 canvas
        const ctx = canvas.getContext('2d')
        if (!ctx) throw new Error('Failed to get canvas context')
        ctx.drawImage(img, 0, 0)

        // 将图片转换为 PNG 格式
        const pngBlob = await new Promise<Blob>((resolve) => {
          canvas.toBlob((b) => resolve(b || new Blob()), 'image/png')
        })

        // 复制到剪贴板
        await navigator.clipboard.write([
          new ClipboardItem({
            'image/png': pngBlob
          })
        ])

        // 释放URL对象
        URL.revokeObjectURL(img.src)

        loadingMessage.close()
        ElMessage({
          type: 'success',
          message: '表情包已复制，可以直接粘贴使用了',
          duration: 2000
        })
      }
    } catch (err) {
      console.error('Copy failed:', err)
      loadingMessage.close()
      ElMessage({
        type: 'error',
        message: '复制失败，请稍后重试',
        duration: 3000
      })
    }
  } catch (err) {
    console.error('Copy failed:', err)
    ElMessage({
      type: 'error',
      message: '复制失败，请稍后重试',
      duration: 3000
    })
  }
}

// 处理图片预览
const handlePreview = (item: SearchResult) => {
  previewImage.value = item.originalUrl || item.url
  showViewer.value = true
}

// 处理示例关键词点击
const handleKeywordClick = (keyword: string) => {
  searchQuery.value = keyword
  handleSearch()
}

// 修改发送函数中的 GIF 检测部分
const handleSend = async (item: SearchResult) => {
  const loadingMessage = ElMessage({
    type: 'info',
    message: '正在准备发送...',
    duration: 0
  })

  try {
    const imageUrl = item.originalUrl || item.url
    const response = await axios.get(imageUrl, {
      responseType: 'blob',
      headers: {
        'Accept': 'image/*'
      }
    })

    const blob = response.data

    // 使用更精确的 GIF 检测
    const isGif = await isGifImage(blob)

    if (isGif) {
      // 1. 创建临时文件
      const tempFileName = `temp_${Date.now()}.gif`
      const tempPath = window.preload.utils.getTempPath(tempFileName)

      // 2. 将blob转换为buffer并写入临时文件
      const arrayBuffer = await blob.arrayBuffer()
      const buffer = new Uint8Array(arrayBuffer)
      await window.preload.fs.writeFile(tempPath, buffer)

      // 3. 使用 ztools.copyFile 复制 GIF 文件到剪贴板
      window.ztools.copyFile(tempPath)

      // 4. 隐藏 ZTools 主窗口
      window.ztools.hideMainWindow()
      await new Promise(resolve => setTimeout(resolve, 200))

      // 5. 模拟按键序列：Alt+Tab, Ctrl+V
      window.ztools.simulateKeyboardTap('tab', 'alt')
      await new Promise(resolve => setTimeout(resolve, 300))
      window.ztools.simulateKeyboardTap('v', 'ctrl')

      // 6. 30秒后删除临时文件
      setTimeout(async () => {
        try {
          await window.preload.fs.unlink(tempPath)
        } catch (err) {
          console.error('Failed to delete temp file:', err)
        }
      }, 30000)
    } else {
      // 非GIF图片：复制到剪贴板
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.src = URL.createObjectURL(blob)

      await new Promise((resolve, reject) => {
        img.onload = resolve
        img.onerror = reject
      })

      const canvas = document.createElement('canvas')
      canvas.width = img.width
      canvas.height = img.height
      const ctx = canvas.getContext('2d')
      ctx?.drawImage(img, 0, 0)

      const pngBlob = await new Promise<Blob>((resolve) => {
        canvas.toBlob((b) => resolve(b || new Blob()), 'image/png')
      })

      await navigator.clipboard.write([
        new ClipboardItem({
          'image/png': pngBlob
        })
      ])

      // 释放URL对象
      URL.revokeObjectURL(img.src)

      // 隐藏 ZTools 主窗口
      window.ztools.hideMainWindow()
      await new Promise(resolve => setTimeout(resolve, 200))

      // 模拟按键序列：Alt+Tab, Ctrl+V
      window.ztools.simulateKeyboardTap('tab', 'alt')
      await new Promise(resolve => setTimeout(resolve, 300))
      window.ztools.simulateKeyboardTap('v', 'ctrl')
    }

    loadingMessage.close()
    ElMessage({
      type: 'success',
      message: '表情包已粘贴到输入框',
      duration: 2000
    })
  } catch (error) {
    console.error('Send failed:', error)
    loadingMessage.close()
    ElMessage.error('发送失败，请重试')
    window.ztools.showMainWindow()
  }
}

const searchDoutula = async (keyword: string, page: number): Promise<SearchResult[]> => {
  // 如果没有关键词，使用默认的"表情包"关键词
  const searchKeyword = keyword || '表情包'
  const url = searchKeyword ?
    `https://www.doutupk.com/search?type=photo&more=1&page=${page}&keyword=${searchKeyword}` :
    `https://www.doutupk.com/article/list?page=${page}`

  const response = await axios.get(url)
  const $ = load(response.data)

  return $('.image_dtb,.image_dta').map((_, img): SearchResult => {
    const originalUrl = img.attribs['data-original'] || img.attribs['src'] || ''
    const thumbnailUrl = img.attribs['src'] || originalUrl

    return {
      id: Date.now().toString() + Math.random(),
      url: thumbnailUrl,
      previewUrl: originalUrl,
      thumbnailUrl,
      title: img.attribs['alt'] || searchKeyword || '表情包',
      gifCandidate: /\.gif(?:$|[?#])/i.test(originalUrl || ''),
      originalUrl,
      source: 'doutula'
    }
  }).get()
}

// 修改图片加载错误处理函数
const handleImageError = async (item: SearchResult) => {
  if (shouldUseGifProgressiveLoading(item)) {
    if (item.thumbnailUrl && item.thumbnailUrl !== item.previewUrl) {
      item.thumbnailUrl = item.previewUrl || item.originalUrl || item.url
      return
    }

    if (item.previewUrl && item.previewUrl !== item.originalUrl) {
      item.previewUrl = item.originalUrl || item.previewUrl
      return
    }

    searchResults.value = searchResults.value.filter(result => getImageUrl(result) !== getImageUrl(item))
    return
  }

  if (item.url !== item.originalUrl) {
    item.url = item.originalUrl || item.url
  } else if (item.url.startsWith('https://')) {
    item.url = item.url.replace('https://', 'http://')
  } else {
    searchResults.value = searchResults.value.filter(result => getImageUrl(result) !== getImageUrl(item))
  }
}
</script>

<style scoped lang="scss">
.online-search {
  height: 100%;
  display: flex;
  flex-direction: column;
  position: relative;

  .fixed-controls {
    position: sticky;
    top: 0;
    z-index: 10;
    background: var(--el-bg-color);
    padding: 16px 20px;
    border-bottom: 1px solid var(--el-border-color-lighter);
    border-radius: 16px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);

    .integrated-search {
      max-width: 1200px;
      margin: 0 auto;

      .search-container {
        display: flex;
        align-items: center;
        gap: 16px;

        .search-input-group {
          display: flex;
          align-items: center;
          flex: 0 0 auto;
          min-width: 0;

          .search-input {
            width: clamp(180px, 22vw, 260px);
            flex: 0 0 auto;
            min-width: 0;

            :deep(.el-input__wrapper) {
              min-height: 36px;
              padding-left: 12px;
              padding-right: 8px;
              border-radius: 999px;
              background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
              box-shadow:
                0 0 0 1px rgba(148, 163, 184, 0.22),
                0 10px 24px rgba(15, 23, 42, 0.06);
            }

            :deep(.el-input__inner) {
              font-size: 13px;
            }

            :deep(.el-input__suffix) {
              display: flex;
              align-items: center;
              margin-left: 8px;
            }

            .search-trigger {
              width: 26px;
              height: 26px;
              border: none;
              border-radius: 999px;
              display: inline-flex;
              align-items: center;
              justify-content: center;
              background: linear-gradient(180deg, #2e6fef 0%, #2563eb 100%);
              color: #ffffff;
              cursor: pointer;
              transition: transform 0.2s ease, box-shadow 0.2s ease, background 0.2s ease;
              box-shadow: 0 6px 16px rgba(37, 99, 235, 0.22);

              .el-icon {
                font-size: 13px;
                line-height: 1;
                color: white !important;
              }

              &:hover:not(:disabled) {
                transform: translateY(-1px);
                background: linear-gradient(180deg, #4c7df0 0%, #2e6fef 100%);
                box-shadow: 0 10px 18px rgba(37, 99, 235, 0.26);
              }

              &:active:not(:disabled) {
                transform: translateY(0);
                background: #1d4ed8;
              }

              &:disabled {
                opacity: 0.75;
                cursor: not-allowed;
              }
            }
          }

          :deep(.is-loading) {
            animation: rotate 1s linear infinite;
          }

          :deep(.el-icon) {
            margin: 0;
            line-height: 1;
          }

          :deep(.el-loading-spinner) {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 100%;
            height: 100%;

            .el-icon {
              color: white !important;
            }
          }
        }

        .site-selector {
          flex: 1;
          background: var(--el-fill-color-light);
          border-radius: 20px;
          padding: 4px;
          overflow: hidden;
          min-width: 0; // 防止flex容器被挤压

          .site-selector-track {
            position: relative;
            display: grid;
            grid-template-columns: repeat(7, 1fr);
            gap: 2px;
            height: 32px;
          }

          .site-selector-slider {
            position: absolute;
            height: 100%;
            background-color: #079d6e; // 使用项目配置的成功色
            border-radius: 16px;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            z-index: 1;
          }

          .site-option {
            position: relative;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            font-size: 14px; // 调整为与菜单栏相同的字体大小
            color: var(--el-text-color-regular);
            transition: all 0.3s ease;
            z-index: 2;
            border-radius: 16px;
            user-select: none;
            padding: 4px 6px; // 使用规范内边距
            min-width: 0;
            white-space: nowrap;
            text-overflow: ellipsis;
            overflow: hidden;

            &:hover {
              color: var(--el-text-color-primary);
            }

            &.active {
              background-color: #079d6e !important; // 使用项目配置的成功色
              color: white !important;
              font-weight: 500;

              &:hover {
                background-color: #0a8c5f !important;
              }
            }
          }
        }
      }
    }
  }

  .content-wrapper {
    flex: 1;
    overflow: hidden;
    padding: 0 0 20px;
  }

  .search-results {
    height: 100%;

    .el-scrollbar {
      height: 100%;
    }

    .results-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(92px, 1fr));
      gap: 6px;
      padding: 8px;
      border-radius: 24px 24px 0 0;
      margin-top: 6px;

      .result-item {
        position: relative;
        background: var(--el-bg-color);
        border: 1px solid var(--el-border-color-lighter);
        border-radius: 16px;
        overflow: hidden;
        content-visibility: auto;
        contain: layout paint style;
        contain-intrinsic-size: 92px 92px;
        transition: all 0.3s ease;
        width: 92px;
        height: 92px;
        justify-self: center;

        &:hover {
          transform: translateY(-2px);
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
          border-radius: 20px;

          .el-image {
            filter: brightness(0.8);
          }
        }

        &.gif-result-item {
          .el-image {
            background:
              radial-gradient(circle at top left, rgba(46, 111, 239, 0.16), transparent 38%),
              linear-gradient(180deg, rgba(241, 245, 249, 0.96), rgba(226, 232, 240, 0.92));
          }
        }

        .el-image {
          width: 100%;
          height: 100%;
          background: var(--el-fill-color-lighter);
          transition: filter 0.3s ease;

          :deep(.el-image__inner) {
            width: 100%;
            height: 100%;
            object-fit: contain;
          }
        }

        .hover-actions {
          position: absolute;
          bottom: 6px;
          left: 0;
          right: 0;
          display: none;
          justify-content: center;
          align-items: center;
          gap: 5px;
          padding: 0 6px;
          transition: all 0.3s ease;

          .action-button {
            width: 22px;
            height: 22px;
            min-width: 22px;
            min-height: 22px;
            padding: 0 !important;
            margin: 0;
            background-color: #2e6fef !important;
            border-color: #2e6fef !important;
            color: white !important;
            transform: translateY(8px);
            transition: all 0.3s ease;
            border-radius: 50% !important;
            display: flex;
            align-items: center;
            justify-content: center;
            box-sizing: border-box;

            .el-icon {
              font-size: 12px;
              color: white !important;
              line-height: 1;
            }

            &:hover {
              background-color: #4c7df0 !important;
              border-color: #4c7df0 !important;
              transform: translateY(-2px);
              box-shadow: 0 4px 8px rgba(46, 111, 239, 0.3);
            }

            &:active {
              background-color: #1e5bd8 !important;
              border-color: #1e5bd8 !important;
            }

            // 重写Element Plus默认样式
            :deep(.el-button__content) {
              padding: 0;
              margin: 0;
              display: flex;
              align-items: center;
              justify-content: center;
              width: 100%;
              height: 100%;
            }
          }
        }

        &:hover .hover-actions {
          display: flex;

          .action-button {
            transform: translateY(0);
          }
        }
      }
    }

    .loading-state {
      padding: 16px;

      .gif-cleaning-notice {
        display: flex;
        align-items: center;
        gap: 16px;
        padding: 14px 18px;
        margin-bottom: 18px;
        border-radius: 18px;
        background:
          radial-gradient(circle at top left, rgba(46, 111, 239, 0.2), transparent 42%),
          linear-gradient(135deg, rgba(46, 111, 239, 0.12), rgba(14, 165, 233, 0.08));
        border: 1px solid rgba(46, 111, 239, 0.18);
        box-shadow: 0 14px 32px rgba(46, 111, 239, 0.08);

        .notice-orbit {
          position: relative;
          width: 44px;
          height: 44px;
          flex-shrink: 0;
        }

        .orbit-ring,
        .orbit-core {
          position: absolute;
          inset: 0;
          border-radius: 50%;
        }

        .orbit-ring-outer {
          border: 2px solid rgba(46, 111, 239, 0.18);
          border-top-color: #2e6fef;
          animation: rotate 1.6s linear infinite;
        }

        .orbit-ring-inner {
          inset: 7px;
          border: 2px dashed rgba(14, 165, 233, 0.42);
          animation: reverse-rotate 2.2s linear infinite;
        }

        .orbit-core {
          inset: 14px;
          background: linear-gradient(135deg, #2e6fef, #0ea5e9);
          box-shadow: 0 0 0 6px rgba(46, 111, 239, 0.12);
          animation: pulse-core 1.5s ease-in-out infinite;
        }

        .notice-copy {
          flex: 1;
          min-width: 0;
        }

        .notice-title,
        .notice-subtitle {
          margin: 0;
        }

        .notice-title {
          color: #1e3a8a;
          font-size: 15px;
          font-weight: 700;
          letter-spacing: 0.02em;
        }

        .notice-subtitle {
          margin-top: 4px;
          color: var(--el-text-color-secondary);
          font-size: 12px;
        }

        .notice-dots {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          flex-shrink: 0;

          span {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: linear-gradient(135deg, #2e6fef, #0ea5e9);
            animation: notice-bounce 1.1s ease-in-out infinite;

            &:nth-child(2) {
              animation-delay: 0.15s;
            }

            &:nth-child(3) {
              animation-delay: 0.3s;
            }
          }
        }
      }

      .skeleton-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(92px, 1fr));
        gap: 6px;

        .skeleton-item {
          position: relative;
          width: 92px;
          height: 92px;
          background: var(--el-fill-color-lighter);
          border-radius: 16px;
          overflow: hidden;
          justify-self: center;

          .skeleton-image {
            width: 100%;
            height: 100%;
            background: linear-gradient(90deg,
                var(--el-fill-color-lighter) 25%,
                var(--el-fill-color-light) 37%,
                var(--el-fill-color-lighter) 63%);
            background-size: 400% 100%;
            animation: skeleton-loading 1.4s ease infinite;
          }

          .skeleton-overlay {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);

            .loading-icon {
              font-size: 24px;
              color: var(--el-color-primary);
              animation: rotate 2s linear infinite;
            }
          }
        }
      }
    }

    .load-more-trigger {
      padding: 20px 0;
      display: flex;
      align-items: center;
      justify-content: center;

      .load-more-button {
        min-width: 120px;
        transition: all 0.3s ease;
        background-color: #2e6fef !important;
        border-color: #2e6fef !important;
        color: white !important;

        .button-content {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          width: 100%;
          color: white !important;
        }

        :deep(.el-button__content) {
          width: 100%;
          color: white !important;
        }

        &:not(.is-loading):hover {
          transform: translateY(-2px);
          box-shadow: 0 2px 12px rgba(46, 111, 239, 0.3);
          background-color: #4c7df0 !important;
          border-color: #4c7df0 !important;
        }

        .el-icon {
          animation: rotate 1s linear infinite;
          margin: 0;
          color: white !important;
        }

        span {
          color: white !important;
        }
      }
    }

    .no-more {
      text-align: center;
      color: var(--el-text-color-secondary);
      padding: 20px;
      font-size: 14px;
    }
  }
}

@keyframes skeleton-loading {
  0% {
    background-position: 100% 50%;
  }

  100% {
    background-position: 0 50%;
  }
}

@keyframes rotate {
  from {
    transform: rotate(0deg);
  }

  to {
    transform: rotate(360deg);
  }
}

@keyframes reverse-rotate {
  from {
    transform: rotate(360deg);
  }

  to {
    transform: rotate(0deg);
  }
}

@keyframes pulse-core {
  0%,
  100% {
    transform: scale(0.9);
    opacity: 0.85;
  }

  50% {
    transform: scale(1.08);
    opacity: 1;
  }
}

@keyframes notice-bounce {
  0%,
  80%,
  100% {
    transform: translateY(0);
    opacity: 0.5;
  }

  40% {
    transform: translateY(-5px);
    opacity: 1;
  }
}

.gif-wash-enter-active,
.gif-wash-leave-active {
  transition: opacity 0.28s ease, transform 0.28s ease;
}

.gif-wash-enter-from,
.gif-wash-leave-to {
  opacity: 0;
  transform: translateY(-8px) scale(0.98);
}

// 添加渐入动画
.results-grid {
  .result-item {
    animation: fadeInScale 0.3s ease forwards;
    opacity: 0;
    transform: scale(0.9);

    @for $i from 1 through 20 {
      &:nth-child(#{$i}) {
        animation-delay: #{$i * 0.05}s;
      }
    }
  }
}

@keyframes fadeInScale {
  from {
    opacity: 0;
    transform: scale(0.9);
  }

  to {
    opacity: 1;
    transform: scale(1);
  }
}

// 暗黑模式适配
:deep(.dark) {
  .fixed-controls {
    background: var(--el-bg-color-overlay);
    border-bottom-color: var(--el-border-color-darker);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
  }

  .result-item {
    background: var(--el-bg-color-overlay);
    border-color: var(--el-border-color-darker);
    border-radius: 16px;

    &:hover {
      border-radius: 20px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);

      .el-image {
        filter: brightness(0.8);
      }
    }

    .hover-actions {
      background: var(--el-bg-color-overlay);
      box-shadow: 0 2px 12px rgba(0, 0, 0, 0.2);
    }
  }

  .skeleton-item {
    background: var(--el-bg-color-overlay);
    border-radius: 16px;

    .skeleton-image {
      background: linear-gradient(90deg,
          var(--el-bg-color-overlay) 25%,
          var(--el-fill-color-darker) 37%,
          var(--el-bg-color-overlay) 63%);
    }
  }

  .gif-cleaning-notice {
    background:
      radial-gradient(circle at top left, rgba(96, 165, 250, 0.18), transparent 42%),
      linear-gradient(135deg, rgba(30, 41, 59, 0.92), rgba(15, 23, 42, 0.88));
    border-color: rgba(96, 165, 250, 0.2);
    box-shadow: 0 16px 32px rgba(2, 6, 23, 0.34);

    .notice-title {
      color: #dbeafe;
    }

    .notice-subtitle {
      color: rgba(226, 232, 240, 0.72);
    }
  }
}

// 添加图片预览相关样式
:deep(.el-image-viewer__wrapper) {
  .el-image-viewer__btn {
    color: #fff;

    &:hover {
      color: var(--el-color-primary);
    }
  }

  .el-image-viewer__actions {
    opacity: 0.9;

    &__inner {
      padding: 8px 16px;
    }
  }
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  text-align: center;

  .empty-icon {
    font-size: 48px;
    color: var(--el-color-primary);
    margin-bottom: 16px;
  }

  h3 {
    font-size: 20px;
    color: var(--el-text-color-primary);
    margin-bottom: 8px;
  }

  p {
    font-size: 14px;
    color: var(--el-text-color-secondary);
    margin-bottom: 24px;
  }

  .example-keywords {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
    justify-content: center;

    .keyword-tag {
      cursor: pointer;
      transition: all 0.3s ease;

      &:hover {
        transform: translateY(-2px);
        background-color: var(--el-color-primary-light-5);
      }
    }
  }
}

// 添加发送按钮样式
.result-actions {
  .el-button {
    &.el-button--success {
      background-color: var(--el-color-success);
      color: white;

      &:hover {
        background-color: var(--el-color-success-light-3);
      }
    }

    .copy-button {
      background-color: var(--el-color-primary) !important;
      color: white;

      &:hover {
        background-color: var(--el-color-primary);
        transform: translateY(-2px);
      }
    }
  }
}

:deep(.custom-backtop.el-backtop) {
  background-color: var(--el-bg-color) !important;
  border: 1px solid var(--el-border-color);
  transition: all 0.3s;

  .el-icon {
    font-size: 20px;
    color: var(--el-text-color-primary);
  }

  &:hover {
    transform: translateY(-3px);
    background-color: var(--el-color-primary) !important;
    border-color: var(--el-color-primary);

    .el-icon {
      color: #fff;
    }
  }
}

// 在 style 部分添加自动加载触发器的样式
.auto-load-trigger {
  height: 20px;
  margin: 10px 0;
  opacity: 0;
  pointer-events: none;
}

// 响应式设计优化
@media (max-width: 1024px) {
  .online-search {
    .fixed-controls {
      padding: 12px 16px;

      .integrated-search {
        .search-container {
          gap: 12px;

          .site-selector {
            .site-option {
              font-size: 13px; // 1024px以下使用13px字体（从14px稍微减小）
              padding: 3px 4px;
            }
          }
        }
      }
    }
  }
}

@media (max-width: 768px) {
  .online-search {
    .fixed-controls {
      padding: 8px 12px;

      .integrated-search {
        .search-container {
          gap: 8px;
          flex-direction: column;

          .search-input-group {
            width: 100%;
            justify-content: center;
            flex: none;

            .search-input {
              width: 100%;
            }
          }

          .site-selector {
            width: 100%;

            .site-selector-track {
              grid-template-columns: repeat(4, 1fr); // 768px以下改为4列
              gap: 3px; // 使用规范间距
              height: 28px; // 使用规范高度
            }

            .site-option {
              font-size: 12px; // 768px以下屏幕使用12px字体（从13px稍微减小）
              padding: 4px 6px; // 使用规范内边距
              min-width: 80px; // 768px以下最小宽度80px
            }
          }
        }
      }
    }

    .content-wrapper {
      padding: 0 12px 12px;
    }
  }
}

@media (max-width: 480px) {
  .online-search {
    .fixed-controls {
      padding: 8px 8px; // 480px以下顶部内边距8px

      .integrated-search {
        .search-container {
          gap: 6px;

          .search-input-group {
            .search-input {
              width: 100%;

              .search-trigger {
                width: 28px;
                height: 28px;

                .el-icon {
                  font-size: 12px;
                }
              }
            }
          }

          .site-selector {
            .site-selector-track {
              grid-template-columns: repeat(2, 1fr); // 480px以下改为2列
              height: 24px;
            }

            .site-option {
              font-size: 11px; // 480px以下屏幕使用11px字体（从12px稍微减小）
              padding: 2px 4px;
              min-width: 70px; // 480px以下最小宽度70px
            }
          }
        }
      }
    }

    .content-wrapper {
      padding: 0 8px 8px;
    }
  }
}
</style>
