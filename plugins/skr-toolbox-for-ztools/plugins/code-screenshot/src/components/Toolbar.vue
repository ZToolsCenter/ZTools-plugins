<script setup lang="ts">
/**
 * 工具栏组件
 * 提供主题选择、背景开关、暗色模式、边距调整、语言选择和清空功能
 */
import { computed } from 'vue'
import { state, BG_GRADIENTS, SUPPORTED_LANGUAGES, loadCode } from '@/store'
import { useToast } from '@/libs/toast'
import CsSelect from '@/libs/components/CsSelect.vue'
import CsSwitch from '@/libs/components/CsSwitch.vue'
import CsButton from '@/libs/components/CsButton.vue'
import { Trash2, Clipboard } from 'lucide-vue-next'

// 将背景渐变转换为选择器选项格式
const themeOptions = computed(() =>
  BG_GRADIENTS.map(g => ({ ...g, label: g.name }))
)

// 提示消息钩子
const toast = useToast()

/**
 * 设置代码窗口边距
 * @param p - 边距值（像素）
 */
const setPadding = (p: number) => {
  state.padding = p
}

/**
 * 清空代码内容
 * 重置代码为空字符串，语言设为自动检测
 */
const clearCode = () => {
  // 清除代码
  state.code = ''
  // 修改语言为自动检测
  state.language = 'auto'
  toast.success('已清空内容')
}
</script>

<template>
  <div class="toolbar-wrapper">
    <!-- Main Toolbar -->
    <div class="toolbar" ref="toolbarRef">

      <!-- Theme / Gradient Selection using CsSelect -->
      <div class="toolbar-section">
        <span class="toolbar-label">主题</span>
        <CsSelect v-model="state.backgroundId" :options="themeOptions" class="theme-select">
          <!-- Custom Trigger Slot -->
          <template #trigger="{ selected }">
            <div class="theme-trigger-content" v-if="selected">
              <span class="gradient-preview" :style="{ background: selected.colors }"></span>
              <span class="theme-name-compact">{{ selected.name }}</span>
            </div>
          </template>

          <!-- Custom Option Slot -->
          <template #option="{ option }">
            <div class="theme-option-content">
              <span class="gradient-preview swatch" :style="{ background: option.colors }"></span>
              <span class="gradient-name">{{ option.name }}</span>
            </div>
          </template>
        </CsSelect>
      </div>

      <!-- Divider -->
      <div class="toolbar-divider"></div>

      <!-- Background Toggle -->
      <div class="toolbar-section">
        <span class="toolbar-label">背景</span>
        <CsSwitch v-model="state.showBackground" />
      </div>

      <!-- Divider -->
      <div class="toolbar-divider"></div>

      <!-- Dark Mode Toggle -->
      <div class="toolbar-section">
        <span class="toolbar-label">暗色</span>
        <CsSwitch v-model="state.darkMode" />
      </div>

      <!-- Divider -->
      <div class="toolbar-divider"></div>

      <!-- Padding Selection -->
      <div class="toolbar-section">
        <span class="toolbar-label">边距</span>
        <div class="padding-group">
          <button v-for="p in [16, 32, 64, 128]" :key="p" class="padding-btn" :class="{ active: state.padding === p }"
            @click="setPadding(p)">
            {{ p }}
          </button>
        </div>
      </div>

      <!-- Divider -->
      <div class="toolbar-divider"></div>

      <!-- Language Selection -->
      <div class="toolbar-section">
        <span class="toolbar-label">语言</span>
        <CsSelect v-model="state.language" :options="SUPPORTED_LANGUAGES" placeholder="语言" />
      </div>

      <!-- Divider -->
      <div class="toolbar-divider"></div>

      <!-- Clear Action -->
      <div class="toolbar-section">
        <span class="toolbar-label">清空</span>
        <CsButton variant="ghost" size="sm" :icon-only="true" @click="clearCode" title="清空内容">
          <Trash2 :size="15" />
        </CsButton>
      </div>

    </div>
  </div>
</template>

<style lang="scss" scoped>
@use '@/styles/variables' as *;

.toolbar-wrapper {
  display: flex;
  flex-direction: column;
  align-items: center;
  position: fixed;
  bottom: 32px;
  left: 0;
  width: 100%;
  pointer-events: none;
  z-index: 310;
}

.toolbar {
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: 0;
  background: var(--color-toolbar-bg);
  backdrop-filter: blur(24px) saturate(180%);
  border: 1px solid var(--color-toolbar-border);
  padding: 10px 16px;
  border-radius: 16px;
  color: var(--color-text);
  box-shadow:
    0 20px 60px rgba(0, 0, 0, 0.4),
    0 0 0 1px rgba(255, 255, 255, 0.04) inset;
}

.toolbar-divider {
  width: 1px;
  height: 28px;
  background: var(--color-section-divider);
  margin: 0 14px;
  flex-shrink: 0;
}

.toolbar-section {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
}

.toolbar-label {
  font-size: 10px;
  color: var(--color-text-muted-darker);
  font-weight: 600;
  letter-spacing: 0.6px;
  text-transform: uppercase;
  line-height: 1;
  user-select: none;
}

/* Theme Select specific styles */
.theme-select {
  min-width: 110px;
}

.theme-trigger-content {
  display: flex;
  align-items: center;
  gap: 8px;
  overflow: hidden;
}

.theme-name-compact {
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 60px;
}

.theme-option-content {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
}

.gradient-preview {
  width: 18px;
  height: 18px;
  border-radius: 4px;
  display: inline-block;
  flex-shrink: 0;
  box-shadow: 0 0 0 1.5px rgba(255, 255, 255, 0.1) inset, 0 2px 4px rgba(0, 0, 0, 0.2);

  &.swatch {
    width: 16px;
    height: 16px;
  }
}

.gradient-name {
  font-size: 13px;
  white-space: nowrap;
}

/* Padding Selector */
.padding-group {
  display: flex;
  gap: 2px;
  background: var(--color-padding-group-bg);
  border: 1px solid var(--color-padding-group-border);
  border-radius: var(--radius-lg);
  padding: 2px;
}

.padding-btn {
  background: transparent;
  border: none;
  color: var(--color-padding-btn-text);
  font-size: 11px;
  font-weight: 600;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all var(--transition-base);
  height: 24px;
  min-width: 30px;

  &:hover:not(.active) {
    background: rgba(255, 255, 255, 0.05);
    color: var(--color-text);
    transform: translateY(-1px);
  }

  &.active {
    background: var(--color-padding-btn-active);
    color: var(--color-padding-btn-active-text);
    box-shadow: var(--shadow-sm);
  }

  :global(.light-theme) & {
    &:hover:not(.active) {
      background: rgba(0, 0, 0, 0.04);
      color: #000;
    }
  }
}
</style>
