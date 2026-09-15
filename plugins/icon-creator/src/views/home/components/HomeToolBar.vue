<template>
  <aside class="home-tool-bar" aria-label="编辑工具栏">
    <div class="tool-group" aria-label="历史">
      <ZButton size="small" class="tool-btn" :disabled="!canUndo" title="撤销" aria-label="撤销" @click="$emit('undo')">
        <Icon icon="mdi:undo" />
      </ZButton>
      <ZButton size="small" class="tool-btn" :disabled="!canRedo" title="重做" aria-label="重做" @click="$emit('redo')">
        <Icon icon="mdi:redo" />
      </ZButton>
    </div>

    <div class="tool-group" aria-label="选择">
      <ZButton
        size="small"
        class="tool-btn"
        :class="{ 'is-active': selectionMode === 'shape' }"
        title="选择图形"
        aria-label="选择图形"
        @click="$emit('set-selection-mode', 'shape')"
      >
        <Icon icon="mdi:cursor-default-outline" />
      </ZButton>
      <ZButton
        size="small"
        class="tool-btn"
        :class="{ 'is-active': selectionMode === 'point' }"
        :disabled="!hasEditablePoints"
        title="选择点位"
        aria-label="选择点位"
        @click="$emit('set-selection-mode', 'point')"
      >
        <Icon icon="mdi:circle-outline" />
      </ZButton>
      <ZButton
        size="small"
        class="tool-btn"
        :class="{ 'is-active': selectionMode === 'segment' }"
        :disabled="!hasEditablePoints"
        title="选择线段"
        aria-label="选择线段"
        @click="$emit('set-selection-mode', 'segment')"
      >
        <Icon icon="mdi:minus" />
      </ZButton>
      <ZButton
        size="small"
        class="tool-btn"
        :class="{ 'is-active': penToolActive }"
        title="钢笔描点工具"
        aria-label="钢笔描点工具"
        @click="$emit('toggle-pen-tool')"
      >
        <Icon icon="mdi:vector-polyline" />
      </ZButton>
      <!-- 油漆桶按钮：悬浮弹出上色行为开关（填充/描边），点击按钮仍为工具开关 -->
      <ZPopover
        class="tool-popover paint-popover"
        trigger="hover"
        placement="right-start"
        :to="false"
        show-arrow
        keep-alive-on-hover
      >
        <template #trigger>
          <ZButton
            size="small"
            class="tool-btn"
            :class="{ 'is-active': paintBucketActive }"
            title="油漆桶工具"
            aria-label="油漆桶工具"
            @click="$emit('toggle-paint-bucket')"
          >
            <Icon icon="mdi:format-color-highlight" />
          </ZButton>
        </template>
        <div class="paint-behavior-popover" role="menu" aria-label="油漆桶上色行为">
          <button
            v-for="option in paintBehaviorOptions"
            :key="option.value"
            type="button"
            class="paint-behavior-option"
            :class="{ active: option.value === paintBucketBehavior }"
            role="menuitemradio"
            :aria-checked="option.value === paintBucketBehavior"
            @click.stop="$emit('set-paint-bucket-behavior', option.value)"
          >
            <span class="paint-behavior-option-label">{{ option.label }}</span>
            <span class="paint-behavior-option-hint">{{ option.hint }}</span>
            <Icon v-if="option.value === paintBucketBehavior" class="paint-behavior-option-state" icon="mdi:check" />
          </button>
        </div>
      </ZPopover>
    </div>

    <StylePresetToolbar
      :color-palette-groups="colorPaletteGroups"
      :gradient-presets="gradientPresets"
      :color-palette-columns="colorPaletteColumns"
      @open-style-preset-manager="$emit('open-style-preset-manager', $event)"
      @preview-color="(channel, color) => $emit('preview-color', channel, color)"
      @apply-color="(channel, color) => $emit('apply-color', channel, color)"
      @preview-gradient="$emit('preview-gradient', $event)"
      @apply-gradient="$emit('apply-gradient', $event)"
    />

    <div class="tool-group" aria-label="视图">
      <ZButton
        size="small"
        class="tool-btn"
        :class="{ 'is-active': showArtboardList }"
        title="画板列表"
        aria-label="画板列表"
        @click="$emit('toggle-artboard-list')"
      >
        <Icon icon="mdi:view-dashboard-outline" />
      </ZButton>
      <ZButton
        size="small"
        class="tool-btn"
        :class="{ 'is-active': showRuler }"
        title="标尺"
        aria-label="标尺"
        @click="$emit('toggle-ruler')"
      >
        <Icon icon="mdi:ruler" />
      </ZButton>
      <ZButton
        size="small"
        class="tool-btn"
        :class="{ 'is-active': showPixelGrid }"
        title="像素网格"
        aria-label="像素网格"
        @click="$emit('toggle-pixel-grid')"
      >
        <Icon icon="mdi:grid" />
      </ZButton>
      <ZButton
        size="small"
        class="tool-btn"
        :class="{ 'is-active': snapToPixelGrid }"
        title="吸附到像素网格"
        aria-label="吸附到像素网格"
        @click="$emit('toggle-snap-to-pixel-grid')"
      >
        <Icon icon="mdi:magnet" />
      </ZButton>
      <ZPopover
        class="tool-popover"
        trigger="hover"
        placement="right-start"
        :to="false"
        show-arrow
        keep-alive-on-hover
      >
        <template #trigger>
          <ZButton
            size="small"
            class="tool-btn"
            :class="{ 'is-active': keylineActive }"
            title="Keyline 与安全区参考线（悬浮可切换类型）"
            aria-label="Keyline 与安全区参考线"
            @click="$emit('toggle-keyline-overlay')"
          >
            <Icon icon="mdi:vector-square" />
          </ZButton>
        </template>
        <div class="keyline-popover" role="menu" aria-label="参考线模板">
          <button
            v-for="option in keylineTemplateOptions"
            :key="option.value"
            type="button"
            class="keyline-option"
            :class="{ active: option.value === keylineTemplate }"
            role="menuitemradio"
            :aria-checked="option.value === keylineTemplate"
            @click.stop="$emit('set-keyline-template', option.value)"
          >
            <span class="keyline-option-label">{{ option.label }}</span>
            <Icon v-if="option.value === keylineTemplate" class="keyline-option-state" icon="mdi:check" />
          </button>
        </div>
      </ZPopover>
    </div>

    <div class="tool-group tool-group-bottom" aria-label="工作台控制与帮助">
      <!-- 油漆桶颜料（PS 式前景/背景叠放色块）：上色始终用前景色（上层块），背景色备用（下层块）。
           点击色块弹出应用内颜色选择器（SV 面板 + 色相/透明度条），面板内支持 HEX/RGBA/HSL 格式切换输入 -->
      <div v-if="paintBucketActive" class="paint-swatch-stack" aria-label="油漆桶颜料">
        <ZColorPicker
          class="paint-swatch paint-swatch-background"
          size="small"
          :show-input="false"
          show-alpha
          placement="right-start"
          :model-value="paintBucketBackgroundColor"
          aria-label="油漆桶背景色"
          @update:model-value="$emit('set-paint-bucket-stroke-color', $event)"
        />
        <ZColorPicker
          class="paint-swatch paint-swatch-foreground"
          size="small"
          :show-input="false"
          show-alpha
          placement="right-start"
          :model-value="paintBucketForegroundColor"
          aria-label="油漆桶前景色"
          @update:model-value="$emit('set-paint-bucket-color', $event)"
        />
        <!-- PS 式小图标：左下交换箭头 -->
        <button
          type="button"
          class="paint-swatch-action swap"
          title="交换前景/背景颜料 (X)"
          aria-label="交换前景背景颜料"
          @click="$emit('swap-paint-bucket-colors')"
        >
          <Icon icon="mdi:autorenew" />
        </button>
      </div>
      <ZButton
        size="small"
        class="tool-btn"
        :title="leftPanelCollapsed ? '展开左侧面板' : '收起左侧面板'"
        :aria-label="leftPanelCollapsed ? '展开左侧面板' : '收起左侧面板'"
        @click="$emit('toggle-left-panel')"
      >
        <Icon :icon="leftPanelCollapsed ? 'mdi:chevron-double-right' : 'mdi:chevron-double-left'" />
      </ZButton>
      <ZButton
        size="small"
        class="tool-btn"
        :class="{ 'is-active': shortcutDrawerOpen }"
        title="快捷键设置"
        aria-label="快捷键设置"
        @click="$emit('open-shortcut-drawer')"
      >
        <Icon icon="mdi:keyboard-outline" />
      </ZButton>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { Icon } from '@iconify/vue'
