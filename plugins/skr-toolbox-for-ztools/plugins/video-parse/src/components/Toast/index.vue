<template>
  <transition name="toast">
    <div v-if="show" class="toast" :class="type">
      {{ message }}
    </div>
  </transition>
</template>

<script setup>
import { ref } from 'vue'

const show = ref(false)
const message = ref('')
const type = ref('info')
let timer = null

const open = (msg, t = 'info', duration = 3000) => {
  message.value = msg
  type.value = t
  show.value = true

  clearTimeout(timer)
  timer = setTimeout(() => {
    show.value = false
  }, duration)
}

// 暴露给父组件
defineExpose({ open })
</script>

<style scoped>
.toast {
  position: fixed;
  bottom: 20px;
  right: 20px;
  padding: 10px 20px;
  border-radius: 5px;
  color: white;
  z-index: 2000;
  font-size: 14px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.1);
}

.toast-enter-active,
.toast-leave-active {
  transition: all 0.3s ease;
}

.toast-enter-from,
.toast-leave-to {
  transform: translateX(100%);
  opacity: 0;
}

.toast.info { background-color: #000 }
.toast.success { background-color: #4B9E5F }
.toast.error { background-color: #FF4D4F }
</style>
