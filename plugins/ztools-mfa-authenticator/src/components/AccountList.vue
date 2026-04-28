<template>
  <div class="account-list">
    <!-- Selection toolbar -->
    <div v-if="selectionMode" class="selection-bar">
      <label class="select-all-row">
        <input
          type="checkbox"
          class="checkbox"
          :checked="allSelected"
          :indeterminate="someSelected && !allSelected"
          @change="toggleSelectAll"
        />
        <span>{{ allSelected ? '取消全选' : '全选' }}</span>
      </label>
      <span class="selection-count">已选 {{ selectedIds.size }} 项</span>
      <div class="selection-actions">
        <button
          class="btn btn-sm btn-danger"
          :disabled="selectedIds.size === 0"
          @click="emitDeleteBatch"
        >删除选中</button>
        <button class="btn btn-sm btn-secondary" @click="exitSelection">退出管理</button>
      </div>
    </div>

    <div v-else class="list-header">
      <button
        v-if="accounts.length > 1"
        class="manage-btn"
        @click="selectionMode = true"
      >管理</button>
    </div>

    <TransitionGroup name="list" tag="div" class="list-container">
      <div
        v-for="account in filteredAccounts"
        :key="account.id"
        class="list-row"
        :class="{
          selected: selectedIds.has(account.id),
          dragging: dragId === account.id,
          'drop-target': dropTargetId === account.id && dragId !== account.id,
        }"
        :draggable="!selectionMode"
        @dragstart="onDragStart($event, account.id)"
        @dragover="onDragOver($event, account.id)"
        @dragleave="onDragLeave"
        @drop="onDrop($event, account.id)"
        @dragend="onDragEnd"
      >
        <label v-if="selectionMode" class="row-checkbox" @click.stop>
          <input
            type="checkbox"
            class="checkbox"
            :checked="selectedIds.has(account.id)"
            @change="toggleSelect(account.id)"
          />
        </label>
        <AccountCard
          class="list-row-card"
          :account="account"
          :totp-display="totpState[account.id]"
          @copy="(code) => emit('copy', code)"
          @edit="(acc) => emit('edit', acc)"
          @delete="(acc) => emit('delete', acc)"
          @pin="(acc) => emit('pin', acc.id)"
          @refresh-hotp="(acc) => emit('refreshHotp', acc)"
        />
      </div>
    </TransitionGroup>

    <div v-if="filteredAccounts.length === 0 && searchQuery" class="no-results">
      <span class="no-results-icon">&#128269;</span>
      <p>无匹配结果</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, reactive } from 'vue'
import PinyinMatch from 'pinyin-match'
import type { Account, TotpDisplay } from '@/types'
import AccountCard from './AccountCard.vue'
import { useSearch } from '@/composables/useSearch'
import { expandShuangpin } from '@/utils/shuangpin'

const search = useSearch()

const props = defineProps<{
  accounts: Account[]
  totpState: Record<string, TotpDisplay>
  searchQuery: string
}>()

const emit = defineEmits<{
  copy: [code: string]
  edit: [account: Account]
  delete: [account: Account]
  deleteBatch: [ids: string[]]
  pin: [id: string]
  reorder: [orderedIds: string[]]
  refreshHotp: [account: Account]
}>()

const selectionMode = ref(false)
const selectedIds = reactive(new Set<string>())
const dragId = ref<string | null>(null)
const dropTargetId = ref<string | null>(null)

const filteredAccounts = computed(() => {
  if (!props.searchQuery.trim()) return props.accounts
  const q = props.searchQuery.toLowerCase().trim()
  const expanded = expandShuangpin(q, search.shuangpinScheme.value)
  return props.accounts.filter((a) => {
    if (a.issuer.toLowerCase().includes(q) || a.label.toLowerCase().includes(q)) return true
    if (PinyinMatch.match(a.issuer, q) || PinyinMatch.match(a.label, q)) return true
    if (expanded !== q) {
      if (PinyinMatch.match(a.issuer, expanded) || PinyinMatch.match(a.label, expanded)) return true
    }
    return false
  })
})

const allSelected = computed(() =>
  filteredAccounts.value.length > 0 && filteredAccounts.value.every((a) => selectedIds.has(a.id)),
)

