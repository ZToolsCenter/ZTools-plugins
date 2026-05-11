<script setup lang="ts">
import { useI18n } from "vue-i18n";
import ZTooltip from "@/components/ui/ZTooltip.vue";
import ZBadge from "@/components/ui/ZBadge.vue";
import ZButton from "@/components/ui/ZButton.vue";
import ZIcon from "@/components/ui/ZIcon.vue";
import FileDropzone from "@/components/shared/FileDropzone.vue";
import { useImageDiff } from "@/composables/useImage";

const { t } = useI18n();

const {
  sourceImage,
  targetImage,
  viewMode,
  sliderPos,
  blendOpacity,
  zoom,
  diffOverlay,
  isComputingDiff,
  bothLoaded,
  handleFileInput,
  clearImages,
  resetTransform,
  startSliderDrag,
  startPan,
  handleWheel,
  viewportRef,
  imageTransform,
} = useImageDiff()

</script>

<template>
  <div class="img-root flex-col">
    <!-- Always Toolbar -->
    <div
      class="h-14 border-b border-[var(--color-border)] bg-[var(--color-background)] flex items-center justify-between px-5 flex-shrink-0 z-30 shadow-sm relative w-full">
      <div
        class="flex bg-[var(--color-surface)] rounded-md border border-[var(--color-border)] p-1 shadow-sm opacity-100 transition-opacity"
        :class="{ 'pointer-events-none opacity-50': !bothLoaded }">
        <ZButton :variant="viewMode === 'split' ? 'primary' : 'surface'" size="sm" @click="viewMode = 'split'"
          class="!rounded-md">
          <ZIcon name="split" :size="14" />
          {{ t("viewSplit") }}
        </ZButton>
        <ZButton :variant="viewMode === 'slider' ? 'primary' : 'surface'" size="sm" @click="viewMode = 'slider'"
          class="!rounded-md">
          <ZIcon name="slider" :size="14" />
          {{ t("viewSlider") }}
        </ZButton>
        <ZButton :variant="viewMode === 'blend' ? 'primary' : 'surface'" size="sm" @click="viewMode = 'blend'"
          class="!rounded-md">
          <ZIcon name="blend" :size="14" />
          {{ t("viewBlend") }}
        </ZButton>
        <ZButton :variant="viewMode === 'highlight' ? 'primary' : 'surface'" size="sm" @click="viewMode = 'highlight'"
          class="!rounded-md">
          <ZIcon name="highlight" :size="14" />
          {{ t("viewHighlight") || "Highlight" }}
        </ZButton>
      </div>

      <div class="flex items-center gap-4">
        <div class="flex items-center gap-1 flex-col">
          <ZBadge variant="surface" size="xs">{{ t("zoom") || "Zoom" }}</ZBadge>
          <span class="text-xs font-mono font-bold text-[var(--color-secondary)]">{{ Math.round(zoom * 100) }}%</span>
        </div>

        <div class="flex gap-2 justify-center items-center">
          <ZTooltip :content="t('resetZoom')">
            <ZButton variant="surface" size="sm" @click="resetTransform" :disabled="!bothLoaded"
              class="text-[var(--color-cta)]">
              <ZIcon name="refresh" :size="14" />
            </ZButton>
          </ZTooltip>
          <ZTooltip :content="t('clearItems')">
            <ZButton variant="danger" size="sm" @click="clearImages" :disabled="!sourceImage && !targetImage">
              <ZIcon name="trash" :size="14" />
              {{ t("clearItems") }}
            </ZButton>
          </ZTooltip>
        </div>
      </div>
    </div>

    <!-- Main Content Area: Setup or Workspace -->
    <div class="flex flex-1 min-h-0 relative overflow-hidden">
      <!-- UNLOADED STATE: Two Dropzones side-by-side -->
      <div v-if="!bothLoaded" class="img-setup flex-1 flex gap-4 p-5">
        <!-- Left Source -->
        <div class="img-panel flex-1 flex flex-col h-full" :class="{ 'has-img': sourceImage }">
          <FileDropzone v-if="!sourceImage" side="source" :title="t('imageSource')" :hint="t('uploadImage')"
            :is-ready="!!sourceImage" accept="image/*" @change="handleFileInput($event, 'source')">
            <template #icon>
              <ZIcon name="image" :size="28" />
            </template>
          </FileDropzone>
          <div v-else
            class="img-preview relative w-full h-full flex flex-col items-center justify-center p-6 bg-checker rounded-xl border border-[var(--color-border)]">
            <span class="view-pill absolute top-4 left-4">{{
              t("imageSource")
            }}</span>
            <img :src="sourceImage" class="w-full flex-1 object-contain drop-shadow-md" />
          </div>
        </div>

        <!-- Right Target -->
        <div class="img-panel flex-1 flex flex-col h-full" :class="{ 'has-img': targetImage }">
          <FileDropzone v-if="!targetImage" side="target" :title="t('imageTarget')" :hint="t('uploadImage')"
            :is-ready="!!targetImage" accept="image/*" @change="handleFileInput($event, 'target')">
            <template #icon>
              <ZIcon name="image" :size="28" />
            </template>
          </FileDropzone>
          <div v-else
            class="img-preview relative w-full h-full flex flex-col items-center justify-center p-6 bg-checker rounded-xl border border-[var(--color-border)]">
            <span class="view-pill absolute top-4 left-4">{{
              t("imageTarget")
            }}</span>
            <img :src="targetImage" class="w-full flex-1 object-contain drop-shadow-md" />
          </div>
        </div>
      </div>

      <!-- LOADED STATE: Full viewport with modes -->
      <div v-else class="img-workspace flex flex-col h-full flex-1 min-h-0">
        <!-- Viewport -->
        <div
          class="flex-1 min-h-0 bg-checker relative flex w-full h-full overflow-hidden cursor-grab active:cursor-grabbing"
          ref="viewportRef"
          @wheel="handleWheel"
          @mousedown="startPan">
          <!-- SPLIT MODE -->
          <template v-if="viewMode === 'split'">
            <div
              class="w-1/2 h-full flex flex-col items-center p-5 border-r border-[var(--color-border)] relative overflow-hidden">
              <span class="view-pill absolute top-4 left-4 z-10">{{
                t("imageSource")
              }}</span>
              <div class="w-full h-full flex items-center justify-center pointer-events-none" :style="imageTransform">
                <img :src="sourceImage" :draggable="false"
                  class="max-w-full max-h-full object-contain drop-shadow-lg" />
              </div>
            </div>
            <div class="w-1/2 h-full flex flex-col items-center p-5 relative overflow-hidden">
              <span class="view-pill absolute top-4 right-4 z-10">{{
                t("imageTarget")
              }}</span>
              <div class="w-full h-full flex items-center justify-center pointer-events-none" :style="imageTransform">
                <img :src="targetImage" :draggable="false"
                  class="max-w-full max-h-full object-contain drop-shadow-lg" />
              </div>
            </div>
          </template>

          <!-- SLIDER MODE -->
          <template v-else-if="viewMode === 'slider'">
            <!-- Viewport containing both images -->
            <div class="absolute inset-0 overflow-hidden pointer-events-none">
              <!-- Base Layer (Target) -->
              <div class="absolute inset-0" :style="imageTransform">
                <div class="w-full h-full p-8 flex items-center justify-center">
                  <img :src="targetImage" :draggable="false"
                    class="max-w-full max-h-full object-contain drop-shadow-xl" />
                </div>
              </div>

              <!-- Overlay Layer (Source) - Clipped -->
              <div class="absolute inset-0" :style="{ clipPath: `inset(0 ${100 - sliderPos}% 0 0)` }">
                <div class="absolute inset-0" :style="imageTransform">
                  <div class="w-full h-full p-8 flex items-center justify-center">
                    <img :src="sourceImage" :draggable="false"
                      class="max-w-full max-h-full object-contain drop-shadow-xl" />
                  </div>
                </div>
              </div>
            </div>

            <div class="absolute top-4 left-4 z-10">
              <span class="view-pill">{{ t("imageSource") }}</span>
            </div>
            <div class="absolute top-4 right-4 z-10">
              <span class="view-pill">{{ t("imageTarget") }}</span>
            </div>

            <!-- Handle -->
            <div
              class="slider-handle absolute top-0 bottom-0 w-[2px] bg-[var(--color-cta)] cursor-ew-resize z-30 flex flex-col items-center justify-center transform -translate-x-1/2"
              
              :style="{ left: `${sliderPos}%` }" @mousedown.prevent="startSliderDrag">
            <div
              class="cursor-ew-resize w-10 h-10 rounded-full bg-[var(--color-cta)] border-2 border-[var(--color-background)] shadow-2xl flex items-center justify-center pointer-events-none text-white transition-transform hover:scale-110">
                <ZIcon name="slider-handle" :size="20" />
              </div>
            </div>
          </template>

          <!-- BLEND MODE -->
          <template v-else-if="viewMode === 'blend'">
            <div class="absolute inset-0 overflow-hidden pointer-events-none" :style="imageTransform">
              <div class="relative w-full h-full p-8 flex items-center justify-center">
                <!-- Base -->
                <img :src="targetImage" :draggable="false"
                  class="max-w-full max-h-full object-contain drop-shadow-xl" />
                <!-- Crossfade Overlay -->
                <img :src="sourceImage" :draggable="false"
                  class="absolute max-w-full max-h-full object-contain drop-shadow-xl" :style="{
                    opacity: blendOpacity,
                    width: 'auto',
                    height: 'auto',
                    maxWidth: 'calc(100% - 64px)',
                    maxHeight: 'calc(100% - 64px)',
                  }" />
              </div>
            </div>

            <div class="absolute top-4 left-4 z-10">
              <ZBadge variant="surface" size="sm">{{
                t("imageSource")
              }}</ZBadge>
            </div>
            <div class="absolute top-4 right-4 z-10">
              <ZBadge variant="surface" size="sm">{{
                t("imageTarget")
              }}</ZBadge>
            </div>

            <!-- Control Box -->
            <div class="blend-control" @mousedown.stop>
              <span class="blend-label">Target</span>
              <div class="blend-slider-wrap">
                <input type="range" min="0" max="1" step="0.01" v-model.number="blendOpacity" class="blend-slider" />
              </div>
              <span class="blend-label">Source</span>
            </div>
          </template>

          <!-- HIGHLIGHT MODE -->
          <template v-else-if="viewMode === 'highlight'">
            <div class="absolute inset-0 overflow-hidden pointer-events-none" :style="imageTransform">
              <div class="relative w-full h-full p-8 flex items-center justify-center">
                <img :src="targetImage"
                  class="max-w-full max-h-full object-contain opacity-30 transition-opacity duration-300" />
                <img v-if="diffOverlay" :src="diffOverlay"
                  class="absolute max-w-full max-h-full object-contain drop-shadow-xl transition-opacity duration-300"
                  :style="{
                    width: 'auto',
                    height: 'auto',
                    maxWidth: 'calc(100% - 64px)',
                    maxHeight: 'calc(100% - 64px)',
                  }" />
                <div v-if="isComputingDiff"
                  class="absolute inset-0 flex items-center justify-center bg-[var(--color-background)]/50 z-20 backdrop-blur-sm">
                  <div class="flex flex-col items-center gap-2">
                    <ZIcon name="loading" :size="32" class="animate-spin text-[var(--color-cta)]" />
                    <span class="text-sm font-bold opacity-70">{{ t("computing") || "Computing Diff..." }}</span>
                  </div>
                </div>
              </div>
            </div>
            <div class="absolute top-4 left-1/2 -translate-x-1/2 z-10">
              <span class="view-pill">{{
                t("viewHighlight") || "Highlight"
              }}</span>
            </div>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
