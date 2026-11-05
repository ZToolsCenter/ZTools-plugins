<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";

import {
  constrainImageCrop,
  exportEditedImage,
  fitImageCrop,
  loadEditableImage,
  renderImagePreview,
  resizeImageCrop,
  rotatedImageSize,
  type ImageCrop,
  type ImageCropHandle,
  type ImageDimensions,
  type ImageRotation,
} from "../theme-image-edit";

const props = defineProps<{ imageDataUrl: string }>();
const emit = defineEmits<{
  apply: [dataUrl: string];
  close: [];
}>();

const dialog = ref<HTMLElement | null>(null);
const canvas = ref<HTMLCanvasElement | null>(null);
const cropElement = ref<HTMLElement | null>(null);
const image = ref<HTMLImageElement>();
const loadError = ref("");
const editError = ref("");
const exporting = ref(false);
const rotation = ref<ImageRotation>(0);
const ratioOption = ref("original");
const crop = ref<ImageCrop>({ x: 0, y: 0, width: 1, height: 1 });
const outputWidth = ref(1);
const focusedBeforeOpen = document.activeElement instanceof HTMLElement
  ? document.activeElement
  : undefined;
let pointerDrag: Readonly<{
  pointerId: number;
  mode: "move" | ImageCropHandle;
  startX: number;
  startY: number;
  origin: ImageCrop;
}> | undefined;

const aspectOptions = computed(() => [
  { value: "original", label: "原图比例" },
  { value: "free", label: "自由裁切" },
  { value: "1:1", label: "1:1" },
  { value: "4:3", label: "4:3" },
  { value: "16:9", label: "16:9" },
  { value: "shelf", label: "横向浮窗" },
]);
const sourceSize = computed<ImageDimensions | undefined>(() =>
  image.value === undefined
    ? undefined
    : { width: image.value.naturalWidth, height: image.value.naturalHeight },
);
const orientedSize = computed<ImageDimensions | undefined>(() =>
  sourceSize.value === undefined
    ? undefined
    : rotatedImageSize(sourceSize.value, rotation.value),
);
const aspectRatio = computed<number | undefined>(() => {
  if (orientedSize.value === undefined || ratioOption.value === "free") return undefined;
  if (ratioOption.value === "original") {
    return orientedSize.value.width / orientedSize.value.height;
  }
  if (ratioOption.value === "shelf") {
    return Math.max(1, window.screen.width / 360);
  }
  const [width, height] = ratioOption.value.split(":").map(Number);
  return width !== undefined && height !== undefined ? width / height : undefined;
});
const cropStyle = computed(() => ({
  left: `${crop.value.x * 100}%`,
  top: `${crop.value.y * 100}%`,
  width: `${crop.value.width * 100}%`,
  height: `${crop.value.height * 100}%`,
}));
const cropPixelSize = computed(() => {
  if (orientedSize.value === undefined) return { width: 1, height: 1 };
  return {
    width: orientedSize.value.width * crop.value.width,
    height: orientedSize.value.height * crop.value.height,
  };
});
const outputHeight = computed({
  get: () => Math.max(1, Math.round(outputWidth.value * cropPixelSize.value.height / cropPixelSize.value.width)),
  set: (height: number) => {
    const width = Math.round(height * cropPixelSize.value.width / cropPixelSize.value.height);
    outputWidth.value = clampOutputWidth(width);
  },
});
const maxWidthFromAspect = computed(() => Math.sqrt(
  16_000_000 * cropPixelSize.value.width / cropPixelSize.value.height,
));
const maximumOutputWidth = computed(() => Math.max(1, Math.floor(Math.min(
  4096,
  4096 * cropPixelSize.value.width / cropPixelSize.value.height,
  maxWidthFromAspect.value,
))));
const hasImage = computed(() => image.value !== undefined && loadError.value.length === 0);

function clampOutputWidth(value: number): number {
  return Math.max(1, Math.min(maximumOutputWidth.value, Math.round(value)));
}

function updateOutputWidth(value: number): void {
  if (!Number.isFinite(value)) return;
  outputWidth.value = clampOutputWidth(value);
}

function selectRatio(value: string): void {
  ratioOption.value = value;
  if (orientedSize.value === undefined) return;
  crop.value = aspectRatio.value === undefined
    ? { x: 0, y: 0, width: 1, height: 1 }
    : fitImageCrop(orientedSize.value, aspectRatio.value);
  outputWidth.value = clampOutputWidth(cropPixelSize.value.width);
}

function rotate(direction: -1 | 1): void {
  rotation.value = ((rotation.value + direction * 90 + 360) % 360) as ImageRotation;
  nextTick(() => resetCropForCurrentRatio());
}

function resetCropForCurrentRatio(): void {
  if (orientedSize.value === undefined) return;
  crop.value = aspectRatio.value === undefined
    ? { x: 0, y: 0, width: 1, height: 1 }
    : fitImageCrop(orientedSize.value, aspectRatio.value);
  outputWidth.value = clampOutputWidth(cropPixelSize.value.width);
}

function resetImage(): void {
  rotation.value = 0;
  ratioOption.value = "original";
  nextTick(() => resetCropForCurrentRatio());
}

