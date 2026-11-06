<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import GroupSidebar from './components/GroupSidebar.vue'
import SettingsPanel from './components/SettingsPanel.vue'
import { renderMarkdown } from './todo/markdown'
import { loadState, saveState } from './todo/storage'
import type { GroupId, TodoItem, TodoSettings, TodoState } from './todo/types'

const GROUP_ORDER: GroupId[] = ['pending', 'done']
const CHORD_TIMEOUT = 900
const DISARM_TIMEOUT = 4000

const state = ref<TodoState>(loadState())
const activeGroup = ref<GroupId>('pending')
const selectedId = ref<string | null>(null)
const editingId = ref<string | null>(null)
const editingText = ref('')
const newTaskText = ref('')
const search = ref('')
const settingsOpen = ref(false)
const clearArmed = ref(false)

const newTaskInput = ref<HTMLInputElement | null>(null)
const searchInput = ref<HTMLInputElement | null>(null)
const listEl = ref<HTMLElement | null>(null)

let chordTimer: number | null = null
let disarmTimer: number | null = null
let pendingG = false
let pendingD = false

const counts = computed<Record<GroupId, number>>(() => ({
  pending: state.value.items.filter((item) => !item.done).length,
  done: state.value.items.filter((item) => item.done).length,
}))

const groupLabel = computed(() => (activeGroup.value === 'pending' ? '待处理' : '已完成'))

const visibleItems = computed<TodoItem[]>(() => {
  const keyword = search.value.trim().toLowerCase()
  return state.value.items.filter((item) => {
    const inGroup = activeGroup.value === 'pending' ? !item.done : item.done
    if (!inGroup) return false
    if (!keyword) return true
    return item.text.toLowerCase().includes(keyword)
  })
})

const subtitle = computed(() => {
  const total = visibleItems.value.length
  return search.value.trim() ? `${total} 项匹配` : `${total} 项`
})

const emptyText = computed(() => {
  if (search.value.trim()) return '没有匹配的任务'
  return activeGroup.value === 'pending' ? '没有待处理的任务' : '还没有已完成的任务'
})

watch(
  state,
  (value) => {
    saveState(value)
  },
  { deep: true },
)

watch(
  visibleItems,
  (list) => {
    if (!list.length) {
      selectedId.value = null
      return
    }
    if (!list.some((item) => item.id === selectedId.value)) {
      selectedId.value = list[0].id
    }
  },
  { immediate: true, flush: 'post' },
)

watch(selectedId, async (id) => {
  if (!id) return
  await nextTick()
  const el = listEl.value?.querySelector(`[data-id="${id}"]`)
  if (el instanceof HTMLElement) el.scrollIntoView({ block: 'nearest' })
})

/**
 * 生成任务唯一标识。
 * @returns 仅含小写字母、数字和中划线的 id。
 */
function createId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * 按当前分组和关键字筛选的列表中选中某条任务。
 * @param item 目标任务。
 * @returns 无返回值。
 */
function selectTask(item: TodoItem): void {
  selectedId.value = item.id
}

/**
 * 新建任务；始终归入待处理分组并立即持久化。
 * @returns 无返回值。
 */
function addTask(): void {
  const text = newTaskText.value.trim()
  if (!text) return
  const item: TodoItem = {
    id: createId(),
    text,
    done: false,
    createdAt: Date.now(),
  }
  state.value.items.unshift(item)
  newTaskText.value = ''
  activeGroup.value = 'pending'
  selectedId.value = item.id
}

/**
 * 切换任务完成状态；任务会随状态自动进入另一个分组，并选中相邻任务。
 * @param item 目标任务。
 * @returns 无返回值。
 */
function toggleDone(item: TodoItem): void {
  const index = visibleItems.value.findIndex((entry) => entry.id === item.id)
  const neighbour =
    visibleItems.value[index + 1] || visibleItems.value[index - 1] || null
  item.done = !item.done
  selectedId.value = neighbour && neighbour.id !== item.id ? neighbour.id : item.id
}

