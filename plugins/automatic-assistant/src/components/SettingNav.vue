<script setup lang="ts">
import { nextTick, reactive, ref, watch } from 'vue'
import type { CategoryDoc } from '../types'
import { INSET_CATEGORIES } from '../insets'
import Icon from './Icon.vue'

const props = defineProps<{
  categories: CategoryDoc[]
  selected: { kind: 'inset' | 'custom'; id: string }
}>()
const emit = defineEmits<{
  (e: 'select', kind: 'inset' | 'custom', id: string): void
  (e: 'add', label: string): void
  (e: 'rename', id: string, label: string): void
  (e: 'remove', id: string): void
}>()

const dialog = reactive({ open: false, mode: 'add' as 'add' | 'rename', label: '' })
const labelInput = ref<HTMLInputElement>()

// 与原版 autoFocus 一致
watch(
  () => dialog.open,
  (open) => {
    if (open) nextTick(() => labelInput.value?.focus())
  }
)

function openAdd() {
  dialog.mode = 'add'
  dialog.label = ''
  dialog.open = true
}

function openRename() {
  const current = props.categories.find((c) => c._id === props.selected.id)
  dialog.mode = 'rename'
  dialog.label = current ? current.label : ''
  dialog.open = true
}

// 与原版一致：输入超 30 字截断
function onLabelInput(value: string) {
  dialog.label = value.length > 30 ? value.substring(0, 30) : value
}

// 与原版一致：只判非空字符串（纯空格可提交）
function confirmDialog() {
  if (!dialog.label) return
  if (dialog.mode === 'add') emit('add', dialog.label)
  else emit('rename', props.selected.id, dialog.label)
  dialog.open = false
}

const isCustomSelected = () => props.selected.kind === 'custom'
</script>

<template>
  <div class="setting-nav">
    <div class="setting-nav-list">
      <ul>
        <li class="nav-header">
          <Icon name="navInset" />
          内置
        </li>
        <div
          v-for="cat in INSET_CATEGORIES"
          :key="cat.id"
          class="nav-item"
          :class="{ selected: selected.kind === 'inset' && selected.id === cat.id }"
          @click="emit('select', 'inset', cat.id)"
        >
          {{ cat.name }}
        </div>
      </ul>
      <ul>
        <li class="nav-header">
          <Icon name="navCustom" />
          自定义
        </li>
        <div
          v-for="cat in categories"
          :key="cat._id"
          class="nav-item"
          :class="{ selected: selected.kind === 'custom' && selected.id === cat._id }"
          @click="emit('select', 'custom', cat._id)"
        >
          {{ cat.label }}
        </div>
      </ul>
    </div>
    <div class="setting-nav-footer">
      <button class="icon-btn small" title="新增分类" @click="openAdd">
        <Icon name="newFolder" />
      </button>
      <button class="icon-btn small" title="修改分类" :disabled="!isCustomSelected()" @click="openRename">
        <Icon name="edit" />
      </button>
      <button class="icon-btn small" title="删除分类" :disabled="!isCustomSelected()" @click="emit('remove', selected.id)">
        <Icon name="deleteForever" />
      </button>
    </div>

    <template v-if="dialog.open">
      <div class="dialog-mask" @click.self="dialog.open = false">
        <div class="name-dialog">
          <div class="name-dialog-title">{{ dialog.mode === 'add' ? '新建分类' : '修改分类' }}</div>
          <div class="text-field name-input">
            <span class="input-root">
              <input
                ref="labelInput"
                type="text"
                placeholder="分类名称"
                :value="dialog.label"
                @input="onLabelInput(($event.target as HTMLInputElement).value)"
                @keyup.enter="confirmDialog"
              />
            </span>
          </div>
          <div class="name-dialog-actions">
            <button class="btn-text" :disabled="!dialog.label" @click="confirmDialog">确定</button>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.setting-nav {
  border-right: 1px solid var(--divider);
  width: 200px;
  height: 100%;
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
}

.setting-nav-list {
  flex: 1;
  min-height: 0;
  overflow: hidden auto;
}

.setting-nav-list ul {
  list-style: none;
}

.nav-header {
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--nav-header-bg);
  height: 48px;
  line-height: 48px;
  padding: 0 16px 0 12px;
  display: flex;
  align-items: center;
  font-size: 14px;
  font-weight: 500;
  color: var(--text-secondary);
}

.nav-header :deep(.icon) {
  font-size: 16px;
  margin-right: 6px;
}

.nav-item {
  display: flex;
  align-items: center;
  height: 44px;
  padding: 6px 12px 6px 32px;
  font-size: 16px;
  line-height: 24px;
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: background-color 150ms cubic-bezier(0.4, 0, 0.2, 1);
}

.nav-item:hover {
  background: var(--hover);
}

.nav-item.selected {
  background: var(--primary-light);
}

.nav-item.selected:hover {
  background: var(--nav-selected-hover);
}

.setting-nav-footer {
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: space-around;
}

.dialog-mask {
  position: fixed;
  inset: 0;
  z-index: 1300;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
}

.name-dialog {
  min-width: 298px;
  background: var(--paper);
  border-radius: 4px;
  box-shadow: 0 11px 15px -7px rgba(0, 0, 0, 0.2), 0 24px 38px 3px rgba(0, 0, 0, 0.14),
    0 9px 46px 8px rgba(0, 0, 0, 0.12);
  padding: 16px 24px;
}

.name-dialog-title {
  font-size: 20px;
  font-weight: 500;
  line-height: 32px;
  letter-spacing: 0.15px;
  padding: 16px 24px;
  margin: -16px -24px 0;
}

.name-input {
  width: 250px;
  padding-top: 0;
  margin-top: 8px;
}

.name-dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}
</style>
