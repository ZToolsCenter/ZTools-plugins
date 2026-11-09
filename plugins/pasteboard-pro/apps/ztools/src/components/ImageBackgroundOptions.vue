<script setup lang="ts">
import { computed, ref, watch } from "vue";

import type { ThemeImageLayout } from "../../preload/window-theme-preferences";

const props = withDefaults(
  defineProps<{
    layout: ThemeImageLayout;
    tilesPerRow: number;
    frosted: boolean;
    frostedIntensity?: number | undefined;
  }>(),
  { frostedIntensity: 50 },
);

const emit = defineEmits<{
  "update:layout": [value: ThemeImageLayout];
  "update:tilesPerRow": [value: number];
  "update:frosted": [value: boolean];
  "update:frostedIntensity": [value: number];
}>();

const layoutOptions: ReadonlyArray<{
  value: ThemeImageLayout;
  label: string;
}> = [
  { value: "cover", label: "铺满" },
  { value: "contain", label: "完整显示" },
  { value: "tile", label: "平铺" },
  { value: "repeat-x", label: "单行重复" },
];
const validLayouts = new Set(layoutOptions.map(({ value }) => value));
const showTileCount = computed(
  () => props.layout === "tile" || props.layout === "repeat-x",
);
const layoutHint = computed(() => {
  switch (props.layout) {
    case "cover":
      return "保持图片比例铺满窗口；窗口比例不同时会裁切图片。";
    case "contain":
      return "保持图片比例并完整显示；窗口比例不同时会留下空白区域。";
    case "tile":
      return `保持图片比例，按每行 ${normalizeCount(props.tilesPerRow)} 格在窗口中横向和纵向重复平铺。`;
    case "repeat-x":
      return `保持图片比例，将一行分成 ${normalizeCount(props.tilesPerRow)} 格铺满窗口；每格可能会裁切图片。`;
  }
});

const countDraft = ref(String(normalizeCount(props.tilesPerRow)));
watch(
  () => props.tilesPerRow,
  (value) => {
    countDraft.value = String(normalizeCount(value));
  },
);

function normalizeCount(value: number): number {
  if (!Number.isFinite(value)) return 3;
  return Math.max(1, Math.min(12, Math.round(value)));
}

function updateLayout(event: Event): void {
  const target = event.target;
  if (!(target instanceof HTMLSelectElement)) return;
  const value = target.value;
  if (validLayouts.has(value as ThemeImageLayout)) {
    emit("update:layout", value as ThemeImageLayout);
  }
}

function updateCountDraft(event: Event): void {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;
  countDraft.value = target.value;

  if (target.value.trim() === "") return;
  const value = Number(target.value);
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 1 || value > 12) return;
  emit("update:tilesPerRow", value);
}

function normalizeCountDraft(event: FocusEvent): void {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;
  const parsed = Number(target.value);
  const value = target.value.trim() === "" || !Number.isFinite(parsed)
    ? 3
    : normalizeCount(parsed);
  countDraft.value = String(value);
  emit("update:tilesPerRow", value);
}

function updateFrosted(event: Event): void {
  const target = event.target;
  if (target instanceof HTMLInputElement) emit("update:frosted", target.checked);
}

function updateIntensity(event: Event): void {
  const target = event.target;
  if (target instanceof HTMLInputElement) {
    emit("update:frostedIntensity", Number(target.value));
  }
}
</script>

<template>
  <div class="image-background-options">
    <label class="settings-field image-background-options__layout">
      <span>图片渲染方式</span>
      <select :value="props.layout" @change="updateLayout">
        <option v-for="option in layoutOptions" :key="option.value" :value="option.value">
          {{ option.label }}
        </option>
      </select>
    </label>
    <p class="image-background-options__hint" aria-live="polite">{{ layoutHint }}</p>

    <label v-if="showTileCount" class="settings-field image-background-options__count">
      <span>每行图片数量</span>
      <input
        :value="countDraft"
        type="number"
        inputmode="numeric"
        min="1"
        max="12"
        step="1"
        aria-label="每行图片数量"
        @input="updateCountDraft"
        @blur="normalizeCountDraft"
      />
    </label>

    <label class="settings-toggle image-background-options__frosted">
      <span>
        <strong>磨砂效果</strong>
        <small>在背景图片上叠加柔和的磨砂层，降低对内容的干扰。</small>
      </span>
      <input
        type="checkbox"
        aria-label="磨砂效果"
        :checked="props.frosted"
        @change="updateFrosted"
      />
    </label>

    <div v-if="props.frosted" class="image-background-options__intensity">
      <div class="image-background-options__intensity-header">
        <span>磨砂强度</span>
        <span class="image-background-options__intensity-value">{{ props.frostedIntensity ?? 50 }}%</span>
      </div>
      <input
        type="range"
        min="1"
        max="100"
        step="1"
        :value="props.frostedIntensity ?? 50"
        aria-label="磨砂强度"
        class="image-background-options__slider"
        @input="updateIntensity"
      />
    </div>
  </div>
</template>

<style scoped src="../styles/image-background-options.css"></style>
