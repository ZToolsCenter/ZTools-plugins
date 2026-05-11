<template>
  <div class="ui-table-editor">
    <div class="ui-table-editor__header">
      <div class="ui-table-editor__check-col"></div>
      <div class="ui-table-editor__col ui-table-editor__key-col">{{ keyLabel }}</div>
      <div class="ui-table-editor__col">{{ valueLabel }}</div>
      <div class="ui-table-editor__check-col"></div>
    </div>
    <div class="ui-table-editor__body">
      <div
        v-for="(row, index) in displayRows"
        :key="index"
        class="ui-table-editor__row"
        :class="{ disabled: !row.enabled }"
      >
        <div class="ui-table-editor__check-col">
          <div
            class="ui-table-editor__check"
            :class="{ active: row.enabled }"
            @click="toggleRow(index)"
          >
            <svg v-if="row.enabled" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
          </div>
        </div>
        <div class="ui-table-editor__col ui-table-editor__key-col">
          <UiAutocompleteInput
            class="ui-table-editor__input"
            :model-value="row.key"
            :placeholder="keyPlaceholder"
            :options="normalizedSuggestions"
            @update:model-value="onInput(index, 'key', $event)"
            @focus="onFocus(index)"
          />
        </div>
        <div class="ui-table-editor__col">
          <UiAutocompleteInput
            class="ui-table-editor__input"
            :model-value="row.value"
            :placeholder="valuePlaceholder"
            :options="getValueSuggestionsByRow(index)"
            @update:model-value="onInput(index, 'value', $event)"
          />
        </div>
        <div class="ui-table-editor__check-col">
          <UiButton
            v-if="index < rows.length - 1"
            variant="ghost"
            size="xs"
            icon-only
            @click="removeRow(index)"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </UiButton>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import UiButton from './UiButton.vue'
import UiAutocompleteInput from './UiAutocompleteInput.vue'

interface KVRow {
  key: string
  value: string
  enabled: boolean
}

const props = withDefaults(defineProps<{
  rows: KVRow[]
  keyPlaceholder?: string
  valuePlaceholder?: string
  keyLabel?: string
  valueLabel?: string
  keySuggestions?: string[]
  suggestionScope?: string
  suggestionLimit?: number
  valueSuggestionsMap?: Record<string, string[]>
  valueSuggestionScope?: string
  valueSuggestionLimit?: number
}>(), {
  keyPlaceholder: 'Key',
  valuePlaceholder: 'Value',
  keyLabel: 'Key',
  valueLabel: 'Value',
  keySuggestions: () => [],
  suggestionScope: 'default',
  suggestionLimit: 200,
  valueSuggestionsMap: () => ({}),
  valueSuggestionScope: 'default',
  valueSuggestionLimit: 200
})

const emit = defineEmits<{
  'update:rows': [rows: KVRow[]]
}>()

const normalizedSuggestions = computed(() => {
  const limit = Math.max(1, props.suggestionLimit)
  const unique: string[] = []
  const seen = new Set<string>()
  for (const raw of props.keySuggestions) {
    const value = raw.trim()
    if (!value) {
      continue
    }
    const key = value.toLowerCase()
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    unique.push(value)
    if (unique.length >= limit) {
      break
    }
  }
  return unique
})

const displayRows = computed(() => {
  const rows = [...props.rows]
  const last = rows[rows.length - 1]
  if (!last || last.key || last.value) {
    rows.push({ key: '', value: '', enabled: false })
  }
  return rows
})

function emitRows(rows: KVRow[]) {
  const filtered = rows.filter((r, i) => i < rows.length - 1 || r.key || r.value)
  if (filtered.length === 0) {
    filtered.push({ key: '', value: '', enabled: false })
  }
  emit('update:rows', filtered)
}

function onInput(index: number, field: 'key' | 'value', value: string) {
  const newRows = [...props.rows]
  const nextRow = { ...newRows[index], [field]: value }
  if (!nextRow.enabled && (nextRow.key.trim() || nextRow.value.trim())) {
    nextRow.enabled = true
  }
  newRows[index] = nextRow
  emit('update:rows', newRows)
}

