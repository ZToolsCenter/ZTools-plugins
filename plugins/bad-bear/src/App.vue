<template>
  <div class="main-container">
    <PluginMarketPage class="market-page" />
  </div>
  <ToastComponent
    :visible="toastState.visible"
    :message="toastState.message"
    :type="toastState.type"
    :duration="toastState.duration"
    @update:visible="toastState.visible = $event"
  />
  <ConfirmDialog
    :visible="confirmState.visible"
    :title="confirmState.title"
    :message="confirmState.message"
    :type="confirmState.type"
    :confirm-text="confirmState.confirmText"
    :cancel-text="confirmState.cancelText"
    @confirm="handleConfirm"
    @cancel="handleCancel"
  />
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import { Toast as ToastComponent, useToast, ConfirmDialog } from './components/common'
import PluginMarketPage from './components/plugin-market/PluginMarketPage.vue'
import { useTheme } from './config/theme'

const {
  toastState,
  confirmState,
  handleConfirm,
  handleCancel,
} = useToast()

onMounted(() => {
  void useTheme()
})
</script>

<style scoped>
.main-container {
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  min-height: 100%;
  padding: 0;
  display: flex;
  align-items: stretch;
  justify-content: stretch;
}

.market-page {
  flex: 1;
  min-height: 0;
}
</style>
