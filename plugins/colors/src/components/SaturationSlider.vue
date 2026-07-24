<script setup lang="ts">
import { Colord, colord } from "colord";
import { computed } from "vue";
import Slider from "@/components/Slider.vue";

interface Props {
  modelValue: Colord;
}

const props = defineProps<Props>();
const emit = defineEmits(["update:modelValue"]);

// 计算饱和度值 (0-100)
const saturation = computed({
  get: () => {
    const hsv = props.modelValue.toHsv();
    return hsv.s;
  },
  set: (value: number) => {
    const hsv = props.modelValue.toHsv();
    const newColor = colord({ h: hsv.h, s: value, v: hsv.v });
    emit("update:modelValue", newColor);
  },
});

// 计算渐变背景
const gradient = computed(() => {
  const hsv = props.modelValue.toHsv();
  const colors = [0, 100].map((s) => colord({ ...hsv, s }).toHslString());
  return `linear-gradient(to right, ${colors.join(", ")})`;
});
</script>

<template>
  <div class="flex items-center space-x-3">
    <span class="w-8 text-sm font-medium">S</span>
    <div class="flex-1">
      <Slider
        v-model="saturation"
        :min="0"
        :max="100"
        :step="1"
        :background="gradient"
        enable-wheel
      />
    </div>
    <span class="w-10 text-right text-sm">{{ Math.round(saturation) }}%</span>
  </div>
</template>
