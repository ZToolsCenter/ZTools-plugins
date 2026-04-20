<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from "vue";
import { colord, extend } from "colord";
import namesPlugin from "colord/plugins/names";

extend([namesPlugin]);

interface Props {
  modelValue: string;
}

const props = defineProps<Props>();
const emit = defineEmits(["update:modelValue"]);

const canvasRef = ref<HTMLCanvasElement | null>(null);
const pickerRef = ref<HTMLDivElement | null>(null);
const isDragging = ref(false);

const currentColor = ref(props.modelValue);

onMounted(() => {
  drawColorWheel();
});

watch(
  () => props.modelValue,
  (newVal) => {
    if (newVal !== currentColor.value) {
      currentColor.value = newVal;
      updatePickerPosition();
    }
  },
);

const drawColorWheel = () => {
  const canvas = canvasRef.value;
  if (!canvas) return;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const width = canvas.width;
  const height = canvas.height;
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = Math.min(width, height) / 2;

  for (let angle = 0; angle < 360; angle++) {
    const startAngle = (angle - 2) * (Math.PI / 180);
    const endAngle = (angle + 2) * (Math.PI / 180);

    const gradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius);
    gradient.addColorStop(0, "#fff");
    gradient.addColorStop(1, colord({ h: angle, s: 100, v: 100 }).toHex());

    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.arc(centerX, centerY, radius, startAngle, endAngle);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();
  }

  updatePickerPosition();
};

const updatePickerPosition = () => {
  const canvas = canvasRef.value;
  const picker = pickerRef.value;
  if (!canvas || !picker) return;

  const color = colord(currentColor.value);
  const hsv = color.toHsv();
  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;
  const radius = Math.min(canvas.width, canvas.height) / 2 - 10;

  const angle = (hsv.h * Math.PI) / 180;
  const distance = (hsv.s / 100) * radius;

  const x = centerX + distance * Math.cos(angle);
  const y = centerY + distance * Math.sin(angle);

  picker.style.left = `${x - 10}px`;
  picker.style.top = `${y - 10}px`;
  picker.style.opacity = hsv.v / 100;
};

const handleMouseDown = (e: MouseEvent) => {
  isDragging.value = true;
  handleMouseMove(e);
};

const handleMouseMove = (e: MouseEvent) => {
  if (!isDragging.value) return;

  const canvas = canvasRef.value;
  if (!canvas) return;

  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;

  const dx = x - centerX;
  const dy = y - centerY;
  const distance = Math.min(Math.sqrt(dx * dx + dy * dy), canvas.width / 2 - 10);

  const angle = Math.atan2(dy, dx) * (180 / Math.PI);
  const hue = angle < 0 ? angle + 360 : angle;
  const saturation = (distance / (canvas.width / 2 - 10)) * 100;

  const newColor = colord({ h: hue, s: saturation, v: 100 }).toHex();
  currentColor.value = newColor;
  emit("update:modelValue", newColor);
  updatePickerPosition();
};

const handleMouseUp = () => {
  isDragging.value = false;
};

onMounted(() => {
  drawColorWheel();
  window.addEventListener("mouseup", handleMouseUp);
});

onUnmounted(() => {
  window.removeEventListener("mouseup", handleMouseUp);
});
</script>

<template>
  <div class="relative inline-block">
    <canvas
      ref="canvasRef"
      width="200"
      height="200"
      class="cursor-crosshair rounded-full"
      @mousedown="handleMouseDown"
      @mousemove="handleMouseMove"
    />
    <div
      ref="pickerRef"
      class="absolute w-5 h-5 border-2 border-white rounded-full shadow-md pointer-events-none"
      style="transform: translate(-50%, -50%)"
    />
  </div>
</template>
