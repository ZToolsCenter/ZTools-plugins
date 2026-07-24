<script setup lang="ts">
/**
 * 对话框根组件。
 * @description 模态对话框容器，使用Radix Vue的Dialog原语实现
 * @see https://www.radix-vue.com/components/dialog 官方文档
 */
import { DialogRoot, type DialogRootEmits, type DialogRootProps, useForwardPropsEmits } from 'radix-vue'

const props = defineProps<DialogRootProps>()
const emits = defineEmits<DialogRootEmits>()

const forwarded = useForwardPropsEmits(props, emits)
</script>

<template>
  <DialogRoot v-bind="forwarded">
    <slot />
  </DialogRoot>
</template>
