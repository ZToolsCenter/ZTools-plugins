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
    <div class="symbol-name-dialog">
      <div class="symbol-name-header">
        <div class="symbol-name-title">创建为符号</div>
        <div class="symbol-name-desc">把当前选中对象保存为可复用的符号定义，画布原对象保持不变；之后可从插入面板「符号」页反复插入联动实例。</div>
      </div>
      <div class="symbol-name-content">
        <ZInput
          size="small"
          type="text"
          :model-value="value"
          placeholder="请输入符号名称"
          @update:model-value="$emit('update:value', String($event))"
          @keydown.enter="$emit('confirm')"
        />
        <div v-if="error" class="symbol-name-error">{{ error }}</div>
      </div>
      <div class="symbol-name-actions">
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
  error: string
}>()

defineEmits<{
  (event: 'update:show', value: boolean): void
  (event: 'update:value', value: string): void
  (event: 'confirm'): void
}>()
</script>

<style lang="scss" scoped>
.symbol-name-dialog {
  min-width: 320px;
  border: 1px solid var(--control-border);
  border-radius: 6px;
  overflow: hidden;
  background: var(--dialog-bg, #fff);
}
.symbol-name-header {
  padding: 14px 16px;
  border-bottom: 1px solid var(--divider-color, rgba(128, 128, 128, 0.18));
}
.symbol-name-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-color, #333);
  line-height: 1.2;
}
.symbol-name-content {
  padding: 16px;
}
.symbol-name-desc {
  margin-top: 6px;
  font-size: 12px;
  line-height: 1.5;
  color: #777;
}
.symbol-name-error {
  margin-top: 8px;
  color: #c00;
  font-size: 12px;
  line-height: 1.4;
}
.symbol-name-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 14px 16px;
  border-top: 1px solid var(--divider-color, rgba(128, 128, 128, 0.18));
}
:global(.zt-modal:has(.symbol-name-dialog) .zt-modal__body) {
  padding: 0;
  border-radius: 6px;
}
</style>
