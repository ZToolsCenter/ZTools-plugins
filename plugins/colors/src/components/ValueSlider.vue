<script setup lang="ts">
import { Colord, colord } from "colord";
import { computed } from "vue";
import Slider from "@/components/Slider.vue";

interface Props {
  modelValue: Colord;
}

const props = defineProps<Props>();
const emit = defineEmits(["update:modelValue"]);

// 计算明度值 (0-100)
const value = computed({
  get: () => {
    const hsv = props.modelValue.toHsv();
    return hsv.v;
  },
  set: (val: number) => {
    const hsv = props.modelValue.toHsv();
    const newColor = colord({ h: hsv.h, s: hsv.s, v: val });
    emit("update:modelValue", newColor);
  },
});

// 计算渐变背景
const gradient = computed(() => {
  const hsv = props.modelValue.toHsv();
  const colors = [0, 100].map((v) => colord({ ...hsv, v }).toHslString());
  return `linear-gradient(to right, ${colors.join(", ")})`;
});
</script>

<template>
  <div class="flex items-center space-x-3">
    <span class="w-8 text-sm font-medium">V</span>
    <div class="flex-1">
      <Slider v-model="value" :min="0" :max="100" :step="1" :background="gradient" enable-wheel />
    </div>
    <span class="w-10 text-right text-sm">{{ Math.round(value) }}%</span>
  </div>
</template>
