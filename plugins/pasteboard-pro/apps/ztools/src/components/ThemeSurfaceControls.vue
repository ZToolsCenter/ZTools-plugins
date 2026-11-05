<script setup lang="ts">
import { computed } from "vue";
import ColorPickerField from "./ColorPickerField.vue";

type CardBackground = Readonly<{ color: string; opacity: number }>;

const props = defineProps<{
  cardBackground?: CardBackground | undefined;
  backgroundBaseColor?: string | undefined;
  darkMode: boolean;
  backgroundMode?: "default" | "color" | "image";
}>();

const emit = defineEmits<{
  "update:cardBackground": [value: CardBackground | undefined];
  "update:backgroundBaseColor": [value: string | undefined];
}>();

const baseDisabled = computed(() => props.backgroundMode === "color");
const defaultCardColor = computed(() => props.darkMode ? "#2f343b" : "#ffffff");
const defaultBaseColor = computed(() => props.darkMode ? "#24282e" : "#f5f6f8");
const cardColor = computed(() => props.cardBackground?.color ?? defaultCardColor.value);
const cardOpacity = computed(() => Math.round((props.cardBackground?.opacity ?? 1) * 100));
const cardOpacityTrack = computed(
  () => `linear-gradient(90deg, var(--settings-accent) ${cardOpacity.value}%, var(--settings-line) ${cardOpacity.value}%)`,
);

function setCardEnabled(enabled: boolean): void {
  emit("update:cardBackground", enabled
    ? props.cardBackground ?? { color: defaultCardColor.value, opacity: 1 }
    : undefined);
}

function updateCardColor(color: string): void {
  emit("update:cardBackground", {
    color,
    opacity: props.cardBackground?.opacity ?? 1,
  });
}

function updateCardOpacity(value: number): void {
  if (!Number.isFinite(value)) return;
  emit("update:cardBackground", {
    color: props.cardBackground?.color ?? defaultCardColor.value,
    opacity: Math.max(0, Math.min(100, Math.round(value))) / 100,
  });
}

function setBaseEnabled(enabled: boolean): void {
  emit("update:backgroundBaseColor", enabled ? defaultBaseColor.value : undefined);
}

function updateBaseColor(color: string): void {
  emit("update:backgroundBaseColor", color);
}
</script>

<template>
  <div class="theme-surface-controls">
    <section class="theme-surface-control" aria-labelledby="card-background-title">
      <label class="settings-toggle theme-surface-control__toggle">
        <span>
          <strong id="card-background-title">卡片底色</strong>
          <small>自定义主卡片颜色和不透明度，方便配合背景图片。</small>
        </span>
        <input
          type="checkbox"
          aria-label="自定义卡片底色"
          :checked="props.cardBackground !== undefined"
          @change="setCardEnabled(($event.target as HTMLInputElement).checked)"
        />
      </label>

      <div v-if="props.cardBackground" class="theme-surface-control__detail">
        <div class="theme-surface-control__color">
          <span>卡片颜色</span>
          <ColorPickerField :model-value="cardColor" label="选择卡片底色" @update:model-value="updateCardColor" />
        </div>
        <label class="theme-surface-control__opacity">
          <span><span>卡片不透明度</span><output>{{ cardOpacity }}%</output></span>
          <input
            type="range"
            aria-label="卡片不透明度"
            min="0"
            max="100"
            step="1"
            :value="cardOpacity"
            :style="{ '--surface-range-track': cardOpacityTrack }"
            @input="updateCardOpacity(Number(($event.target as HTMLInputElement).value))"
          />
        </label>
        <button type="button" class="quiet-action theme-surface-control__reset" @click="setCardEnabled(false)">恢复默认卡片底色</button>
        <small v-if="cardOpacity < 100" class="theme-surface-control__hint">降低不透明度会透出背景，可调高以提升文字辨识度。</small>
      </div>
    </section>

    <section v-if="props.backgroundMode !== 'image'" class="theme-surface-control" aria-labelledby="background-base-title">
      <label class="settings-toggle theme-surface-control__toggle">
        <span>
          <strong id="background-base-title">背景底色</strong>
          <small>{{ baseDisabled ? '纯色背景请使用下方的“背景颜色”设置。' : '自定义窗口底色；图片背景使用独立的渲染设置。' }}</small>
        </span>
        <input
          type="checkbox"
          aria-label="自定义背景底色"
          :disabled="baseDisabled"
          :checked="props.backgroundBaseColor !== undefined"
          @change="setBaseEnabled(($event.target as HTMLInputElement).checked)"
        />
      </label>

      <div v-if="props.backgroundBaseColor !== undefined" class="theme-surface-control__detail">
        <div class="theme-surface-control__color">
          <span>背景颜色</span>
          <ColorPickerField :model-value="props.backgroundBaseColor" label="选择背景底色" :disabled="baseDisabled" @update:model-value="updateBaseColor" />
        </div>
        <button type="button" class="quiet-action theme-surface-control__reset" :disabled="baseDisabled" @click="setBaseEnabled(false)">恢复默认背景底色</button>
      </div>
    </section>
  </div>
</template>

<style scoped src="../styles/theme-surface-controls.css"></style>
