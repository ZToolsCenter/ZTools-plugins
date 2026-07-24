<script setup lang="ts">
import { ref, nextTick, watch } from 'vue'

const props = defineProps<{
  show: boolean,
  errorMsg: string,
  modelValue: string
}>()

const emits = defineEmits(['update:show', 'update:modelValue', 'verify', 'cancel', 'focus'])

const verifyInput = ref<HTMLInputElement | null>(null)

watch(() => props.show, (val) => {
  if (val) {
    nextTick(() => {
      verifyInput.value?.focus()
    })
  }
})
</script>

<template>
  <transition name="modal-fade">
    <div class="modal-overlay" v-if="show" @click.self="emits('update:show', false)">
      <div class="modal-content">
        <h3 class="modal-title">身份验证</h3>
        <div class="form-row">
          <div class="form-item full-width">
            <label>
              <span class="modal-tip dark bold" style="margin: 0">请输入主密码以解密账号密钥</span>
              <span v-if="errorMsg" class="label-error">{{ errorMsg }}</span>
            </label>
            <input 
              type="password" 
              :value="modelValue"
              @input="emits('update:modelValue', ($event.target as HTMLInputElement).value)"
              placeholder="请输入主密码" 
              @keyup.enter="emits('verify')" 
              @focus="emits('focus')"
              ref="verifyInput"
              spellcheck="false"
            >
          </div>
        </div>
        <div class="modal-actions">
          <button class="btn" @click="emits('cancel')">取消</button>
          <button class="btn btn-primary" @click="emits('verify')">验证</button>
        </div>
      </div>
    </div>
  </transition>
</template>
