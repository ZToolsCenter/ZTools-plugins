import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { getVisualPage, buildPageStarts, getPreviousPageStart, getPageIndexForStart } from '../utils/txtParser'

export interface Chapter {
  index: number
  title: string
  content: string
}

export const useReaderStore = defineStore('reader', () => {
  const chapters = ref<Chapter[]>([])
  const currentChapterIndex = ref(0)
  const progressIndex = ref(0)
  const isLoading = ref(false)
  const loadError = ref('')
  const readerVisible = ref(false)

  const hushreaderLineLength = ref(80)
  const hushreaderLineCount = ref(5)

  // 在线阅读（在线书源 / 开源阅读）逐章加载相关状态
  const onlineMode = ref(false)
  const onlineChapterLoading = ref(false)
  const onlineChapterError = ref('')

  const currentChapter = computed(() =>
    chapters.value[currentChapterIndex.value] ?? null
  )

  const currentPageSlice = computed(() => {
    const chapter = currentChapter.value
    if (!chapter) return { lines: [''], startIndex: 0, endIndex: 0 }
    return getVisualPage(
      chapter.content,
      progressIndex.value,
      hushreaderLineLength.value,
      hushreaderLineCount.value
    )
  })

  const hushreaderLines = computed(() => {
    if (onlineMode.value) {
      if (onlineChapterError.value) return [`加载失败：${onlineChapterError.value}`]
      if (!currentChapter.value?.content) return ['章节加载中…']
    }
    return currentPageSlice.value.lines
  })

  const pageStarts = computed(() => {
    const chapter = currentChapter.value
    if (!chapter) return [0]
    return buildPageStarts(chapter.content, hushreaderLineLength.value, hushreaderLineCount.value)
  })

  const currentPage = computed(() =>
    getPageIndexForStart(progressIndex.value, pageStarts.value)
  )

  const totalPages = computed(() => pageStarts.value.length)

  const readingPercent = computed(() => {
    if (chapters.value.length === 0) return 0
    // 在线阅读：章节未全部加载，按章节位置估算进度
    if (onlineMode.value) {
      const n = chapters.value.length
      const ratio = totalPages.value > 0 ? currentPage.value / totalPages.value : 0
      const value = ((currentChapterIndex.value + Math.max(0, Math.min(ratio, 0.999))) / n) * 100
      return Math.min(100, Math.floor(value * 100) / 100)
    }
    const totalChars = chapters.value.reduce((sum, ch) => sum + ch.content.length, 0)
    if (totalChars === 0) return 0
    const isLastChapter = currentChapterIndex.value === chapters.value.length - 1
    const isLastPage = isLastChapter && currentPage.value === totalPages.value - 1
    const effectiveIndex = isLastPage ? currentPageSlice.value.endIndex : progressIndex.value
    const readChars = chapters.value
      .slice(0, currentChapterIndex.value)
      .reduce((sum, ch) => sum + ch.content.length, 0)
      + effectiveIndex
    if (readChars >= totalChars) return 100
    return Math.min(100, Math.floor((readChars / totalChars) * 10000) / 100)
  })

  function setChapters(chs: Chapter[]) {
    chapters.value = chs
  }

  function setHushreaderLayout(lineLength: number, lineCount: number) {
    hushreaderLineLength.value = lineLength
    hushreaderLineCount.value = lineCount
  }

  function nextPage(): boolean {
    const slice = currentPageSlice.value
    const chapter = currentChapter.value
    if (!chapter) return false

    if (slice.endIndex < chapter.content.length) {
      progressIndex.value = slice.endIndex
      return true
    }

    if (currentChapterIndex.value < chapters.value.length - 1) {
      currentChapterIndex.value++
      progressIndex.value = 0
      return true
    }
    return false
  }

  function prevPage(): boolean {
    const chapter = currentChapter.value
    if (!chapter) return false

    if (progressIndex.value > 0) {
      progressIndex.value = getPreviousPageStart(progressIndex.value, pageStarts.value)
      return true
    }

    if (currentChapterIndex.value > 0) {
      currentChapterIndex.value--
      const prevChapter = chapters.value[currentChapterIndex.value]
      if (prevChapter) {
        const prevStarts = buildPageStarts(prevChapter.content, hushreaderLineLength.value, hushreaderLineCount.value)
        progressIndex.value = prevStarts[prevStarts.length - 1] ?? 0
      } else {
        progressIndex.value = 0
      }
      return true
    }
    return false
  }

  function goToChapter(idx: number) {
    if (idx >= 0 && idx < chapters.value.length) {
      currentChapterIndex.value = idx
      progressIndex.value = 0
    }
  }

  function goToProgress(chapterIndex: number, charIndex: number) {
    if (chapterIndex >= 0 && chapterIndex < chapters.value.length) {
      currentChapterIndex.value = chapterIndex
      const chapter = chapters.value[chapterIndex]
      if (chapter) {
        progressIndex.value = Math.max(0, Math.min(charIndex, chapter.content.length))
      } else {
        progressIndex.value = 0
      }
    }
  }

  function reset() {
    chapters.value = []
    currentChapterIndex.value = 0
    progressIndex.value = 0
    isLoading.value = false
    loadError.value = ''
    onlineMode.value = false
    onlineChapterLoading.value = false
    onlineChapterError.value = ''
  }

  function setOnlineMode(flag: boolean) {
    onlineMode.value = flag
    if (!flag) {
      onlineChapterLoading.value = false
      onlineChapterError.value = ''
    }
  }

  return {
    chapters, currentChapterIndex, progressIndex, currentChapter,
    currentPageSlice, hushreaderLines, pageStarts, currentPage, totalPages, readingPercent,
    hushreaderLineLength, hushreaderLineCount,
    isLoading, loadError, readerVisible,
    onlineMode, onlineChapterLoading, onlineChapterError,
    setChapters, setHushreaderLayout, nextPage, prevPage, goToChapter, goToProgress,
    setOnlineMode, reset
  }
})
