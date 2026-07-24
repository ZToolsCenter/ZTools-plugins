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
    const hsl = props.modelValue.toHsl();
    return hsl.h;
  },
  set: (value: number) => {
    const hsl = props.modelValue.toHsl();
    const newColor = colord({ h: value, s: hsl.s, l: hsl.l });
    emit("update:modelValue", newColor);
  },
});

// 计算饱和度值 (0-100)
const saturation = computed({
  get: () => {
    const hsl = props.modelValue.toHsl();
    return hsl.s;
  },
  set: (value: number) => {
    const hsl = props.modelValue.toHsl();
    const newColor = colord({ h: hsl.h, s: value, l: hsl.l });
    emit("update:modelValue", newColor);
  },
});

// 计算亮度值 (0-100)
const lightness = computed({
  get: () => {
    const hsl = props.modelValue.toHsl();
    return hsl.l;
  },
  set: (value: number) => {
    const hsl = props.modelValue.toHsl();
    const newColor = colord({ h: hsl.h, s: hsl.s, l: value });
    emit("update:modelValue", newColor);
  },
});

// 计算渐变背景
const hueGradient = computed(() => {
  const hsl = props.modelValue.toHsl();
  const colors = [0, 60, 120, 180, 240, 300, 0].map((h) => colord({ ...hsl, h: h }).toHex());

  return `linear-gradient(to right, ${colors.join(", ")})`;
});

const saturationGradient = computed(() => {
  const hsl = props.modelValue.toHsl();
  const colors = [0, 100].map((s) => colord({ ...hsl, s }).toHex());
  return `linear-gradient(to right, ${colors.join(", ")})`;
});

const lightnessGradient = computed(() => {
  const hsl = props.modelValue.toHsl();
  const colors = [0, 100].map((l) => colord({ ...hsl, l }).toHex());
  return `linear-gradient(to right, ${colors.join(", ")})`;
});
</script>

<template>
  <div class="space-y-4">
    <!-- Hue Slider -->
    <div class="flex items-center space-x-3">
      <span class="w-8 text-sm font-medium">H</span>
      <div class="flex-1">
        <Slider
          v-model="hue"
          :min="0"
          :max="360"
          :step="1"
          :background="hueGradient"
          enable-wheel
        />
      </div>
      <span class="w-10 text-right text-sm">{{ Math.round(hue) }}</span>
    </div>

    <!-- Saturation Slider -->
    <div class="flex items-center space-x-3">
      <span class="w-8 text-sm font-medium">S</span>
      <div class="flex-1">
        <Slider
          v-model="saturation"
          :min="0"
          :max="100"
          :step="1"
          :background="saturationGradient"
          enable-wheel
        />
      </div>
      <span class="w-10 text-right text-sm">{{ Math.round(saturation) }}%</span>
    </div>

    <!-- Lightness Slider -->
    <div class="flex items-center space-x-3">
      <span class="w-8 text-sm font-medium">L</span>
      <div class="flex-1">
        <Slider
          v-model="lightness"
          :min="0"
          :max="100"
          :step="1"
          :background="lightnessGradient"
          enable-wheel
        />
      </div>
      <span class="w-10 text-right text-sm">{{ Math.round(lightness) }}%</span>
    </div>
  </div>
</template>
