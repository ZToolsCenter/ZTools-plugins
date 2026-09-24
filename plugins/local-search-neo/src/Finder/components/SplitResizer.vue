<script setup lang="ts">
import { onUnmounted, ref } from "vue";

const props = withDefaults(
  defineProps<{
    modelValue: number;
    min?: number;
    max?: number | (() => number);
    defaultWidth?: number;
    title?: string;
  }>(),
  {
    min: 0,
    max: undefined,
    defaultWidth: undefined,
    title: "拖动调整宽度，双击恢复默认",
  },
);

const emit = defineEmits<{
  "update:modelValue": [value: number];
  change: [value: number];
  resizingChange: [isResizing: boolean];
}>();

const isResizing = ref(false);

let startX = 0;
let startWidth = 0;

function resolveMax(): number {
  if (typeof props.max === "function") {
    const computedMax = props.max();
    return typeof computedMax === "number" && !Number.isNaN(computedMax)
      ? computedMax
      : Number.POSITIVE_INFINITY;
  }
  return typeof props.max === "number" && !Number.isNaN(props.max)
    ? props.max
    : Number.POSITIVE_INFINITY;
}

function onMouseMove(event: MouseEvent) {
  if (!isResizing.value) return;
  const deltaX = event.clientX - startX;
  const minVal = typeof props.min === "number" && !Number.isNaN(props.min) ? props.min : 0;
  const maxVal = Math.max(minVal, resolveMax());
  const targetWidth = Math.min(maxVal, Math.max(minVal, startWidth + deltaX));
  emit("update:modelValue", targetWidth);
}

function onMouseUp(event: MouseEvent) {
  if (!isResizing.value) return;
  const deltaX = event.clientX - startX;
  const minVal = typeof props.min === "number" && !Number.isNaN(props.min) ? props.min : 0;
  const maxVal = Math.max(minVal, resolveMax());
  const finalWidth = Math.min(maxVal, Math.max(minVal, startWidth + deltaX));

  isResizing.value = false;
  emit("resizingChange", false);
  removeListeners();
  emit("update:modelValue", finalWidth);
  emit("change", finalWidth);
}

function removeListeners() {
  window.removeEventListener("mousemove", onMouseMove);
  window.removeEventListener("mouseup", onMouseUp);
}

function onMouseDown(event: MouseEvent) {
  if (event.button !== 0) return;
  event.preventDefault();

  removeListeners();
  isResizing.value = true;
  emit("resizingChange", true);

  startX = event.clientX;
  startWidth = props.modelValue;

  window.addEventListener("mousemove", onMouseMove);
  window.addEventListener("mouseup", onMouseUp);
}

function onDoubleClick() {
  if (props.defaultWidth !== undefined) {
    emit("update:modelValue", props.defaultWidth);
    emit("change", props.defaultWidth);
  }
}

onUnmounted(() => {
  removeListeners();
});
</script>

<template>
  <div
    class="finder-split-resizer"
    :class="{ 'is-resizing': isResizing }"
    :title="title"
    @mousedown="onMouseDown"
    @dblclick="onDoubleClick"
  >
    <span class="resizer-line"></span>
  </div>
</template>

<style scoped>
.finder-split-resizer {
  position: absolute;
  top: 0;
  right: -8px;
  bottom: 0;
  z-index: 50;
  width: 8px;
  cursor: col-resize;
}

.resizer-line {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 2px;
  background: transparent;
  transition: background-color 0.15s ease;
  pointer-events: none;
}

.finder-split-resizer:hover .resizer-line,
.finder-split-resizer.is-resizing .resizer-line {
  background: var(--primary-color);
}
</style>
