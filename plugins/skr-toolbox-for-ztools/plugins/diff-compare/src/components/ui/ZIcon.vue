<script setup lang="ts">
/**
 * 图标组件
 * 基于SVG Sprite的图标组件，从预注册的SVG图标集中显示图标
 */

defineProps<{
  /** 图标名称，对应SVG Sprite中的图标ID */
  name: string
  /** 图标尺寸（像素），默认16 */
  size?: number
}>()
</script>

<template>
  <svg
    :width="size || 16"
    :height="size || 16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <use :xlink:href="`#icon-${name}`" />
  </svg>
</template>