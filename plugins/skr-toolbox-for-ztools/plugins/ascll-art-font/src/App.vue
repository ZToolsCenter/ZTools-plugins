<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import TopBar from './components/TopBar.vue'
import ColorPalette from './components/ColorPalette.vue'
import ActionBar from './components/ActionBar.vue'
import PreviewArea from './components/PreviewArea.vue'
import SettingsPanel from './components/SettingsPanel.vue'
import { initFiglet, generateAsciiArt, getAllFontNames } from './composables/useFiglet'
import { useStorage } from './composables/useStorage'
import { COLOR_PRESETS } from './constants/colors'

const storage = useStorage()

// 初始化 figlet
initFiglet()

// 核心状态
const inputText = ref('Hello')
const selectedFont = ref(storage.getLastFont())
const themeIndex = ref(storage.getThemeIndex())
const showSettings = ref(false)
const favorites = ref<Set<string>>(new Set(storage.getFavorites()))

// 设置状态
const savedSettings = storage.getSettings()
const showFavoritesOnly = ref(savedSettings.showFavoritesOnly)
const horizontalLayout = ref(savedSettings.horizontalLayout)
const verticalLayout = ref(savedSettings.verticalLayout)

// 所有字体名
const allFonts = getAllFontNames()

// 当前可见字体列表（考虑收藏筛选）
const fontList = computed(() => {
  if (showFavoritesOnly.value) {
    const filtered = allFonts.filter(f => favorites.value.has(f))
    return filtered.length > 0 ? filtered : allFonts
  }
  return allFonts
})

// 当前主题
const currentTheme = computed(() => COLOR_PRESETS[themeIndex.value] || COLOR_PRESETS[0])

// 是否已收藏当前字体
const isFavorited = computed(() => favorites.value.has(selectedFont.value))

// 生成 ASCII art（带 debounce）
const asciiOutput = ref('')
let debounceTimer: ReturnType<typeof setTimeout> | null = null

function updateOutput() {
  asciiOutput.value = generateAsciiArt(
    inputText.value,
    selectedFont.value,
    horizontalLayout.value,
    verticalLayout.value
  )
}

function debouncedUpdate() {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(updateOutput, 150)
}

// 监听输入文字变化（debounce）
watch(inputText, debouncedUpdate)

// 监听字体/布局变化（立即更新）
watch([selectedFont, horizontalLayout, verticalLayout], () => {
  updateOutput()
  storage.setLastFont(selectedFont.value)
})

// 监听设置变化并持久化
watch([showFavoritesOnly, horizontalLayout, verticalLayout], () => {
  storage.setSettings({
    showFavoritesOnly: showFavoritesOnly.value,
    horizontalLayout: horizontalLayout.value,
    verticalLayout: verticalLayout.value,
  })
})

// 监听主题变化
watch(themeIndex, () => {
  storage.setThemeIndex(themeIndex.value)
})

// 确保选中字体在可见列表中
watch(fontList, (list) => {
  if (!list.includes(selectedFont.value) && list.length > 0) {
    selectedFont.value = list[0]
  }
})

// 操作方法
function toggleFavorite() {
  const font = selectedFont.value
  const newSet = new Set(favorites.value)
  if (newSet.has(font)) {
    newSet.delete(font)
  } else {
    newSet.add(font)
  }
  favorites.value = newSet
  storage.setFavorites([...newSet])
}

function navigateFont(direction: 'prev' | 'next') {
  const list = fontList.value
  if (list.length === 0) return
  const currentIndex = list.indexOf(selectedFont.value)
  const idx = currentIndex === -1 ? 0 : currentIndex
  const newIndex = direction === 'prev'
    ? (idx - 1 + list.length) % list.length
    : (idx + 1) % list.length
  selectedFont.value = list[newIndex]
}

function copyToClipboard() {
  if (!asciiOutput.value) return
  try {
    window.ztools.copyText(asciiOutput.value)
    window.ztools.showNotification('已复制到剪贴板')
  } catch {
    navigator.clipboard.writeText(asciiOutput.value)
  }
}

// 初始生成
onMounted(() => {
  updateOutput()
  window.ztools?.onPluginEnter?.(() => {})
})
</script>

<template>
  <div class="app">
    <TopBar
      v-model="inputText"
      :selected-font="selectedFont"
      :font-list="fontList"
      @update:selected-font="selectedFont = $event"
      @open-settings="showSettings = true"
    />

    <div class="toolbar">
      <ColorPalette v-model:selected-index="themeIndex" />
      <ActionBar
        :is-favorited="isFavorited"
        @toggle-favorite="toggleFavorite"
        @prev-font="navigateFont('prev')"
        @next-font="navigateFont('next')"
        @copy="copyToClipboard"
      />
    </div>

    <PreviewArea
      :content="asciiOutput"
      :fore-color="currentTheme.foreground"
      :bg-color="currentTheme.background"
    />

    <SettingsPanel
      :visible="showSettings"
      v-model:show-favorites-only="showFavoritesOnly"
      v-model:horizontal-layout="horizontalLayout"
      v-model:vertical-layout="verticalLayout"
      @close="showSettings = false"
    />
  </div>
</template>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
}

.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 16px 4px 0;
}
</style>
