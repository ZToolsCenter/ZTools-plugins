<script setup>
import { ref, watch } from 'vue'

const props = defineProps({
  show: { type: Boolean, default: false },
  item: { type: Object, default: null }
})

const emit = defineEmits(['confirm', 'cancel'])

const remark = ref('')

// 弹窗打开时重置备注
watch(() => props.show, (val) => {
  if (val) {
    remark.value = ''
  }
})

const handleConfirm = () => {
  emit('confirm', remark.value)
}
</script>

<template>
  <div v-if="show" class="dialog-overlay" @click="emit('cancel')">
    <div class="dialog-content" @click.stop>
      <div class="dialog-header">
        <h3>添加收藏</h3>
        <button class="dialog-close" @click="emit('cancel')">✕</button>
      </div>
      <div class="dialog-body">
        <div class="dialog-preview">
          <div v-if="item?.type === 'text'" class="preview-text">
            {{ item.content.substring(0, 100) }}{{ item.content.length > 100 ? '...' : '' }}
          </div>
          <div v-else-if="item?.type === 'image'" class="preview-image">
            <img :src="item.content" alt="预览图" />
          </div>
        </div>
        <div class="dialog-field">
          <label>备注</label>
          <input
            v-model="remark"
            type="text"
            placeholder="请输入备注(可选)"
            @keyup.enter="handleConfirm"
          />
        </div>
      </div>
      <div class="dialog-footer">
        <button class="btn-cancel" @click="emit('cancel')">取消</button>
        <button class="btn-confirm" @click="handleConfirm">确定</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: var(--overlay-color);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 3000;
}

.dialog-content {
  background: rgba(255, 255, 255, 0.95);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border-radius: 12px;
  width: 90%;
  max-width: 500px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
}

@media (prefers-color-scheme: dark) {
  .dialog-content {
    background: rgba(30, 30, 50, 0.95);
  }
}

.dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-color);
}

.dialog-header h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
}

.dialog-close {
  background: none;
  border: none;
  font-size: 20px;
  color: var(--text-tertiary);
  cursor: pointer;
  padding: 0;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  transition: background 0.2s;
}

.dialog-close:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.dialog-body {
  padding: 20px;
}

.dialog-preview {
  margin-bottom: 16px;
  padding: 12px;
  background: var(--bg-hover-light);
  border-radius: 8px;
  max-height: 200px;
  overflow: auto;
}

.preview-text {
  color: var(--text-secondary);
  font-size: 14px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-all;
}

.preview-image {
  display: flex;
  justify-content: center;
}

.preview-image img {
  max-width: 100%;
  max-height: 180px;
  border-radius: 4px;
}

.dialog-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.dialog-field label {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary);
}

.dialog-field input {
  padding: 10px 12px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  font-size: 14px;
  outline: none;
  transition: border-color 0.2s;
  background: var(--bg-surface);
  color: var(--text-primary);
}

.dialog-field input:focus {
  border-color: var(--primary-color);
}

.dialog-footer {
  display: flex;
  gap: 12px;
  justify-content: flex-end;
  padding: 16px 20px;
  border-top: 1px solid var(--border-color);
}

.dialog-footer button {
  padding: 8px 20px;
  border-radius: 6px;
  font-size: 14px;
  cursor: pointer;
  border: none;
  transition: all 0.2s;
}

.btn-cancel {
  background: var(--bg-hover);
  color: var(--text-secondary);
}

.btn-cancel:hover {
  background: var(--bg-cancel-hover);
}

.btn-confirm {
  background: var(--primary-color);
  color: var(--text-white);
}

.btn-confirm:hover {
  background: var(--primary-hover);
}
</style>
