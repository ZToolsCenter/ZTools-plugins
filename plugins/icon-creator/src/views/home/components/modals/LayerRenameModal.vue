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
    <div class="layer-rename-dialog">
      <div class="layer-rename-header">
        <div class="layer-rename-title">重命名图层</div>
      </div>
      <div class="layer-rename-content">
        <ZInput
          size="small"
          type="text"
          :model-value="value"
          placeholder="请输入图层名称"
          @update:model-value="$emit('update:value', String($event))"
          @keydown.enter="$emit('confirm')"
        />
      </div>
      <div class="layer-rename-actions">
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
.layer-rename-dialog {
  min-width: 320px;
  border: 1px solid var(--control-border);
  border-radius: 6px;
  overflow: hidden;
  background: var(--dialog-bg, #fff);
}
.layer-rename-header {
  padding: 14px 16px;
  border-bottom: 1px solid var(--divider-color, rgba(128, 128, 128, 0.18));
}
.layer-rename-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-color, #333);
  line-height: 1.2;
}
.layer-rename-content {
  padding: 16px;
}
.layer-rename-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 14px 16px;
  border-top: 1px solid var(--divider-color, rgba(128, 128, 128, 0.18));
}
:global(.zt-modal:has(.layer-rename-dialog) .zt-modal__body) {
  padding: 0;
  border-radius: 6px;
}
</style>
