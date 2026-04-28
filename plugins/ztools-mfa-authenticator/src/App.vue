<template>
  <div class="app">
    <div v-if="!crypto.isInitialized.value" class="loading">
      <div class="loading-icon">🔐</div>
      <p>加载中...</p>
    </div>

    <div v-else-if="autoUnlocking" class="loading">
      <div class="loading-icon">&#x1F513;</div>
      <p>自动解锁中...</p>
    </div>

    <UnlockScreen
      v-else-if="!crypto.isUnlocked.value"
      :is-first-time="crypto.isFirstTime.value"
      @unlocked="onUnlocked"
    />

    <template v-else>
      <header class="header">
        <h1 class="header-title">MFA Authenticator</h1>
        <div class="header-actions">
          <button
            class="icon-btn icon-btn-secondary"
            :title="themeLabel"
            @click="cycleTheme"
          >{{ themeIcon }}</button>
          <button
            class="icon-btn icon-btn-secondary"
            :title="indicatorLabel"
            @click="cycleIndicator"
          >{{ indicatorIcon }}</button>
          <div class="shuangpin-wrapper">
            <button
              class="icon-btn icon-btn-secondary"
              :class="{ 'icon-btn-active': search.shuangpinScheme.value !== 'off' }"
              :title="shuangpinLabel"
              @click="showShuangpinMenu = !showShuangpinMenu"
            >拼</button>
            <div v-if="showShuangpinMenu" class="shuangpin-menu">
              <button
                v-for="(label, key) in shuangpinOptions"
                :key="key"
                class="shuangpin-item"
                :class="{ active: search.shuangpinScheme.value === key }"
                @click="selectShuangpin(key as any)"
              >{{ label }}</button>
            </div>
          </div>
          <button
            class="icon-btn icon-btn-secondary"
            title="修改主密码"
            @click="showChangePassword = true"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M10.5 1.5a2.5 2.5 0 0 1 1.77 4.27L13 6.5V8h-1.5v1.5H10V11H7.5l-.73-.73A2.5 2.5 0 1 1 10.5 1.5Zm0 1.5a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
          <button
            class="icon-btn icon-btn-secondary"
            title="导入文件"
            @click="showImportFileDialog = true"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M8 1v8m0 0L5 6m3 3 3-3M2 10v2a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
          <button
            v-if="accountStore.accounts.value.length > 0"
            class="icon-btn icon-btn-secondary"
            title="导出账户"
            @click="showExportDialog = true"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M8 9V1m0 0L5 4m3-3 3 3M2 10v2a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
          <button
            v-if="accountStore.accounts.value.length > 0"
            class="icon-btn icon-btn-secondary icon-btn-danger"
            title="清空所有账户"
            @click="handleClearAll"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M2 4h12M5.33 4V2.67a1.33 1.33 0 0 1 1.34-1.34h2.66a1.33 1.33 0 0 1 1.34 1.34V4m2 0v9.33a1.33 1.33 0 0 1-1.34 1.34H4.67a1.33 1.33 0 0 1-1.34-1.34V4h9.34Z" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
          <button class="icon-btn" title="添加账户" @click="showAddDialog = true">+</button>
        </div>
      </header>

      <EmptyState
        v-if="accountStore.accounts.value.length === 0"
        @add="showAddDialog = true"
      />

      <AccountList
        v-else
        :accounts="accountStore.accounts.value"
        :totp-state="totpStateMap"
        :search-query="search.searchQuery.value"
        @copy="handleCopy"
        @edit="handleEdit"
        @delete="handleDelete"
        @delete-batch="handleDeleteBatch"
        @pin="handlePin"
        @reorder="handleReorder"
        @refresh-hotp="handleRefreshHotp"
      />

      <AddAccountDialog
        v-if="showAddDialog"
        @save="handleAdd"
        @save-batch="handleAddBatch"
        @close="showAddDialog = false"
      />

      <EditAccountDialog
        v-if="editingAccount"
        :account="editingAccount"
        @save="handleUpdate"
        @delete="handleDeleteConfirm"
        @close="editingAccount = null"
      />

      <ExportDialog
        v-if="showExportDialog"
        :accounts="accountStore.accounts.value"
        @close="showExportDialog = false"
      />

      <ImportFileDialog
        v-if="showImportFileDialog"
        @save-batch="handleAddBatch"
        @close="showImportFileDialog = false"
      />

      <ConfirmDeleteDialog
        v-if="deleteDialogMode"
        :mode="deleteDialogMode"
        :count="deleteDialogMode === 'all' ? accountStore.accounts.value.length : pendingDeleteIds.length"
        :account-names="deleteAccountNames"
        @confirm="executeDelete"
        @close="deleteDialogMode = null"
      />

      <ChangePasswordDialog
        v-if="showChangePassword"
        @close="showChangePassword = false"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useCrypto } from '@/composables/useCrypto'
