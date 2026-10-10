<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useStore } from '../composables/useStore'
import { isDevMock } from '../api'

const store = useStore()

/**
 * 正常情况下搜索走宿主子输入框，页面顶部**什么都没有** —— 列表直接顶到窗口上沿，
 * 多出来的高度全部给内容（这一行原本只放一句指向宿主搜索框的说明文案，
 * 既占 44px 又没有任何操作）。
 *
 * 只有子输入框注册失败（或浏览器开发模式）时才退回页面内搜索框兜底：
 * 那时它是唯一的输入入口，不能连入口一起省掉。
 */
const showOwnInput = computed(() => isDevMock() || !store.subInputReady.value)

const searchPlaceholder = computed(() =>
  isDevMock() ? '搜索剪贴板历史（浏览器开发模式）' : '搜索剪贴板历史'
)

/**
 * 宿主子输入框不可用时，这个框就是唯一的输入入口 —— 打开插件时必须已经聚焦，
 * 否则用户得先点一下才能打字。聚焦请求由 store 的 searchFocusTick 驱动。
 */
const inputEl = ref<HTMLInputElement | null>(null)

function focusInput(): void {
  const el = inputEl.value
  if (!el) return
  el.focus()
  // 已有关键词时全选：新输入直接覆盖，而不是拼在旧词后面
  if (store.query.value) el.select()
}

onMounted(() => {
  if (showOwnInput.value) focusInput()
})

watch(
  () => store.searchFocusTick.value,
  () => {
    if (showOwnInput.value) focusInput()
  }
)

watch(showOwnInput, (v) => {
  if (v) focusInput()
})

function onSearch(e: Event): void {
  store.setQuery((e.target as HTMLInputElement).value)
}
</script>

<template>
  <header v-if="showOwnInput" class="toolbar">
    <div class="search">
      <svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke-width="1.7"
        stroke-linecap="round" stroke-linejoin="round">
        <circle cx="11" cy="11" r="7" stroke="currentColor" />
        <path d="M20 20l-3.5-3.5" stroke="currentColor" />
      </svg>
      <input
        ref="inputEl"
        class="search-input"
        :value="store.query.value"
        :placeholder="searchPlaceholder"
        @input="onSearch"
      />
    </div>

    <div class="spacer" />

    <span v-if="store.remoteSearching.value" class="status">搜索中…</span>
    <span v-else-if="store.loading.value" class="status">加载中…</span>

    <span class="count">{{ store.filtered.value.length }} 条</span>
  </header>
</template>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  height: 44px;
  flex: none;
  padding: 0 14px;
  border-bottom: 1px solid var(--border);
}

.search {
  display: flex;
  align-items: center;
  gap: 8px;
  width: min(320px, 40vw);
  height: 30px;
  padding: 0 10px;
  border-radius: var(--radius);
  background: var(--bg);
  border: 1px solid var(--border);
  color: var(--text-3);
}

.search-input {
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  font: inherit;
  color: var(--text);
}

.search-input::placeholder { color: var(--text-3); }

.spacer { flex: 1; }

.status { color: var(--text-3); font-size: 12px; }

.count {
  font-size: 12px;
  color: var(--text-2);
  font-variant-numeric: tabular-nums;
}
</style>
