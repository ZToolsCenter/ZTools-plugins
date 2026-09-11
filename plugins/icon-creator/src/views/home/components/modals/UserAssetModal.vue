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
    <div class="user-asset-dialog">
      <div class="user-asset-dialog-header">
        <div class="user-asset-dialog-title">{{ mode === 'create' ? '保存素材' : '重命名素材' }}</div>
        <div class="user-asset-dialog-desc">{{ mode === 'create' ? '将当前选中对象保存到本地素材库，重启后仍可继续插入编辑。' : '更新素材名称，不影响已插入画布的对象。' }}</div>
      </div>
      <div class="user-asset-dialog-content">
        <ZInput
          size="small"
          type="text"
          :model-value="name"
          placeholder="请输入素材名称"
          @update:model-value="$emit('update:name', String($event))"
          @keydown.enter="$emit('confirm')"
        />
        <div v-if="error" class="user-asset-dialog-error">{{ error }}</div>
      </div>
      <div class="user-asset-dialog-actions">
        <ZButton size="small" @click="$emit('update:show', false)">取消</ZButton>
        <ZButton size="small" type="primary" @click="$emit('confirm')">确定</ZButton>
      </div>
    </div>
  </ZModal>
</template>

<script setup lang="ts">
import { ZButton, ZInput, ZModal } from 'ztools-ui'
import type { UserAssetDialogState } from '../../types'

defineProps<{
  show: boolean
  mode: UserAssetDialogState['mode']
  name: string
  error: string
}>()

defineEmits<{
  (event: 'update:show', value: boolean): void
  (event: 'update:name', value: string): void
  (event: 'confirm'): void
}>()
</script>

<style lang="scss" scoped>
.user-asset-dialog {
  min-width: 320px;
  border: 1px solid var(--control-border);
  border-radius: 6px;
  overflow: hidden;
  background: var(--dialog-bg, #fff);
}
.user-asset-dialog-header {
  padding: 14px 16px;
  border-bottom: 1px solid var(--divider-color, rgba(128, 128, 128, 0.18));
}
.user-asset-dialog-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-color, #333);
  line-height: 1.2;
}
.user-asset-dialog-content {
  padding: 16px;
}
.user-asset-dialog-desc {
  margin-top: 6px;
  font-size: 12px;
  line-height: 1.5;
  color: #777;
}
.user-asset-dialog-error {
  margin-top: 8px;
  color: #c00;
  font-size: 12px;
  line-height: 1.4;
}
.user-asset-dialog-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 14px 16px;
  border-top: 1px solid var(--divider-color, rgba(128, 128, 128, 0.18));
}
:global(.zt-modal:has(.user-asset-dialog) .zt-modal__body) {
  padding: 0;
  border-radius: 6px;
}
</style>