function onFocus(index: number) {
  if (index === props.rows.length - 1) {
    const last = props.rows[index]
    if (last.key || last.value) {
      emit('update:rows', [...props.rows, { key: '', value: '', enabled: false }])
    }
  }
}

function toggleRow(index: number) {
  if (index >= props.rows.length) return
  const newRows = [...props.rows]
  newRows[index] = { ...newRows[index], enabled: !newRows[index].enabled }
  emit('update:rows', newRows)
}

function removeRow(index: number) {
  const newRows = props.rows.filter((_, i) => i !== index)
  if (newRows.length === 0) {
    newRows.push({ key: '', value: '', enabled: false })
  }
  emit('update:rows', newRows)
}

function getValueSuggestionsByRow(index: number): string[] {
  const row = props.rows[index]
  if (!row || !row.key.trim()) {
    return []
  }

  const key = row.key.trim().toLowerCase()
  const candidates = props.valueSuggestionsMap[key] || []
  const limit = Math.max(1, props.valueSuggestionLimit)
  const unique: string[] = []
  const seen = new Set<string>()

  for (const raw of candidates) {
    const value = raw.trim()
    if (!value) {
      continue
    }
    const dedupeKey = value.toLowerCase()
    if (seen.has(dedupeKey)) {
      continue
    }
    seen.add(dedupeKey)
    unique.push(value)
    if (unique.length >= limit) {
      break
    }
  }

  return unique
}
</script>

<style scoped>
.ui-table-editor {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  overflow: hidden;
}

.ui-table-editor__header {
  display: flex;
  align-items: stretch;
  background: var(--bg-surface);
  border-bottom: 1px solid var(--border-color);
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  flex-shrink: 0;
}

.ui-table-editor__header .ui-table-editor__col {
  padding: 6px 12px;
  border-right: 1px solid var(--border-color);
}

.ui-table-editor__header .ui-table-editor__check-col {
  padding: 6px 0;
  border-right: 1px solid var(--border-color);
  width: 36px;
  min-width: 36px;
}

.ui-table-editor__body {
  display: flex;
  flex-direction: column;
  overflow-y: auto;
}

.ui-table-editor__row {
  display: flex;
  align-items: stretch;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-surface);
}

.ui-table-editor__row:last-child {
  border-bottom: none;
}

.ui-table-editor__row:hover {
  background: var(--bg-elevated);
}

.ui-table-editor__row.disabled {
  background: transparent;
}

.ui-table-editor__row.disabled :deep(.ui-autocomplete-input) {
  color: var(--text-muted);
}

.ui-table-editor__col {
  flex: 1;
  min-width: 0;
  padding: 0;
  border-right: 1px solid var(--border-color);
  display: flex;
}

.ui-table-editor__col:last-child {
  border-right: none;
}

.ui-table-editor__key-col {
  flex: 1.2;
}

.ui-table-editor__check-col {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  flex-shrink: 0;
  border-right: 1px solid var(--border-color);
}

.ui-table-editor__check-col:last-child {
  border-right: none;
}

.ui-table-editor__check {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  background: var(--bg-surface);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.ui-table-editor__check:hover {
  border-color: var(--accent-primary);
}

.ui-table-editor__check.active {
  background: var(--accent-primary);
  border-color: var(--accent-primary);
  color: var(--bg-surface);
}

:deep(.ui-autocomplete-input) {
  width: 100%;
  padding: 6px 12px;
  border: none;
  background: transparent;
  color: var(--text-primary);
  font-size: 13px;
  font-family: inherit;
  outline: none;
}

:deep(.ui-autocomplete-input::placeholder) {
  color: var(--text-muted);
  font-family: inherit;
}

:deep(.ui-autocomplete-wrapper.is-disabled .ui-autocomplete-input) {
  cursor: not-allowed;
}
</style>
