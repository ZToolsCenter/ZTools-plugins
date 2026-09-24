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
    <div class="artboard-rename-dialog">
      <div class="artboard-rename-header">
        <div class="artboard-rename-title">重命名画板</div>
        <div class="artboard-rename-desc">更新画板名称，不影响画板内容。</div>
      </div>
      <div class="artboard-rename-content">
        <ZInput
          size="small"
          type="text"
          :model-value="value"
          placeholder="请输入画板名称"
          @update:model-value="$emit('update:value', String($event))"
          @keydown.enter="$emit('confirm')"
        />
      </div>
      <div class="artboard-rename-actions">
        <ZButton size="small" @click="$emit('update:show', false)">取消</ZButton>
        <ZButton size="small" type="primary" @click="$emit('confirm')">确定</ZButton>
      </div>
    </div>
  </ZModal>
</template>

<script setup lang="ts">
import { ZButton, ZInput, ZModal } from 'ztools-ui'

defineProps<{
  show: boolean
  value: string
}>()

defineEmits<{
  (event: 'update:show', value: boolean): void
  (event: 'update:value', value: string): void
  (event: 'confirm'): void
}>()
</script>

<style lang="scss" scoped>
.artboard-rename-dialog {
  min-width: 320px;
  border: 1px solid var(--control-border);
  border-radius: 6px;
  overflow: hidden;
  background: var(--dialog-bg, #fff);
}
.artboard-rename-header {
  padding: 14px 16px;
  border-bottom: 1px solid var(--divider-color, rgba(128, 128, 128, 0.18));
}
.artboard-rename-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-color, #333);
  line-height: 1.2;
}
.artboard-rename-content {
  padding: 16px;
}
.artboard-rename-desc {
  margin-top: 6px;
  font-size: 12px;
  line-height: 1.5;
  color: #777;
}
.artboard-rename-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 14px 16px;
  border-top: 1px solid var(--divider-color, rgba(128, 128, 128, 0.18));
}
:global(.zt-modal:has(.artboard-rename-dialog) .zt-modal__body) {
  padding: 0;
  border-radius: 6px;
}
</style>
