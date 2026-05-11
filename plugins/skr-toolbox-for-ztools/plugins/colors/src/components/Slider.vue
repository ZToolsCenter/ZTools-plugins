<script setup lang="ts">
import { useElementBounding, useEventListener } from "@vueuse/core";
import { computed, ref, useTemplateRef, watch, onMounted, nextTick } from "vue";
export interface Props {
  max?: number;
  min?: number;
  step?: number;
  background?: string;
  enableWheel?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  max: 100,
  min: 0,
  step: 1,
  background: "#03f0fc",
  enableWheel: false,
});
const value = defineModel<number>({
  default: 0,
});

const sliderRef = useTemplateRef("sliderRef");
const thumbRef = useTemplateRef("thumbRef");

const isDragging = ref(false);

/**
 * 将原始值吸附到最近的步进点
 */
const snapToStep = (value: number): number => {
  if (props.step <= 0) return value;
  const steppedValue = Math.round(value / props.step) * props.step;
  return Math.max(props.min, Math.min(props.max, steppedValue));
};

/**
 * 限制值在 min 和 max 范围内
 */
const clampValue = (value: number): number => {
  return Math.max(props.min, Math.min(props.max, value));
};

/**
 * 计算 thumb 的像素位置
 */
const calculateThumbPosition = (percentage: number): number => {
  const sliderWidth = sliderRef.value?.offsetWidth || 0;
  const sliderHeight = sliderRef.value?.offsetHeight || 0;
  const thumbWidth = thumbRef.value?.offsetWidth || 0;

  // 最大移动距离为 slider 宽度减去左右各 h/2 的边距
  const maxOffset = sliderHeight / 2;
  const effectiveWidth = sliderWidth - 2 * maxOffset;

  // 计算在有效区域内的位置
  const positionInEffectiveArea = percentage * effectiveWidth;

  // 加上左边距，得到最终位置
  return maxOffset + positionInEffectiveArea;
};

/**
 * 更新 thumb 的视觉位置
 */
const updateThumbPosition = () => {
  const thumb = thumbRef.value;
  if (!thumb || !sliderRef.value) return;

  const left = calculateThumbPosition(percentage.value);
  thumb.style.left = `${left}px`;
};

/**
 * 根据鼠标事件计算视觉百分比（0-1）
 */
const calculateVisualPercentage = (e: MouseEvent): number => {
  const rect = sliderRef.value!.getBoundingClientRect();
  const sliderHeight = rect.height;
  const maxOffset = sliderHeight / 2;

  // 计算相对于 slider 的位置，考虑左右边距
  const x = e.clientX - rect.left - maxOffset;
  const effectiveWidth = rect.width - 2 * maxOffset;
  const clampedX = Math.max(0, Math.min(x, effectiveWidth));

  return effectiveWidth > 0 ? clampedX / effectiveWidth : 0;
};

// 0-1 百分比计算
const percentage = computed({
  set(percentage: number) {
    // 将百分比转换为实际值
    const rawValue = percentage * (props.max - props.min) + props.min;
    const clampedValue = clampValue(rawValue);

    // 实时更新 value，吸附到最近的步进点
    value.value = snapToStep(clampedValue);
  },
  get() {
    // 将 value 转换为百分比
    if (value.value < props.min) return props.min;
    if (value.value > props.max) return props.max;
    return (value.value - props.min) / (props.max - props.min);
  },
});

/**
 * 监听 value 变化，更新 thumb 位置
 * 注意：只在非拖动状态下更新，避免拖动时跳动
 */
watch(
  value,
  () => {
    if (!isDragging.value) {
      updateThumbPosition();
    }
  },
  { immediate: true },
);

/**
 * 组件挂载后确保 thumb 位置正确
 */
onMounted(async () => {
  await nextTick();
  await nextTick(); // 等待两次以确保 DOM 完全渲染
  updateThumbPosition();
});

/**
 * 开始拖动
 */
const handleMouseDown = (e: MouseEvent) => {
  isDragging.value = true;
  handleMouseMove(e);
};

/**
 * 拖动中：thumb 跟随鼠标，value 实时吸附更新
 */
const handleMouseMove = (e: MouseEvent) => {
  if (!isDragging.value || !sliderRef.value) return;

  // 1. 计算视觉百分比（基于鼠标位置）
  const visualPercentage = calculateVisualPercentage(e);

  // 2. 直接更新 thumb 的视觉位置（跟随鼠标，连续平滑）
  const thumb = thumbRef.value;
  if (thumb) {
    const left = calculateThumbPosition(visualPercentage);
    thumb.style.left = `${left}px`;
  }

  // 3. 更新 value（会吸附到最近的步进点）
  percentage.value = visualPercentage;
};

/**
 * 结束拖动：添加平滑过渡效果
 */
const handleMouseUp = () => {
  isDragging.value = false;

  // 添加过渡动画，让吸附行为更平滑
  const thumb = thumbRef.value;
  if (thumb) {
    thumb.style.transition = "left 0.2s ease-in-out";

    // 过渡结束后移除 transition，避免影响下次拖动
    setTimeout(() => {
      if (thumb) {
        thumb.style.transition = "";
      }
    }, 200);
  }
};
/**
 * 处理滚轮事件
 */
const handleWheel = (e: WheelEvent) => {
  if (!props.enableWheel || !sliderRef.value) return;

  e.preventDefault();

  // 根据滚轮方向调整值
  const delta = e.deltaY > 0 ? -props.step : props.step;

  // 如果按下 Shift 键，提升滑动速度（10倍）
  const speedMultiplier = e.shiftKey ? 10 : 1;
  let newValue = value.value + delta * speedMultiplier;

  // 确保值在有效范围内
  newValue = clampValue(newValue);
  // 吸附到最近的步进点
  newValue = snapToStep(newValue);

  value.value = newValue;
};

useEventListener(document, ["mouseup", "mouseleave", "visibilitychange"], () => {
  updateThumbPosition();
  handleMouseUp();
});

useEventListener(document, "mousemove", handleMouseMove, { passive: true });

// 如果启用了滚轮功能，则添加滚轮事件监听器
if (props.enableWheel) {
  useEventListener(sliderRef, "wheel", handleWheel, { passive: false });
}
</script>
<template>
  <div
    ref="sliderRef"
    :class="['relative h-6 cursor-pointer rounded-full p-0']"
    :style="{ background: background }"
    @mousedown.prevent="handleMouseDown"
  >
    <div
      ref="thumbRef"
      :class="[
        'pointer-events-none absolute top-1/2 m-0  h-4 w-4 rounded-full bg-white shadow-md outline outline-gray-300',
      ]"
      style="transform: translate(-50%, -50%)"
    />
  </div>
</template>
