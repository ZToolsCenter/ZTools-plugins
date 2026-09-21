<template>
  <div class="tool-group style-preset-group" aria-label="样式预设">
    <!-- 色板预设 -->
    <ZPopover
      class="tool-popover style-preset-popover"
      trigger="hover"
      placement="right-start"
      :to="false"
      show-arrow
      keep-alive-on-hover
    >
      <template #trigger>
        <button
          type="button"
          class="tool-btn"
          title="色板预设（悬浮查看）"
          aria-label="色板预设"
        >
          <Icon icon="mdi:palette-outline" />
        </button>
      </template>
      <div class="style-preset-popover-content" role="menu" aria-label="色板预设">
        <div class="style-preset-header">
          <span class="style-preset-title">色板</span>
          <button class="preset-setting-btn" title="管理色板" @click.stop="$emit('open-style-preset-manager', 'colors')">
            <Icon icon="mdi:cog-outline" />
          </button>
        </div>
        <div class="palette-groups-scroll">
          <section v-for="group in colorPaletteGroups" :key="group.id" class="palette-group-mini">
            <div class="palette-group-name-mini">{{ group.name }}</div>
            <div class="palette-grid-mini" :style="{ '--palette-columns': String(colorPaletteColumns) }">
              <div v-for="swatch in group.colors" :key="swatch.id" class="palette-swatch-pair-mini">
                <button
                  v-for="target in colorSwatchTargets"
                  :key="target.channel"
                  type="button"
                  class="palette-swatch-btn-mini"
                  :class="target.className"
                  :title="getColorSwatchButtonTitle(swatch.name, target.channel)"
                  :style="{ '--swatch-color': swatch.color }"
                  @mouseenter="handleColorHover(target.channel, swatch.color)"
                  @mouseleave="handleColorLeave"
                  @click.stop="handleColorClick(target.channel, swatch.color)"
                >
                  <span>{{ target.label }}</span>
                </button>
              </div>
            </div>
          </section>
        </div>
      </div>
    </ZPopover>

    <!-- 渐变预设 -->
    <ZPopover
      class="tool-popover style-preset-popover"
      trigger="hover"
      placement="right-start"
      :to="false"
      show-arrow
      keep-alive-on-hover
    >
      <template #trigger>
        <button
          type="button"
          class="tool-btn"
          title="渐变预设（悬浮查看）"
          aria-label="渐变预设"
        >
          <Icon icon="mdi:gradient-horizontal" />
        </button>
      </template>
      <div class="style-preset-popover-content" role="menu" aria-label="渐变预设">
        <div class="style-preset-header">
          <span class="style-preset-title">渐变</span>
          <button class="preset-setting-btn" title="管理渐变预设" @click.stop="$emit('open-style-preset-manager', 'gradients')">
            <Icon icon="mdi:cog-outline" />
          </button>
        </div>
        <div class="gradient-presets-scroll">
          <div class="gradient-preset-grid-mini">
            <button
              v-for="preset in gradientPresets"
              :key="preset.id"
              type="button"
              class="gradient-preset-btn-mini"
              :title="getGradientPresetTitle(preset)"
              @mouseenter="handleGradientHover(preset)"
              @mouseleave="handleGradientLeave"
              @click.stop="handleGradientClick(preset)"
            >
              <span class="gradient-preset-preview-mini" :style="getGradientPresetStyle(preset)"></span>
              <span class="gradient-preset-name-mini">{{ preset.name }}</span>
            </button>
          </div>
        </div>
      </div>
    </ZPopover>
  </div>
</template>

<script setup lang="ts">
import { Icon } from '@iconify/vue'
import { ZPopover } from 'ztools-ui'
import type { ColorPaletteGroup, GradientPresetItem, StyleTargetChannel } from '../types'

defineProps<{
  colorPaletteGroups: ColorPaletteGroup[]
  gradientPresets: GradientPresetItem[]
  colorPaletteColumns: number
}>()

const emit = defineEmits<{
  (event: 'open-style-preset-manager', tab: 'colors' | 'gradients'): void
  (event: 'preview-color', channel: StyleTargetChannel, color: string | null): void
  (event: 'apply-color', channel: StyleTargetChannel, color: string): void
  (event: 'preview-gradient', preset: GradientPresetItem | null): void
  (event: 'apply-gradient', preset: GradientPresetItem): void
}>()

const colorSwatchTargets: Array<{ channel: StyleTargetChannel; label: string; className: string }> = [
  { channel: 'fill', label: '填', className: 'fill-target' },
  { channel: 'stroke', label: '描', className: 'stroke-target' }
]

/**
 * 生成色板按钮提示
 */
function getColorSwatchButtonTitle(name: string, channel: StyleTargetChannel): string {
  return `${channel === 'fill' ? '应用到填充' : '应用到描边'}：${name}`
}

/**
 * 生成渐变预设样式
 */
function getGradientPresetStyle(preset: GradientPresetItem): Record<string, string> {
  const stops = [...preset.stops]
    .sort((a, b) => a.offset - b.offset)
    .map((stop) => `${stop.color} ${Math.round(stop.offset * 100)}%`)
    .join(', ')

  if (preset.type === 'radial') {
    const x = Math.round((Number(preset.centerX) || 0.5) * 100)
    const y = Math.round((Number(preset.centerY) || 0.5) * 100)
    return { background: `radial-gradient(circle at ${x}% ${y}%, ${stops})` }
  }

  // 将 Fabric 的 0° 向右角度转换为 CSS linear-gradient 的角度
  const angle = Number(preset.angle) || 0
  const cssAngle = (angle + 90) % 360
  return { background: `linear-gradient(${cssAngle}deg, ${stops})` }
}

