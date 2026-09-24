<template>
  <ZModal
    :show="show"
    preset="dialog"
    :show-mask="true"
    :mask-closable="true"
    :close-on-esc="true"
    :auto-focus="true"
    @update:show="$emit('update:show', $event)"
  >
    <div class="export-dialog">
      <div class="export-dialog-header">
        <div class="export-dialog-title">导出图标</div>
        <div class="export-dialog-desc">选择导出格式、SVG 背景、PNG 尺寸、透明背景和文件名前缀。</div>
      </div>
      <div class="export-dialog-content">
        <div v-if="artboards.length > 1" class="export-section">
          <div class="export-section-title">画板选择</div>
          <label class="export-check-option">
            <input type="checkbox" :checked="exportAllArtboards" @change="$emit('update:export-all-artboards', getChecked($event))" />
            <span>导出所有画板（打包为 ZIP）</span>
          </label>
          <div v-if="!exportAllArtboards" class="export-artboard-hint">仅导出当前画板</div>
        </div>
        <div class="export-section">
          <div class="export-section-title">快速预设</div>
          <select class="export-preset-select" :value="selectedPreset" @change="$emit('select-preset', ($event.target as HTMLSelectElement).value)">
            <option value="">自定义配置</option>
            <option value="favicon">Favicon 套装 (16-256px)</option>
            <option value="pwa">PWA Icons (72-512px)</option>
            <option value="android">Android Launcher (48-512px)</option>
            <option value="ios">iOS App Icon (20-1024px)</option>
            <option value="electron">Electron Icon (16-1024px)</option>
          </select>
        </div>
        <div class="export-section">
          <div class="export-section-title">格式</div>
          <label class="export-check-option">
            <input type="checkbox" :checked="dialog.svgEnabled" @change="$emit('set-format-enabled', 'svg', getChecked($event))" />
            <span>SVG</span>
          </label>
          <label v-if="dialog.svgEnabled" class="export-check-option export-bg-option">
            <input type="checkbox" :checked="dialog.svgIncludeBg" @change="$emit('update:svg-include-bg', getChecked($event))" />
            <span>SVG 保留画布背景</span>
          </label>
          <label class="export-check-option">
            <input type="checkbox" :checked="dialog.pngEnabled" @change="$emit('set-format-enabled', 'png', getChecked($event))" />
            <span>PNG</span>
          </label>
        </div>
        <div v-if="dialog.pngEnabled" class="export-section">
          <div class="export-section-title">PNG 尺寸</div>
          <div class="export-size-grid">
            <button
              v-for="size in sizeOptions"
              :key="size"
              type="button"
              class="export-size-btn"
              :class="{ active: selectedPngSizes.includes(size) }"
              @click="$emit('toggle-png-size', size)"
            >{{ size }}</button>
          </div>
          <div class="export-custom-size-row">
            <label>自定义</label>
            <ZInput
              size="small"
              type="text"
              :model-value="dialog.customSizeInput"
              placeholder="例如 1024"
              @update:model-value="$emit('update:custom-size-input', String($event))"
            />
          </div>
          <label class="export-check-option export-transparent-option">
            <input type="checkbox" :checked="dialog.transparentBg" @change="$emit('update:transparent-bg', getChecked($event))" />
            <span>PNG 使用透明背景</span>
          </label>
        </div>
        <div class="export-section">
          <div class="export-section-title">文件名</div>
          <ZInput
            size="small"
            type="text"
            :model-value="dialog.filePrefix"
            placeholder="文件名前缀"
            @update:model-value="$emit('update:file-prefix', String($event))"
          />
        </div>
        <pre v-if="dialog.status" class="export-status">{{ dialog.status }}</pre>
      </div>
      <div class="export-dialog-actions">
        <ZButton size="small" :disabled="dialog.loading" @click="$emit('update:show', false)">关闭</ZButton>
        <ZButton size="small" type="primary" :disabled="dialog.loading || !canExport" @click="$emit('export')">
          {{ dialog.loading ? '导出中...' : '导出' }}
        </ZButton>
      </div>
    </div>
  </ZModal>
</template>

<script setup lang="ts">
import { ZButton, ZInput, ZModal } from 'ztools-ui'
import type { ExportDialogState, ExportFormat, IconCreatorProjectArtboard } from '../../types'

defineProps<{
  show: boolean
  dialog: ExportDialogState
  sizeOptions: number[]
  selectedPngSizes: number[]
  canExport: boolean
  artboards: IconCreatorProjectArtboard[]
  exportAllArtboards: boolean
  selectedPreset: string
}>()

defineEmits<{
  (event: 'update:show', value: boolean): void
  (event: 'set-format-enabled', format: ExportFormat, enabled: boolean): void
  (event: 'update:svg-include-bg', value: boolean): void
  (event: 'toggle-png-size', size: number): void
  (event: 'update:custom-size-input', value: string): void
  (event: 'update:transparent-bg', value: boolean): void
  (event: 'update:file-prefix', value: string): void
  (event: 'update:export-all-artboards', value: boolean): void
  (event: 'select-preset', presetId: string): void
  (event: 'export'): void
}>()

// 从原生 checkbox 事件中提取布尔值，避免模板重复断言事件目标类型。
function getChecked(event: Event) {
  return !!(event.target as HTMLInputElement | null)?.checked
}
</script>

<style lang="scss" scoped>
.export-dialog {
  min-width: 320px;
  width: min(520px, 92vw);
  border: 1px solid var(--control-border);
  border-radius: 6px;
  overflow: hidden;
  background: var(--dialog-bg, #fff);
}
.export-dialog-header {
  padding: 14px 16px;
  border-bottom: 1px solid var(--divider-color, rgba(128, 128, 128, 0.18));
}
.export-dialog-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-color, #333);
  line-height: 1.2;
}
.export-dialog-content {
  padding: 16px;
}
.export-dialog-desc {
  margin-top: 6px;
  font-size: 12px;
  line-height: 1.5;
  color: #777;
}
.export-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  &:not(:last-child) {
    margin-bottom: 16px;
  }
}
.export-section-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-color, #333);
}
.export-check-option {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--text-color, #333);
}
.export-size-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 6px;
}
.export-size-btn {
  border: 1px solid var(--control-border);
  border-radius: 4px;
  padding: 6px 4px;
  background: var(--control-bg);
  color: var(--text-color);
  cursor: pointer;
  &.active {
    color: var(--primary-color);
    border-color: var(--primary-color);
    background: rgba(0, 128, 255, 0.08);
  }
}
.export-custom-size-row {
  display: grid;
  grid-template-columns: 52px 1fr;
  align-items: center;
  gap: 8px;
  label {
    font-size: 12px;
    color: #777;
  }
}
.export-transparent-option,
.export-bg-option {
  margin-top: 2px;
}
.export-artboard-hint {
  font-size: 12px;
  color: #999;
  padding-left: 24px;
}
.export-preset-select {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid var(--control-border);
  border-radius: 4px;
  background: var(--control-bg);
  color: var(--text-color);
  font-size: 13px;
  cursor: pointer;
  &:focus {
    outline: none;
    border-color: var(--primary-color);
  }
}
.export-status {
  margin: 8px 0 0;
  max-height: 160px;
  overflow: auto;
  padding: 8px;
  border-radius: 4px;
  background: var(--control-bg);
  color: var(--text-color);
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
}
.export-dialog-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 14px 16px;
  border-top: 1px solid var(--divider-color, rgba(128, 128, 128, 0.18));
}
:global(.zt-modal:has(.export-dialog) .zt-modal__body) {
  padding: 0;
  border-radius: 6px;
}
</style>
