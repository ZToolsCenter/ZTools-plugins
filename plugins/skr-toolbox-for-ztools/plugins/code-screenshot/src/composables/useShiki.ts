import { ref, shallowRef, watch } from 'vue'
import { createHighlighter, type HighlighterCore } from 'shiki'
import { state, SUPPORTED_LANGUAGES, detectLanguage, LANGUAGE_ALIASES } from '../store'

/**
 * Shiki 语法高亮 composable
 * 封装 Shiki 高亮器的初始化和代码高亮逻辑
 */
export function useShiki() {
  // Shiki 高亮器实例（使用 shallowRef 避免深度响应）
  const highlighter = shallowRef<HighlighterCore | null>(null)
  // 高亮器是否已加载完成
  const isLoaded = ref(false)
  // 高亮后的 HTML 代码
  const highlightedHtml = ref('')

  /**
   * 初始化 Shiki 高亮器
   * 异步加载支持的语言和主题
   */
  const initShiki = async () => {
    isLoaded.value = false
    try {
      const langs = SUPPORTED_LANGUAGES.filter(l => l.id !== 'auto').map(l => l.id)
      highlighter.value = await createHighlighter({
        themes: ['github-dark', 'github-light'],
        langs: langs,
      })
      isLoaded.value = true
      updateHighlight()
    } catch (e) {
      console.error('Failed to init Shiki:', e)
    }
  }

  /**
   * 更新代码高亮结果
   * 根据当前语言和主题设置，使用 Shiki 生成高亮 HTML
   */
  const updateHighlight = () => {
    if (!highlighter.value || !isLoaded.value) {
      highlightedHtml.value = escapeHtml(state.code)
      return
    }

    let lang = state.language

    // Auto-detect language
    if (lang === 'auto' || !lang) {
      const detected = detectLanguage(state.code)
      if (detected && SUPPORTED_LANGUAGES.some(l => l.id === detected)) {
        lang = detected
      } else if (detected && LANGUAGE_ALIASES[detected]) {
        lang = LANGUAGE_ALIASES[detected]
      } else {
        lang = 'text'
      }
    }

    // Fallback to text if language is not supported
    if (!SUPPORTED_LANGUAGES.some(l => l.id === lang && l.id !== 'auto')) {
      lang = 'text'
    }

    try {
      const html = highlighter.value.codeToHtml(state.code || ' ', {
        lang: lang,
        theme: state.theme
      })
      highlightedHtml.value = html
    } catch (e) {
      console.error('Highlight failed:', e)
      highlightedHtml.value = escapeHtml(state.code)
    }
  }

  /**
   * HTML 字符转义
   * 将特殊字符转换为 HTML 实体，防止 XSS 攻击
   * @param unsafe - 未经转义的字符串
   * @returns 转义后的安全字符串
   */
  const escapeHtml = (unsafe: string) => {
    return unsafe
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  initShiki()

  // 监听状态变化，自动更新高亮
  watch([() => state.code, () => state.language, () => state.theme], () => {
    updateHighlight()
  })

  return {
    isLoaded,
    highlightedHtml
  }
}
