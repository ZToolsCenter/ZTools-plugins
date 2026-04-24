<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from "vue";
import { colord, extend } from "colord";
import namesPlugin from "colord/plugins/names";
import { useEventListener } from "@vueuse/core";

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
      // 当颜色变化时，重新绘制色轮以更新亮度
      drawColorWheel();
    }
  },
);

/**
 * 绘制色轮
 * 使用 Canvas 2D API 绘制一个完整的 HSV 色轮
 * 色轮亮度会根据当前颜色的 V（明度）值动态调整
 */
const drawColorWheel = () => {
  const canvas = canvasRef.value;
  if (!canvas) return;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  // 获取当前颜色的亮度值，用于调整色轮整体亮度
  const currentHsv = colord(currentColor.value).toHsv();
  const brightness = currentHsv.v / 100; // 转换为 0-1 范围

  // 获取画布尺寸和中心点坐标
  const width = canvas.width;
  const height = canvas.height;
  const centerX = width / 2;
  const centerY = height / 2;
  // 计算色轮半径（取宽高中较小值的一半）
  const radius = Math.min(width, height) / 2;

  // 遍历 360 度，绘制每个角度扇形
  for (let angle = 0; angle < 360; angle++) {
    // 计算当前扇形的起始和结束角度（每个扇形 4 度，有 2 度重叠保证平滑过渡）
    const startAngle = (angle - 2) * (Math.PI / 180);
    const endAngle = (angle + 2) * (Math.PI / 180);

    // 创建径向渐变：从中心（白色）到边缘（纯色）
    const gradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius);
    // 中心点为白色，但根据亮度调整（亮度越低，中心越暗）
    const centerBrightness = Math.max(brightness * 255, 50); // 保持最低亮度避免完全黑色
    gradient.addColorStop(0, `rgb(${centerBrightness}, ${centerBrightness}, ${centerBrightness})`);
    // 边缘为当前角度的纯色，根据亮度值调整（饱和度 100%，明度由 brightness 决定）
    gradient.addColorStop(1, colord({ h: angle, s: 100, v: brightness * 100 }).toHex());

    // 绘制扇形路径
    ctx.beginPath();
    ctx.moveTo(centerX, centerY); // 从圆心开始
    ctx.arc(centerX, centerY, radius, startAngle, endAngle); // 绘制弧线
    ctx.closePath(); // 闭合路径
    ctx.fillStyle = gradient; // 设置填充样式为渐变
    ctx.fill(); // 填充扇形
  }

  // 绘制完成后更新取色器位置
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

  // 使用 transform: translate(-50%, -50%) 居中，所以直接设置坐标即可
  picker.style.left = `${x}px`;
  picker.style.top = `${y}px`;
  // 保持取色器始终可见，不根据亮度调整透明度
  picker.style.opacity = '1';

  // 智能选择边框颜色：根据亮度动态选择白色或黑色，确保最大对比度
  // 当亮度低于 50% 时使用白色，高于 50% 时使用黑色
  const borderColor = hsv.v < 50 ? '#ffffff' : '#000000';
  picker.style.borderColor = borderColor;
};

const handleMouseDown = (e: MouseEvent) => {
  isDragging.value = true;
  handleMouseMove(e);
};

/**
 * 处理鼠标移动事件，实现色轮取色功能
 * @param e 鼠标事件对象
 */
const handleMouseMove = (e: MouseEvent) => {
  // 如果未处于拖动状态，直接返回
  if (!isDragging.value) return;

  const canvas = canvasRef.value;
  if (!canvas) return;

  // 获取画布相对于视口的位置
  const rect = canvas.getBoundingClientRect();
  // 计算鼠标在画布中的相对坐标
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;

  // 计算鼠标位置相对于圆心的偏移量
  const dx = x - centerX;
  const dy = y - centerY;
  // 计算鼠标到圆心的距离，限制在色轮半径范围内（减去10px边距）
  const distance = Math.min(Math.sqrt(dx * dx + dy * dy), canvas.width / 2 - 10);

  // 计算角度（弧度转角度），atan2 返回值范围是 -180 到 180
  const angle = Math.atan2(dy, dx) * (180 / Math.PI);
  // 将负角度转换为 0-360 范围
  const hue = angle < 0 ? angle + 360 : angle;
  // 根据距离计算饱和度（距离越远，饱和度越高）
  const saturation = (distance / (canvas.width / 2 - 10)) * 100;
  let oldColor = colord(currentColor.value).toHsv();
  // 使用 HSV 颜色模型生成新颜色（色相和饱和度来自鼠标位置，明度固定为100%）
  const newColor = colord({ h: hue, s: saturation, v: oldColor.v }).toHex();
  currentColor.value = newColor;
  // 触发更新事件，通知父组件颜色变化
  emit("update:modelValue", newColor);
  // 更新取色器的位置指示器
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
useEventListener(window, "mousemove", handleMouseMove, { passive: true });
</script>

<template>
  <div class="relative inline-block">
    <canvas
      ref="canvasRef"
      width="200"
      height="200"
      class="cursor-crosshair rounded-full"
      @mousedown="handleMouseDown"
    />
    <div
      ref="pickerRef"
      class="absolute w-5 h-5 border-2 rounded-full shadow-md pointer-events-none"
      style="transform: translate(-50%, -50%)"
    />
  </div>
</template>
