<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
} from "@lucide/vue";

const props = defineProps({
  modelOptions: { type: Array, default: () => [] },
  modelValue: { type: String, default: "" },
  reasoningOptions: { type: Array, default: () => [] },
  reasoningValue: { type: String, default: "" },
});
const emit = defineEmits(["update:modelValue", "update:reasoningValue"]);
const root = ref(null);
const trigger = ref(null);
const options = ref(null);
const open = ref(false);
const view = ref("overview");
const selectedModel = computed(
  () =>
    props.modelOptions.find((option) => option.value === props.modelValue) ||
    null,
);
const selectedReasoning = computed(
  () =>
    props.reasoningOptions.find(
      (option) => option.value === props.reasoningValue,
    ) || null,
);
const triggerModelLabel = computed(
  () => selectedModel.value?.model || selectedModel.value?.label || "选择模型",
);
const triggerReasoningLabel = computed(
  () => selectedReasoning.value?.label || "",
);

/**
 * 打开或关闭模型设置弹窗，并在每次打开时回到概览视图。
 * @returns {void} 无返回值。
 */
function toggleMenu() {
  if (!props.modelOptions.length) return;
  open.value = !open.value;
  if (open.value) view.value = "overview";
}

/**
 * 关闭模型设置弹窗并按需把焦点交还触发按钮。
 * @param {boolean} restoreFocus 是否恢复触发按钮焦点。
 * @returns {void} 无返回值。
 */
function closeMenu(restoreFocus = false) {
  open.value = false;
  view.value = "overview";
  if (restoreFocus) nextTick(() => trigger.value?.focus());
}

/**
 * 从概览进入模型或推理等级列表，并把当前选中项定位到可视区域中央。
 * @param {'models'|'reasoning'} target 目标选择列表。
 * @returns {Promise<void>} 列表渲染并完成选中项定位后的 Promise。
 */
async function openView(target) {
  view.value = target;
  await nextTick();

  // 列表可能包含大量模型，进入时直接恢复当前选择附近的位置。
  const selectedOption = options.value?.querySelector('[aria-checked="true"]');
  selectedOption?.scrollIntoView({ block: "center", inline: "nearest" });
}

/**
 * 选择模型并关闭弹窗。
 * @param {string} value 宿主模型稳定标识。
 * @returns {void} 无返回值。
 */
function selectModel(value) {
  emit("update:modelValue", value);
  closeMenu(true);
}

/**
 * 选择推理等级并关闭弹窗。
 * @param {string} value 标准推理等级标识。
 * @returns {void} 无返回值。
 */
function selectReasoning(value) {
  emit("update:reasoningValue", value);
  closeMenu(true);
}

/**
 * 在点击组件外部或按下 Escape 时关闭弹窗。
 * @param {PointerEvent|KeyboardEvent} event 文档级交互事件。
 * @returns {void} 无返回值。
 */
function handleDocumentInteraction(event) {
  if (!open.value) return;
  if (event instanceof KeyboardEvent && event.key === "Escape") {
    closeMenu(true);
    return;
  }
  if (
    event instanceof PointerEvent &&
    event.target instanceof Node &&
    !root.value?.contains(event.target)
  ) {
    closeMenu(false);
  }
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
  <div ref="root" class="model-reasoning-picker" :class="{ open }">
    <button
      ref="trigger"
      class="model-reasoning-trigger"
      type="button"
      aria-label="选择模型和推理等级"
      aria-haspopup="dialog"
      :aria-expanded="open"
      :disabled="!modelOptions.length"
      :data-model-value="modelValue"
      :data-reasoning-value="reasoningValue"
      @click="toggleMenu"
    >
      <span class="model-reasoning-name">{{ triggerModelLabel }}</span>
      <span v-if="triggerReasoningLabel" class="model-reasoning-effort">{{
        triggerReasoningLabel
      }}</span>
      <ChevronUp v-if="open" :size="14" />
      <ChevronDown v-else :size="14" />
    </button>

    <section
      v-if="open"
      class="model-reasoning-popover"
      role="dialog"
      aria-label="模型设置"
    >
      <div v-if="view === 'overview'" class="model-reasoning-overview">
        <button
          class="model-reasoning-row"
          type="button"
          aria-label="选择模型"
          @click="openView('models')"
        >
          <span>模型</span>
          <strong>{{ triggerModelLabel }}</strong>
          <ChevronRight :size="16" />
        </button>
        <button
          v-if="reasoningOptions.length"
          class="model-reasoning-row"
          type="button"
          aria-label="选择推理等级"
          @click="openView('reasoning')"
        >
          <span>推理等级</span>
          <strong>{{ triggerReasoningLabel }}</strong>
          <ChevronRight :size="16" />
        </button>
      </div>

      <template v-else>
        <button
          class="model-reasoning-back"
          type="button"
          aria-label="返回模型设置"
          @click="openView('overview')"
        >
          <ChevronLeft :size="16" />
          <strong>{{ view === "models" ? "选择模型" : "选择推理等级" }}</strong>
        </button>
        <div ref="options" class="model-reasoning-options" role="menu">
          <button
            v-for="option in view === 'models'
              ? modelOptions
              : reasoningOptions"
            :key="option.value"
            class="model-reasoning-option"
            type="button"
            role="menuitemradio"
            :aria-checked="
              view === 'models'
                ? option.value === modelValue
                : option.value === reasoningValue
            "
            :data-value="option.value"
            @click="
              view === 'models'
                ? selectModel(option.value)
                : selectReasoning(option.value)
            "
          >
            <span>{{ option.label }}</span>
            <Check
              v-if="
                view === 'models'
                  ? option.value === modelValue
                  : option.value === reasoningValue
              "
              :size="16"
            />
          </button>
        </div>
      </template>
    </section>
  </div>
</template>
