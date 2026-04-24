<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from "vue";
import { colord } from "colord";
import { useEventListener } from "@vueuse/core";

interface Props {
  modelValue: string;
  type: "saturation" | "value";
}

const props = defineProps<Props>();
const emit = defineEmits(["update:modelValue"]);

const sliderRef = ref<HTMLDivElement | null>(null);
const thumbRef = ref<HTMLDivElement | null>(null);
const isDragging = ref(false);

const currentColor = computed(() => colord(props.modelValue));

const updateThumbPosition = () => {
  const thumb = thumbRef.value;
  if (!thumb) return;

  const hsv = currentColor.value.toHsv();
  const position = props.type === "saturation" ? hsv.s / 100 : hsv.v / 100;
  thumb.style.left = `${position * 100}%`;
};

watch(() => props.modelValue, updateThumbPosition);

const handleMouseDown = (e: MouseEvent) => {
  isDragging.value = true;
  handleMouseMove(e);
};

const handleMouseMove = (e: MouseEvent) => {
  if (!isDragging.value || !sliderRef.value) return;

  const rect = sliderRef.value.getBoundingClientRect();
  const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
  const value = x / rect.width;

  const hsv = currentColor.value.toHsv();
  let newColor = currentColor.value;

  if (props.type === "saturation") {
    newColor = colord({ h: hsv.h, s: value * 100, v: hsv.v });
  } else {
    newColor = colord({ h: hsv.h, s: hsv.s, v: value * 100 });
  }

  emit("update:modelValue", newColor.toHex());
  updateThumbPosition();
};

const handleMouseUp = () => {
  isDragging.value = false;
};

const gradient = computed(() => {
  const hsv = currentColor.value.toHsv();
  if (props.type === "saturation") {
    return `linear-gradient(to right, hsl(${hsv.h}, 0%, ${hsv.v / 2}%), hsl(${hsv.h}, 100%, ${hsv.v / 2}%))`;
  } else {
    return `linear-gradient(to right, hsl(${hsv.h}, ${hsv.s}%, 0%), hsl(${hsv.h}, ${hsv.s}%, 100%))`;
  }
});

useEventListener(document, ["mouseup", "mouseleave", "visibilitychange"], () => {
  updateThumbPosition();
  handleMouseUp();
});

useEventListener(document, "mousemove", handleMouseMove, { passive: true });
</script>

<template>
  <div
    ref="sliderRef"
    class="relative h-6 rounded-full cursor-pointer"
    :style="{ background: gradient }"
    @mousedown.prevent="handleMouseDown"
  >
    <div
      ref="thumbRef"
      class="absolute top-1/2 w-6 h-6 bg-white rounded-full shadow-md border border-gray-300 pointer-events-none"
      style="transform: translate(-50%, -50%)"
    />
  </div>
</template>
