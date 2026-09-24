<script setup lang="ts">
import {
  Check,
  ChevronDown,
  Download,
  Filter,
  LoaderCircle,
  MoreHorizontal,
  Play,
  RefreshCw,
  Search,
  Settings,
  SlidersHorizontal,
  Trash2,
  X
} from '@lucide/vue'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { applyPetRuntimeConfig } from './petWindowController'
import PetPreview from './components/PetPreview.vue'
import type {
  InstalledPet,
  PetDownloadProgress,
  PetRuntimeConfig,
  PetSearchItem,
  PetTab
} from './types'

const tabs: Array<{ id: PetTab; label: string }> = [
  { id: 'gallery', label: '宠物库' },
  { id: 'installed', label: '已下载' },
  { id: 'settings', label: '设置' }
]
const sortOptions = [
  { value: 'installed', label: '最多安装' },
  { value: 'recent', label: '最近收录' },
  { value: 'popular', label: '最多喜欢' }
]
const kindOptions = [
  { value: '', label: '全部类型' },
  { value: 'creature', label: '生物' },
  { value: 'character', label: '角色' },
  { value: 'object', label: '物件' }
]

const activeTab = ref<PetTab>('gallery')
const pets = ref<PetSearchItem[]>([])
const installedPets = ref<InstalledPet[]>([])
const runtimeConfig = ref<PetRuntimeConfig>({
  activeSlug: null,
  enabled: false,
  scale: 0.72,
  opacity: 1,
  alwaysOnTop: true,
  soundEnabled: false,
  returnToDefaultAnimation: true,
  position: null
})
const query = ref('')
const sort = ref('installed')
const kind = ref('')
const nextCursor = ref<number | null>(0)
const total = ref(0)
const loading = ref(false)
const loadingMore = ref(false)
const errorMessage = ref('')
const installingSlugs = ref(new Set<string>())
const downloadProgress = ref(new Map<string, PetDownloadProgress>())
const detailPet = ref<PetSearchItem | null>(null)
const requestSequence = ref(0)
const loadMoreSentinel = ref<HTMLElement | null>(null)
let searchTimer: number | null = null
let loadMoreObserver: IntersectionObserver | null = null

const installedSlugSet = computed(() => new Set(installedPets.value.map((pet) => pet.slug)))
const activePet = computed(() =>
  installedPets.value.find((pet) => pet.slug === runtimeConfig.value.activeSlug)
)

/**
 * 把安装量格式化为紧凑的中文界面数字。
 * @param value 原始安装量。
 * @returns 格式化后的安装量。
 */
function formatCount(value: number): string {
  return new Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: 1 }).format(
    value
  )
}

/**
 * 把下载字节数格式化为紧凑容量文本。
 * @param bytes 下载字节数。
 * @returns 格式化后的容量。
 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * 返回下载按钮展示的百分比或已接收容量。
 * @param slug 宠物 slug。
 * @returns 下载进度文本。
 */
function getDownloadProgressLabel(slug: string): string {
  const progress = downloadProgress.value.get(slug)
  if (!progress) return '下载中'
  return progress.percent == null ? formatBytes(progress.receivedBytes) : `${progress.percent}%`
}

/**
 * 返回确定进度条宽度；未知总量时返回 null。
 * @param slug 宠物 slug。
 * @returns 百分比宽度或 null。
 */
function getDownloadProgressPercent(slug: string): number | null {
  return downloadProgress.value.get(slug)?.percent ?? null
}

/**
 * 更新指定宠物的下载进度并触发 Vue 响应式刷新。
 * @param slug 宠物 slug。
 * @param progress 最新下载进度。
 * @returns 无返回值。
 */
function updateDownloadProgress(slug: string, progress: PetDownloadProgress): void {
  const nextProgress = new Map(downloadProgress.value)
  nextProgress.set(slug, progress)
  downloadProgress.value = nextProgress
}

/**
 * 返回宠物卡片优先使用的轻量动态预览地址。
 * @param pet 宠物目录项。
 * @returns Petdex 预览图片地址。
 */
function getPreviewUrl(pet: PetSearchItem): string {
  return pet.previewUrl || `https://assets.petdex.dev/pets/${pet.slug}/preview.webp`
}

/**
 * 从本地服务刷新已安装宠物和运行配置。
 * @returns 刷新完成后的 Promise。
 */