/* ── Root ────────────────────────────────────────── */
.img-root {
  display: flex;
  flex: 1;
  min-height: 0;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  overflow: hidden;
  background: var(--color-background);
  user-select: none;
  /* Prevent accidental text/image selection */
}

.img-panel {
  flex: 1;
  min-width: 0;
  min-height: 0;
  position: relative;
  display: flex;
  flex-direction: column;
}

/* ── Checkerboard background ─────────────────────── */
.bg-checker {
  background-color: color-mix(in srgb,
      var(--color-background) 50%,
      var(--color-surface));
  background-image:
    linear-gradient(45deg,
      color-mix(in srgb, var(--color-border) 20%, transparent) 25%,
      transparent 25%),
    linear-gradient(-45deg,
      color-mix(in srgb, var(--color-border) 20%, transparent) 25%,
      transparent 25%),
    linear-gradient(45deg,
      transparent 75%,
      color-mix(in srgb, var(--color-border) 20%, transparent) 75%),
    linear-gradient(-45deg,
      transparent 75%,
      color-mix(in srgb, var(--color-border) 20%, transparent) 75%);
  background-size: 20px 20px;
  background-position:
    0 0,
    0 10px,
    10px -10px,
    -10px 0px;
}

/* ── Dropzone ────────────────────────────────────── */
.img-dropzone {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 200ms ease;

  &:hover,
  &--active {
    background: color-mix(in srgb, var(--color-cta) 4%, transparent);
  }

  &--active {
    outline: 2px dashed var(--color-cta);
    outline-offset: -2px;
  }

  /* Hover effect handled by parent label hover */
  &:hover .img-dropzone-card,
  &--active .img-dropzone-card {
    border-color: var(--color-cta);
    box-shadow: var(--shadow-md);
    transform: translateY(-2px);
    background: color-mix(in srgb,
        var(--color-cta) 4%,
        var(--color-background));
  }

  &:hover .img-dz-icon-wrap,
  &--active .img-dz-icon-wrap {
    background: color-mix(in srgb, var(--color-cta) 15%, transparent);
  }

  &:hover .img-dz-icon,
  &--active .img-dz-icon {
    color: var(--color-cta);
  }
}

