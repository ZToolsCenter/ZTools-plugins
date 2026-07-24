// 商店搜索子输入注册和键盘快捷键
// 处理与 ZTools 子输入功能的集成以进行市场搜索

import { type Ref } from 'vue'

// 扩展 window.ztools 类型以包含子输入相关方法
const ztoolsWithSubInput = window.ztools as typeof window.ztools & {
  setSubInput?: (
    callback: (payload: { text: string }) => void,
    placeholder?: string,
    autoFocus?: boolean,
  ) => boolean
  removeSubInput?: () => void
  setSubInputValue?: (value: string) => void
  subInputFocus?: () => boolean
  subInputSelect?: () => boolean
}

const MARKET_SEARCH_PLACEHOLDER = '搜索插件市场...'

export function useStoreSubInput(options: {
  isStoreNav: Ref<boolean>
  searchQuery: Ref<string>
}) {
  let subInputRegisterTimer: number | null = null

  /**
   * 取消注册子输入并清理注册定时器
   */
  function unregisterSubInput() {
    if (subInputRegisterTimer !== null) {
      window.clearInterval(subInputRegisterTimer)
      subInputRegisterTimer = null
    }

    ztoolsWithSubInput.removeSubInput?.()
  }

  /**
   * 注册市场搜索的子输入
   * 使用重试逻辑，因为宿主可能没有立即准备好
   * @param autoFocus - 注册后是否聚焦输入框
   */
  function registerSubInput(autoFocus = false) {
    if (!options.isStoreNav.value || !ztoolsWithSubInput.setSubInput) {
      return
    }

    unregisterSubInput()

    // 每 100ms 重试注册一次，直到成功
    subInputRegisterTimer = window.setInterval(() => {
      const registered = ztoolsWithSubInput.setSubInput?.(
        ({ text }) => {
          options.searchQuery.value = text || ''
        },
        MARKET_SEARCH_PLACEHOLDER,
        autoFocus,
      )

      if (!registered) {
        return
      }

      // 注册成功，清除定时器
      if (subInputRegisterTimer !== null) {
        window.clearInterval(subInputRegisterTimer)
        subInputRegisterTimer = null
      }

      // 使用当前搜索查询初始化子输入
      ztoolsWithSubInput.setSubInputValue?.(options.searchQuery.value)
    }, 100)
  }

  /**
   * 聚焦子输入，可选择全选文本
   * 使用重试逻辑确保输入框准备就绪
   * @param select - 聚焦后是否全选文本
   */
  function focusSubInput(select = false) {
    registerSubInput(true)

    let retryCount = 0
    const timer = window.setInterval(() => {
      const handled = select
        ? ztoolsWithSubInput.subInputSelect?.()
        : ztoolsWithSubInput.subInputFocus?.()

      retryCount += 1
      if (handled || retryCount >= 10) {
        window.clearInterval(timer)
      }
    }, 50)
  }

  /**
   * 同步子输入注册状态与当前导航
   * 在商店标签时注册，否则取消注册
   * @param autoFocus - 注册时是否自动聚焦
   */
  function syncStoreSubInput(autoFocus = false) {
    if (options.isStoreNav.value) {
      registerSubInput(autoFocus)
      return
    }

    unregisterSubInput()
  }

  /**
   * 清除搜索查询并更新子输入值
   */
  function clearSearchQuery() {
    if (!options.searchQuery.value) {
      return
    }

    options.searchQuery.value = ''
    ztoolsWithSubInput.setSubInputValue?.('')
  }

  return {
    unregisterSubInput,
    registerSubInput,
    focusSubInput,
    syncStoreSubInput,
    clearSearchQuery,
  }
}