/**
 * 删除任务，并把选择移动到相邻任务。
 * @param id 目标任务 id。
 * @returns 无返回值。
 */
function removeTask(id: string): void {
  const index = visibleItems.value.findIndex((entry) => entry.id === id)
  const neighbour = visibleItems.value[index + 1] || visibleItems.value[index - 1] || null
  const storedIndex = state.value.items.findIndex((entry) => entry.id === id)
  if (storedIndex >= 0) state.value.items.splice(storedIndex, 1)
  if (editingId.value === id) cancelEdit()
  if (neighbour && neighbour.id !== id) {
    selectedId.value = neighbour.id
  } else if (selectedId.value === id) {
    selectedId.value = null
  }
}

/**
 * 进入编辑态并聚焦编辑框。
 * @param item 目标任务。
 * @returns 无返回值。
 */
async function startEdit(item: TodoItem): Promise<void> {
  editingId.value = item.id
  editingText.value = item.text
  selectedId.value = item.id
  await nextTick()
  const input = document.querySelector<HTMLInputElement>(
    `.task-card[data-id="${item.id}"] .edit-input`,
  )
  if (input) {
    input.focus()
    input.select()
  }
}

/**
 * 提交编辑；文本为空时保留原文。
 * @returns 无返回值。
 */
function commitEdit(): void {
  const id = editingId.value
  if (!id) return
  const text = editingText.value.trim()
  editingId.value = null
  if (!text) return
  const item = state.value.items.find((entry) => entry.id === id)
  if (item) item.text = text
}

/**
 * 取消编辑。
 * @returns 无返回值。
 */
function cancelEdit(): void {
  editingId.value = null
  editingText.value = ''
}

/**
 * 切换选中任务的完成状态。
 * @returns 无返回值。
 */
function toggleSelected(): void {
  const item = state.value.items.find((entry) => entry.id === selectedId.value)
  if (item) toggleDone(item)
}

/**
 * 编辑选中任务。
 * @returns 无返回值。
 */
function editSelected(): void {
  const item = state.value.items.find((entry) => entry.id === selectedId.value)
  if (item && editingId.value !== item.id) startEdit(item)
}

/**
 * 在可见列表中移动选择。
 * @param delta 移动步长，可为负。
 * @returns 无返回值。
 */
function moveSelection(delta: number): void {
  const list = visibleItems.value
  if (!list.length) return
  const current = list.findIndex((item) => item.id === selectedId.value)
  const next = Math.min(Math.max(current + delta, 0), list.length - 1)
  selectedId.value = list[next].id
}

/**
 * 选中列表首或尾的任务。
 * @param edge 'first' 或 'last'。
 * @returns 无返回值。
 */
function selectEdge(edge: 'first' | 'last'): void {
  const list = visibleItems.value
  if (!list.length) return
  selectedId.value = (edge === 'first' ? list[0] : list[list.length - 1]).id
}

/**
 * 按顺序切换分组。
 * @param delta 移动步长，可为负。
 * @returns 无返回值。
 */
function switchGroup(delta: number): void {
  const current = GROUP_ORDER.indexOf(activeGroup.value)
  const next = (current + delta + GROUP_ORDER.length) % GROUP_ORDER.length
  activeGroup.value = GROUP_ORDER[next]
}

/**
 * 切换到指定分组。
 * @param group 目标分组。
 * @returns 无返回值。
 */
function setActiveGroup(group: GroupId): void {
  if (activeGroup.value === group) return
  activeGroup.value = group
}

/**
 * 聚焦新建任务输入框。
 * @returns 无返回值。
 */
function focusNewTask(): void {
  newTaskInput.value?.focus()
}

/**
 * 聚焦搜索框。
 * @returns 无返回值。
 */
function focusSearch(): void {
  searchInput.value?.focus()
  searchInput.value?.select()
}

/**
 * 打开设置面板。
 * @returns 无返回值。
 */
function openSettings(): void {
  settingsOpen.value = true
}

/**
 * 关闭设置面板并撤销待确认的危险操作。
 * @returns 无返回值。
 */
