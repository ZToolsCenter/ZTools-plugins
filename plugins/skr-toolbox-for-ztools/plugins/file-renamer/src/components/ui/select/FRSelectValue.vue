<script setup lang="ts">
/**
 * 选择器值显示组件。
 * @description 显示当前选中的值
 * @extends SelectValue 来自Radix Vue
 */
import { SelectValue, type SelectValueProps } from 'radix-vue'

const props = defineProps<SelectValueProps>()
</script>

<template>
  <SelectValue v-bind="props">
    <slot />
  </SelectValue>
</template>
