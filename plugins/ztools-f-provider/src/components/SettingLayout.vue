<script setup lang="ts">
import type { Component } from 'vue'

export interface NavItem {
  /** 唯一 key，作为 v-model 值 */
  key: string
  /** 显示名称 */
  label: string
  /** 图标（emoji / 文字符号，避免引入图标库） */
  icon?: string
  /** 该项对应的页面组件 */
  component?: Component
  /** 是否禁用 */
  disabled?: boolean
  /** 右侧附加文案（如版本号、状态） */
  extra?: string
}

withDefaults(
  defineProps<{
    /** 当前选中项 key */
    modelValue: string
    /** 导航项列表 */
    items: NavItem[]
    /** 标题 */
    title?: string
    /** 是否展示版本号 */
    version?: string | null
  }>(),
  {
    title: '',
    version: null
  }
)

const emit = defineEmits<{ (e: 'update:modelValue', key: string): void }>()

function select(item: NavItem) {
  if (item.disabled) return
  emit('update:modelValue', item.key)
}
</script>

<template>
  <div class="setting-layout">
    <!-- 左侧侧边栏（导航菜单） -->
    <aside class="sidebar">
      <nav class="sidebar-nav">
        <button
          v-for="item in items"
          :key="item.key"
          type="button"
          class="nav-item"
          :class="{
            active: modelValue === item.key,
            disabled: item.disabled
          }"
          :disabled="item.disabled"
          @click="select(item)"
        >
          <span v-html="item.icon" class="nav-icon"></span>
          <span class="nav-label">{{ item.label }}</span>
          <span v-if="item.extra" class="nav-extra">{{ item.extra }}</span>
        </button>
      </nav>
    </aside>

    <!-- 右侧内容区 -->
    <main class="content">
      <slot />
    </main>
  </div>
</template>

<style scoped>
.setting-layout {
  display: flex;
  width: 100%;
  height: 100vh;
  box-sizing: border-box;
  overflow: hidden;
}

/* ── 侧边栏 ── */
.sidebar {
  width: 200px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--border-color, #e5e6eb);
  background: var(--sidebar-bg, transparent);
  box-sizing: border-box;
  padding: 16px 0;
}

.sidebar-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 18px 16px;
  border-bottom: 1px solid var(--border-color, #e5e6eb);
  margin-bottom: 8px;
}

.sidebar-logo {
  width: 24px;
  height: 24px;
  border-radius: 6px;
  object-fit: cover;
  flex-shrink: 0;
}

.sidebar-title {
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sidebar-version {
  margin-left: auto;
  font-size: 11px;
  color: var(--text-secondary, #999);
  flex-shrink: 0;
}

.sidebar-nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px 10px;
  overflow-y: auto;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  text-align: left;
  padding: 9px 12px;
  border: none;
  background: transparent;
  color: inherit;
  font-size: 13px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
  font-family: inherit;
}

.nav-item:hover:not(.disabled):not(.active) {
  background: var(--hover-bg, rgba(0, 0, 0, 0.05));
}

.nav-item.active {
  background: var(--primary-color, #1976d2);
  color: #fff;
}

.nav-item.disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.nav-icon {
  width: 18px;
  text-align: center;
  font-size: 14px;
  flex-shrink: 0;
  display: flex;
  justify-content: center;
  align-items: center;
}

:deep(.nav-icon svg) {
  width: 18px;
  height: 18px;
}

.nav-label {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.nav-extra {
  font-size: 11px;
  opacity: 0.7;
  flex-shrink: 0;
}

/* ── 内容区 ── */
.content {
  flex: 1;
  overflow-y: auto;
  box-sizing: border-box;
}
</style>
