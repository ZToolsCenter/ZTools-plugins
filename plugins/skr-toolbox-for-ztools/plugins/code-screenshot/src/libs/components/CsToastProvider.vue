<script setup lang="ts">
/**
 * 提示消息容器组件
 * 负责渲染所有提示消息，使用 Teleport 传送到 body
 */
import { useToast } from '@/libs/toast'
import CsToast from '@/libs/components/CsToast.vue'

const toastStore = useToast()
</script>

<template>
  <Teleport to="body">
    <div class="cs-toast-container">
      <TransitionGroup name="toast-list">
        <CsToast v-for="toast in toastStore.toasts" :key="toast.id" :message="toast.message" :type="toast.type"
          @close="toastStore.remove(toast.id)" />
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style lang="scss" scoped>
.cs-toast-container {
  position: fixed;
  top: 24px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 9999;
  display: flex;
  flex-direction: column;
  align-items: center;
  pointer-events: none;
}

/* List Transitions */
.toast-list-enter-active {
  transition: all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.toast-list-leave-active {
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  position: absolute;
  /* for smooth list moving */
}

.toast-list-enter-from {
  opacity: 0;
  transform: translateY(-20px) scale(0.9);
}

.toast-list-leave-to {
  opacity: 0;
  transform: scale(0.95);
}

/* Ensure moving items transition smoothly */
.toast-list-move {
  transition: transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
}
</style>
