<script lang="ts" setup>
import { computed } from "vue";
import { useConfigStore } from "@/utils/config";
import { useCurrentColor } from "@/utils/current-color";
import Select from "./Select.vue";

const currentColorStore = useCurrentColor();
const config = useConfigStore();

// 定义颜色格式选项
const colorFormatOptions = [
  { value: "hex", label: "HEX (#RRGGBB)" },
  { value: "rgb", label: "RGB (rgb(r, g, b))" },
  { value: "hsv/hsb", label: "HSV/HSB" },
  { value: "hsl", label: "HSL (hsl(h, s%, l%))" },
  { value: "hwb", label: "HWB" },
  { value: "cmyk", label: "CMYK" },
  { value: "lab", label: "LAB" },
  { value: "lch", label: "LCH" },
  { value: "xyz", label: "XYZ" },
];

// 计算样式，保持原有的背景色功能
const selectStyle = computed(() => ({
  background: currentColorStore.currentColor.toHex(),
}));
</script>

<template>
  <Select
    id="colorFormat"
    v-model="config.format"
    :options="colorFormatOptions"
    :style="selectStyle"
  />
</template>
