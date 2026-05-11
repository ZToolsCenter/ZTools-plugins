<script setup lang="ts">
import { useCurrentColor } from "@/utils/current-color";
const currentColorStore = useCurrentColor();
</script>
<template>
  <div class="col-span-6 space-y-6">
    <div
      class="rounded-2xl p-6 shadow-lg"
      :style="{
        backgroundColor: currentColorStore.currentColor.toHex(),
        color: currentColorStore.currentColor.isDark() ? '#FFFFFF' : '#000000',
      }"
    >
      <div class="transition-colors duration-500 ease-in-out">
        <slot></slot>
      </div>
    </div>
  </div>
</template>
