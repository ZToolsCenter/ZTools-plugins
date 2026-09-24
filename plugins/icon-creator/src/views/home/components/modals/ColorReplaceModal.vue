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
    <div class="color-replace-dialog">
      <div class="color-replace-header">
        <div class="color-replace-title">颜色替换</div>
        <div class="color-replace-subtitle">扫描文档中全部对象的填充 / 描边与渐变色标，一键批量替换目标颜色</div>
      </div>
      <div class="color-replace-content">
        <div v-if="!entries.length" class="color-replace-empty">文档中没有可替换的颜色</div>
        <template v-else>
          <div class="color-replace-label">文档颜色（按使用次数排序）</div>
          <div class="color-replace-list" role="listbox" aria-label="文档颜色列表">
            <button
              v-for="entry in entries"
              :key="entry.key"
              type="button"
              class="color-replace-item"
              :class="{ active: entry.key === selectedKey }"
              role="option"
              :aria-selected="entry.key === selectedKey"
              @click="selectedKey = entry.key"
            >
              <span class="color-swatch" :style="{ background: swatchBackground(entry.display) }"></span>
              <span class="color-hex">{{ entry.display }}</span>
              <span class="color-count">{{ entry.count }} 次</span>
            </button>
          </div>
          <div class="color-replace-target">
            <label class="color-replace-label" for="color-replace-target-input">替换为</label>
            <div class="color-replace-target-row">
              <ZColorPicker
                size="small"
                :show-input="false"
                :model-value="targetPickerValue"
                @change="targetColor = String($event)"
              />
              <ZInput
                id="color-replace-target-input"
                size="small"
                type="text"
                :model-value="targetColor"
                placeholder="#ff0000 或 transparent"
                @update:model-value="targetColor = String($event)"
              />
            </div>
          </div>
        </template>
      </div>
      <div class="color-replace-actions">
        <ZButton size="small" @click="$emit('update:show', false)">取消</ZButton>
        <ZButton size="small" type="primary" :disabled="!canReplace" @click="handleReplace">全部替换</ZButton>
      </div>
    </div>
  </ZModal>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ZButton, ZColorPicker, ZInput, ZModal } from 'ztools-ui'
import { normalizeColorKey, type ScannedColorEntry } from '../../colorReplace'

/**
 * 全局颜色替换弹窗：左侧列出文档中出现过的颜色（纯模块扫描结果），
 * 选中源色后在右侧输入替换色（颜色选择器 + hex 输入），确认后交由运行时
 * 一次性替换（整批一条撤销记录，toast 汇报替换对象数）。
 */
const props = defineProps<{
  show: boolean
  entries: ScannedColorEntry[]
}>()

const emit = defineEmits<{
  (event: 'update:show', value: boolean): void
  /** 确认替换：from 为选中的源色键，to 为归一化后的目标色。 */
  (event: 'replace', from: string, to: string): void
}>()

const selectedKey = ref<string | null>(null)
const targetColor = ref('#000000')

// 每次打开弹窗时重置选区：默认选中使用次数最多的颜色，替换色回退常用黑色。
watch(
  () => props.show,
  (show) => {
    if (!show) return
    selectedKey.value = props.entries[0]?.key ?? null
    targetColor.value = '#000000'
  }
)

// 颜色选择器只接受合法颜色值，输入框内容非法时保持上一次合法值用于展示。
const targetPickerValue = computed(() => normalizeColorKey(targetColor.value) ?? '#000000')
// 目标色与源色归一化比较，同色 / 非法时不允许提交替换。
const targetKey = computed(() => normalizeColorKey(targetColor.value))
const canReplace = computed(() => {
  if (!selectedKey.value || !targetKey.value) return false
  return selectedKey.value !== targetKey.value
})

// 透明色用棋盘格底纹展示，其余颜色直接铺底。
function swatchBackground(display: string) {
  if (display === 'transparent') {
    return 'repeating-conic-gradient(#d1d5db 0% 25%, #ffffff 0% 50%) 50% / 10px 10px'
  }
  return display
}

// 提交替换：from / to 都传归一化键，保证运行时替换与列表展示语义一致，随后关闭弹窗。
function handleReplace() {
  if (!canReplace.value || !selectedKey.value || !targetKey.value) return
  emit('replace', selectedKey.value, targetKey.value)
  emit('update:show', false)
}
</script>

<style lang="scss" scoped>
.color-replace-dialog {
  min-width: 380px;
  max-width: min(460px, calc(100vw - 32px));
  border: 1px solid var(--control-border);
  border-radius: 6px;
  overflow: hidden;
  background: var(--dialog-bg, #fff);
}
.color-replace-header {
  padding: 14px 16px 10px;
  border-bottom: 1px solid var(--divider-color, rgba(128, 128, 128, 0.18));
}
.color-replace-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-color, #333);
  line-height: 1.2;
}
.color-replace-subtitle {
  margin-top: 4px;
  font-size: 12px;
  color: var(--text-secondary, #6b7280);
  line-height: 1.5;
}
.color-replace-content {
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.color-replace-label {
  font-size: 12px;
  color: var(--text-secondary, #6b7280);
}
.color-replace-empty {
  padding: 18px 0;
  text-align: center;
  font-size: 13px;
  color: var(--text-secondary, #6b7280);
}
.color-replace-list {
  max-height: 220px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-right: 2px;
}
.color-replace-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 8px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
  text-align: left;
  transition: background-color 0.15s ease, border-color 0.15s ease;

  &:hover {
    background: var(--hover-bg, rgba(30, 111, 255, 0.06));
  }

  &.active {
    border-color: var(--primary-color, #0284c7);
    background: var(--primary-light-bg, rgba(30, 111, 255, 0.08));
  }
}
.color-swatch {
  flex: 0 0 auto;
  width: 22px;
  height: 22px;
  border-radius: 5px;
  border: 1px solid var(--control-border, rgba(128, 128, 128, 0.35));
  background-color: #fff;
}
.color-hex {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color: var(--text-color, #333);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.color-count {
  flex: 0 0 auto;
  font-size: 12px;
  color: var(--text-secondary, #6b7280);
  font-variant-numeric: tabular-nums;
}
.color-replace-target {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.color-replace-target-row {
  display: flex;
  align-items: center;
  gap: 8px;

  :deep(.zt-color-picker) {
    flex: 0 0 auto;
  }

  :deep(.zt-input) {
    flex: 1;
  }
}
.color-replace-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 16px 14px;
  border-top: 1px solid var(--divider-color, rgba(128, 128, 128, 0.18));
}
:global(.zt-modal:has(.color-replace-dialog) .zt-modal__body) {
  padding: 0;
  border-radius: 6px;
}
</style>
