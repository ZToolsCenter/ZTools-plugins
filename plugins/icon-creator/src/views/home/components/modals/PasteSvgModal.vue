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
    <div class="paste-svg-dialog">
      <div class="paste-svg-header">
        <div class="paste-svg-title">粘贴 SVG / Path</div>
        <div class="paste-svg-desc">支持完整 SVG、单独 &lt;path d=&quot;...&quot;&gt; 或 path d 数据。</div>
      </div>
      <div class="paste-svg-content">
        <textarea
          :value="value"
          class="paste-svg-textarea"
          placeholder="在这里粘贴 SVG 代码或 path d 数据，例如 M12 2L2 22h20z"
          @input="handleInput"
          @keydown.ctrl.enter.prevent="$emit('confirm')"
          @keydown.meta.enter.prevent="$emit('confirm')"
        ></textarea>
        <div v-if="error" class="paste-svg-error">{{ error }}</div>
      </div>
      <div class="paste-svg-actions">
        <button class="tb-btn" type="button" :disabled="loading" @click="$emit('read-clipboard')">读取剪贴板</button>
        <span class="paste-svg-action-spacer"></span>
        <ZButton size="small" :disabled="loading" @click="$emit('update:show', false)">取消</ZButton>
        <ZButton size="small" type="primary" :disabled="loading || !value.trim()" @click="$emit('confirm')">
          {{ loading ? '导入中...' : '导入' }}
        </ZButton>
      </div>
    </div>
  </ZModal>
</template>

<script setup lang="ts">
import { ZButton, ZModal } from 'ztools-ui'

defineProps<{
  show: boolean
  value: string
  error: string
  loading: boolean
}>()

const emit = defineEmits<{
  (event: 'update:show', value: boolean): void
  (event: 'update:value', value: string): void
  (event: 'read-clipboard'): void
  (event: 'confirm'): void
}>()

// 将 textarea 的输入事件收敛成 v-model 所需的字符串，保持父组件继续拥有弹窗状态。
function handleInput(event: Event) {
  emit('update:value', (event.target as HTMLTextAreaElement | null)?.value ?? '')
}
</script>

<style lang="scss" scoped>
.paste-svg-dialog {
  min-width: 320px;
  border: 1px solid var(--control-border);
  border-radius: 6px;
  overflow: hidden;
  background: var(--dialog-bg, #fff);
}
.paste-svg-header {
  padding: 14px 16px;
  border-bottom: 1px solid var(--divider-color, rgba(128, 128, 128, 0.18));
}
.paste-svg-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-color, #333);
  line-height: 1.2;
}
.paste-svg-content {
  padding: 16px;
}
.paste-svg-desc {
  margin-top: 6px;
  font-size: 12px;
  line-height: 1.5;
  color: #777;
}
.paste-svg-textarea {
  width: 100%;
  min-height: 180px;
  resize: vertical;
  border: 1px solid var(--control-border);
  border-radius: 4px;
  padding: 8px;
  background: var(--control-bg);
  color: var(--text-color);
  font-family: ui-monospace, SFMono-Regular, Consolas, 'Liberation Mono', Menlo, monospace;
  font-size: 12px;
  line-height: 1.5;
  outline: none;
  box-sizing: border-box;
  &:focus {
    border-color: var(--primary-color);
  }
}
.paste-svg-error {
  margin-top: 8px;
  color: #c00;
  font-size: 12px;
  line-height: 1.4;
}
.paste-svg-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 14px 16px;
  border-top: 1px solid var(--divider-color, rgba(128, 128, 128, 0.18));
}
.paste-svg-action-spacer {
  flex: 1;
}
.tb-btn {
  padding: 4px 10px;
  border: 1px solid rgba(128, 128, 128, 0.25);
  border-radius: 5px;
  background: #fff;
  cursor: pointer;
  font-size: 12px;
  white-space: nowrap;
  &:hover { background: #e8e8e8; }
  &:disabled { opacity: 0.4; cursor: default; }
}
:global(.zt-modal:has(.paste-svg-dialog) .zt-modal__body) {
  padding: 0;
  border-radius: 6px;
}
</style>
