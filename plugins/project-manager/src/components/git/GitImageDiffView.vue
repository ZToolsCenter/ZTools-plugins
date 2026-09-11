<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { GitImageDiffPayload, GitImageSide } from '../../types';

const props = defineProps<{
  payload: GitImageDiffPayload;
}>();

const { t } = useI18n();
const fitMode = ref(true);
const scale = ref(1);
const naturalSizes = ref<Record<'before' | 'after', { width: number; height: number }>>({
  before: { width: 0, height: 0 },
  after: { width: 0, height: 0 },
});

const sides = computed(() => [
  { key: 'before' as const, label: t('git.before'), side: props.payload.before },
  { key: 'after' as const, label: t('git.after'), side: props.payload.after },
]);

function dataUrl(side: GitImageSide): string {
  return `data:${side.mime};base64,${side.base64}`;
}

function onImageLoad(key: 'before' | 'after', event: Event) {
  const image = event.target as HTMLImageElement;
  naturalSizes.value[key] = { width: image.naturalWidth, height: image.naturalHeight };
}

function zoomIn() {
  fitMode.value = false;
  scale.value = Math.min(8, Math.round((scale.value + 0.25) * 100) / 100);
}

function zoomOut() {
  fitMode.value = false;
  scale.value = Math.max(0.1, Math.round((scale.value - 0.25) * 100) / 100);
}

function setFit() {
  fitMode.value = true;
}

function set100() {
  fitMode.value = false;
  scale.value = 1;
}

function imageStyle(key: 'before' | 'after') {
  if (fitMode.value) {
    return { maxWidth: '100%', maxHeight: '100%', width: 'auto', height: 'auto' };
  }
  const size = naturalSizes.value[key];
  if (!size.width || !size.height) {
    return { maxWidth: 'none', maxHeight: 'none', transform: `scale(${scale.value})`, transformOrigin: 'top left' };
  }
  return {
    width: `${Math.max(1, Math.round(size.width * scale.value))}px`,
    height: `${Math.max(1, Math.round(size.height * scale.value))}px`,
    maxWidth: 'none',
    maxHeight: 'none',
  };
}
</script>

<template>
  <div class="git-image-diff">
    <div class="git-image-toolbar">
      <button type="button" :class="{ 'is-active': fitMode }" :title="t('git.fit')" @click="setFit">
        {{ t('git.fit') }}
      </button>
      <button type="button" :class="{ 'is-active': !fitMode && scale === 1 }" :title="t('git.zoom100')" @click="set100">
        100%
      </button>
      <button type="button" class="icon" :title="t('git.zoomOut')" @click="zoomOut">
        <span class="i-mdi-minus" />
      </button>
      <span class="git-image-zoom-label">{{ fitMode ? t('git.fit') : `${Math.round(scale * 100)}%` }}</span>
      <button type="button" class="icon" :title="t('git.zoomIn')" @click="zoomIn">
        <span class="i-mdi-plus" />
      </button>
    </div>

    <div class="git-image-columns">
      <section v-for="item in sides" :key="item.key" class="git-image-side">
        <header class="git-image-side-header">
          <span>{{ item.label }}</span>
          <span v-if="item.side" class="git-image-size">{{ item.side.size }} B</span>
        </header>
        <div class="git-image-canvas">
          <img
            v-if="item.side"
            :src="dataUrl(item.side)"
            :alt="item.label"
            :style="imageStyle(item.key)"
            @load="onImageLoad(item.key, $event)"
          >
          <div v-else class="git-image-missing">
            <span class="i-mdi-image-off-outline text-2xl" />
            <span>{{ t('git.imageSideMissing') }}</span>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.git-image-diff {
  display: flex;
  flex: 1;
  min-height: 0;
  flex-direction: column;
  overflow: hidden;
  background: var(--git-sunken);
}

.git-image-toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
  padding: 6px 10px;
  border-bottom: 1px solid var(--git-border);
  background: var(--git-panel);
}

.git-image-toolbar button {
  min-height: 24px;
  padding: 2px 8px;
  border: 1px solid var(--git-border);
  border-radius: 5px;
  background: transparent;
  color: var(--git-text-secondary);
  font-size: var(--app-font-control);
  cursor: pointer;
}

.git-image-toolbar button:hover,
.git-image-toolbar button.is-active {
  border-color: color-mix(in srgb, var(--git-accent) 45%, var(--git-border));
  background: color-mix(in srgb, var(--git-accent) 12%, transparent);
  color: var(--git-accent);
}

.git-image-toolbar button.icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  padding: 2px;
}

.git-image-zoom-label {
  min-width: 42px;
  color: var(--git-muted);
  font-size: var(--app-font-meta);
  text-align: center;
}

.git-image-columns {
  display: flex;
  flex: 1;
  min-height: 0;
  gap: 1px;
  overflow: hidden;
  background: var(--git-border);
}

.git-image-side {
  display: flex;
  flex: 1 1 0;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  background: var(--git-panel);
}

.git-image-side-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
  padding: 6px 10px;
  border-bottom: 1px solid var(--git-border);
  color: var(--git-text-secondary);
  font-size: var(--app-font-control);
  font-weight: 600;
}

.git-image-size {
  color: var(--git-muted);
  font-family: var(--git-mono);
  font-weight: 400;
}

.git-image-canvas {
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
  align-items: center;
  justify-content: center;
  overflow: auto;
  padding: 12px;
  background: color-mix(in srgb, var(--git-sunken) 86%, var(--git-panel));
}

.git-image-canvas img {
  display: block;
  flex: none;
  object-fit: contain;
}

.git-image-missing {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: var(--git-muted);
  font-size: var(--app-font-meta);
}
</style>
