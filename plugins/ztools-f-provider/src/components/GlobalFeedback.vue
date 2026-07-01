<script setup lang="ts">
/**
 * 全局反馈组件挂载点。
 *
 * ztools-ui 的 useToast()/useConfirmDialog() 内部用模块级单例 ref（toastState/
 * confirmState）保存状态；但 ZToast / ZConfirmDialog 组件本身只读 props，并不
 * 自动订阅该单例。因此这里必须把单例状态绑定到组件 props 上。
 *
 * 注意 ZToast 自动消失的实现是「倒计时结束后 emit('update:visible', false)」，
 * 且当传入 visible prop 时组件不会自行改值，必须用 v-model:visible 把回写接回
 * toastState，否则单例 visible 一直为 true，toast 永不消失。
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
