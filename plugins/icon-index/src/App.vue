<script setup lang="ts">
import { AlertCircle, SearchX } from 'lucide-vue-next'
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import AppHeader from './components/AppHeader.vue'
import FormatToolbar from './components/FormatToolbar.vue'
import IconGrid from './components/IconGrid.vue'
import PaginationBar from './components/PaginationBar.vue'
import QuickActionDialog from './components/QuickActionDialog.vue'
import ToastMessage from './components/ToastMessage.vue'
import { useIconSearch } from './composables/useIconSearch'
import { copyAsset, saveAsset, svgToPngDataUrl } from './services/exporter'
import { matchIconSequence } from './services/icon-shortcut'
import { iconifyClient } from './services/iconify'
import type { IconItem, OutputFormat, QuickIconAction } from './types/icon'

const searchState = useIconSearch()
const header = ref<InstanceType<typeof AppHeader> | null>(null)
const format = ref<OutputFormat>('svg')
const pngSize = ref(128)
const color = ref('#193c39')
const busyAction = ref<'copy' | 'save' | null>(null)
const toast = ref<{ message: string; kind: 'success' | 'error' } | null>(null)
const quickDialogOpen = ref(false)
const quickItem = ref<IconItem | null>(null)
const quickSequence = ref(0)
const sequenceBuffer = ref('')
let toastTimer: number | null = null
let sequenceTimer: number | null = null

const selectedColorEnabled = computed(() => searchState.selected.value?.palette !== true)
const displayQuery = computed(() => {
  const effective = searchState.result.value?.effectiveQuery
  if (!effective || effective === searchState.activeQuery.value) return searchState.activeQuery.value
  return `${searchState.activeQuery.value} / ${effective}`
})

function showToast(message: string, kind: 'success' | 'error' = 'success'): void {
  toast.value = { message, kind }
  if (toastTimer) window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => {
    toast.value = null
  }, 2400)
}

async function renderAsset(item: IconItem, outputFormat: OutputFormat): Promise<{ svg: string; png?: string }> {
  const svg = await iconifyClient.getSvg(item.id, item.palette ? undefined : color.value)
  if (outputFormat === 'svg') return { svg }
  return { svg, png: await svgToPngDataUrl(svg, pngSize.value) }
}

async function performCopy(
  item = searchState.selected.value,
  outputFormat: OutputFormat = format.value
): Promise<void> {
  if (!item || busyAction.value) return
  format.value = outputFormat
  busyAction.value = 'copy'
  try {
    const asset = await renderAsset(item, outputFormat)
    await copyAsset(outputFormat, asset.svg, asset.png)
    showToast(`已复制 ${outputFormat.toUpperCase()}`)
  } catch (error) {
    showToast(error instanceof Error ? error.message : '复制失败', 'error')
  } finally {
    busyAction.value = null
  }
}

async function performSave(
  item = searchState.selected.value,
  outputFormat: OutputFormat = format.value
): Promise<void> {
  if (!item || busyAction.value) return
  format.value = outputFormat
  busyAction.value = 'save'
  try {
    const asset = await renderAsset(item, outputFormat)
    const savedPath = saveAsset(item, outputFormat, asset.svg, asset.png)
    if (savedPath) showToast('图标已保存')
  } catch (error) {
    showToast(error instanceof Error ? error.message : '保存失败', 'error')
  } finally {
    busyAction.value = null
  }
}

async function focusSelected(): Promise<void> {
  await nextTick()
  const selected = document.querySelector<HTMLElement>(`[data-icon-index="${searchState.selectedIndex.value}"]`)
  selected?.focus({ preventScroll: true })
  selected?.scrollIntoView({ block: 'nearest' })
}

function gridColumnCount(): number {
  const grid = document.querySelector<HTMLElement>('.icon-grid')
  if (!grid) return 1
  return Math.max(1, getComputedStyle(grid).gridTemplateColumns.split(' ').length)
}