.img-file-input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
  z-index: 10;
  width: 100%;
  height: 100%;
}

.img-dropzone-card {
  position: relative;
  width: 280px;
  padding: 36px 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  background: var(--color-background);
  border: 2px dashed var(--color-border);
  border-radius: 16px;
  box-shadow: var(--shadow-sm);
  transition: all 200ms ease;
  user-select: none;
  pointer-events: none;
  /* Let label handle clicks */
}

/* Hover effect handled by parent label hover */
.img-dropzone:hover .img-dropzone-card,
.img-dropzone-card--active {
  border-color: var(--color-cta);
  box-shadow: var(--shadow-md);
  transform: translateY(-2px);
  background: color-mix(in srgb, var(--color-cta) 4%, var(--color-background));
}

.img-dz-icon-wrap {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--color-border) 20%, transparent);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 8px;
  transition: all 200ms ease;
}

.img-dropzone:hover .img-dz-icon-wrap,
.img-dropzone-card--active .img-dz-icon-wrap {
  background: color-mix(in srgb, var(--color-cta) 15%, transparent);
}

.img-dz-icon {
  color: var(--color-secondary);
  transition: color 200ms ease;
}

.img-dropzone:hover .img-dz-icon,
.img-dropzone-card--active .img-dz-icon {
  color: var(--color-cta);
}

