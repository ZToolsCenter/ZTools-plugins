<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";

import ColorPickerDialog from "./ColorPickerDialog.vue";
import "../styles/color-picker.css";

const props = withDefaults(defineProps<{
  modelValue: string;
  label: string;
  disabled?: boolean;
}>(), {
  disabled: false,
});

const emit = defineEmits<{
  "update:modelValue": [value: string];
}>();

const HEX_COLOR_PATTERN = /^#[\da-f]{6}$/i;
const HEX_COLOR_HTML_PATTERN = "#[0-9A-Fa-f]{6}";
const dialogOpen = ref(false);
const hexInput = ref<HTMLInputElement>();
const swatchButton = ref<HTMLButtonElement>();
const hexDraft = ref(props.modelValue.toLowerCase());
const invalidHex = ref(false);

const normalizedColor = computed(() => HEX_COLOR_PATTERN.test(props.modelValue)
  ? props.modelValue.toLowerCase()
  : "#000000");
const swatchLabel = computed(() => `${props.label.replace(/^选择/u, "")}调色板`);

watch(() => props.modelValue, (value) => {
  if (document.activeElement !== hexInput.value) {
    hexDraft.value = value.toLowerCase();
    invalidHex.value = false;
  }
});

function openDialog(): void {
  if (props.disabled) return;
  dialogOpen.value = true;
}

function updateHexDraft(event: Event): void {
  const value = (event.target as HTMLInputElement).value;
  const isValid = HEX_COLOR_PATTERN.test(value);
  hexDraft.value = value.toLowerCase();
  invalidHex.value = value.length > 0 && !isValid;
  if (!isValid) return;
  invalidHex.value = false;
  emit("update:modelValue", value.toLowerCase());
}

function restoreHexDraft(): void {
  if (!HEX_COLOR_PATTERN.test(hexDraft.value)) {
    hexDraft.value = normalizedColor.value;
  } else {
    hexDraft.value = hexDraft.value.toLowerCase();
  }
  invalidHex.value = false;
}

function closeDialog(): void {
  dialogOpen.value = false;
  void nextTick(() => swatchButton.value?.focus());
}

function applyDialogColor(color: string): void {
  emit("update:modelValue", color.toLowerCase());
  hexDraft.value = color.toLowerCase();
  closeDialog();
}
</script>

<template>
  <div class="color-picker-field">
    <button
      ref="swatchButton"
      class="color-picker-field__swatch"
      type="button"
      :aria-label="swatchLabel"
      :disabled="props.disabled"
      @click="openDialog"
    >
      <span class="color-picker-field__swatch-color" :style="{ backgroundColor: normalizedColor }" />
    </button>
    <div class="color-picker-field__value">
      <input
        ref="hexInput"
        class="color-picker-field__hex"
        type="text"
        :aria-label="props.label"
        :aria-invalid="invalidHex || undefined"
        :pattern="HEX_COLOR_HTML_PATTERN"
        maxlength="7"
        spellcheck="false"
        autocomplete="off"
        :disabled="props.disabled"
        :value="hexDraft"
        @input="updateHexDraft"
        @blur="restoreHexDraft"
      />
      <small v-if="invalidHex" class="color-picker-field__error" role="alert">请输入完整的 #RRGGBB 颜色值。</small>
    </div>
    <ColorPickerDialog
      v-if="dialogOpen"
      :color="normalizedColor"
      :title="swatchLabel"
      @apply="applyDialogColor"
      @close="closeDialog"
    />
  </div>
</template>
