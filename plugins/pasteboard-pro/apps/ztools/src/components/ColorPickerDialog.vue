<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";

type HsvColor = { hue: number; saturation: number; value: number };

const props = defineProps<{
  color: string;
  title: string;
}>();

const emit = defineEmits<{
  apply: [hex: string];
  close: [];
}>();

const HEX_COLOR_PATTERN = /^#[\da-f]{6}$/i;
const HEX_COLOR_HTML_PATTERN = "#[0-9A-Fa-f]{6}";
const PRESET_COLORS = [
  "#FFFFFF", "#E9EDF2", "#A0A8B2", "#68727D", "#2F343B", "#24282E",
  "#6F61EA", "#2F6BC1", "#EFB740", "#D45B71", "#43A987", "#5C6CE7",
];

const dialog = ref<HTMLDialogElement>();
const hexInput = ref<HTMLInputElement>();
const colorPlane = ref<HTMLDivElement>();
const pointerId = ref<number>();
const hue = ref(0);
const saturation = ref(1);
const value = ref(1);
const hexDraft = ref(props.color.toUpperCase());

const validHexDraft = computed(() => HEX_COLOR_PATTERN.test(hexDraft.value));
const hexColor = computed(() => hsvToHex({
  hue: hue.value,
  saturation: saturation.value,
  value: value.value,
}));
const planeStyle = computed(() => ({ "--picker-hue": `${hue.value}deg` }));
const markerStyle = computed(() => ({
  left: `${saturation.value * 100}%`,
  top: `${(1 - value.value) * 100}%`,
}));
const planeValueText = computed(
  () => `${Math.round(saturation.value * 100)}% 饱和度，${Math.round(value.value * 100)}% 明度`,
);

watch(() => props.color, (color) => setHsv(parseHex(color)), { immediate: true });
watch(hexColor, (color) => {
  if (document.activeElement !== hexInput.value) hexDraft.value = color;
});

onMounted(() => {
  if (dialog.value && !dialog.value.open) dialog.value.showModal();
  void nextTick(() => hexInput.value?.focus());
});

onBeforeUnmount(() => {
  releaseCapturedPointer();
  if (dialog.value?.open) dialog.value.close("cancel");
});

function parseHex(hex: string): HsvColor {
  const normalized = HEX_COLOR_PATTERN.test(hex) ? hex.slice(1) : "000000";
  const red = Number.parseInt(normalized.slice(0, 2), 16) / 255;
  const green = Number.parseInt(normalized.slice(2, 4), 16) / 255;
  const blue = Number.parseInt(normalized.slice(4, 6), 16) / 255;
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  const delta = maximum - minimum;
  let colorHue = 0;

  if (delta !== 0) {
    if (maximum === red) colorHue = 60 * (((green - blue) / delta) % 6);
    else if (maximum === green) colorHue = 60 * ((blue - red) / delta + 2);
    else colorHue = 60 * ((red - green) / delta + 4);
  }

  return {
    hue: (colorHue + 360) % 360,
    saturation: maximum === 0 ? 0 : delta / maximum,
    value: maximum,
  };
}