import { ZButton, ZColorPicker, ZPopover } from 'ztools-ui'
import StylePresetToolbar from './StylePresetToolbar.vue'
import type { KeylineTemplate, ColorPaletteGroup, GradientPresetItem, StyleTargetChannel } from '../types'

type KeylineTemplateOption = {
  value: KeylineTemplate
  label: string
}

/** 油漆桶上色行为弹窗选项：决定点击改填充色还是描边色（仅切换行为，不出颜色选择器）。 */
type PaintBehaviorOption = {
  value: 'fill' | 'stroke'
  label: string
  hint: string
}

const paintBehaviorOptions: PaintBehaviorOption[] = [
  { value: 'fill', label: '填充', hint: '点击封闭区域改填充色' },
  { value: 'stroke', label: '描边', hint: '点击对象改描边色' }
]

defineProps<{
  canUndo: boolean
  canRedo: boolean
  selectionMode: 'shape' | 'point' | 'segment'
  hasEditablePoints: boolean
  penToolActive: boolean
  paintBucketActive: boolean
  paintBucketForegroundColor: string
  paintBucketBackgroundColor: string
  paintBucketBehavior: 'fill' | 'stroke'
  showArtboardList: boolean
  showRuler: boolean
  showPixelGrid: boolean
  snapToPixelGrid: boolean
  keylineActive: boolean
  keylineTemplate: KeylineTemplate
  keylineTemplateOptions: KeylineTemplateOption[]
  shortcutDrawerOpen: boolean
  leftPanelCollapsed: boolean
  colorPaletteGroups: ColorPaletteGroup[]
  gradientPresets: GradientPresetItem[]
  colorPaletteColumns: number
}>()

