<script setup lang="ts">
import { computed } from 'vue'
import { closeMessage, message } from '../message'
import Icon from './Icon.vue'

const iconName = computed(
  () =>
    ({ success: 'alertSuccess', error: 'alertError', warning: 'alertWarning', info: 'alertInfo' })[
      message.severity
    ] || 'alertInfo'
)
</script>

<template>
  <Transition name="snack">
    <div v-if="message.open" class="snackbar">
      <div class="alert" :class="message.severity">
        <span class="alert-icon"><Icon :name="iconName" /></span>
        <span class="alert-msg">{{ message.text }}</span>
        <span class="alert-action">
          <button class="close-btn" title="Close" @click="closeMessage()">
            <Icon name="close" />
          </button>
        </span>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.snackbar {
  position: fixed;
  top: 24px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 1400;
  max-width: 560px;
}

.alert {
  display: flex;
  padding: 6px 16px;
  border-radius: 4px;
  color: #fff;
  font-size: 16px;
  font-weight: 500;
  line-height: 1.43;
}

.alert-icon {
  display: flex;
  padding: 6px 0;
  margin-right: 12px;
  opacity: 0.9;
  font-size: 22px;
}

.alert-msg {
  padding: 8px 0;
}

.alert-action {
  display: flex;
  align-items: flex-start;
  padding: 4px 0 0 16px;
  margin-right: -8px;
}

.close-btn {
  display: inline-flex;
  padding: 5px;
  border-radius: 50%;
  color: inherit;
}

.close-btn:hover {
  background: rgba(255, 255, 255, 0.12);
}

.close-btn :deep(.icon) {
  font-size: 20px;
}

.alert.success {
  background: #2e7d32;
}

.alert.error {
  background: #d32f2f;
}

.alert.warning {
  background: #ed6c02;
}

.alert.info {
  background: #0288d1;
}

/* MUI Grow：opacity 225ms + scale 150ms */
.snack-enter-active,
.snack-leave-active {
  transition: opacity 225ms cubic-bezier(0.4, 0, 0.2, 1), transform 150ms cubic-bezier(0.4, 0, 0.2, 1);
}

.snack-enter-from,
.snack-leave-to {
  opacity: 0;
  transform: translateX(-50%) scale(0.75);
}
</style>
