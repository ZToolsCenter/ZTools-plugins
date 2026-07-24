<script setup lang="ts">
import { ref, watch } from 'vue'

const props = defineProps<{
  show: boolean
  dataInput: string
  passwordInput: string
  dataError: string
  passwordError: string
}>()

const emits = defineEmits(['update:show', 'update:dataInput', 'update:passwordInput', 'verify', 'cancel'])

const dataInputRef = ref<HTMLTextAreaElement | null>(null)
const passwordInputRef = ref<HTMLInputElement | null>(null)
const showPassword = ref(false)

watch(() => props.show, (newVal) => {
  if (newVal) {
    showPassword.value = false
    setTimeout(() => dataInputRef.value?.focus(), 100)
  }
})

const handleSubmit = () => {
  emits('verify')
}

const handleCancel = () => {
  emits('cancel')
}

const handleKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Enter' && e.ctrlKey) {
    handleSubmit()
  } else if (e.key === 'Escape') {
    handleCancel()
  }
}

const togglePasswordVisibility = () => {
  showPassword.value = !showPassword.value
}
</script>

<template>
  <transition name="modal-fade">
    <div class="modal-overlay" v-if="show" @click.self="handleCancel">
      <div class="modal-content modal-import">
        <h3 class="modal-title">导入数据</h3>
        
        <div class="form-item full-width">
          <label>
            <span>数据</span>
            <span v-if="dataError" class="label-error">{{ dataError }}</span>
          </label>
          <textarea 
            ref="dataInputRef"
            :value="dataInput"
            @input="emits('update:dataInput', ($event.target as HTMLTextAreaElement).value)"
            @keydown="handleKeydown"
            placeholder="粘贴导出的Base64编码数据 (导入成功自动覆盖当前数据)"
            class="data-textarea"
            spellcheck="false"
          />
        </div>

        <div class="form-item full-width">
          <label>
            <span>主密码</span>
            <span v-if="passwordError" class="label-error">{{ passwordError }}</span>
          </label>
          <div class="form-input-container">
            <input 
              ref="passwordInputRef"
              :type="showPassword ? 'text' : 'password'" 
              :value="passwordInput"
              @input="emits('update:passwordInput', ($event.target as HTMLInputElement).value)"
              @keydown="handleKeydown"
              placeholder="输入主密码 (导入成功后自动设定为新的主密码)"
              spellcheck="false"
            />
            <div class="eye-btn" @click="togglePasswordVisibility">
              <svg v-if="showPassword" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
              <svg v-else width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>
            </div>
          </div>
        </div>

        <div class="modal-actions">
          <button class="btn btn-secondary" @click="handleCancel">取消</button>
          <button class="btn btn-primary" @click="handleSubmit">导入</button>
        </div>
      </div>
    </div>
  </transition>
</template>

<style scoped>
.modal-import {
  width: 420px;
  max-width: 90vw;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
}

.form-item {
  margin-bottom: 12px;
}

.form-item label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
  margin-left: 12px;
  margin-right: 12px;
  font-size: 13px;
  font-weight: 700;
}

.form-item input,
.data-textarea {
  width: 100%;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid var(--border-color);
  background: rgba(128, 128, 128, 0.05);
  color: var(--text-color);
  font-size: 15px;
  font-weight: 700;
  outline: none;
  box-sizing: border-box;
}

.form-item input::placeholder,
.data-textarea::placeholder {
  font-size: 15px;
  font-weight: 700;
}

.data-textarea {
  min-height: 140px;
  max-height: 200px;
  resize: none;
  font-family: inherit;
  font-size: 13px;
}

.data-textarea::placeholder {
  font-family: inherit;
  font-size: 15px;
  font-weight: 700;
}

.form-input-container {
  position: relative;
  display: flex;
  align-items: center;
}

.form-input-container input {
  width: 100%;
  padding-right: 40px;
}

.eye-btn {
  position: absolute;
  right: 12px;
  cursor: pointer;
  display: flex;
  align-items: center;
  opacity: 0.6;
  transition: opacity 0.2s;
  color: var(--text-color);
}

.eye-btn:hover {
  opacity: 1;
}

.label-error {
  color: #f25656;
  font-size: 12px;
  font-weight: 700;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 16px;
  margin-top: 20px;
}
</style>
