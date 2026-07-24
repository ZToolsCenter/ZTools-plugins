<script setup lang="ts">
import { useCurrentColor } from "@/utils/current-color";

defineProps<{ title?: string }>();
const currentColorStore = useCurrentColor();
</script>
<template>
  <div
    class="flex h-full w-full flex-1 flex-col items-center justify-center rounded-2xl p-6 shadow-lg"
    :style="{
      backgroundColor: currentColorStore.currentColor.toHex(),
      color: currentColorStore.currentColor.isDark() ? '#FFFFFF' : '#000000',
    }"
  >
    <div class="w-full transition-[color] duration-500 ease-in-out">
      <h3 v-if="title" class="mb-4 text-lg font-semibold">{{ title }}</h3>
      <slot></slot>
    </div>
  </div>
</template>
