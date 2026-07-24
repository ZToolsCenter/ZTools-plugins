<script setup lang="ts">
import { Colord } from "colord";
import { computed } from "vue";
import { colordToString } from "@/utils/color";
import { useConfigStore } from "@/utils/config";
import { copyColor2 } from "@/utils/copy";
import { useMessage } from "@/utils/message";

interface Props {
  color: Colord;
}

const props = defineProps<Props>();

interface HarmonyColor {
  label: string;
  colors: Colord[];
}
const config = useConfigStore();
const message = useMessage();

const harmonyColors = computed<HarmonyColor[]>(() => {
  const color = props.color;
  const hsv = color.toHsv();

  return [
    {
      label: "互补色",
      colors: [color.rotate(180)],
    },
    {
      label: "对比色",
      colors: [color.rotate(150), color.rotate(210)],
    },
    {
      label: "类似色",
      colors: [color.rotate(-30), color.rotate(30)],
    },
    {
      label: "中差色",
      colors: [color.rotate(90), color.rotate(-90), color.rotate(180)],
    },
  ];
});
function handleCopy(color: Colord) {
  copyColor2(color, { ...config });
}
</script>

<template>
  <div class="space-y-4">
    <div v-for="harmony in harmonyColors" :key="harmony.label" class="space-y-2">
      <h3 class="text-sm font-medium">{{ harmony.label }}</h3>
      <div class="flex gap-2">
        <div
          v-for="(c, index) in harmony.colors"
          :key="index"
          class="group relative cursor-pointer"
        >
          <div
            class="h-10 w-10 rounded-lg border border-[color:currentColor] shadow-md transition-transform hover:scale-105"
            :style="{ backgroundColor: c.toHex() }"
            @click="handleCopy(c)"
          />
          <div
            class="absolute -bottom-6 left-1/2 -translate-x-1/2 text-xs whitespace-nowrap opacity-0 transition-opacity group-hover:opacity-100"
          >
            {{ colordToString(c, config) }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
