<script setup lang="ts">
import { ref } from 'vue'
import { Plus, X } from 'lucide-vue-next'
import type { RequestEntry } from '../utils/curl/types'
import { createEntry } from '../utils/curl/parser'

type EntryType = NonNullable<RequestEntry['valueType']>

const props = defineProps<{
  entries: RequestEntry[]
  keyLabel: string
  valueLabel: string
  showType?: boolean
  allowFileType?: boolean
}>()

const emit = defineEmits<{
  change: []
}>()

const openTypeId = ref('')
const typeMenuStyle = ref<Record<string, string>>({})

const typeOptions: Array<{ value: EntryType; label: string }> = [
  { value: 'string', label: 'string' },
  { value: 'integer', label: 'integer' },
  { value: 'boolean', label: 'boolean' },
  { value: 'number', label: 'number' },
  { value: 'file', label: 'file' },
  { value: 'array', label: 'array' }
]

function visibleTypeOptions() {
  return props.allowFileType ? typeOptions : typeOptions.filter((item) => item.value !== 'file')
}

function addRow() {
  props.entries.push(createEntry())
  emit('change')
}

function removeRow(index: number) {
  props.entries.splice(index, 1)
  emit('change')
}

function toggleTypeMenu(entry: RequestEntry, event: MouseEvent) {
  if (openTypeId.value === entry.id) {
    openTypeId.value = ''
    return
  }
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  typeMenuStyle.value = {
    position: 'fixed',
    top: `${rect.bottom + 5}px`,
    left: `${rect.left}px`,
    width: `${rect.width}px`
  }
  openTypeId.value = entry.id
}

function selectType(entry: RequestEntry, value: EntryType) {
  entry.valueType = value
  openTypeId.value = ''
  if (value === 'file') {
    entry.value = ''
  } else {
    entry.file = undefined
  }
  emit('change')
}

function onFileChange(entry: RequestEntry, event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  entry.file = file
  entry.value = file?.name || ''
  emit('change')
}

function clearFile(entry: RequestEntry) {
  entry.value = ''
  entry.file = undefined
  emit('change')
}
</script>

<template>
  <div class="kv-table" :class="{ 'with-type': showType }">
    <div class="kv-head">
      <span></span>
      <span>{{ keyLabel }}</span>
      <span v-if="showType">类型</span>
      <span>{{ valueLabel }}</span>
      <span></span>
    </div>
    <div v-for="(entry, index) in entries" :key="entry.id" class="kv-row">
      <input v-model="entry.enabled" type="checkbox" @change="emit('change')" />
      <input v-model="entry.key" :placeholder="keyLabel" @input="emit('change')" />
      <div v-if="showType" class="type-select">
        <button class="type-trigger" @click="toggleTypeMenu(entry, $event)">
          <span>{{ entry.valueType || 'string' }}</span>
        </button>
        <Teleport to="body">
          <Transition name="type-pop">
            <div v-if="openTypeId === entry.id" class="type-menu" :style="typeMenuStyle" @mouseleave="openTypeId = ''">
              <button
                v-for="option in visibleTypeOptions()"
                :key="option.value"
                :class="{ active: (entry.valueType || 'string') === option.value }"
                @click="selectType(entry, option.value)"
              >
                {{ option.label }}
              </button>
            </div>
          </Transition>
        </Teleport>
      </div>
      <div v-if="showType && allowFileType && entry.valueType === 'file'" class="file-value-wrap">
        <label class="file-value" :title="entry.value || '上传文件'">
          <span>{{ entry.value || '上传文件' }}</span>
          <input type="file" @change="onFileChange(entry, $event)" />
        </label>
        <button v-if="entry.value" class="file-clear" title="移除附件" @click="clearFile(entry)">
          <X :size="13" :stroke-width="1.9" />
        </button>
      </div>
      <input v-else v-model="entry.value" :placeholder="valueLabel" @input="emit('change')" />
      <button class="icon-button" title="删除" @click="removeRow(index)">
        <X :size="14" :stroke-width="1.8" />
      </button>
    </div>
    <button class="add-row" @click="addRow">
      <Plus :size="14" :stroke-width="1.8" />
      添加
    </button>
  </div>
