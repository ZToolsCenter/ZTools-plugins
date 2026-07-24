<template>
  <div class="cookie-panel">
    <div class="cookie-panel__toolbar">
      <UiInput style="width: 50%;" v-model="keyword" :placeholder="t('cookies.searchPlaceholder')" />
      <UiTooltip :content="t('cookies.add')" placement="top">
        <UiButton variant="primary" size="xs" @click="showAddModal = true">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </UiButton>
      </UiTooltip>
      <UiTooltip :content="t('cookies.refresh')" placement="top">
        <UiButton variant="ghost" size="xs" @click="refreshCookies">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
            <path d="M3 3v5h5" />
            <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
            <path d="M16 21h5v-5" />
          </svg>
        </UiButton>
      </UiTooltip>
      <UiTooltip :content="t('cookies.clearAll')" placement="top">
        <UiButton variant="danger" size="xs" :disabled="cookies.length === 0" @click="confirmClearAll = true">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M3 6h18" />
            <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
            <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
          </svg>
        </UiButton>
      </UiTooltip>
    </div>

    <UiEmpty v-if="filteredCookies.length === 0" :text="t('cookies.empty')" />

    <div v-else class="cookie-panel__list">
      <div v-for="group in groupedCookies" :key="group.domain" class="cookie-domain-group">
        <div class="cookie-domain-group__header" @click="toggleGroup(group.domain)">
          <svg class="cookie-domain-group__toggle"
            :class="{ 'cookie-domain-group__toggle--expanded': expandedGroups.has(group.domain) }" width="14"
            height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="9 18 15 12 9 6" />
          </svg>
          <span class="cookie-domain-group__domain">{{ group.domain }}</span>
          <UiBadge size="sm" variant="info">{{ group.items.length }}</UiBadge>
          <UiTooltip :content="t('cookies.clearDomain')" placement="top">
            <UiButton variant="ghost" size="sm" icon-only @click.stop="clearDomain(group.domain)">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M18 6 6 18" />
                <path d="m6 6 12 12" />
              </svg>
            </UiButton>
          </UiTooltip>
        </div>

        <div v-show="expandedGroups.has(group.domain)" v-for="item in group.items" :key="item.id" class="cookie-row">
          <div class="cookie-row__main" @click="toggleExpand(item.id)">
            <div class="cookie-row__name">
              {{ item.name }}
              <UiBadge v-if="item.sameSite" size="sm" :variant="sameSiteVariant(item.sameSite)">{{ item.sameSite }}
              </UiBadge>
            </div>
            <div class="cookie-row__value" :class="{ 'cookie-row__value--expanded': expandedIds.has(item.id) }">
              {{ expandedIds.has(item.id) ? item.value : item.value.slice(0, 40) + (item.value.length > 40 ? '...' : '')
              }}
            </div>
          </div>
          <div class="cookie-row__meta">
            <span>{{ item.path }}</span>
            <UiBadge v-if="item.secure" size="sm" variant="warning">Secure</UiBadge>
            <UiBadge v-if="item.httpOnly" size="sm" variant="info">HttpOnly</UiBadge>
          </div>
          <div class="cookie-row__actions">
            <UiTooltip :content="t('common.delete')" placement="top">
              <UiButton variant="ghost" size="sm" icon-only @click="removeCookie(item.id)">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M3 6h18" />
                  <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                  <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                </svg>
              </UiButton>
            </UiTooltip>
            <UiTooltip :content="t('cookies.copy')" placement="top">
              <UiButton variant="ghost" size="sm" icon-only @click="copyCookie(item)">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
                  <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
                </svg>
              </UiButton>
            </UiTooltip>
          </div>
        </div>
      </div>
    </div>

    <UiConfirm v-if="confirmClearAll" :title="t('cookies.clearAll')" :message="t('cookies.clearAllConfirm')"
      :confirm-text="t('common.delete')" :cancel-text="t('common.cancel')" confirm-variant="danger" @confirm="clearAll"
      @cancel="confirmClearAll = false" />

    <UiModal v-if="showAddModal" :title="t('cookies.addTitle')" size="sm" @close="showAddModal = false">
      <div class="add-cookie-form">
        <div class="form-row">
          <div class="form-group">
            <UiLabel>{{ t('cookies.name') }} *</UiLabel>
            <UiInput v-model="newCookie.name" :placeholder="t('cookies.namePlaceholder')" />
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <UiLabel>{{ t('cookies.value') }} *</UiLabel>
            <UiInput v-model="newCookie.value" :placeholder="t('cookies.valuePlaceholder')" />
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <UiLabel>{{ t('cookies.domain') }} *</UiLabel>
            <UiInput v-model="newCookie.domain" :placeholder="t('cookies.domainPlaceholder')" />
          </div>
          <div class="form-group form-group--sm">
            <UiLabel>{{ t('cookies.path') }}</UiLabel>
            <UiInput v-model="newCookie.path" placeholder="/" />
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <UiLabel>{{ t('cookies.sameSite') }}</UiLabel>
            <UiSelect v-model="newCookie.sameSite" :options="sameSiteOptions" />
          </div>
        </div>
        <div class="form-row checkboxes">
          <label class="checkbox-label">
            <input type="checkbox" v-model="newCookie.secure" />
            <span>Secure</span>
          </label>
          <label class="checkbox-label">
            <input type="checkbox" v-model="newCookie.httpOnly" />
            <span>HttpOnly</span>
          </label>
        </div>
      </div>
      <template #footer>
        <UiButton variant="secondary" size="sm" @click="showAddModal = false">{{ t('common.cancel') }}</UiButton>
        <UiButton variant="primary" size="sm" :disabled="!canAddCookie" @click="addCookie">{{ t('common.save') }}
        </UiButton>
      </template>
    </UiModal>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, reactive } from 'vue'