function beginCropDrag(event: PointerEvent): void {
  if (event.button !== 0 || canvas.value === null || cropElement.value === null) return;
  const bounds = canvas.value.getBoundingClientRect();
  if (bounds.width <= 0 || bounds.height <= 0) return;
  const handle = (event.target as HTMLElement).closest<HTMLElement>("[data-pb-crop-handle]")
    ?.dataset.pbCropHandle;
  const mode: "move" | ImageCropHandle = handle === "nw" || handle === "ne" || handle === "sw" || handle === "se"
    ? handle
    : "move";
  event.preventDefault();
  pointerDrag = {
    pointerId: event.pointerId,
    mode,
    startX: event.clientX,
    startY: event.clientY,
    origin: crop.value,
  };
  try { cropElement.value.setPointerCapture(event.pointerId); } catch { /* The pointer may have ended. */ }
}

function moveCropDrag(event: PointerEvent): void {
  const drag = pointerDrag;
  if (drag === undefined || drag.pointerId !== event.pointerId || canvas.value === null) return;
  const bounds = canvas.value.getBoundingClientRect();
  if (bounds.width <= 0 || bounds.height <= 0) return;
  const dx = (event.clientX - drag.startX) / bounds.width;
  const dy = (event.clientY - drag.startY) / bounds.height;
  if (drag.mode === "move") {
    crop.value = constrainImageCrop({
      ...drag.origin,
      x: Math.max(0, Math.min(1 - drag.origin.width, drag.origin.x + dx)),
      y: Math.max(0, Math.min(1 - drag.origin.height, drag.origin.y + dy)),
    });
  } else if (orientedSize.value !== undefined) {
    crop.value = resizeImageCrop(
      drag.origin,
      drag.mode,
      { x: dx, y: dy },
      orientedSize.value,
      aspectRatio.value,
    );
  }
  outputWidth.value = clampOutputWidth(outputWidth.value);
}

function endCropDrag(event: PointerEvent): void {
  if (pointerDrag?.pointerId !== event.pointerId) return;
  pointerDrag = undefined;
  try {
    if (cropElement.value?.hasPointerCapture(event.pointerId)) {
      cropElement.value.releasePointerCapture(event.pointerId);
    }
  } catch { /* The browser has already released the pointer. */ }
}

function handleCropKey(event: KeyboardEvent): void {
  const keyDelta: Record<string, Readonly<{ x: number; y: number }>> = {
    ArrowLeft: { x: -0.01, y: 0 },
    ArrowRight: { x: 0.01, y: 0 },
    ArrowUp: { x: 0, y: -0.01 },
    ArrowDown: { x: 0, y: 0.01 },
  };
  const delta = keyDelta[event.key];
  if (delta === undefined || orientedSize.value === undefined) return;
  event.preventDefault();
  event.stopPropagation();
  const scale = event.shiftKey ? 5 : 1;
  const handle = (event.target as HTMLElement).closest<HTMLElement>("[data-pb-crop-handle]")
    ?.dataset.pbCropHandle;
  if (handle === "nw" || handle === "ne" || handle === "sw" || handle === "se") {
    crop.value = resizeImageCrop(
      crop.value,
      handle,
      { x: delta.x * scale, y: delta.y * scale },
      orientedSize.value,
      aspectRatio.value,
    );
  } else {
    crop.value = constrainImageCrop({
      ...crop.value,
      x: Math.max(0, Math.min(1 - crop.value.width, crop.value.x + delta.x * scale)),
      y: Math.max(0, Math.min(1 - crop.value.height, crop.value.y + delta.y * scale)),
    });
  }
}

async function applyImage(): Promise<void> {
  if (!hasImage.value || exporting.value) return;
  exporting.value = true;
  editError.value = "";
  try {
    const edited = await exportEditedImage(image.value!, {
      rotation: rotation.value,
      crop: crop.value,
      width: outputWidth.value,
      height: outputHeight.value,
    });
    emit("apply", edited);
  } catch (error) {
    editError.value = error instanceof Error ? error.message : "图片导出失败，请调整尺寸后重试";
  } finally {
    exporting.value = false;
  }
}

function containDialogTab(event: KeyboardEvent): void {
  if (event.key !== "Tab" || dialog.value === null) return;
  const focusable = [...dialog.value.querySelectorAll<HTMLElement>(
    'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )].filter((element) => element.tabIndex >= 0 && element.getClientRects().length > 0);
  const first = focusable[0];
  const last = focusable.at(-1);
  if (first === undefined || last === undefined) {
    event.preventDefault();
    dialog.value.focus({ preventScroll: true });
  } else if (document.activeElement === dialog.value || !dialog.value.contains(document.activeElement)) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus({ preventScroll: true });
  } else if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus({ preventScroll: true });
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus({ preventScroll: true });
  }
}

watch([image, rotation], async () => {
  await nextTick();
  if (image.value !== undefined && canvas.value !== null) {
    renderImagePreview(canvas.value, image.value, rotation.value);
  }
}, { flush: "post" });