</template>

<style scoped>
.kv-table {
  display: grid;
  align-content: start;
  gap: 6px;
  height: 100%;
  min-height: 0;
  overflow: auto;
}

.kv-head,
.kv-row {
  display: grid;
  grid-template-columns: 26px minmax(120px, 1fr) minmax(150px, 1fr) 32px;
  gap: 8px;
  align-items: center;
}

.kv-table.with-type .kv-head,
.kv-table.with-type .kv-row {
  grid-template-columns: 26px minmax(110px, 1fr) 112px minmax(140px, 1.2fr) 32px;
}

.kv-head {
  color: #64748b;
  font-size: 12px;
}

.kv-row input[type='checkbox'] {
  width: 15px;
  height: 15px;
  accent-color: #6366f1;
}

.kv-row input:not([type='checkbox']),
.file-value {
  height: 32px;
  min-width: 0;
  box-sizing: border-box;
  padding: 0 9px;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  color: #0f172a;
  background: #fff;
  outline: none;
}

.file-value-wrap {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 28px;
  gap: 6px;
  min-width: 0;
}

.file-value {
  position: relative;
  display: grid;
  align-items: center;
  overflow: hidden;
  color: #4f46e5;
  background: #f8fafc;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}

.file-value:hover {
  background: #f5f3ff;
}

.file-clear {
  display: grid;
  place-items: center;
  width: 28px;
  height: 32px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  color: #94a3b8;
  background: #f8fafc;
  cursor: pointer;
}

.file-clear:hover {
  color: #ef4444;
  background: #fef2f2;
}

.file-value span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-value input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}

.kv-row input:not([type='checkbox']):focus,
.file-value:focus {
  border-color: #a5b4fc;
}

.type-select {
  position: relative;
  min-width: 0;
}

.type-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  height: 32px;
  box-sizing: border-box;
  padding: 0 10px;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  color: #334155;
  background: #fff;
  font-size: 12px;
  font-weight: 700;
  text-align: left;
  cursor: pointer;
  transition:
    border 0.16s ease,
    background 0.16s ease,
    color 0.16s ease;
}

.type-trigger::after {
  width: 6px;
  height: 6px;
  border-right: 1.5px solid currentColor;
  border-bottom: 1.5px solid currentColor;
  content: '';
  transform: rotate(45deg) translateY(-2px);
  opacity: 0.7;
}

.type-trigger:hover {
  border-color: #c7d2fe;
  color: #4f46e5;
  background: #f8fafc;
}

.type-menu {
  z-index: 1000;
  display: grid;
  min-width: 96px;
  padding: 5px;
  border: 1px solid #dbe2ea;
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 12px 28px rgb(15 23 42 / 13%);
  transform-origin: top center;
}

.type-menu button {
  height: 28px;
  padding: 0 8px;
  border: 0;
  border-radius: 6px;
  color: #334155;
  background: transparent;
  font-size: 12px;
  font-weight: 700;
  text-align: left;
  cursor: pointer;
}

.type-menu button:hover,
.type-menu button.active {
  color: #4f46e5;
  background: #f1f5f9;
}

.type-pop-enter-active,
.type-pop-leave-active {
  transition:
    opacity 0.15s ease,
    transform 0.15s ease;
}

.type-pop-enter-from,
.type-pop-leave-to {
  opacity: 0;
  transform: translateY(-5px) scale(0.98);
}

.icon-button,
.add-row {
  display: inline-grid;
  place-items: center;
  height: 30px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  color: #64748b;
  background: #f8fafc;
  cursor: pointer;
}

.icon-button:hover,
.add-row:hover {
  color: #4f46e5;
  background: #f5f3ff;
}

.add-row {
  grid-auto-flow: column;
  gap: 5px;
  justify-self: start;
  padding: 0 10px;
  font-size: 12px;
  font-weight: 700;
}
</style>
