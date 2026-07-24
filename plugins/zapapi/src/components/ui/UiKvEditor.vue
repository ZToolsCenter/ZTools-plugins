<template>
  <div class="ui-kv-editor">
    <div class="ui-kv-editor__header">
      <slot name="header" />
      <UiButton variant="ghost" size="xs" @click="addRow">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
        {{ addLabel }}
      </UiButton>
    </div>
    <div class="ui-kv-editor__rows">
      <div v-for="(row, index) in rows" :key="index" class="ui-kv-editor__row">
        <div class="ui-kv-editor__toggle" :class="{ active: row.enabled }" @click="row.enabled = !row.enabled">
          <UiTooltip :content="row.enabled ? t('common.enabled') : t('common.disabled')" placement="top">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
          </UiTooltip>
        </div>
        <UiInput v-model="row.key" :placeholder="keyPlaceholder" class="ui-kv-editor__key" />
        <UiInput v-model="row.value" :placeholder="valuePlaceholder" class="ui-kv-editor__value" />
        <UiTooltip :content="t('kv.delete')" placement="top">
          <UiButton variant="danger" size="xs" icon-only @click="removeRow(index)">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </UiButton>
        </UiTooltip>
      </div>
      <div v-if="rows.length === 0" class="ui-kv-editor__empty">
        {{ t('kv.noData') }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import UiButton from './UiButton.vue'
import UiInput from './UiInput.vue'
import UiTooltip from './UiTooltip.vue'

const { t } = useI18n()

interface KVRow {
  key: string
  value: string
  enabled: boolean
}

const props = withDefaults(defineProps<{
  rows: KVRow[]
  keyPlaceholder?: string
  valuePlaceholder?: string
  addLabel?: string
}>(), {
  keyPlaceholder: 'Key',
  valuePlaceholder: 'Value',
  addLabel: ''
})

const addLabel = computed(() => props.addLabel || t('kv.add'))

const emit = defineEmits<{
  'update:rows': [rows: KVRow[]]
}>()

function addRow() {
  emit('update:rows', [...props.rows, { key: '', value: '', enabled: true }])
}

function removeRow(index: number) {
  const newRows = [...props.rows]
  newRows.splice(index, 1)
  emit('update:rows', newRows)
}
</script>

<style scoped>
.ui-kv-editor {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}

.ui-kv-editor__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.ui-kv-editor__rows {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.ui-kv-editor__row {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: 4px 6px;
  border-radius: var(--radius-sm);
  transition: background var(--transition-fast);
}

.ui-kv-editor__row:hover {
  background: var(--bg-surface);
}

.ui-kv-editor__toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  color: var(--text-muted);
  transition: all var(--transition-base);
  flex-shrink: 0;
  border: 1px solid transparent;
}

.ui-kv-editor__toggle:hover {
  background: var(--bg-elevated);
  border-color: var(--border-color);
}

.ui-kv-editor__toggle.active {
  color: var(--success-color);
  background: var(--bg-elevated);
  border-color: var(--border-color);
}

.ui-kv-editor__key {
  flex: 1;
  min-width: 0;
}

.ui-kv-editor__value {
  flex: 1.5;
  min-width: 0;
}

.ui-kv-editor__empty {
  padding: 20px;
  text-align: center;
  color: var(--text-muted);
  font-size: 13px;
}
</style>