const someSelected = computed(() =>
  filteredAccounts.value.some((a) => selectedIds.has(a.id)),
)

function toggleSelect(id: string) {
  if (selectedIds.has(id)) {
    selectedIds.delete(id)
  } else {
    selectedIds.add(id)
  }
}

function toggleSelectAll() {
  if (allSelected.value) {
    filteredAccounts.value.forEach((a) => selectedIds.delete(a.id))
  } else {
    filteredAccounts.value.forEach((a) => selectedIds.add(a.id))
  }
}

function emitDeleteBatch() {
  emit('deleteBatch', [...selectedIds])
}

function exitSelection() {
  selectionMode.value = false
  selectedIds.clear()
}

function onDragStart(e: DragEvent, id: string) {
  dragId.value = id
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', id)
  }
}

function onDragOver(e: DragEvent, id: string) {
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
  dropTargetId.value = id
}

function onDragLeave() {
  dropTargetId.value = null
}

function onDrop(e: DragEvent, targetId: string) {
  e.preventDefault()
  dropTargetId.value = null

  if (!dragId.value || dragId.value === targetId) {
    dragId.value = null
    return
  }

  const list = filteredAccounts.value.map((a) => a.id)
  const fromIdx = list.indexOf(dragId.value)
  const toIdx = list.indexOf(targetId)
  if (fromIdx === -1 || toIdx === -1) return

  list.splice(fromIdx, 1)
  list.splice(toIdx, 0, dragId.value)

  const fullIds = props.accounts.map((a) => a.id)
  const inFilter = new Set(list)
  const result: string[] = []
  let filterIdx = 0
  for (const id of fullIds) {
    if (inFilter.has(id)) {
      result.push(list[filterIdx++])
    } else {
      result.push(id)
    }
  }

  emit('reorder', result)
  dragId.value = null
}

function onDragEnd() {
  dragId.value = null
  dropTargetId.value = null
}
</script>

<style scoped>
.account-list {
  display: flex;
  flex-direction: column;
}

.list-header {
  display: flex;
  justify-content: flex-end;
  padding: 4px 16px;
  min-height: 32px;
}

.manage-btn {
  background: none;
  border: none;
  color: var(--accent);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: var(--radius);
}
.manage-btn:hover { background: var(--bg-card); }

.selection-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 16px;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border);
}

.select-all-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--text-primary);
  cursor: pointer;
}

.selection-count {
  font-size: 12px;
  color: var(--text-secondary);
  flex: 1;
}

.selection-actions {
  display: flex;
  gap: 6px;
}

.checkbox {
  width: 16px;
  height: 16px;
  accent-color: var(--accent);
  cursor: pointer;
}

.list-container {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 0 16px 16px;
}

.list-row {
  display: flex;
  align-items: center;
  gap: 8px;
  border-radius: var(--radius-lg);
  transition: background 0.15s;
}

.list-row.selected {
  background: var(--bg-card-hover);
}

.list-row.dragging {
  opacity: 0.4;
}

.list-row.drop-target {
  border-top: 2px solid var(--accent);
}

.list-row[draggable="true"] {
  cursor: grab;
}

.list-row[draggable="true"]:active {
  cursor: grabbing;
}

.row-checkbox {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  cursor: pointer;
}

.list-row-card {
  flex: 1;
  min-width: 0;
}

.btn-sm {
  padding: 5px 12px;
  border: none;
  border-radius: var(--radius);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.btn-sm:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-danger { background: var(--danger); color: #fff; }
.btn-danger:hover:not(:disabled) { filter: brightness(0.85); }
.btn-secondary { background: var(--bg-card); color: var(--text-primary); }
.btn-secondary:hover { background: var(--bg-card-hover); }

.no-results {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 16px;
  color: var(--text-secondary);
}

.no-results-icon {
  font-size: 40px;
  margin-bottom: 12px;
}

.no-results p {
  font-size: 15px;
}

.list-enter-active,
.list-leave-active {
  transition: all 0.3s ease;
}

.list-enter-from {
  opacity: 0;
  transform: translateY(-10px);
}

.list-leave-to {
  opacity: 0;
  transform: translateX(20px);
}

.list-move {
  transition: transform 0.3s ease;
}
</style>
