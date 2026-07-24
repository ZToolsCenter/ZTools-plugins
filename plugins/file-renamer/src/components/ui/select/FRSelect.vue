<script setup lang="ts">
/**
 * 选择器组件。
 * @description 下拉选择器根组件，使用Radix Vue的Select原语实现
 * @see https://www.radix-vue.com/components/select 官方文档
 */
import { SelectRoot, type SelectRootEmits, type SelectRootProps, useForwardPropsEmits } from 'radix-vue'

const props = defineProps<SelectRootProps>()
const emits = defineEmits<SelectRootEmits>()

const forwarded = useForwardPropsEmits(props, emits)
</script>

<template>
  <SelectRoot v-bind="forwarded">
    <slot />
  </SelectRoot>
</template>
