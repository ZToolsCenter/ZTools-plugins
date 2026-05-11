<script setup lang="ts">
const props = defineProps<{
  show: boolean,
  passwordInput: string,
  confirmPasswordInput: string,
  errorMsg: string
}>()

const emits = defineEmits([
  'update:show', 'update:passwordInput', 'update:confirmPasswordInput', 
  'submit', 'cancel'
])
</script>

<template>
  <transition name="modal-fade">
    <div class="modal-overlay" v-if="show" @click.self="emits('update:show', false)">
      <div class="modal-content">
        <h3 class="modal-title">设置主密码</h3>
        <p class="modal-tip dark bold">为了保护您的 2FA 密钥安全，请设置一个主密码，该密码仅用于解密、查看密钥原文。</p>
        <div class="form-row">
          <div class="form-item full-width">
            <label>
              <span>输入新密码</span>
              <span v-if="errorMsg" class="label-error">{{ errorMsg }}</span>
            </label>
            <input 
              type="password" 
              :value="passwordInput"
              @input="emits('update:passwordInput', ($event.target as HTMLInputElement).value)"
              placeholder="请输入至少 4 位密码" 
              @keyup.enter="emits('submit')"
              spellcheck="false"
            >
          </div>
          <div class="form-item full-width">
            <label><span>确认新密码</span></label>
            <input 
              type="password" 
              :value="confirmPasswordInput"
              @input="emits('update:confirmPasswordInput', ($event.target as HTMLInputElement).value)"
              placeholder="请再次输入密码" 
              @keyup.enter="emits('submit')"
              spellcheck="false"
            >
          </div>
        </div>
        <div class="modal-actions">
          <button class="btn btn-secondary" @click="emits('cancel')">取消</button>
          <button class="btn btn-primary" @click="emits('submit')">确定</button>
        </div>
      </div>
    </div>
  </transition>
</template>
