<script setup lang="ts">
import { Colord, colord } from "colord";
import { computed } from "vue";
import Slider from "@/components/Slider.vue";

interface Props {
  modelValue: Colord;
}

const props = defineProps<Props>();
const emit = defineEmits(["update:modelValue"]);

// 计算色相值 (0-360)
const hue = computed({
  get: () => {
    const hsv = props.modelValue.toHsv();
    return hsv.h;
  },
  set: (value: number) => {
    const hsv = props.modelValue.toHsv();
    const newColor = colord({ h: value, s: hsv.s, v: hsv.v });
    emit("update:modelValue", newColor);
  },
});

// 计算渐变背景 - 完整的色相环
const gradient = computed(() => {
  const hsv = props.modelValue.toHsv();
  const colors = [0, 60, 120, 180, 240, 300, 0].map((h) => colord({ ...hsv, h: h }).toHex());

  return `linear-gradient(to right, ${colors.join(", ")})`;
});
</script>

<template>
  <div class="flex items-center space-x-3">
    <span class="w-8 text-sm font-medium">H</span>
    <div class="flex-1">
      <Slider v-model="hue" :min="0" :max="360" :step="1" :background="gradient" enable-wheel />
    </div>
    <span class="w-10 text-right text-sm">{{ Math.round(hue) }}</span>
  </div>
</template>
