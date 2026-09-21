<script setup lang="ts">
/**
 * 全局反馈组件挂载点。
 *
 * ztools-ui 的 useToast()/useConfirmDialog() 用模块级单例 ref 保存状态，
 * 但 ZToast / ZConfirmDialog 组件只读 props，必须在此把单例状态绑上去。
 * ZToast 需要 v-model:visible 把「倒计时结束」回写接回单例，否则永不消失。
 */
import { ZToast, ZConfirmDialog, useToast, useConfirmDialog } from 'ztools-ui'

const { toastState } = useToast()
const { confirmState, handleConfirm, handleCancel } = useConfirmDialog()
</script>

<template>
  <ZToast
    :message="toastState.message"
    :type="toastState.type"
    :duration="toastState.duration"
    v-model:visible="toastState.visible"
  />
  <ZConfirmDialog
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