async function refreshLocalState(): Promise<void> {
  const [installed, config] = await Promise.all([
    window.desktopPet.listInstalledPets(),
    window.desktopPet.getRuntimeConfig()
  ])
  installedPets.value = installed
  runtimeConfig.value = config
}

/**
 * 加载宠物目录首页或下一页，并丢弃过期请求结果。
 * @param append 是否追加下一页。
 * @returns 加载完成后的 Promise。
 */
async function loadPets(append = false): Promise<void> {
  if (append && (loading.value || loadingMore.value || nextCursor.value === null)) return
  const sequence = ++requestSequence.value
  append ? (loadingMore.value = true) : (loading.value = true)
  errorMessage.value = ''
  try {
    const response = await window.desktopPet.searchPets({
      query: query.value,
      sort: sort.value,
      kinds: kind.value ? [kind.value] : [],
      cursor: append ? (nextCursor.value ?? 0) : 0,
      limit: 24
    })
    if (sequence !== requestSequence.value) return
    pets.value = append ? [...pets.value, ...response.pets] : response.pets
    nextCursor.value = response.nextCursor
    total.value = response.total
  } catch (error) {
    if (sequence !== requestSequence.value) return
    errorMessage.value = error instanceof Error ? error.message : '宠物库加载失败'
  } finally {
    if (sequence === requestSequence.value) {
      loading.value = false
      loadingMore.value = false

      // 搜索或分页完成后重新观察哨兵，处理元素始终停留在预加载区域的情况。
      await nextTick()
      observeLoadMoreSentinel(loadMoreSentinel.value)
    }
  }
}

/**
 * 在列表末尾进入预加载区域时请求下一页。
 * @param entries IntersectionObserver 观察结果。
 * @returns 无返回值。
 */
function handleLoadMoreIntersection(entries: IntersectionObserverEntry[]): void {
  if (!entries.some((entry) => entry.isIntersecting)) return
  if (activeTab.value !== 'gallery' || pets.value.length === 0) return
  void loadPets(true)
}

/**
 * 绑定或清理列表底部滚动加载哨兵。
 * @param sentinel 当前渲染的哨兵元素。
 * @returns 无返回值。
 */
function observeLoadMoreSentinel(sentinel: HTMLElement | null): void {
  loadMoreObserver?.disconnect()
  loadMoreObserver = null
  if (!sentinel) return
  loadMoreObserver = new IntersectionObserver(handleLoadMoreIntersection, {
    rootMargin: '240px 0px'
  })
  loadMoreObserver.observe(sentinel)
}

/**
 * 延迟触发搜索，避免连续输入产生大量远端请求。
 * @returns 无返回值。
 */
function scheduleSearch(): void {
  if (searchTimer !== null) window.clearTimeout(searchTimer)
  searchTimer = window.setTimeout(() => void loadPets(false), 320)
}

/**
 * 下载并安装一个宠物，同时更新本地列表。
 * @param pet 待安装宠物。
 * @returns 安装完成后的 Promise。
 */
async function installPet(pet: PetSearchItem): Promise<void> {
  const nextInstalling = new Set(installingSlugs.value)
  nextInstalling.add(pet.slug)
  installingSlugs.value = nextInstalling
  updateDownloadProgress(pet.slug, { receivedBytes: 0, totalBytes: null, percent: null })
  errorMessage.value = ''
  try {
    await window.desktopPet.installPet(pet, (progress) => {
      updateDownloadProgress(pet.slug, progress)
    })
    await refreshLocalState()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '下载失败'
  } finally {
    const completed = new Set(installingSlugs.value)
    completed.delete(pet.slug)
    installingSlugs.value = completed
    const completedProgress = new Map(downloadProgress.value)
    completedProgress.delete(pet.slug)
    downloadProgress.value = completedProgress
  }
}

/**
 * 启用已安装宠物并显示透明桌面窗口。
 * @param slug 待启用宠物 slug。
 * @returns 启用完成后的 Promise。
 */
async function enablePet(slug: string): Promise<void> {
  const pet = installedPets.value.find((item) => item.slug === slug)
  runtimeConfig.value = await applyPetRuntimeConfig(
    {
      ...runtimeConfig.value,
      activeSlug: slug,
      enabled: true,
      soundEnabled: Boolean(pet?.soundUrl) && runtimeConfig.value.soundEnabled
    },
    installedPets.value
  )
  detailPet.value = null
}

