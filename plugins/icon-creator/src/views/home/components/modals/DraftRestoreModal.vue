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
    <div class="draft-restore-dialog">
      <div class="draft-restore-header">
        <div class="draft-restore-title">恢复自动草稿</div>
      </div>
      <div class="draft-restore-content">
        <div class="draft-restore-message">
          <Icon icon="mdi:history" class="draft-restore-icon" />
          <span>{{ message }}</span>
        </div>
      </div>
      <div class="draft-restore-actions">
        <ZButton size="small" @click="$emit('update:show', false)">不恢复</ZButton>
        <ZButton size="small" type="primary" @click="$emit('confirm')">恢复</ZButton>
      </div>
    </div>
  </ZModal>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Icon } from '@iconify/vue'
import { ZButton, ZModal } from 'ztools-ui'

const props = defineProps<{
  show: boolean
  /** 草稿内的项目标签数，用于在文案中体现恢复范围 */
  tabCount: number
}>()

defineEmits<{
  (event: 'update:show', value: boolean): void
  (event: 'confirm'): void
}>()

// 多标签草稿提示会恢复全部标签与激活态；单标签草稿保持简洁文案。
const message = computed(() => props.tabCount > 1
  ? `检测到上次未保存的自动草稿，包含 ${props.tabCount} 个项目标签，是否全部恢复？`
  : '检测到上次未保存的自动草稿，是否恢复？')
</script>

<style lang="scss" scoped>
.draft-restore-dialog {
  min-width: 320px;
  border: 1px solid var(--control-border);
  border-radius: 6px;
  overflow: hidden;
  background: var(--dialog-bg, #fff);
}
.draft-restore-header {
  padding: 14px 16px;
  border-bottom: 1px solid var(--divider-color, rgba(128, 128, 128, 0.18));
}
.draft-restore-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-color, #333);
  line-height: 1.2;
}
.draft-restore-content {
  padding: 16px;
}
.draft-restore-message {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 13px;
  color: var(--text-color, #333);
  line-height: 1.6;
}
.draft-restore-icon {
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  margin-top: 2px;
  color: var(--primary-color, #2080f0);
}
.draft-restore-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 14px 16px;
  border-top: 1px solid var(--divider-color, rgba(128, 128, 128, 0.18));
}
:global(.zt-modal:has(.draft-restore-dialog) .zt-modal__body) {
  padding: 0;
  border-radius: 6px;
}
</style>
