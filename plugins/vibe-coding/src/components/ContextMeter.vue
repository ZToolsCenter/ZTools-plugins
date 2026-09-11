<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from "vue";

const props = defineProps({
  usedTokens: { type: Number, default: 0 },
  contextWindow: { type: Number, default: 0 },
  breakdown: { type: Object, default: () => ({}) },
});

const open = ref(false);
const root = ref(null);
const radius = 5.5;
const circumference = 2 * Math.PI * radius;
const available = computed(
  () => props.contextWindow > 0 && props.usedTokens >= 0,
);
const percent = computed(() =>
  Math.min(
    100,
    Math.max(0, Math.round((props.usedTokens / props.contextWindow) * 100)),
  ),
);
const dashArray = computed(
  () => `${(circumference * percent.value) / 100} ${circumference}`,
);
const breakdownTotal = computed(() =>
  ["systemTokens", "toolsTokens", "messageTokens"].reduce(
    (total, key) => total + Math.max(0, Number(props.breakdown?.[key]) || 0),
    0,
  ),
);
const segments = computed(() => {
  const total = breakdownTotal.value;
  if (!total) return [{ key: "total", width: percent.value }];
  return [
    {
      key: "system",
      width: (percent.value * props.breakdown.systemTokens) / total,
    },
    {
      key: "tools",
      width: (percent.value * props.breakdown.toolsTokens) / total,
    },
    {
      key: "messages",
      width: (percent.value * props.breakdown.messageTokens) / total,
    },
  ].filter((segment) => segment.width > 0);
});

/**
 * 将 token 数按每 1024 个为 1k 格式化为紧凑文本。
 * @param {number} value 待格式化的 token 数。
 * @returns {string} 最多保留一位小数并带 k 后缀的文本。
 */
function formatTokens(value) {
  const thousands = Math.max(0, Number(value) || 0) / 1024;
  return `${thousands.toLocaleString("zh-CN", { minimumFractionDigits: 0, maximumFractionDigits: 1 })}k`;
}

/**
 * 关闭上下文占用详情面板。
 * @returns {void} 无返回值。
 */
function close() {
  open.value = false;
}

/**
 * 在点击组件外部或按下 Escape 时关闭详情面板。
 * @param {PointerEvent|KeyboardEvent} event 文档级交互事件。
 * @returns {void} 无返回值。
 */
function handleDocumentInteraction(event) {
  if (!open.value) return;
  if (event instanceof KeyboardEvent && event.key === "Escape") {
    close();
    return;
  }
  if (
    event instanceof PointerEvent &&
    event.target instanceof Node &&
    !root.value?.contains(event.target)
  )
    close();
}

onMounted(() => {
  document.addEventListener("pointerdown", handleDocumentInteraction);
  document.addEventListener("keydown", handleDocumentInteraction);
});

onBeforeUnmount(() => {
  // 组件卸载时释放文档监听，避免会话页面重复挂载后累积处理器。
  document.removeEventListener("pointerdown", handleDocumentInteraction);
  document.removeEventListener("keydown", handleDocumentInteraction);
});
</script>

<template>
  <span v-if="available" ref="root" class="context-meter">
    <button
      class="context-meter-trigger"
      type="button"
      v-tooltip="{
        label: `上下文已用 ${percent}%`,
        side: 'top',
        delayMs: 200,
        disabled: open,
      }"
      :aria-label="`上下文已用 ${percent}%`"
      :aria-expanded="open"
      @click="open = !open"
    >
      <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden="true">
        <circle class="context-meter-track" cx="7" cy="7" :r="radius" />
        <circle
          class="context-meter-fill"
          cx="7"
          cy="7"
          :r="radius"
          :stroke-dasharray="dashArray"
          transform="rotate(-90 7 7)"
        />
      </svg>
    </button>
    <div
      v-if="open"
      class="context-meter-panel"
      role="dialog"
      aria-label="上下文使用情况"
    >
      <div class="context-meter-header">
        <span class="context-meter-headline">上下文已用</span>
        <strong>{{ percent }}%</strong>
        <span class="context-meter-figures"
          >~{{ formatTokens(usedTokens) }} /
          {{ formatTokens(contextWindow) }}</span
        >
      </div>
      <div class="context-meter-bar">
        <span
          v-for="segment in segments"
          :key="segment.key"
          class="context-meter-segment"
          :class="`is-${segment.key}`"
          :style="{ width: `${segment.width}%` }"
        ></span>
      </div>
      <dl v-if="breakdownTotal" class="context-meter-rows">
        <div>
          <dt><i class="is-system"></i>系统提示词</dt>
          <dd>~{{ formatTokens(breakdown.systemTokens) }}</dd>
        </div>
        <div>
          <dt><i class="is-tools"></i>工具定义</dt>
          <dd>~{{ formatTokens(breakdown.toolsTokens) }}</dd>
        </div>
        <div>
          <dt><i class="is-messages"></i>对话消息</dt>
          <dd>~{{ formatTokens(breakdown.messageTokens) }}</dd>
        </div>
      </dl>
    </div>
  </span>
</template>