import { useAccounts } from '@/composables/useAccounts'
import { useTotp } from '@/composables/useTotp'
import { useSearch } from '@/composables/useSearch'
import { useAutoUnlock } from '@/composables/useAutoUnlock'
import { parseOtpauthUri } from '@/utils/otpauth-uri'
import { schemeLabels, type ShuangpinScheme } from '@/utils/shuangpin'
import type { Account, AccountInput } from '@/types'

import UnlockScreen from '@/components/UnlockScreen.vue'
import EmptyState from '@/components/EmptyState.vue'
import AccountList from '@/components/AccountList.vue'
import AddAccountDialog from '@/components/AddAccountDialog.vue'
import EditAccountDialog from '@/components/EditAccountDialog.vue'
import ExportDialog from '@/components/ExportDialog.vue'
import ImportFileDialog from '@/components/ImportFileDialog.vue'
import ConfirmDeleteDialog from '@/components/ConfirmDeleteDialog.vue'
import ChangePasswordDialog from '@/components/ChangePasswordDialog.vue'
import { useTheme } from '@/composables/useTheme'

const theme = useTheme()
const crypto = useCrypto()
const accountStore = useAccounts()
const totp = useTotp()
const search = useSearch()
const autoUnlock = useAutoUnlock()

const totpStateMap = computed(() => totp.totpState.value)

const autoUnlocking = ref(false)
const showAddDialog = ref(false)
const showExportDialog = ref(false)
const showImportFileDialog = ref(false)
const showChangePassword = ref(false)
const editingAccount = ref<Account | null>(null)
const deleteDialogMode = ref<'batch' | 'all' | null>(null)
const pendingDeleteIds = ref<string[]>([])
let pendingUri: string | null = null

const themeIcon = computed(() => {
  if (theme.mode.value === 'dark') return '🌙'
  if (theme.mode.value === 'light') return '☀️'
  return '💻'
})

const themeLabel = computed(() => {
  if (theme.mode.value === 'dark') return '深色主题 · 点击切换'
  if (theme.mode.value === 'light') return '浅色主题 · 点击切换'
  return '跟随系统 · 点击切换'
})

function cycleTheme() {
  const order = ['dark', 'light', 'system'] as const
  const i = order.indexOf(theme.mode.value)
  theme.setMode(order[(i + 1) % 3])
}

const indicatorIcon = computed(() =>
  theme.indicatorMode.value === 'ring' ? '⭕' : '━',
)

const indicatorLabel = computed(() =>
  theme.indicatorMode.value === 'ring' ? '环形指示器 · 点击切换' : '条形指示器 · 点击切换',
)

function cycleIndicator() {
  theme.setIndicator(theme.indicatorMode.value === 'ring' ? 'bar' : 'ring')
}

const showShuangpinMenu = ref(false)
const shuangpinOptions = schemeLabels

const shuangpinLabel = computed(() => {
  const scheme = search.shuangpinScheme.value
  return scheme === 'off' ? '双拼搜索 · 已关闭' : `双拼搜索 · ${schemeLabels[scheme]}`
})

function selectShuangpin(scheme: ShuangpinScheme) {
  search.setShuangpin(scheme)
  showShuangpinMenu.value = false
}

onMounted(async () => {
  theme.initialize()

  try {
    await crypto.initialize()
  } catch {
    // initialize has internal fallback, this is a safety net
  }

  if (!crypto.isFirstTime.value) {
    const storedPwd = await autoUnlock.tryRestore()
    if (storedPwd) {
      autoUnlocking.value = true
      const ok = await crypto.unlock(storedPwd)
      if (ok) {
        await loadAndStart()
        autoUnlocking.value = false
      } else {
        autoUnlock.clear()
        autoUnlocking.value = false
      }
    }
  }

  search.init()

  window.ztools.onPluginEnter(({ type, payload }) => {
    if (type === 'regex' && payload) {
      if (crypto.isUnlocked.value) {
        openAddFromUri(payload)
      } else {
        pendingUri = payload
      }
    }
    totp.start()
  })

  window.ztools.onPluginOut(() => {
    crypto.lock()
    totp.stop()
  })
})

onUnmounted(() => {
  totp.stop()
})

async function onUnlocked() {
  await loadAndStart()
  if (pendingUri) {
    openAddFromUri(pendingUri)
    pendingUri = null
  }
}

async function loadAndStart() {
  await accountStore.loadAccounts(crypto.decrypt)
  for (const account of accountStore.accounts.value) {
    await totp.registerAccount(account)
  }
  totp.start()
}

function openAddFromUri(uri: string) {
  showAddDialog.value = true
}