/**
 * 生成渐变预设标题
 */
function getGradientPresetTitle(preset: GradientPresetItem): string {
  const typeLabel = preset.type === 'radial' ? '径向渐变' : '线性渐变'
  return `${preset.name} · ${typeLabel}${preset.userCreated ? ' · 我的预设' : ''}`
}

/**
 * 色板悬浮预览
 */
function handleColorHover(channel: StyleTargetChannel, color: string): void {
  emit('preview-color', channel, color)
}

/**
 * 色板离开取消预览
 */
function handleColorLeave(): void {
  emit('preview-color', 'fill', null)
}

/**
 * 色板点击应用
 */
function handleColorClick(channel: StyleTargetChannel, color: string): void {
  emit('apply-color', channel, color)
}

/**
 * 渐变悬浮预览
 */
function handleGradientHover(preset: GradientPresetItem): void {
  emit('preview-gradient', preset)
}

/**
 * 渐变离开取消预览
 */
function handleGradientLeave(): void {
  emit('preview-gradient', null)
}

/**
 * 渐变点击应用
 */
function handleGradientClick(preset: GradientPresetItem): void {
  emit('apply-gradient', preset)
}
</script>

<style lang="scss" scoped>
@use '../styles/tokens' as *;

.style-preset-group {
  // 继承父级的 tool-group 样式
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
  cursor: pointer;
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
}

.style-preset-popover {
  :deep(.zt-popover__content) {
    min-width: 240px;
    max-width: 320px;
  }

  :deep(.zt-popover__body--card) {
    padding: 0;
    // 半透明背景，让预览效果能透过去
    background: rgba(255, 255, 255, 0.75);
    backdrop-filter: blur(16px);
    border: 1px solid rgba(0, 0, 0, 0.08);
  }
}

.style-preset-popover-content {
  display: flex;
  flex-direction: column;
  max-height: 480px;
  overflow: hidden;
}

.style-preset-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.08);
  background: rgba(255, 255, 255, 0.9);
}

.style-preset-title {
  font-size: 13px;
  font-weight: 600;
  color: #1f2937;
}

.preset-setting-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 5px;
  background: transparent;
  color: #6b7280;
  cursor: pointer;
  transition: all 0.15s ease;

  &:hover {
    background: rgba(0, 0, 0, 0.05);
    border-color: rgba(0, 0, 0, 0.1);
    color: var(--primary-color);
  }

  :deep(svg) {
    width: 14px;
    height: 14px;
  }
}

.palette-groups-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 10px 12px;
  min-height: 0;
}

.palette-group-mini {
  margin-bottom: 14px;

  &:last-child {
    margin-bottom: 0;
  }
}

.palette-group-name-mini {
  font-size: 11px;
  font-weight: 600;
  color: #6b7280;
  margin-bottom: 7px;
  padding-left: 2px;
}

.palette-grid-mini {
  display: grid;
  grid-template-columns: repeat(var(--palette-columns, 6), 1fr);
  gap: 6px;
}

.palette-swatch-pair-mini {
  display: grid;
  grid-template-rows: repeat(2, 18px);
  overflow: hidden;
  border: 1px solid rgba(128, 128, 128, 0.18);
  border-radius: 6px;
  background: #fff;
}

.palette-swatch-btn-mini {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  min-width: 0;
  padding: 0;
  border: 0;
  background: var(--swatch-color);
  cursor: pointer;
  transition: all 0.15s ease;

  span {
    color: rgba(255, 255, 255, 0.92);
    font-size: 10px;
    font-weight: 700;
    line-height: 1;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.45);
  }

  &:hover {
    z-index: 1;
    outline: 2px solid var(--primary-color);
    outline-offset: -2px;
  }

  &.stroke-target {
    background:
      linear-gradient(var(--swatch-color), var(--swatch-color)) center / 70% 3px no-repeat,
      #fff;

    span {
      color: #333;
      text-shadow: 0 1px 1px rgba(255, 255, 255, 0.75);
    }
  }
}

.gradient-presets-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 10px 12px;
  min-height: 0;
}

.gradient-preset-grid-mini {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
}

.gradient-preset-btn-mini {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr);
  align-items: center;
  gap: 6px;
  min-width: 0;
  padding: 4px;
  border: 1px solid rgba(128, 128, 128, 0.18);
  border-radius: 7px;
  background: #fafafa;
  cursor: pointer;
  transition: border-color 0.15s, transform 0.15s;

  &:hover {
    border-color: var(--primary-color);
    transform: translateY(-1px);
  }
}

.gradient-preset-preview-mini {
  width: 32px;
  height: 24px;
  border-radius: 5px;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.12);
}

.gradient-preset-name-mini {
  overflow: hidden;
  color: #444;
  font-size: 11px;
  line-height: 1.3;
  text-align: left;
  white-space: nowrap;
  text-overflow: ellipsis;
}
</style>
