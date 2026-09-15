<template>
  <ZDrawer
    :show="show"
    placement="right"
    width="min(520px, 92vw)"
    :z-index="40"
    :block-scroll="false"
    content-class="shortcut-drawer"
    @update:show="$emit('update:show', $event)"
  >
    <header class="shortcut-drawer-header">
      <div>
        <h2>快捷键</h2>
        <p>查看、搜索、录制并管理编辑器快捷键</p>
      </div>
      <button class="shortcut-close-btn" title="关闭" @click="$emit('close')">×</button>
    </header>
    <div class="shortcut-drawer-tools">
      <ZInput :model-value="search" size="small" type="text" placeholder="搜索动作、说明或快捷键" @update:model-value="$emit('update:search', String($event))" />
      <button class="tb-btn" @click="$emit('reset')">恢复默认</button>
    </div>
    <div class="shortcut-group-list">
      <section v-for="group in groups" :key="group.id" class="shortcut-group">
        <div class="shortcut-group-title">{{ group.label }}</div>
        <div v-for="action in group.actions" :key="action.id" class="shortcut-action-row">
          <div class="shortcut-action-info">
            <div class="shortcut-action-name">{{ action.name }}</div>
            <div class="shortcut-action-desc">{{ action.description }}</div>
          </div>
          <div class="shortcut-binding-list">
            <div
              v-for="(binding, bindingIndex) in bindings[action.id]"
              :key="getShortcutBindingKey(action.id, binding, bindingIndex)"
              class="shortcut-binding-row"
            >
              <ZHotkeyInput
                class="shortcut-hotkey-input"
                :model-value="binding"
                :platform="platform"
                placeholder="录制快捷键"
                @change="$emit('apply-binding', action.id, binding, $event)"
              />
              <button class="shortcut-binding-delete" title="删除" @click="$emit('remove-binding', action.id, binding)">×</button>
              <button
                v-if="bindingIndex === bindings[action.id].length - 1"
                class="shortcut-binding-add"
                title="添加快捷键"
                @click="$emit('add-binding', action.id)"
              >＋</button>
            </div>
            <button
              v-if="!bindings[action.id].length"
              class="shortcut-binding-add shortcut-binding-add--empty"
              title="添加快捷键"
              @click="$emit('add-binding', action.id)"
            >＋</button>
          </div>
        </div>
      </section>
      <div v-if="!groups.length" class="shortcut-empty">未找到匹配的快捷键</div>
    </div>
  </ZDrawer>
</template>

<script setup lang="ts">
import { ZDrawer, ZHotkeyInput, ZInput } from 'ztools-ui'
import type { EditorPlatform, ShortcutActionDefinition, ShortcutActionId, ShortcutGroupDefinition } from '../shortcuts'

type ShortcutDisplayGroup = ShortcutGroupDefinition & {
  actions: ShortcutActionDefinition[]
}

defineProps<{
  show: boolean
  search: string
  groups: ShortcutDisplayGroup[]
  bindings: Record<ShortcutActionId, string[]>
  platform: EditorPlatform
}>()

defineEmits<{
  (event: 'update:show', value: boolean): void
  (event: 'update:search', value: string): void
  (event: 'close'): void
  (event: 'reset'): void
  (event: 'apply-binding', actionId: ShortcutActionId, oldValue: string, nextValue: string): void
  (event: 'add-binding', actionId: ShortcutActionId): void
  (event: 'remove-binding', actionId: ShortcutActionId, binding: string): void
}>()

// 为录制中的空快捷键也生成稳定 key，避免列表重绘时输入框状态错位。
function getShortcutBindingKey(actionId: ShortcutActionId, binding: string, index: number) {
  return `${actionId}-${binding || 'empty'}-${index}`
}
</script>

<style lang="scss" scoped>
@use '../styles/tokens' as *;

:global(.zt-drawer__mask) {
  background: rgba(0, 0, 0, 0.18);
}
:global(.shortcut-drawer) {
  display: flex;
  flex-direction: column;
  background: $panel-bg;
  border-left: $border;
  box-shadow: -16px 0 36px rgba(0, 0, 0, 0.16);
  overflow: hidden;
}
.shortcut-drawer-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 16px;
  border-bottom: $border;
  h2 {
    margin: 0;
    font-size: 18px;
  }
  p {
    margin: 4px 0 0;
    color: #666;
    font-size: 12px;
  }
}
.shortcut-close-btn,
.shortcut-binding-delete {
  border: 1px solid rgba(128, 128, 128, 0.24);
  border-radius: 6px;
  background: #fff;
  color: #666;
  cursor: pointer;
  &:hover { background: #f1f1f1; color: #c00; }
}
.shortcut-close-btn {
  width: 35px;
  height: 35px;
  font-size: 20px;
  line-height: 1;
}
.shortcut-drawer-tools {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 8px;
  padding: 12px 16px;
  border-bottom: $border;
}
.shortcut-group-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px 16px 16px;
}
.shortcut-group {
  margin-bottom: 14px;
}
.shortcut-group-title {
  position: sticky;
  top: -8px;
  z-index: 1;
  padding: 8px 0;
  background: $panel-bg;
  color: #555;
  font-weight: 700;
  font-size: 12px;
}
.shortcut-action-row {
  display: grid;
  grid-template-columns: 220px 1fr;
  gap: 12px;
  padding: 10px 0;
  border-top: 1px solid rgba(128, 128, 128, 0.14);
}
.shortcut-action-name {
  color: #333;
  font-weight: 600;
  font-size: 13px;
}
.shortcut-action-desc {
  margin-top: 3px;
  color: #777;
  font-size: 12px;
  line-height: 1.4;
}
.shortcut-binding-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.shortcut-binding-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 35px 35px;
  gap: 6px;
  align-items: center;
}
.shortcut-hotkey-input {
  min-width: 0;
}
.shortcut-binding-delete,
.shortcut-binding-add {
  width: 35px;
  height: 35px;
  padding: 0;
  box-sizing: border-box;
  border: 2px solid var(--control-border);
  border-radius: 6px;
  background: #fafafa;
  color: #666;
  cursor: pointer;
  line-height: 1;
  transition: border-color 0.15s ease, box-shadow 0.15s ease, background 0.15s ease, color 0.15s ease;

  &:hover {
    background: #fafafa;
    border-color: var(--primary-color);
  }
}
.shortcut-binding-delete {
  font-size: 16px;

  &:hover {
    color: #c00;
  }
}
.shortcut-binding-add {
  font-size: 15px;
  color: var(--primary-color);
}
.shortcut-binding-add--empty {
  align-self: flex-end;
}
.shortcut-empty {
  padding: 32px 0;
  color: #777;
  text-align: center;
}
.tb-btn {
  padding: 4px 10px;
  border: 1px solid rgba(128, 128, 128, 0.25);
  border-radius: 5px;
  background: #fff;
  cursor: pointer;
  font-size: 12px;
  white-space: nowrap;
  &:hover { background: #e8e8e8; }
  &:disabled { opacity: 0.4; cursor: default; }
  &.sm { padding: 3px 7px; font-size: 11px; }
  &.xs { padding: 2px 6px; font-size: 11px; }
  &.active { background: #d0e0ff; border-color: #7ba7e0; }
  &.danger { color: #c00; }
  &.primary { background: #1e6fff; color: #fff; border-color: #1e6fff; }
}
</style>
