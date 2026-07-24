<script setup lang="ts">
import { Colord, colord } from "colord";
import { computed } from "vue";
import Slider from "@/components/Slider.vue";

interface Props {
  modelValue: Colord;
}

const props = defineProps<Props>();
const emit = defineEmits(["update:modelValue"]);

// 计算红色值 (0-255)
const red = computed({
  get: () => {
    const rgb = props.modelValue.toRgb();
    return rgb.r;
  },
  set: (value: number) => {
    const rgb = props.modelValue.toRgb();
    const newColor = colord({ r: value, g: rgb.g, b: rgb.b });
    emit("update:modelValue", newColor);
  },
});

// 计算绿色值 (0-255)
const green = computed({
  get: () => {
    const rgb = props.modelValue.toRgb();
    return rgb.g;
  },
  set: (value: number) => {
    const rgb = props.modelValue.toRgb();
    const newColor = colord({ r: rgb.r, g: value, b: rgb.b });
    emit("update:modelValue", newColor);
  },
});

// 计算蓝色值 (0-255)
const blue = computed({
  get: () => {
    const rgb = props.modelValue.toRgb();
    return rgb.b;
  },
  set: (value: number) => {
    const rgb = props.modelValue.toRgb();
    const newColor = colord({ r: rgb.r, g: rgb.g, b: value });
    emit("update:modelValue", newColor);
  },
});

// 计算渐变背景
const redGradient = computed(() => {
  const rgb = props.modelValue.toRgb();
  const colors = [0, 255].map((r) => colord({ r: r, g: rgb.g, b: rgb.b }).toHex());
  return `linear-gradient(to right, ${colors.join(", ")})`;
});

const greenGradient = computed(() => {
  const rgb = props.modelValue.toRgb();
  const colors = [0, 255].map((g) => colord({ r: rgb.r, g: g, b: rgb.b }).toHex());
  return `linear-gradient(to right, ${colors.join(", ")})`;
});

const blueGradient = computed(() => {
  const rgb = props.modelValue.toRgb();
  const colors = [0, 255].map((b) => colord({ r: rgb.r, g: rgb.g, b: b }).toHex());
  return `linear-gradient(to right, ${colors.join(", ")})`;
});
</script>

<template>
  <div class="space-y-4">
    <!-- Red Slider -->
    <div class="flex items-center space-x-3">
      <span class="w-8 text-sm font-medium">R</span>
      <div class="flex-1">
        <Slider
          v-model="red"
          :min="0"
          :max="255"
          :step="1"
          :background="redGradient"
          enable-wheel
        />
      </div>
      <span class="w-10 text-right text-sm">{{ Math.round(red) }}</span>
    </div>

    <!-- Green Slider -->
    <div class="flex items-center space-x-3">
      <span class="w-8 text-sm font-medium">G</span>
      <div class="flex-1">
        <Slider
          v-model="green"
          :min="0"
          :max="255"
          :step="1"
          :background="greenGradient"
          enable-wheel
        />
      </div>
      <span class="w-10 text-right text-sm">{{ Math.round(green) }}</span>
    </div>

    <!-- Blue Slider -->
    <div class="flex items-center space-x-3">
      <span class="w-8 text-sm font-medium">B</span>
      <div class="flex-1">
        <Slider
          v-model="blue"
          :min="0"
          :max="255"
          :step="1"
          :background="blueGradient"
          enable-wheel
        />
      </div>
      <span class="w-10 text-right text-sm">{{ Math.round(blue) }}</span>
    </div>
  </div>
</template>