async function moveSelection(delta: number): Promise<void> {
  searchState.select(searchState.selectedIndex.value + delta)
  await focusSelected()
}

function resetSequence(): void {
  sequenceBuffer.value = ''
  if (sequenceTimer) window.clearTimeout(sequenceTimer)
  sequenceTimer = null
}

function openQuickActions(index = searchState.selectedIndex.value): void {
  const item = searchState.items.value[index]
  if (!item) return
  resetSequence()
  searchState.select(index)
  quickItem.value = item
  quickSequence.value = index + 1
  quickDialogOpen.value = true
}

function closeQuickActions(): void {
  quickDialogOpen.value = false
  void focusSelected()
}

function commitPendingSequence(): void {
  if (!sequenceBuffer.value) return
  const index = searchState.selectedIndex.value
  resetSequence()
  openQuickActions(index)
}

function selectByAltDigit(digit: string): void {
  const match = matchIconSequence(sequenceBuffer.value, digit, searchState.items.value.length)
  if (match.index === null) {
    resetSequence()
    return
  }

  sequenceBuffer.value = match.buffer
  searchState.select(match.index)
  void focusSelected()

  if (match.commit) {
    openQuickActions(match.index)
    return
  }

  if (sequenceTimer) window.clearTimeout(sequenceTimer)
  sequenceTimer = window.setTimeout(commitPendingSequence, 700)
}

async function runQuickAction(action: QuickIconAction): Promise<void> {
  const item = quickItem.value
  if (!item || busyAction.value) return

  if (action === 'copy-svg') await performCopy(item, 'svg')
  else if (action === 'copy-png') await performCopy(item, 'png')
  else if (action === 'save-svg') await performSave(item, 'svg')
  else await performSave(item, 'png')

  closeQuickActions()
}

async function changePage(direction: -1 | 1): Promise<void> {
  const result = searchState.result.value
  if (!result) return
  if (direction === -1 && !result.hasPrevious) return
  if (direction === 1 && !result.hasNext) return
  quickDialogOpen.value = false
  resetSequence()
  await searchState.goToPage(result.page + direction)
  await focusSelected()
}

function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  )
}

function onKeydown(event: KeyboardEvent): void {
  if (event.altKey && /^\d$/.test(event.key)) {
    event.preventDefault()
    if (quickDialogOpen.value) {
      const quickActions: Partial<Record<string, QuickIconAction>> = {
        '1': 'copy-svg',
        '2': 'copy-png',
        '3': 'save-svg',
        '4': 'save-png'
      }
      const action = quickActions[event.key]
      if (action) void runQuickAction(action)
      return
    }
    if (!event.repeat) selectByAltDigit(event.key)
    return
  }

  if (event.key === 'Escape' && quickDialogOpen.value) {
    event.preventDefault()
    closeQuickActions()
    return
  }

  if (quickDialogOpen.value) return

  if (isEditableTarget(event.target)) {
    if (event.key === 'ArrowDown' && searchState.items.value.length) {
      event.preventDefault()
      void focusSelected()
    }
    return
  }

  const target = event.target instanceof HTMLElement ? event.target : null
  if (event.key === 'Enter' && target?.closest('button:not([data-icon-index])')) return

  const commandKey = event.ctrlKey || event.metaKey
  if (commandKey && event.key.toLowerCase() === 'c') {
    event.preventDefault()
    void performCopy()
    return
  }
  if (commandKey && event.key.toLowerCase() === 's') {
    event.preventDefault()
    void performSave()
    return
  }

  const columns = gridColumnCount()
  const movements: Record<string, number> = {
    ArrowLeft: -1,
    ArrowRight: 1,
    ArrowUp: -columns,
    ArrowDown: columns
  }

  if (event.key in movements) {
    event.preventDefault()
    void moveSelection(movements[event.key])
  } else if (event.key === 'Home') {
    event.preventDefault()
    searchState.select(0)
    void focusSelected()
  } else if (event.key === 'End') {
    event.preventDefault()
    searchState.select(searchState.items.value.length - 1)
    void focusSelected()
  } else if (event.key === 'Enter') {
    event.preventDefault()
    openQuickActions()
  } else if (event.key === 'PageUp') {
    event.preventDefault()
    void changePage(-1)
  } else if (event.key === 'PageDown') {
    event.preventDefault()
    void changePage(1)
  } else if (event.key === '/' && !commandKey) {
    event.preventDefault()
    header.value?.focusSearch(true)
  }
}