import { useI18n } from 'vue-i18n'
import UiButton from '../ui/UiButton.vue'
import UiInput from '../ui/UiInput.vue'
import UiEmpty from '../ui/UiEmpty.vue'
import UiBadge from '../ui/UiBadge.vue'
import UiConfirm from '../ui/UiConfirm.vue'
import UiTooltip from '../ui/UiTooltip.vue'
import UiModal from '../ui/UiModal.vue'
import UiLabel from '../ui/UiLabel.vue'
import UiSelect from '../ui/UiSelect.vue'

interface CookieItem {
  id: string
  name: string
  value: string
  domain: string
  path: string
  secure: boolean
  httpOnly: boolean
  sameSite: string
  expiresAt: number | null
}

const { t } = useI18n()
const keyword = ref('')
const cookies = ref<CookieItem[]>([])
const confirmClearAll = ref(false)
const expandedIds = ref(new Set<string>())
const expandedGroups = ref(new Set<string>())

function refreshCookies() {
  if (!window.services?.cookiesList) {
    cookies.value = []
    return
  }
  const newCookies = window.services.cookiesList() as CookieItem[]
  cookies.value = newCookies
}

function getCookies() {
  if (!window.services?.cookiesList) {
    return []
  }
  return window.services.cookiesList() as CookieItem[]
}

function removeCookie(id: string) {
  window.services?.cookiesDelete?.(id)
  refreshCookies()
}

function clearDomain(domain: string) {
  window.services?.cookiesClear?.(domain)
  refreshCookies()
}

function clearAll() {
  window.services?.cookiesClear?.()
  confirmClearAll.value = false
  refreshCookies()
}

function toggleExpand(id: string) {
  const newSet = new Set(expandedIds.value)
  if (newSet.has(id)) {
    newSet.delete(id)
  } else {
    newSet.add(id)
  }
  expandedIds.value = newSet
}

function toggleGroup(domain: string) {
  const newSet = new Set(expandedGroups.value)
  if (newSet.has(domain)) {
    newSet.delete(domain)
  } else {
    newSet.add(domain)
  }
  expandedGroups.value = newSet
}

function copyCookie(item: CookieItem) {
  const text = `${item.name}=${item.value}`
  navigator.clipboard.writeText(text)
}

function sameSiteVariant(sameSite: string): 'success' | 'warning' | 'info' {
  if (sameSite === 'Strict') return 'success'
  if (sameSite === 'Lax') return 'info'
  return 'warning'
}

const showAddModal = ref(false)
const newCookie = reactive({
  name: '',
  value: '',
  domain: '',
  path: '/',
  secure: false,
  httpOnly: false,
  sameSite: 'Lax'
})

const sameSiteOptions = [
  { label: 'Lax', value: 'Lax' },
  { label: 'Strict', value: 'Strict' },
  { label: 'None', value: 'None' }
]

const canAddCookie = computed(() => {
  return newCookie.name.trim() && newCookie.value.trim() && newCookie.domain.trim()
})

function addCookie() {
  if (!canAddCookie.value) return
  window.services?.cookiesAdd?.({
    name: newCookie.name.trim(),
    value: newCookie.value.trim(),
    domain: newCookie.domain.trim(),
    path: newCookie.path.trim() || '/',
    secure: newCookie.secure,
    httpOnly: newCookie.httpOnly,
    sameSite: newCookie.sameSite
  })
  showAddModal.value = false
  refreshCookies()
  newCookie.name = ''
  newCookie.value = ''
  newCookie.domain = ''
  newCookie.path = '/'
  newCookie.secure = false
  newCookie.httpOnly = false
  newCookie.sameSite = 'Lax'
}