.img-dz-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--color-text);
  margin: 0;
}

.img-dz-hint {
  font-size: 12px;
  color: var(--color-secondary);
  opacity: 0.8;
  margin: 0;
  text-align: center;
}

/* ── Blend Mode Control ────────────────────────── */
.blend-control {
  position: absolute;
  bottom: 32px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 40;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 24px;
  border-radius: 99px;
  background: color-mix(in srgb, var(--color-background) 85%, transparent);
  backdrop-filter: blur(12px);
  border: 1px solid var(--color-border);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.15);
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  pointer-events: auto;

  &:hover {
    transform: translateX(-50%) translateY(-2px);
    background: color-mix(in srgb, var(--color-background) 92%, transparent);
    border-color: var(--color-cta);
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.2);
  }
}

.blend-label {
  font-size: 10px;
  font-weight: 800;
  font-family: var(--font-mono);
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--color-secondary);
  width: 60px;
}

.blend-control .blend-label:first-child {
  text-align: right;
}

.blend-slider-wrap {
  width: 200px;
  display: flex;
  align-items: center;
}

.blend-slider {
  width: 100%;
  height: 4px;
  appearance: none;
  -webkit-appearance: none;
  background: var(--color-border);
  border-radius: 2px;
  outline: none;
  cursor: pointer;

  &::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 14px;
    height: 14px;
    background: var(--color-cta);
    border-radius: 50%;
    border: 2px solid var(--color-background);
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
    transition: all 0.2s ease;
  }

  &::-webkit-slider-thumb:hover {
    transform: scale(1.2);
    box-shadow: 0 0 0 4px color-mix(in srgb, var(--color-cta) 20%, transparent);
  }
}

/* ── View Pills / Labels ─────────────────────────── */
.view-pill {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.05em;
  padding: 4px 10px;
  border-radius: 6px;
  background: var(--color-background);
  color: var(--color-secondary);
  border: 1px solid var(--color-border);
  pointer-events: none;
  backdrop-filter: blur(4px);
  background: color-mix(in srgb, var(--color-background) 80%, transparent);
}
</style>
