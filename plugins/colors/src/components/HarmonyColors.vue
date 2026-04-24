<script setup lang="ts">
import { computed } from "vue";
import { colord } from "colord";
import { showSuccess } from "@/utils/notification";
import { copyColor } from "@/utils/copy";

interface Props {
  color: string;
}

const props = defineProps<Props>();

interface HarmonyColor {
  label: string;
  colors: string[];
}

const harmonyColors = computed<HarmonyColor[]>(() => {
  const color = colord(props.color);
  const hsv = color.toHsv();

  return [
    {
      label: "互补色",
      colors: [color.rotate(180).toHex()],
    },
    {
      label: "对比色",
      colors: [color.rotate(150).toHex(), color.rotate(210).toHex()],
    },
    {
      label: "类似色",
      colors: [color.rotate(-30).toHex(), color.rotate(30).toHex()],
    },
    {
      label: "中差色",
      colors: [color.rotate(90).toHex(), color.rotate(-90).toHex(), color.rotate(180).toHex()],
    },
  ];
});
</script>

<template>
  <div class="space-y-4">
    <div v-for="harmony in harmonyColors" :key="harmony.label" class="space-y-2">
      <h3 class="text-sm font-medium text-gray-700">{{ harmony.label }}</h3>
      <div class="flex gap-2">
        <div
          v-for="(c, index) in harmony.colors"
          :key="index"
          class="relative group cursor-pointer"
        >
          <div
            class="w-10 h-10 rounded-lg shadow-md border border-gray-200 transition-transform hover:scale-105"
            :style="{ backgroundColor: c }"
            @click="copyColor(c)"
          />
          <div
            class="absolute -bottom-6 left-1/2 -translate-x-1/2 text-xs text-gray-500 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap"
          >
            {{ c }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
