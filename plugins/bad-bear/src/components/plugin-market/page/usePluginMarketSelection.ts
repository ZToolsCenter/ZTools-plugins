// 页面选择状态和派生计算

import { computed, type ComputedRef, type Ref } from 'vue'
import type {
  CategoryInfo,
  PluginMarketUiPlugin,
} from '../../../types/pluginMarket'

export function usePluginMarketSelection(options: {
  activeNav: Ref<'store' | 'installed' | 'notifications' | 'upload' | 'account' | 'settings'>
  selectedCategoryKey: Ref<string | null>
  selectedPluginName: Ref<string | null>
  searchQuery: Ref<string>
  plugins: Ref<PluginMarketUiPlugin[]>
  installedViewPlugins: Ref<PluginMarketUiPlugin[]>
  storefrontCategories: Ref<Record<string, CategoryInfo>>
}) {
  // 派生状态：当前导航是否为商店标签？
  const isStoreNav: ComputedRef<boolean> = computed(() => options.activeNav.value === 'store')

  // 派生状态：当前导航是否为已安装标签？
  const isInstalledNav: ComputedRef<boolean> = computed(() => options.activeNav.value === 'installed')

  // 派生状态：当前导航是否为列表视图（商店或已安装）？
  const isListNav: ComputedRef<boolean> = computed(() => isStoreNav.value || isInstalledNav.value)

  // 派生状态：商店标签中是否处于搜索模式？
  const isSearchMode: ComputedRef<boolean> = computed(
    () => isStoreNav.value && options.searchQuery.value.trim().length > 0
  )

  // 派生状态：是否应显示可滚动内容？
  // 当在列表模式且没有打开详情视图时为 true
  const showScrollableContent: ComputedRef<boolean> = computed(
    () => isListNav.value && !selectedPlugin.value && !selectedCategory.value
  )

  // 派生状态：当前选中的分类
  const selectedCategory: ComputedRef<CategoryInfo | null> = computed(() => {
    if (!isStoreNav.value || !options.selectedCategoryKey.value) {
      return null
    }

    return options.storefrontCategories.value[options.selectedCategoryKey.value] || null
  })

  // 派生状态：当前选中的插件
  // 根据当前标签从市场或已安装插件中解析
  const selectedPlugin: ComputedRef<PluginMarketUiPlugin | null> = computed(() => {
    if (!isListNav.value || !options.selectedPluginName.value) {
      return null
    }

    // 如果在已安装标签，优先从已安装插件中查找
    if (isInstalledNav.value) {
      return (
        options.installedViewPlugins.value.find((p) => p.name === options.selectedPluginName.value) ||
        options.plugins.value.find((p) => p.name === options.selectedPluginName.value) ||
        null
      )
    }

    // 否则从市场插件中查找
    return (
      options.plugins.value.find((p) => p.name === options.selectedPluginName.value) ||
      options.installedViewPlugins.value.find((p) => p.name === options.selectedPluginName.value) ||
      null
    )
  })

  return {
    isStoreNav,
    isInstalledNav,
    isListNav,
    isSearchMode,
    showScrollableContent,
    selectedCategory,
    selectedPlugin,
  }
}