onMounted(async () => {
  try {
    image.value = await loadEditableImage(props.imageDataUrl);
    resetCropForCurrentRatio();
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : "无法读取所选图片";
  }
  await nextTick();
  dialog.value?.querySelector<HTMLElement>("button:not([disabled]), input:not([disabled]), select:not([disabled])")
    ?.focus({ preventScroll: true });
});

onBeforeUnmount(() => {
  pointerDrag = undefined;
  if (focusedBeforeOpen?.isConnected) focusedBeforeOpen.focus({ preventScroll: true });
});
</script>

<template>
  <Teleport to="body">
    <div class="background-image-editor__backdrop" @click.self="emit('close')">
      <section
        ref="dialog"
        class="background-image-editor"
        role="dialog"
        aria-modal="true"
        aria-labelledby="background-image-editor-title"
        tabindex="-1"
        @keydown.esc.stop.prevent="emit('close')"
        @keydown.tab="containDialogTab"
      >
        <header class="background-image-editor__header">
          <div>
            <h2 id="background-image-editor-title">编辑背景图片</h2>
            <p>拖动选区调整裁切，或使用角点修改范围。</p>
          </div>
          <button type="button" class="background-image-editor__icon" aria-label="关闭" @click="emit('close')">×</button>
        </header>

        <div class="background-image-editor__body">
          <div class="background-image-editor__preview-viewport">
            <div v-if="hasImage" class="background-image-editor__frame">
              <canvas ref="canvas" data-pb-image-editor-preview aria-label="图片裁切预览" />
              <div class="background-image-editor__crop-layer">
                <div
                  ref="cropElement"
                  class="background-image-editor__crop"
                  data-pb-image-crop
                  :style="cropStyle"
                  tabindex="0"
                  role="group"
                  aria-label="裁切选区，方向键移动，按住 Shift 加速"
                  @pointerdown="beginCropDrag"
                  @pointermove="moveCropDrag"
                  @pointerup="endCropDrag"
                  @pointercancel="endCropDrag"
                  @lostpointercapture="pointerDrag = undefined"
                  @keydown="handleCropKey"
                >
                  <button
                    v-for="handle in ['nw', 'ne', 'sw', 'se'] as const"
                    :key="handle"
                    type="button"
                    class="background-image-editor__crop-handle"
                    :class="`background-image-editor__crop-handle--${handle}`"
                    :data-pb-crop-handle="handle"
                    :aria-label="`调整裁切${{ nw: '左上', ne: '右上', sw: '左下', se: '右下' }[handle]}角`"
                    @pointerdown.stop="beginCropDrag"
                    @pointermove="moveCropDrag"
                    @pointerup="endCropDrag"
                    @pointercancel="endCropDrag"
                    @keydown="handleCropKey"
                  />
                </div>
              </div>
            </div>
            <p v-else-if="loadError" class="background-image-editor__error" role="alert">{{ loadError }}</p>
            <p v-else class="background-image-editor__loading" role="status">正在准备图片…</p>
          </div>

          <div v-if="hasImage" class="background-image-editor__controls">
            <div class="background-image-editor__actions" aria-label="图片操作">
              <button type="button" :disabled="exporting" aria-label="向左旋转" @click="rotate(-1)">
                <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M8 4 3.5 8.5 8 13M4 8.5h6a5 5 0 1 1-4.8 6" /></svg>
                <span>向左旋转</span>
              </button>
              <button type="button" :disabled="exporting" aria-label="向右旋转" @click="rotate(1)">
                <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m12 4 4.5 4.5L12 13m4-4.5h-6a5 5 0 1 0 4.8 6" /></svg>
                <span>向右旋转</span>
              </button>
              <button type="button" :disabled="exporting" @click="resetImage">重置图片</button>
            </div>
            <label class="background-image-editor__ratio">
              <span>裁切比例</span>
              <select :value="ratioOption" :disabled="exporting" @change="selectRatio(($event.target as HTMLSelectElement).value)">
                <option v-for="option in aspectOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
              </select>
            </label>
            <div class="background-image-editor__sizes">
              <label><span>输出宽度</span><input :value="outputWidth" type="number" min="1" :max="maximumOutputWidth" step="1" :disabled="exporting" @input="updateOutputWidth(Number(($event.target as HTMLInputElement).value))" /></label>
              <span class="background-image-editor__size-link" aria-label="保持裁切比例">×</span>
              <label><span>输出高度</span><input v-model.number="outputHeight" type="number" min="1" max="4096" step="1" :disabled="exporting" /></label>
            </div>
            <p class="background-image-editor__hint">单位：像素。修改宽或高会按比例同步另一边。</p>
            <p v-if="editError" class="background-image-editor__error" role="alert">{{ editError }}</p>
          </div>
        </div>

        <footer class="background-image-editor__footer">
          <button type="button" class="background-image-editor__cancel" :disabled="exporting" @click="emit('close')">取消</button>
          <button type="button" class="background-image-editor__apply" :disabled="!hasImage || exporting" @click="applyImage">
            {{ exporting ? "正在处理…" : "应用图片" }}
          </button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped src="../styles/background-image-editor.css"></style>
