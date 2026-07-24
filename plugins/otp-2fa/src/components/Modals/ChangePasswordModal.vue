<script setup lang="ts">
import { ref, watch } from 'vue'

const props = defineProps<{
  show: boolean
  currentError: string
  newError: string
  confirmError: string
}>()

const emits = defineEmits([
  'update:show', 'submit', 'cancel',
  'update:currentPassword', 'update:newPassword', 'update:confirmPassword'
])

const currentPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const showCurrent = ref(false)
const showNew = ref(false)
const showConfirm = ref(false)

const currentInput = ref<HTMLInputElement | null>(null)

watch(() => props.show, (val) => {
  if (val) {
    currentPassword.value = ''
    newPassword.value = ''
    confirmPassword.value = ''
    showCurrent.value = false
    showNew.value = false
    showConfirm.value = false
    setTimeout(() => currentInput.value?.focus(), 100)
  }
})

const handleSubmit = () => {
  emits('update:currentPassword', currentPassword.value)
  emits('update:newPassword', newPassword.value)
  emits('update:confirmPassword', confirmPassword.value)
  emits('submit')
}

const handleCancel = () => {
  emits('cancel')
}
</script>

<template>
  <transition name="modal-fade">
    <div class="modal-overlay" v-if="show" @click.self="handleCancel">
      <div class="modal-content">
        <h3 class="modal-title">修改主密码</h3>

        <div class="form-row">
          <div class="form-item full-width">
            <label>
              <span>当前主密码</span>
              <span v-if="currentError" class="label-error">{{ currentError }}</span>
            </label>
            <div class="form-input-container">
              <input
                ref="currentInput"
                :type="showCurrent ? 'text' : 'password'"
                v-model="currentPassword"
                placeholder="输入当前主密码"
                @keyup.enter="handleSubmit"
                spellcheck="false"
              />
              <div class="eye-btn" @click="showCurrent = !showCurrent">
                <svg v-if="showCurrent" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                <svg v-else width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>
              </div>
            </div>
          </div>

          <div class="form-item full-width">
            <label>
              <span>新主密码</span>
              <span v-if="newError" class="label-error">{{ newError }}</span>
            </label>
            <div class="form-input-container">
              <input
                :type="showNew ? 'text' : 'password'"
                v-model="newPassword"
                placeholder="请输入至少 4 位密码"
                @keyup.enter="handleSubmit"
                spellcheck="false"
              />
              <div class="eye-btn" @click="showNew = !showNew">
                <svg v-if="showNew" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                <svg v-else width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>
              </div>
            </div>
          </div>

          <div class="form-item full-width">
            <label>
              <span>确认新密码</span>
              <span v-if="confirmError" class="label-error">{{ confirmError }}</span>
            </label>
            <div class="form-input-container">
              <input
                :type="showConfirm ? 'text' : 'password'"
                v-model="confirmPassword"
                placeholder="请再次输入密码"
                @keyup.enter="handleSubmit"
                spellcheck="false"
              />
              <div class="eye-btn" @click="showConfirm = !showConfirm">
                <svg v-if="showConfirm" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                <svg v-else width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>
              </div>
            </div>
          </div>
        </div>

        <div class="modal-actions">
          <button class="btn btn-secondary" @click="handleCancel">取消</button>
          <button class="btn btn-primary" @click="handleSubmit">确定</button>
        </div>
      </div>
    </div>
  </transition>
</template>