async function handleAdd(input: AccountInput) {
  await accountStore.addAccount(input, crypto.encrypt)
  const added = accountStore.accounts.value[accountStore.accounts.value.length - 1]
  await totp.registerAccount(added)
  showAddDialog.value = false
}

async function handleAddBatch(inputs: AccountInput[]) {
  for (const input of inputs) {
    await accountStore.addAccount(input, crypto.encrypt)
    const added = accountStore.accounts.value[accountStore.accounts.value.length - 1]
    await totp.registerAccount(added)
  }
  showAddDialog.value = false
  showImportFileDialog.value = false
  window.ztools.showToast(`成功导入 ${inputs.length} 条账户`)
}

async function handleUpdate(payload: { id: string; changes: Partial<AccountInput> }) {
  const old = accountStore.accounts.value.find((a) => a.id === payload.id)
  if (old) totp.unregisterAccount(old.id)

  await accountStore.updateAccount(payload.id, payload.changes, crypto.encrypt)

  const updated = accountStore.accounts.value.find((a) => a.id === payload.id)
  if (updated) await totp.registerAccount(updated)

  editingAccount.value = null
}

function handleCopy(code: string) {
  window.ztools.copyText(code)
  window.ztools.showToast('已复制到剪贴板')
  setTimeout(() => {
    window.ztools.hideMainWindow()
  }, 600)
}

function handleEdit(account: Account) {
  editingAccount.value = account
}

function handleDelete(account: Account) {
  editingAccount.value = account
}

function handleDeleteConfirm(id: string) {
  totp.unregisterAccount(id)
  accountStore.removeAccount(id)
  editingAccount.value = null
}

function handleDeleteBatch(ids: string[]) {
  pendingDeleteIds.value = ids
  deleteDialogMode.value = 'batch'
}

function handlePin(id: string) {
  accountStore.pinAccount(id)
}

function handleRefreshHotp(account: Account) {
  totp.refreshHotp(account.id, (id, newCounter) => {
    accountStore.updateCounter(id, newCounter)
  })
}

function handleReorder(orderedIds: string[]) {
  accountStore.reorderAccounts(orderedIds)
}

function handleClearAll() {
  deleteDialogMode.value = 'all'
}

const deleteAccountNames = computed(() => {
  if (deleteDialogMode.value === 'all') {
    return accountStore.accounts.value.map((a) => `${a.issuer} — ${a.label}`)
  }
  const set = new Set(pendingDeleteIds.value)
  return accountStore.accounts.value
    .filter((a) => set.has(a.id))
    .map((a) => `${a.issuer} — ${a.label}`)
})

function executeDelete() {
  if (deleteDialogMode.value === 'all') {
    for (const a of accountStore.accounts.value) {
      totp.unregisterAccount(a.id)
    }
    accountStore.removeAll()
    window.ztools.showToast('已清空所有账户')
  } else {
    for (const id of pendingDeleteIds.value) {
      totp.unregisterAccount(id)
    }
    accountStore.removeBatch(pendingDeleteIds.value)
    window.ztools.showToast(`已删除 ${pendingDeleteIds.value.length} 条账户`)
  }
  deleteDialogMode.value = null
  pendingDeleteIds.value = []
}
</script>

<style scoped>
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
}

.header-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
}

.header-actions {
  display: flex;
  gap: 8px;
}

.icon-btn {
  width: 32px;
  height: 32px;
  border: none;
  border-radius: var(--radius);
  background: var(--accent);
  color: var(--bg-primary);
  font-size: 18px;
  font-weight: 700;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.2s;
}

.icon-btn:hover {
  background: var(--accent-hover);
}

.icon-btn-secondary {
  background: var(--bg-card);
  color: var(--text-primary);
  font-size: 14px;
}

.icon-btn-secondary:hover {
  background: var(--bg-card-hover);
}

.icon-btn-active {
  color: var(--accent) !important;
  border: 1px solid var(--accent);
}

.icon-btn-danger:hover {
  color: var(--danger);
}

.shuangpin-wrapper {
  position: relative;
}

.shuangpin-menu {
  position: absolute;
  top: 100%;
  right: 0;
  margin-top: 4px;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  min-width: 110px;
  padding: 4px 0;
  z-index: 200;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}

.shuangpin-item {
  display: block;
  width: 100%;
  text-align: left;
  background: none;
  border: none;
  color: var(--text-primary);
  padding: 7px 14px;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.15s;
}

.shuangpin-item:hover {
  background: var(--bg-card-hover);
}

.shuangpin-item.active {
  color: var(--accent);
  font-weight: 600;
}

.loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  color: var(--text-secondary);
  font-size: 14px;
}

.loading-icon {
  font-size: 48px;
  margin-bottom: 12px;
}
</style>