defineEmits<{
  (event: 'undo'): void
  (event: 'redo'): void
  (event: 'set-selection-mode', mode: 'shape' | 'point' | 'segment'): void
  (event: 'toggle-pen-tool'): void
  (event: 'toggle-paint-bucket'): void
  (event: 'set-paint-bucket-color', color: string): void
  (event: 'set-paint-bucket-stroke-color', color: string): void
  (event: 'swap-paint-bucket-colors'): void
  (event: 'toggle-paint-bucket-behavior'): void
  (event: 'set-paint-bucket-behavior', behavior: 'fill' | 'stroke'): void
  (event: 'toggle-artboard-list'): void
  (event: 'toggle-ruler'): void
  (event: 'toggle-pixel-grid'): void
  (event: 'toggle-snap-to-pixel-grid'): void
  (event: 'toggle-keyline-overlay'): void
  (event: 'set-keyline-template', value: KeylineTemplate): void
  (event: 'open-shortcut-drawer'): void
  (event: 'toggle-left-panel'): void
  (event: 'open-style-preset-manager', tab: 'colors' | 'gradients'): void
  (event: 'preview-color', channel: StyleTargetChannel, color: string | null): void
  (event: 'apply-color', channel: StyleTargetChannel, color: string): void
  (event: 'preview-gradient', preset: GradientPresetItem | null): void
  (event: 'apply-gradient', preset: GradientPresetItem): void
}>()
</script>

<style lang="scss" scoped>
@use '../styles/tokens' as *;

