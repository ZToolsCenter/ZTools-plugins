// 页面导航和数据刷新协调

import { type Ref } from 'vue'
import type { ActiveNav } from './shared'

export function usePluginMarketNavigation(options: {
  activeNav: Ref<ActiveNav>
  selectedCategoryKey: Ref<string | null>
  selectedPluginName: Ref<string | null>
  canUseInternalPluginApis: Ref<boolean>
  clearSearchQuery: () => void
  refreshNavData: (nav: ActiveNav) => Promise<void>
}) {
  /**
   * 处理导航标签点击
   * 切换到目标标签并刷新其数据
   * 当内部 API 不可用时阻止导航到"已安装"标签
   */
  function handleNavClick(nav: ActiveNav): void {
    // 如果已经在当前标签，则刷新数据
    if (options.activeNav.value === nav) {
      void options.refreshNavData(nav)
      return
    }

    // 如果无法使用内部 API，阻止导航到"已安装"标签
    if (nav === 'installed' && !options.canUseInternalPluginApis.value) {
      options.activeNav.value = 'store'
      return
    }

    options.selectedPluginName.value = null
    options.activeNav.value = nav
  }

  /**
   * 打开分类详情视图
   */
  function openCategory(categoryKey: string) {
    options.selectedCategoryKey.value = categoryKey
  }

  /**
   * 关闭分类详情视图
   */
  function closeCategory() {
    options.selectedCategoryKey.value = null
  }

  /**
   * 打开插件详情视图
   */
  function openPlugin(name: string) {
    options.selectedPluginName.value = name
  }

  /**
   * 关闭插件详情视图
   */
  function closePlugin() {
    options.selectedPluginName.value = null
  }

  return {
    handleNavClick,
    openCategory,
    closeCategory,
    openPlugin,
    closePlugin,
  }
}