const filteredCookies = computed(() => {
  const term = keyword.value.trim().toLowerCase()
  if (!term) {
    return cookies.value
  }

  return cookies.value.filter((item) => {
    return (
      item.domain.toLowerCase().includes(term) ||
      item.name.toLowerCase().includes(term) ||
      item.value.toLowerCase().includes(term) ||
      item.path.toLowerCase().includes(term)
    )
  })
})

const groupedCookies = computed(() => {
  const grouped = new Map<string, CookieItem[]>()
  for (const item of filteredCookies.value) {
    const bucket = grouped.get(item.domain) || []
    bucket.push(item)
    grouped.set(item.domain, bucket)
  }

  return Array.from(grouped.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([domain, items]) => ({ domain, items }))
})

refreshCookies()

defineExpose({ refreshCookies, getCookies })
</script>

<style scoped>
.cookie-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.cookie-panel__toolbar {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  padding: var(--space-xs);
  border-bottom: 1px solid var(--border-color);
  flex-shrink: 0;
}

.cookie-panel__search {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  flex: 1;
  min-width: 0;
}

.cookie-panel__search :deep(.ui-input-wrapper) {
  flex: 1;
}

.cookie-panel__search-icon {
  color: var(--text-muted);
  flex-shrink: 0;
}

.cookie-panel__list {
  flex: 1;
  overflow: auto;
  display: block;
  padding: var(--space-sm);
}

.cookie-panel__list::-webkit-scrollbar {
  display: none;
}

.cookie-domain-group {
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  overflow: hidden;
  background: var(--bg-surface);
  margin-bottom: var(--space-sm);
}

.cookie-domain-group__header {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-sm) var(--space-md);
  background: var(--bg-elevated);
  border-bottom: 1px solid var(--border-color);
  cursor: pointer;
  font-size: 12px;
  transition: background var(--transition-fast);
}

.cookie-domain-group__header:hover {
  background: var(--bg-overlay);
}

.cookie-domain-group__toggle {
  transition: transform var(--transition-fast);
  flex-shrink: 0;
  color: var(--text-muted);
}

.cookie-domain-group__toggle--expanded {
  transform: rotate(90deg);
}

.cookie-domain-group__domain {
  font-weight: 600;
  color: var(--text-primary);
}

.cookie-domain-group__clear {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
  padding: 4px 8px;
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  font-size: 11px;
  cursor: pointer;
  opacity: 0;
  transition: all var(--transition-fast);
}

.cookie-domain-group__header:hover .cookie-domain-group__clear {
  opacity: 1;
}

.cookie-domain-group__clear:hover {
  background: var(--error-color);
  color: #ffffff;
}

.cookie-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: var(--space-sm) var(--space-md);
  border-top: 1px solid var(--border-color);
  transition: background var(--transition-fast);
  cursor: pointer;
  min-height: 0;
}

.cookie-row:first-of-type {
  border-top: none;
}

.cookie-row:hover {
  background: var(--bg-elevated);
}

.cookie-row__main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.cookie-row__name {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  flex-wrap: wrap;
}

.cookie-row__value {
  font-size: 11px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
  transition: all var(--transition-base);
}

.cookie-row__value--expanded {
  white-space: pre-wrap;
  word-break: break-all;
  font-size: 11px;
  max-height: 200px;
  overflow-y: auto;
}

.cookie-row__meta {
  display: flex;
  gap: var(--space-xs);
  font-size: 11px;
  color: var(--text-muted);
  align-items: center;
  flex-wrap: wrap;
}

.cookie-row__actions {
  display: flex;
  gap: 4px;
  margin-top: var(--space-xs);
  flex-direction: row-reverse;
}

.cookie-row__actions :deep(.ui-button) {
  padding: 6px;
}

.cookie-row__actions :deep(svg) {
  width: 16px;
  height: 16px;
}

.add-cookie-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
}

.add-cookie-form .form-row {
  display: flex;
  gap: var(--space-md);
}

.add-cookie-form .form-group {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  flex: 1;
}

.add-cookie-form .form-group--sm {
  flex: 0 0 80px;
}

.add-cookie-form .form-group :deep(.ui-label) {
  font-size: 11px;
  font-weight: 500;
  color: var(--text-secondary);
}

.add-cookie-form .checkboxes {
  display: flex;
  gap: var(--space-lg);
  margin-top: var(--space-xs);
}

.add-cookie-form .checkbox-label {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  font-size: 12px;
  color: var(--text-primary);
  cursor: pointer;
}

.add-cookie-form .checkbox-label input[type="checkbox"] {
  width: 14px;
  height: 14px;
  cursor: pointer;
}
</style>