function closeSettings(): void {
  settingsOpen.value = false
  disarmClear()
}

/**
 * 在设置开与关之间切换。
 * @returns 无返回值。
 */
function toggleSettings(): void {
  if (settingsOpen.value) closeSettings()
  else openSettings()
}

/**
 * 滚动设置面板。
 * @param direction 1 向下，-1 向上。
 * @returns 无返回值。
 */
function scrollSettings(direction: number): void {
  const panel = document.querySelector('.settings-panel')
  if (panel instanceof HTMLElement) panel.scrollBy({ top: direction * 132 })
}

/**
 * 武装“清空已完成”按钮，超时自动撤销。
 * @returns 无返回值。
 */
function armClear(): void {
  clearArmed.value = true
  if (disarmTimer) window.clearTimeout(disarmTimer)
  disarmTimer = window.setTimeout(() => {
    clearArmed.value = false
    disarmTimer = null
  }, DISARM_TIMEOUT)
}

/**
 * 撤销危险操作确认状态。
 * @returns 无返回值。
 */
function disarmClear(): void {
  clearArmed.value = false
  if (disarmTimer) {
    window.clearTimeout(disarmTimer)
    disarmTimer = null
  }
}

/**
 * 更新单个设置项。
 * @param key 设置字段名。
 * @param value 新的布尔值。
 * @returns 无返回值。
 */
function handleUpdateSetting(key: keyof TodoSettings, value: boolean): void {
  state.value.settings[key] = value
}

/**
 * 清空已完成任务；首次点击为确认，超时自动撤销。
 * @returns 无返回值。
 */
function handleClearCompleted(): void {
  if (counts.value.done === 0) return
  if (!clearArmed.value) {
    armClear()
    return
  }
  state.value.items = state.value.items.filter((item) => !item.done)
  disarmClear()
}

/**
 * 清除连续按键状态。
 * @returns 无返回值。
 */
function resetChords(): void {
  pendingG = false
  pendingD = false
  if (chordTimer) {
    window.clearTimeout(chordTimer)
    chordTimer = null
  }
}

/**
 * 记录 g/d 连击的第一击。
 * @param kind 按键种类。
 * @returns 无返回值。
 */
function startChord(kind: 'g' | 'd'): void {
  if (kind === 'g') pendingG = true
  else pendingD = true
  if (chordTimer) window.clearTimeout(chordTimer)
  chordTimer = window.setTimeout(resetChords, CHORD_TIMEOUT)
}

/**
 * 判断事件目标是否处于文本输入状态。
 * @param target 事件目标。
 * @returns 是否正在输入。
 */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.isContentEditable
  )
}

/**
 * 统一处理 Vim 风格快捷键；输入态只响应 Esc 与 Ctrl+N。
 * @param event 键盘事件。
 * @returns 无返回值。
 */
function handleKeydown(event: KeyboardEvent): void {
  const target = event.target
  const typing = isTypingTarget(target)

  if (event.key === 'Escape') {
    if (editingId.value) {
      cancelEdit()
      return
    }
    if (settingsOpen.value) {
      closeSettings()
      return
    }
    if (typing && target instanceof HTMLElement) {
      target.blur()
      return
    }
    resetChords()
    return
  }

  if (
    (event.ctrlKey || event.metaKey) &&
    (event.key === 'n' || event.key === 'N')
  ) {
    event.preventDefault()
    focusNewTask()
    return
  }

  if (typing) {
    if (event.key === 'Enter' && target === searchInput.value && target instanceof HTMLElement) {
      target.blur()
    }
    return
  }

  if (settingsOpen.value && (event.key === 'j' || event.key === 'k')) {
    event.preventDefault()
    scrollSettings(event.key === 'j' ? 1 : -1)
    return
  }

  if (event.key === 'g') {
    if (pendingG) {
      resetChords()
      selectEdge('first')
      event.preventDefault()
    } else {
      startChord('g')
    }
    return
  }

  if (event.key === 'G') {
    resetChords()
    selectEdge('last')
    event.preventDefault()
    return
  }

  if (event.key === 'd') {
    if (pendingD) {
      resetChords()
      if (selectedId.value) removeTask(selectedId.value)
      event.preventDefault()
    } else {
      startChord('d')
    }
    return
  }

  resetChords()

  switch (event.key) {
    case '?':
      event.preventDefault()
      toggleSettings()
      break
    case 'j':
    case 'ArrowDown':
      event.preventDefault()
      moveSelection(1)
      break
    case 'k':
    case 'ArrowUp':
      event.preventDefault()
      moveSelection(-1)
      break
    case 'h':
    case 'ArrowLeft':
      event.preventDefault()
      switchGroup(-1)
      break
    case 'l':
    case 'ArrowRight':
      event.preventDefault()
      switchGroup(1)
      break
    case ' ':
      event.preventDefault()
      toggleSelected()
      break
    case 'Enter':
    case 'i':
      event.preventDefault()
      editSelected()
      break
    case 'Tab':
      event.preventDefault()
      focusNewTask()
      break
    case '/':
      event.preventDefault()
      focusSearch()
      break
    case 'Delete':
      if (selectedId.value) removeTask(selectedId.value)
      break
    default:
      break
  }
}