function onKeyup(event: KeyboardEvent): void {
  if (event.key === 'Alt' && !quickDialogOpen.value) commitPendingSequence()
}

function extractLaunchQuery(payload: unknown): string {
  if (typeof payload !== 'string') return ''
  return payload.trim().replace(/^(?:icon|svg|图标)\s+/i, '')
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('keyup', onKeyup)

  const ztools = window.ztools
  if (ztools) {
    ztools.setExpendHeight?.(680)
    ztools.onPluginEnter?.((parameter) => {
      const launchQuery = extractLaunchQuery(parameter.payload)
      if (launchQuery) void searchState.search(launchQuery)
      else header.value?.focusSearch(true)
    })
  }

  void searchState.search('home')
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('keyup', onKeyup)
  if (toastTimer) window.clearTimeout(toastTimer)
  resetSequence()
})
</script>

<template>
  <div class="app-shell">
    <AppHeader
      ref="header"
      v-model="searchState.query.value"
      :loading="searchState.loading.value"
      @search="searchState.search()"
    />

    <main class="workspace">
      <section class="results-pane" aria-label="搜索结果">
        <div class="results-toolbar">
          <div class="query-summary">
            <strong>{{ displayQuery || '图标' }}</strong>
            <span v-if="searchState.result.value">已载入 {{ searchState.result.value.loadedCount }}</span>
          </div>
          <FormatToolbar
            v-model:format="format"
            v-model:size="pngSize"
            v-model:color="color"
            :color-enabled="selectedColorEnabled"
          />
        </div>

        <div v-if="searchState.loading.value" class="loading-grid" aria-label="正在搜索">
          <span v-for="index in 30" :key="index" class="loading-tile" />
        </div>

        <div v-else-if="searchState.error.value" class="state-panel error-state" role="alert">
          <AlertCircle :size="30" aria-hidden="true" />
          <strong>{{ searchState.error.value }}</strong>
          <button type="button" class="secondary-command" @click="searchState.search()">重新搜索</button>
        </div>

        <div v-else-if="searchState.result.value && !searchState.items.value.length" class="state-panel">
          <SearchX :size="34" aria-hidden="true" />
          <strong>没有找到匹配图标</strong>
        </div>

        <IconGrid
          v-else
          :items="searchState.items.value"
          :selected-index="searchState.selectedIndex.value"
          :color="color"
          @select="openQuickActions"
        />

        <PaginationBar
          v-if="searchState.result.value"
          :page="searchState.result.value.page"
          :count="searchState.items.value.length"
          :loaded-count="searchState.result.value.loadedCount"
          :has-previous="searchState.result.value.hasPrevious"
          :has-next="searchState.result.value.hasNext"
          :loading="searchState.loading.value"
          @previous="changePage(-1)"
          @next="changePage(1)"
        />
      </section>
    </main>

    <QuickActionDialog
      :open="quickDialogOpen"
      :item="quickItem"
      :sequence="quickSequence"
      :color="color"
      :png-size="pngSize"
      :busy="busyAction !== null"
      @close="closeQuickActions"
      @action="runQuickAction"
    />

    <Transition name="toast">
      <ToastMessage v-if="toast" :message="toast.message" :kind="toast.kind" />
    </Transition>
  </div>
</template>
