<script setup lang="ts">
import { colord } from "colord";
import { computed } from "vue";
import { useCounterStore } from "@/utils/config";
import { copyColor } from "@/utils/copy";
import { useMessage } from "@/utils/message";

interface Props {
  color: string;
}

const props = defineProps<Props>();

interface HarmonyColor {
  label: string;
  colors: string[];
}
const config = useCounterStore();
const message = useMessage();

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
function copyColorWithConfig(hex: string) {
  if (config.removeHash) hex = hex.substring(1);
  copyColor(hex);
}
</script>

<template>
  <div class="space-y-4">
    <div v-for="harmony in harmonyColors" :key="harmony.label" class="space-y-2">
      <h3 class="text-sm font-medium text-gray-700">{{ harmony.label }}</h3>
      <div class="flex gap-2">
        <div
          v-for="(c, index) in harmony.colors"
          :key="index"
          class="group relative cursor-pointer"
        >
          <div
            class="h-10 w-10 rounded-lg border border-gray-200 shadow-md transition-transform hover:scale-105"
            :style="{ backgroundColor: c }"
            @click="copyColorWithConfig(c)"
          />
          <div
            class="absolute -bottom-6 left-1/2 -translate-x-1/2 text-xs whitespace-nowrap text-gray-500 opacity-0 transition-opacity group-hover:opacity-100"
          >
            {{ c }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