.home-tool-bar {
  width: 44px;
  flex: 0 0 44px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 8px 5px;
  background: color-mix(in srgb, $panel-bg, #20242b 4%);
  border-right: $border;
  box-sizing: border-box;
  min-height: 0;
}
.tool-group {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  width: 100%;
  padding-bottom: 8px;
  border-bottom: 1px solid rgba(128, 128, 128, 0.18);
}
.tool-group-bottom {
  margin-top: auto;
  padding-top: 8px;
  padding-bottom: 0;
  border-top: 1px solid rgba(128, 128, 128, 0.18);
  border-bottom: 0;
}

/* 油漆桶颜料：PS 式前景/背景叠放色块 + 左下交换箭头，随工具态出现在工具栏底部。
   前景大块在左上（最上层），背景小块叠在右下、大部分被前景遮挡。
   色块本体是 ZColorPicker 的触发器，点击弹出应用内取色面板（支持 HEX/RGBA/HSL 输入） */
.paint-swatch-stack {
  position: relative;
  width: 100%;
  height: 44px;
  margin-bottom: 2px;
}
.paint-swatch {
  position: absolute;
  padding: 0;

  /* 色块视觉样式；尺寸由各位置类显式指定像素值：
     库内 trigger 是无固定尺寸的 auto flex 容器，百分比宽高会失去解析基准而塌缩为 0 */
  :deep(.zt-color-picker__swatch) {
    padding: 0;
    border: 1px solid rgba(97, 97, 97, 0.7);
    border-radius: 4px;
    background-color: #fff;
    background-image:
      linear-gradient(45deg, rgba(0, 0, 0, 0.07) 25%, transparent 25%, transparent 75%, rgba(0, 0, 0, 0.07) 75%, rgba(0, 0, 0, 0.07)),
      linear-gradient(45deg, rgba(0, 0, 0, 0.07) 25%, transparent 25%, transparent 75%, rgba(0, 0, 0, 0.07) 75%, rgba(0, 0, 0, 0.07));
    background-position: 0 0, 3px 3px;
    background-size: 6px 6px;
    box-sizing: border-box;
    overflow: hidden;
    transition: border-color 0.15s ease, box-shadow 0.15s ease;

    &:hover {
      border-color: color-mix(in srgb, var(--primary-color), transparent 30%);
      box-shadow: 0 0 0 1px color-mix(in srgb, var(--primary-color), transparent 55%);
    }
  }

  :deep(.zt-color-picker__preview) {
    border-radius: 0;
  }
}
/* PS 布局：前景大块左上（最上层），背景小块右下、大部分被前景遮挡 */
.paint-swatch-foreground {
  left: 0;
  top: 0;
  z-index: 3;
  width: 22px;
  height: 22px;

  :deep(.zt-color-picker__trigger),
  :deep(.zt-color-picker__swatch) {
    width: 22px;
    height: 22px;
  }
}
.paint-swatch-background {
  left: 14px;
  top: 14px;
  z-index: 1;
  width: 20px;
  height: 20px;

  :deep(.zt-color-picker__trigger),
  :deep(.zt-color-picker__swatch) {
    width: 20px;
    height: 20px;
  }
}
.paint-swatch-action {
  position: absolute;
  width: 12px;
  height: 12px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 3px;
  background: transparent;
  color: #6b7280;
  cursor: pointer;
  transition: color 0.15s ease, background-color 0.15s ease;

  :deep(svg) {
    width: 10px;
    height: 10px;
  }

  &:hover {
    background: rgba(255, 255, 255, 0.85);
    color: var(--primary-color);
  }

  /* PS 位置：交换箭头左下 */
  &.swap {
    left: 0;
    bottom: 10px;
  }
}
/* 油漆桶 hover 弹窗：上色行为（填充/描边）二选一，仅切换行为 */
.paint-behavior-popover {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.paint-behavior-header {
  padding: 2px 8px 4px;
  font-size: 11px;
  color: #6b7280;
}
.paint-behavior-option {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 8px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: #374151;
  font-size: 12px;
  text-align: left;
  transition: border-color 0.15s ease, background-color 0.15s ease, color 0.15s ease;

  &:hover {
    background: color-mix(in srgb, var(--primary-color), white 92%);
    border-color: color-mix(in srgb, var(--primary-color), transparent 70%);
    color: var(--primary-color);
  }

  &.active {
    background: var(--primary-light-bg);
    border-color: color-mix(in srgb, var(--primary-color), transparent 58%);
    color: var(--primary-color);
    font-weight: 600;
  }
}
.paint-behavior-option-label {
  flex: 0 0 auto;
}
.paint-behavior-option-hint {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 11px;
  opacity: 0.75;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.paint-behavior-option-state {
  flex: 0 0 auto;
  font-size: 14px;
}
.paint-popover {
  :deep(.zt-popover__content) {
    min-width: 200px;
  }
}
.tool-popover {
  width: 100%;
  display: flex;
  justify-content: center;

  :deep(.zt-popover__content) {
    min-width: 168px;
  }

  :deep(.zt-popover__body--card) {
    padding: 6px;
  }
}
.tool-btn {
  width: 32px;
  min-width: 32px;
  height: 32px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid transparent;
  border-radius: 7px;
  background: transparent;
  box-shadow: none;
  color: #4b5563;
  transition: border-color 0.15s ease, box-shadow 0.15s ease, color 0.15s ease, background-color 0.15s ease;

  :deep(svg) {
    width: 17px;
    height: 17px;
  }

  &:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.85);
    border-color: color-mix(in srgb, var(--primary-color), transparent 62%);
    color: #222;
  }

  &:disabled {
    opacity: 0.38;
    cursor: not-allowed;
    box-shadow: none;
  }

  &.is-active {
    background: var(--primary-light-bg);
    border-color: var(--primary-color);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--primary-color), transparent 35%);
    color: var(--primary-color);
  }
}
.keyline-popover {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.keyline-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  padding: 6px 8px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: #374151;
  font-size: 12px;
  text-align: left;
  transition: border-color 0.15s ease, background-color 0.15s ease, color 0.15s ease;

  &:hover {
    background: color-mix(in srgb, var(--primary-color), white 92%);
    border-color: color-mix(in srgb, var(--primary-color), transparent 70%);
    color: var(--primary-color);
  }

  &.active {
    background: var(--primary-light-bg);
    border-color: color-mix(in srgb, var(--primary-color), transparent 58%);
    color: var(--primary-color);
    font-weight: 600;
  }
}
.keyline-option-label {
  min-width: 0;
}
.keyline-option-state {
  flex: 0 0 auto;
  font-size: 14px;
}
</style>