/**
 * 格式化创建时间，同日显示“今天”。
 * @param timestamp 毫秒时间戳。
 * @returns 可读时间文本。
 */
function formatTime(timestamp: number): string {
  const date = new Date(timestamp)
  const now = new Date()
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  const time = `${hours}:${minutes}`
  if (date.toDateString() === now.toDateString()) return `今天 ${time}`
  return `${date.getMonth() + 1}月${date.getDate()}日 ${time}`
}

/**
 * 渲染 Markdown 任务文本。
 * @param text 原始文本。
 * @returns 安全 HTML。
 */
function renderTaskMarkdown(text: string): string {
  return renderMarkdown(text)
}

onMounted(() => {
  window.addEventListener('keydown', handleKeydown)
  if (typeof window.ztools !== 'undefined' && window.ztools) {
    window.ztools.onPluginEnter(() => {
      state.value = loadState()
    })
    window.ztools.onPluginOut(() => {
      resetChords()
      disarmClear()
    })
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeydown)
  resetChords()
  disarmClear()
})
</script>

<template>
  <div class="plugin-root">
    <GroupSidebar
      :active="activeGroup"
      :counts="counts"
      @select="setActiveGroup"
      @open-settings="openSettings"
    />

    <main class="main-panel">
      <header class="main-header">
        <div class="title-block">
          <h1 class="group-title">{{ groupLabel }}</h1>
          <span class="group-subtitle">{{ subtitle }}</span>
        </div>
        <div class="search-box">
          <svg
            class="search-icon"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            stroke-width="1.7"
            stroke-linecap="round"
            aria-hidden="true"
          >
            <circle cx="9" cy="9" r="5.4" />
            <path d="M13.2 13.2 17 17" />
          </svg>
          <input
            ref="searchInput"
            v-model="search"
            type="text"
            class="search-input"
            placeholder="搜索待办  /"
            aria-label="搜索待办"
          />
        </div>
      </header>

      <div ref="listEl" class="task-list" role="list">
        <p v-if="visibleItems.length === 0" class="empty-state">{{ emptyText }}</p>

        <article
          v-for="item in visibleItems"
          :key="item.id"
          class="task-card"
          :class="{
            selected: item.id === selectedId,
            editing: item.id === editingId,
            done: item.done,
          }"
          :data-id="item.id"
          role="listitem"
          @click="selectTask(item)"
          @dblclick="startEdit(item)"
        >
          <button
            type="button"
            class="check"
            role="checkbox"
            :aria-checked="item.done ? 'true' : 'false'"
            :aria-label="item.done ? '标记为待处理' : '标记为已完成'"
            @click.stop="toggleDone(item)"
          >
            <svg
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              stroke-width="2.2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M3.4 8.4 6.6 11.6 12.6 4.8" />
            </svg>
          </button>

          <div class="task-body">
            <template v-if="item.id === editingId">
              <input
                v-model="editingText"
                class="edit-input"
                aria-label="编辑任务"
                @keydown.enter.prevent="commitEdit"
                @blur="commitEdit"
                @click.stop
              />
            </template>
            <template v-else>
              <div
                v-if="state.settings.renderMarkdown"
                class="task-text"
                :class="{ done: item.done }"
                v-html="renderTaskMarkdown(item.text)"
              />
              <div v-else class="task-text" :class="{ done: item.done }">{{ item.text }}</div>
              <time
                v-if="state.settings.showCreatedAt"
                class="task-time"
                :datetime="new Date(item.createdAt).toISOString()"
              >
                {{ formatTime(item.createdAt) }}
              </time>
            </template>
          </div>

          <button
            type="button"
            class="delete-btn"
            title="删除任务"
            aria-label="删除任务"
            @click.stop="removeTask(item.id)"
          >
            <svg
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linecap="round"
              aria-hidden="true"
            >
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </article>
      </div>

      <footer class="composer">
        <input
          ref="newTaskInput"
          v-model="newTaskText"
          type="text"
          class="new-task-input"
          placeholder="新任务，Enter 添加 · Tab 快速新建"
          aria-label="新任务"
          @keydown.enter="addTask"
        />
        <button
          type="button"
          class="add-btn"
          :disabled="newTaskText.trim().length === 0"
          @click="addTask"
        >
          添加
        </button>
      </footer>
    </main>

    <SettingsPanel
      v-if="settingsOpen"
      :settings="state.settings"
      :done-count="counts.done"
      :clear-armed="clearArmed"
      @close="closeSettings"
      @update-setting="handleUpdateSetting"
      @clear-completed="handleClearCompleted"
    />
  </div>
