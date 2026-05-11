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
  const start = colord({ ...hsv, v: 0 }).toHslString();
  const end = colord({ ...hsv, v: 100 }).toHslString();
  return `linear-gradient(to right, ${start}, ${end})`;
});
</script>

<template>
  <Slider v-model="value" :min="0" :max="100" :step="1" :background="gradient" enable-wheel />
</template>