/**
 * 停用当前桌宠并关闭透明窗口。
 * @returns 停用完成后的 Promise。
 */
async function disablePet(): Promise<void> {
  runtimeConfig.value = await applyPetRuntimeConfig(
    { ...runtimeConfig.value, enabled: false },
    installedPets.value
  )
}

/**
 * 卸载本地宠物；当前启用项会先被停用。
 * @param slug 待卸载宠物 slug。
 * @returns 卸载完成后的 Promise。
 */
async function uninstallPet(slug: string): Promise<void> {
  if (runtimeConfig.value.activeSlug === slug) await disablePet()
  await window.desktopPet.uninstallPet(slug)
  if (runtimeConfig.value.activeSlug === slug) {
    runtimeConfig.value = await window.desktopPet.saveRuntimeConfig({
      ...runtimeConfig.value,
      activeSlug: null,
      enabled: false
    })
  }
  await refreshLocalState()
}

/**
 * 保存设置并将窗口属性变化立即应用到桌宠。
 * @returns 保存完成后的 Promise。
 */
async function saveSettings(): Promise<void> {
  runtimeConfig.value = await applyPetRuntimeConfig(runtimeConfig.value, installedPets.value)
}

/**
 * 接收桌宠子窗口产生的运行配置变化并同步管理界面。
 * @param event 包含最新运行配置的自定义事件。
 * @returns 无返回值。
 */
function handleRuntimeConfigChange(event: Event): void {
  const detail = (event as CustomEvent<PetRuntimeConfig>).detail
  if (detail) runtimeConfig.value = detail
}

watch(query, scheduleSearch)
watch(sort, () => void loadPets(false))
watch(kind, () => void loadPets(false))
watch(loadMoreSentinel, observeLoadMoreSentinel)

onMounted(async () => {
  window.addEventListener('petdex-desktop-pet:runtime-config', handleRuntimeConfigChange)
  await Promise.all([refreshLocalState(), loadPets(false)])
})

onBeforeUnmount(() => {
  // 清理页面级监听，避免插件视图重建后重复处理子窗口事件。
  window.removeEventListener('petdex-desktop-pet:runtime-config', handleRuntimeConfigChange)
  if (searchTimer !== null) window.clearTimeout(searchTimer)
  loadMoreObserver?.disconnect()
})
</script>