</template>

<style scoped>
.plugin-root {
  display: grid;
  grid-template-columns: 208px minmax(0, 1fr);
  height: 100vh;
  overflow: hidden;
  background: var(--plugin-surface, #fff);
  color: var(--plugin-text, #1f2329);
}

.main-panel {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  background: var(--plugin-surface, #fff);
  border-left: 1px solid var(--plugin-border, #e6e8eb);
}

.main-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 20px 12px;
}

.title-block {
  min-width: 0;
}

.group-title {
  margin: 0;
  font-size: 20px;
  font-weight: 650;
  letter-spacing: 0.01em;
}

.group-subtitle {
  display: block;
  margin-top: 2px;
  font-size: 12px;
  color: var(--plugin-text-muted, #8a919f);
}

.search-box {
  display: flex;
  align-items: center;
  gap: 6px;
  width: min(260px, 46%);
  min-width: 0;
  padding: 6px 12px;
  border: 1px solid var(--plugin-border, #e6e8eb);
  border-radius: 999px;
  background: var(--plugin-surface-alt, #f2f4f7);
  transition: border-color 0.15s ease, background 0.15s ease;
}

.search-box:focus-within {
  border-color: var(--plugin-accent, #2f6bff);
  background: var(--plugin-surface, #fff);
}

.search-icon {
  flex: none;
  width: 16px;
  height: 16px;
  color: var(--plugin-text-muted, #8a919f);
}

.search-input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  font-size: 13px;
}

.search-input::placeholder {
  color: var(--plugin-text-muted, #8a919f);
}

.task-list {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
  overflow-y: auto;
  padding: 4px 20px 14px;
  scroll-behavior: smooth;
}

.empty-state {
  margin: 48px auto;
  text-align: center;
  font-size: 13px;
  color: var(--plugin-text-muted, #8a919f);
}

.task-card {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--plugin-border, #e6e8eb);
  border-radius: var(--plugin-radius, 10px);
  background: var(--plugin-surface, #fff);
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease, box-shadow 0.15s ease;
}

.task-card:hover {
  border-color: color-mix(in srgb, var(--plugin-accent, #2f6bff) 45%, var(--plugin-border, #e6e8eb));
}

.task-card.selected {
  border-color: var(--plugin-accent, #2f6bff);
  background: var(--plugin-accent-soft, rgba(47, 107, 255, 0.14));
}

.task-card.editing {
  cursor: text;
}

.check {
  display: grid;
  flex: none;
  place-items: center;
  width: 20px;
  height: 20px;
  margin-top: 1px;
  border: 1.6px solid var(--plugin-border, #e6e8eb);
  border-radius: 6px;
  background: var(--plugin-surface, #fff);
  color: transparent;
  transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
}

.check:hover {
  border-color: var(--plugin-accent, #2f6bff);
}

.check[aria-checked='true'] {
  border-color: var(--plugin-accent, #2f6bff);
  background: var(--plugin-accent, #2f6bff);
  color: #fff;
}

.check svg {
  width: 14px;
  height: 14px;
}

.task-body {
  flex: 1;
  min-width: 0;
}

.task-text {
  font-size: 14px;
  line-height: 1.55;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.task-text.done {
  color: var(--plugin-text-muted, #8a919f);
  text-decoration: line-through;
}

.task-text :deep(code) {
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--plugin-surface-alt, #f2f4f7);
  font-size: 12.5px;
}

.task-text :deep(a) {
  color: var(--plugin-accent, #2f6bff);
}

.task-text :deep(.md-code-block) {
  margin: 6px 0;
  padding: 8px 10px;
  overflow-x: auto;
  border-radius: 8px;
  background: var(--plugin-surface-alt, #f2f4f7);
}

.task-text :deep(.md-code-block code) {
  padding: 0;
  background: none;
}

.task-time {
  display: block;
  margin-top: 3px;
  font-size: 11px;
  color: var(--plugin-text-muted, #8a919f);
}

.edit-input {
  width: 100%;
  padding: 2px 6px;
  border: 1px solid var(--plugin-accent, #2f6bff);
  border-radius: 6px;
  background: var(--plugin-surface, #fff);
  font-size: 14px;
  outline: none;
}

.delete-btn {
  display: grid;
  flex: none;
  place-items: center;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  color: var(--plugin-text-muted, #8a919f);
  opacity: 0;
  transition: opacity 0.15s ease, background 0.15s ease, color 0.15s ease;
}

.task-card:hover .delete-btn,
.task-card.selected .delete-btn,
.delete-btn:focus-visible {
  opacity: 1;
}

.delete-btn:hover {
  background: var(--plugin-danger-soft, rgba(229, 72, 77, 0.12));
  color: var(--plugin-danger, #e5484d);
}

.delete-btn svg {
  width: 14px;
  height: 14px;
}

@media (hover: none) {
  .delete-btn {
    opacity: 1;
  }
}

.composer {
  display: flex;
  gap: 8px;
  padding: 12px 20px 16px;
  border-top: 1px solid var(--plugin-border, #e6e8eb);
  background: var(--plugin-surface, #fff);
}

.new-task-input {
  flex: 1;
  min-width: 0;
  padding: 8px 12px;
  border: 1px solid var(--plugin-border, #e6e8eb);
  border-radius: 8px;
  background: var(--plugin-surface-alt, #f2f4f7);
  font-size: 13px;
  outline: none;
  transition: border-color 0.15s ease, background 0.15s ease;
}

.new-task-input:focus {
  border-color: var(--plugin-accent, #2f6bff);
  background: var(--plugin-surface, #fff);
}

.new-task-input::placeholder {
  color: var(--plugin-text-muted, #8a919f);
}

.add-btn {
  flex: none;
  padding: 0 18px;
  border-radius: 8px;
  background: var(--plugin-accent, #2f6bff);
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  transition: opacity 0.15s ease;
}

.add-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.add-btn:not(:disabled):active {
  opacity: 0.75;
}

@media (max-width: 720px) {
  .plugin-root {
    grid-template-columns: 64px minmax(0, 1fr);
  }

  .search-box {
    width: min(180px, 52%);
  }

  .main-header {
    padding: 12px 14px 10px;
  }

  .task-list {
    padding: 4px 14px 12px;
  }

  .composer {
    padding: 10px 14px 14px;
  }
}
</style>