function hsvToHex(color: HsvColor): string {
  const normalizedHue = ((color.hue % 360) + 360) % 360;
  const chroma = color.value * color.saturation;
  const hueSegment = normalizedHue / 60;
  const secondary = chroma * (1 - Math.abs((hueSegment % 2) - 1));
  const match = color.value - chroma;
  let channels: [number, number, number];

  if (hueSegment < 1) channels = [chroma, secondary, 0];
  else if (hueSegment < 2) channels = [secondary, chroma, 0];
  else if (hueSegment < 3) channels = [0, chroma, secondary];
  else if (hueSegment < 4) channels = [0, secondary, chroma];
  else if (hueSegment < 5) channels = [secondary, 0, chroma];
  else channels = [chroma, 0, secondary];

  return `#${channels.map((channel) => Math.round((channel + match) * 255)
    .toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

function setHsv(color: HsvColor): void {
  hue.value = color.hue;
  saturation.value = color.saturation;
  value.value = color.value;
}

function selectHue(event: Event): void {
  hue.value = Number((event.target as HTMLInputElement).value);
}

function updateFromPoint(clientX: number, clientY: number): void {
  const bounds = colorPlane.value?.getBoundingClientRect();
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) return;
  saturation.value = clamp((clientX - bounds.left) / bounds.width);
  value.value = 1 - clamp((clientY - bounds.top) / bounds.height);
}

function startPointer(event: PointerEvent): void {
  if (event.button !== 0 || !colorPlane.value) return;
  event.preventDefault();
  pointerId.value = event.pointerId;
  colorPlane.value.setPointerCapture(event.pointerId);
  updateFromPoint(event.clientX, event.clientY);
}

function movePointer(event: PointerEvent): void {
  if (pointerId.value !== event.pointerId) return;
  updateFromPoint(event.clientX, event.clientY);
}

function stopPointer(event: PointerEvent): void {
  if (pointerId.value !== event.pointerId) return;
  pointerId.value = undefined;
  if (colorPlane.value?.hasPointerCapture(event.pointerId)) {
    colorPlane.value.releasePointerCapture(event.pointerId);
  }
}

function releaseCapturedPointer(): void {
  const activeId = pointerId.value;
  pointerId.value = undefined;
  if (activeId !== undefined && colorPlane.value?.hasPointerCapture(activeId)) {
    colorPlane.value.releasePointerCapture(activeId);
  }
}

function moveWithKeyboard(event: KeyboardEvent): void {
  const saturationStep = event.shiftKey ? 0.1 : 0.02;
  const valueStep = event.shiftKey ? 0.1 : 0.02;
  let changed = true;

  switch (event.key) {
    case "ArrowLeft": saturation.value = clamp(saturation.value - saturationStep); break;
    case "ArrowRight": saturation.value = clamp(saturation.value + saturationStep); break;
    case "ArrowUp": value.value = clamp(value.value + valueStep); break;
    case "ArrowDown": value.value = clamp(value.value - valueStep); break;
    case "Home": saturation.value = 0; break;
    case "End": saturation.value = 1; break;
    case "PageUp": value.value = 1; break;
    case "PageDown": value.value = 0; break;
    default: changed = false;
  }

  if (changed) event.preventDefault();
}

function updateHex(event: Event): void {
  const input = event.target as HTMLInputElement;
  hexDraft.value = input.value;
  if (!HEX_COLOR_PATTERN.test(input.value)) return;
  setHsv(parseHex(input.value));
  hexDraft.value = input.value.toUpperCase();
}

function restoreHex(): void {
  hexDraft.value = HEX_COLOR_PATTERN.test(hexDraft.value)
    ? hexDraft.value.toUpperCase()
    : hexColor.value;
}

function selectPreset(color: string): void {
  setHsv(parseHex(color));
  hexDraft.value = color;
}

function cancel(): void {
  if (dialog.value?.open) dialog.value.close("cancel");
}

function apply(): void {
  if (dialog.value?.open) dialog.value.close("apply");
}

function handleCancel(event: Event): void {
  event.preventDefault();
  cancel();
}

function handleClose(): void {
  if (dialog.value?.returnValue === "apply") emit("apply", hexColor.value.toLowerCase());
  else emit("close");
}

function clamp(input: number): number {
  return Math.min(1, Math.max(0, input));
}
</script>

<template>
  <Teleport to="body">
    <dialog
      ref="dialog"
      class="color-picker-dialog"
      aria-modal="true"
      aria-labelledby="color-picker-dialog-title"
      :style="planeStyle"
      @cancel="handleCancel"
      @keydown.esc.stop.prevent="cancel"
      @close="handleClose"
    >
      <div class="color-picker-dialog__layout">
        <header class="color-picker-dialog__header">
          <div>
            <span class="color-picker-dialog__eyebrow">COLOR</span>
            <h2 id="color-picker-dialog-title">{{ props.title }}</h2>
          </div>
          <button class="color-picker-dialog__close" type="button" aria-label="关闭调色板" @click="cancel">×</button>
        </header>

        <main class="color-picker-dialog__controls">
          <div
            ref="colorPlane"
            class="color-picker-dialog__plane"
            data-pb-color-plane
            role="slider"
            tabindex="0"
            aria-label="饱和度与明度"
            aria-valuemin="0"
            aria-valuemax="100"
            :aria-valuenow="Math.round(saturation * 100)"
            :aria-valuetext="planeValueText"
            @pointerdown="startPointer"
            @pointermove="movePointer"
            @pointerup="stopPointer"
            @pointercancel="stopPointer"
            @lostpointercapture="stopPointer"
            @keydown="moveWithKeyboard"
          >
            <span class="color-picker-dialog__marker" :style="markerStyle" />
          </div>

          <label class="color-picker-dialog__hue">
            <span>色相</span>
            <input
              type="range"
              aria-label="色相"
              min="0"
              max="359"
              step="1"
              :value="Math.round(hue) % 360"
              @input="selectHue"
            />
          </label>

          <div class="color-picker-dialog__hex-row">
            <label class="color-picker-dialog__hex-field">
              <span>颜色代码</span>
              <input
                ref="hexInput"
                type="text"
                aria-label="颜色代码"
                :aria-invalid="!validHexDraft || undefined"
                :pattern="HEX_COLOR_HTML_PATTERN"
                maxlength="7"
                spellcheck="false"
                autocomplete="off"
                :value="hexDraft"
                @input="updateHex"
                @blur="restoreHex"
              />
              <small v-if="!validHexDraft" class="color-picker-field__error" role="alert">请输入完整的 #RRGGBB 颜色值。</small>
            </label>
            <span class="color-picker-dialog__preview" :style="{ backgroundColor: hexColor }" aria-hidden="true" />
          </div>

          <fieldset class="color-picker-dialog__presets">
            <legend>常用颜色</legend>
            <div class="color-picker-dialog__swatches">
              <button
                v-for="color in PRESET_COLORS"
                :key="color"
                type="button"
                class="color-picker-dialog__preset"
                :class="{ 'is-selected': hexColor === color }"
                :style="{ '--preset-color': color }"
                :aria-label="`预设色 ${color}`"
                :aria-pressed="hexColor === color"
                @click="selectPreset(color)"
              />
            </div>
          </fieldset>
        </main>

        <footer class="color-picker-dialog__actions">
          <button class="color-picker-dialog__cancel" type="button" @click="cancel">取消</button>
          <button class="color-picker-dialog__apply" type="button" :disabled="!validHexDraft" @click="apply">应用颜色</button>
        </footer>
      </div>
    </dialog>
  </Teleport>
</template>