<template>
  <main class="app-shell">
    <header class="topbar">
      <nav class="tabs" aria-label="桌宠视图">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          type="button"
          :class="['tab-button', { active: activeTab === tab.id }]"
          @click="activeTab = tab.id"
        >
          {{ tab.label }}
          <span v-if="tab.id === 'installed'" class="tab-count">{{ installedPets.length }}</span>
        </button>
      </nav>
    </header>

    <section v-if="activeTab === 'gallery'" class="view-section">
      <div class="toolbar">
        <label class="search-field">
          <Search :size="17" />
          <input v-model="query" type="search" placeholder="搜索名称、角色或风格" />
          <button v-if="query" type="button" title="清空搜索" @click="query = ''">
            <X :size="15" />
          </button>
        </label>
        <label class="select-field">
          <SlidersHorizontal :size="16" />
          <select v-model="sort">
            <option v-for="option in sortOptions" :key="option.value" :value="option.value">
              {{ option.label }}
            </option>
          </select>
          <ChevronDown :size="15" />
        </label>
        <label class="select-field">
          <Filter :size="16" />
          <select v-model="kind">
            <option v-for="option in kindOptions" :key="option.value" :value="option.value">
              {{ option.label }}
            </option>
          </select>
          <ChevronDown :size="15" />
        </label>
        <button type="button" class="icon-button" title="刷新宠物库" @click="loadPets(false)">
          <RefreshCw :size="17" :class="{ spinning: loading }" />
        </button>
      </div>

      <div v-if="errorMessage" class="status-banner error">
        <span>{{ errorMessage }}</span>
        <button type="button" @click="errorMessage = ''"><X :size="15" /></button>
      </div>

      <div v-if="loading && pets.length === 0" class="loading-state">
        <LoaderCircle :size="24" class="spinning" />
        <span>正在加载宠物库</span>
      </div>

      <div v-else-if="pets.length === 0" class="empty-state">
        <Search :size="26" />
        <strong>没有找到匹配的宠物</strong>
      </div>

      <div v-else class="pet-grid">
        <article
          v-for="pet in pets"
          :key="pet.slug"
          class="pet-card"
          :style="{ '--pet-accent': pet.dominantColor || 'var(--brand)' }"
        >
          <button type="button" class="pet-preview" @click="detailPet = pet">
            <PetPreview
              :src="getPreviewUrl(pet)"
              :fallback-src="pet.spritesheetPath"
              :label="`${pet.displayName} 动画预览`"
            />
            <span v-if="pet.featured" class="featured-badge">精选</span>
            <span class="dex-number">No. {{ pet.dexNumber ?? '—' }}</span>
          </button>
          <div class="pet-card-body">
            <div class="pet-title-row">
              <div class="pet-title">
                <strong>{{ pet.displayName }}</strong>
                <span>{{ pet.submittedBy.name }}</span>
              </div>
              <button
                type="button"
                class="icon-button compact"
                title="查看详情"
                @click="detailPet = pet"
              >
                <MoreHorizontal :size="16" />
              </button>
            </div>
            <p>{{ pet.description }}</p>
            <div class="pet-card-footer">
              <span><Download :size="14" /> {{ formatCount(pet.metrics.installCount) }}</span>
              <button
                v-if="!installedSlugSet.has(pet.slug)"
                type="button"
                class="card-action"
                :disabled="installingSlugs.has(pet.slug)"
                @click="installPet(pet)"
              >
                <LoaderCircle v-if="installingSlugs.has(pet.slug)" :size="15" class="spinning" />
                <Download v-else :size="15" />
                {{ installingSlugs.has(pet.slug) ? getDownloadProgressLabel(pet.slug) : '下载' }}
                <span v-if="installingSlugs.has(pet.slug)" class="download-progress-track">
                  <span
                    :class="{ indeterminate: getDownloadProgressPercent(pet.slug) === null }"
                    :style="{
                      width:
                        getDownloadProgressPercent(pet.slug) === null
                          ? undefined
                          : `${getDownloadProgressPercent(pet.slug)}%`
                    }"
                  />
                </span>
              </button>
              <button
                v-else-if="runtimeConfig.activeSlug !== pet.slug || !runtimeConfig.enabled"
                type="button"
                class="card-action primary"
                @click="enablePet(pet.slug)"
              >
                <Play :size="15" /> 启用
              </button>
              <span v-else class="active-status"><Check :size="14" /> 使用中</span>
            </div>
          </div>
        </article>
      </div>

      <div
        v-if="nextCursor !== null && pets.length"
        ref="loadMoreSentinel"
        class="load-more-sentinel"
        aria-label="加载更多宠物"
      >
        <LoaderCircle v-if="loadingMore" :size="18" class="spinning" />
      </div>
    </section>

    <section v-else-if="activeTab === 'installed'" class="view-section installed-view">
      <div v-if="installedPets.length === 0" class="empty-state tall">
        <Download :size="28" />
        <strong>还没有下载宠物</strong>
        <button type="button" class="command-button" @click="activeTab = 'gallery'">
          打开宠物库
        </button>
      </div>
      <div v-else class="installed-list">
        <article v-for="pet in installedPets" :key="pet.slug" class="installed-row">
          <PetPreview
            :src="`https://assets.petdex.dev/pets/${pet.slug}/preview.webp`"
            :fallback-src="pet.spritesheetUrl"
            :label="`${pet.displayName} 动画预览`"
          />
          <div class="installed-meta">
            <strong>{{ pet.displayName }}</strong>
            <span>Sprite v{{ pet.spriteVersionNumber }} · {{ pet.slug }}</span>
          </div>
          <span
            v-if="runtimeConfig.activeSlug === pet.slug && runtimeConfig.enabled"
            class="active-status"
          >
            <Check :size="14" /> 使用中
          </span>
          <button
            v-else
            type="button"
            class="command-button secondary compact-command"
            @click="enablePet(pet.slug)"
          >
            <Play :size="15" /> 启用
          </button>
          <button
            type="button"
            class="icon-button danger"
            title="卸载宠物"
            @click="uninstallPet(pet.slug)"
          >
            <Trash2 :size="16" />
          </button>
        </article>
      </div>
    </section>

    <section v-else class="view-section settings-view">
      <div class="settings-header">
        <Settings :size="19" />
        <div>
          <h2>桌宠设置</h2>
          <p>{{ activePet?.displayName || '当前未选择宠物' }}</p>
        </div>
      </div>

      <div class="settings-form">
        <label class="setting-row">
          <span>
            <strong>宠物大小</strong>
            <small>{{ Math.round(runtimeConfig.scale * 100) }}%</small>
          </span>
          <input
            v-model.number="runtimeConfig.scale"
            type="range"
            min="0.4"
            max="1.4"
            step="0.05"
            @change="saveSettings"
          />
        </label>

        <label class="setting-row">
          <span>
            <strong>透明度</strong>
            <small>{{ Math.round(runtimeConfig.opacity * 100) }}%</small>
          </span>
          <input
            v-model.number="runtimeConfig.opacity"
            type="range"
            min="0.2"
            max="1"
            step="0.05"
            @change="saveSettings"
          />
        </label>

        <label class="setting-row toggle-row">
          <span>
            <strong>宠物音效</strong>
            <small>{{ activePet?.soundUrl ? '点击宠物时播放专属音效' : '当前宠物不含音效' }}</small>
          </span>
          <input
            v-model="runtimeConfig.soundEnabled"
            type="checkbox"
            :disabled="!activePet?.soundUrl"
            @change="saveSettings"
          />
        </label>

        <label class="setting-row toggle-row">
          <span>
            <strong>自动恢复默认动画</strong>
            <small>切换动作播放一遍后恢复默认动画</small>
          </span>
          <input
            v-model="runtimeConfig.returnToDefaultAnimation"
            type="checkbox"
            @change="saveSettings"
          />
        </label>

        <label class="setting-row toggle-row">
          <span>
            <strong>始终置顶</strong>
            <small>让宠物保持在其他窗口上方</small>
          </span>
          <input v-model="runtimeConfig.alwaysOnTop" type="checkbox" @change="saveSettings" />
        </label>
      </div>
    </section>

    <div v-if="detailPet" class="detail-backdrop" @click.self="detailPet = null">
      <aside class="detail-panel" aria-label="宠物详情">
        <button
          type="button"
          class="icon-button detail-close"
          title="关闭详情"
          @click="detailPet = null"
        >
          <X :size="17" />
        </button>
        <div
          class="detail-preview"
          :style="{ '--pet-accent': detailPet.dominantColor || 'var(--brand)' }"
        >
          <PetPreview
            :src="getPreviewUrl(detailPet)"
            :fallback-src="detailPet.spritesheetPath"
            :label="`${detailPet.displayName} 动画预览`"
          />
        </div>
        <div class="detail-content">
          <span class="detail-kind"
            >{{ detailPet.kind }} · Sprite v{{ detailPet.spriteVersionNumber }}</span
          >
          <h2>{{ detailPet.displayName }}</h2>
          <p>{{ detailPet.description }}</p>
          <div class="tag-list">
            <span v-for="tag in [...detailPet.vibes, ...detailPet.tags].slice(0, 8)" :key="tag">{{
              tag
            }}</span>
          </div>
          <dl>
            <div>
              <dt>作者</dt>
              <dd>{{ detailPet.submittedBy.name }}</dd>
            </div>
            <div>
              <dt>安装</dt>
              <dd>{{ formatCount(detailPet.metrics.installCount) }}</dd>
            </div>
          </dl>
          <button
            v-if="!installedSlugSet.has(detailPet.slug)"
            type="button"
            class="command-button full"
            :disabled="installingSlugs.has(detailPet.slug)"
            @click="installPet(detailPet)"
          >
            <LoaderCircle v-if="installingSlugs.has(detailPet.slug)" :size="16" class="spinning" />
            <Download v-else :size="16" />
            {{
              installingSlugs.has(detailPet.slug)
                ? getDownloadProgressLabel(detailPet.slug)
                : '下载宠物'
            }}
            <span v-if="installingSlugs.has(detailPet.slug)" class="download-progress-track">
              <span
                :class="{ indeterminate: getDownloadProgressPercent(detailPet.slug) === null }"
                :style="{
                  width:
                    getDownloadProgressPercent(detailPet.slug) === null
                      ? undefined
                      : `${getDownloadProgressPercent(detailPet.slug)}%`
                }"
              />
            </span>
          </button>
          <button
            v-else
            type="button"
            class="command-button full"
            @click="enablePet(detailPet.slug)"
          >
            <Play :size="16" /> 启用宠物
          </button>
        </div>
      </aside>
    </div>
  </main>
</template>
