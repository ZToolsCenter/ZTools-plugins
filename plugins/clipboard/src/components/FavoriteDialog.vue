<script setup>
import { ref, watch, nextTick, onUnmounted } from 'vue'

const props = defineProps({
  show: { type: Boolean, default: false },
  item: { type: Object, default: null }
})

const emit = defineEmits(['confirm', 'cancel'])

const remark = ref('')
const dialogContentRef = ref(null)
const remarkInputRef = ref(null)
let focusableEls = []

const updateFocusableEls = () => {
  const el = dialogContentRef.value
  if (!el) return
  focusableEls = Array.from(el.querySelectorAll(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  ))
}

const trapFocus = (e) => {
  if (focusableEls.length === 0) return
  const first = focusableEls[0]
  const last = focusableEls[focusableEls.length - 1]
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault()
    last.focus()
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault()
    first.focus()
  }
}

const handleKeydown = (e) => {
  if (e.key === 'Tab') {
    trapFocus(e)
    return
  }
  if (e.key === 'Enter') {
    // 如果用户通过 Tab 聚焦到了某个按钮，让按钮原生 Enter 行为触发点击
    if (document.activeElement?.tagName === 'BUTTON') {
      return
    }
    // 如果聚焦在输入框且已有 @keyup.enter，这里 let it pass through
    // 否则直接提交
    if (document.activeElement?.tagName !== 'INPUT') {
      e.preventDefault()
      emit('confirm', remark.value)
    }
  } else if (e.key === 'Escape') {
    emit('cancel')
  }
}

// 弹窗打开时重置备注
watch(() => props.show, (val) => {
  if (val) {
    remark.value = ''
    window.addEventListener('keydown', handleKeydown)
    nextTick(() => {
      updateFocusableEls()
      remarkInputRef.value?.focus()
    })
  } else {
    window.removeEventListener('keydown', handleKeydown)
    focusableEls = []
  }
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown)
})

const handleConfirm = () => {
  emit('confirm', remark.value)
}
</script>

<template>
  <div v-if="show" class="dialog-overlay" @click="emit('cancel')">
    <div ref="dialogContentRef" class="dialog-content" @click.stop>
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
            ref="remarkInputRef"
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
