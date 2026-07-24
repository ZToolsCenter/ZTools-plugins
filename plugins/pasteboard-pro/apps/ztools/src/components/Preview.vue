<script setup lang="ts">
import { ref, watch } from "vue";

import type { PasteItem } from "@pasteboard-pro/core";

const props = defineProps<{ item: PasteItem; standalone?: boolean }>();
const emit = defineEmits<{
  close: [];
  paste: [itemId: string, plainText: boolean];
  ocr: [itemId: string];
  rotate: [value: { itemId: string; quarterTurns: -1 | 1 }];
  quickLook: [itemId: string];
  edit: [itemId: string];
  rename: [itemId: string];
}>();

const previewUrl = ref<string>();
const previewMediaType = ref<string>();
const previewError = ref<string>();
let previewGeneration = 0;

watch(
  () => [props.item.id, props.item.payload.revision] as const,
  async () => {
    const generation = ++previewGeneration;
    previewUrl.value = undefined;
    previewMediaType.value = undefined;
    previewError.value = undefined;
    try {
      const preview = await window.pasteboardPro?.getItemPreview(props.item.id);
      if (generation !== previewGeneration || preview == null) return;
      previewMediaType.value = preview.mediaType;
      previewUrl.value = `data:${preview.mediaType};base64,${preview.dataBase64}`;
    } catch (error) {
      if (generation === previewGeneration) {
        previewError.value = error instanceof Error ? error.message : String(error);
      }
    }
  },
  { immediate: true },
);
</script>

<template>
  <aside class="preview" :class="{ 'preview--standalone': standalone }" aria-label="内容预览">
    <header>
      <div>
        <span>{{ item.kind }}</span>
        <strong>{{ item.title ?? "Preview" }}</strong>
      </div>
      <button type="button" aria-label="关闭预览" @click="emit('close')">×</button>
    </header>
    <div v-if="previewUrl && previewMediaType?.startsWith('image/')" class="preview-body">
      <div class="media"><img :src="previewUrl" :alt="item.title ?? '剪贴板图片预览'" /></div>
      <pre v-if="item.ocrText" class="ocr-text">{{ item.ocrText }}</pre>
    </div>
    <div v-else-if="previewUrl && previewMediaType === 'application/pdf'" class="media">
      <object :data="previewUrl" type="application/pdf" :aria-label="item.title ?? 'PDF 预览'">
        当前 WebView 无法显示 PDF 预览
      </object>
    </div>
    <pre v-else>{{ previewError ?? item.payload.text ?? item.ocrText ?? item.payload.filePaths?.join('\n') ?? item.payload.mediaType }}</pre>
    <footer>
      <span>{{ item.sourceApp?.name ?? "Unknown app" }}</span>
      <div>
        <span v-if="item.kind === 'image'" class="rotation-group" aria-label="旋转图片">
          <button type="button" class="secondary icon-button" aria-label="向左旋转" title="向左旋转" @click="emit('rotate', { itemId: item.id, quarterTurns: -1 })">↶</button>
          <button type="button" class="secondary icon-button" aria-label="向右旋转" title="向右旋转" @click="emit('rotate', { itemId: item.id, quarterTurns: 1 })">↷</button>
        </span>
        <button v-if="item.kind === 'image'" type="button" class="secondary" @click="emit('ocr', item.id)">
          识别文字
        </button>
        <button v-if="item.kind === 'image' || item.kind === 'files' || item.payload.mediaType === 'application/pdf'" type="button" class="secondary" @click="emit('quickLook', item.id)">
          Quick Look
        </button>
        <button type="button" class="secondary" @click="emit('rename', item.id)">重命名</button>
        <button v-if="['text', 'rich_text', 'html', 'url', 'color'].includes(item.kind)" type="button" class="secondary" @click="emit('edit', item.id)">编辑</button>
        <button type="button" class="secondary" @click="emit('paste', item.id, true)">纯文本</button>
        <button type="button" @click="emit('paste', item.id, false)">粘贴</button>
      </div>
    </footer>
  </aside>
</template>

<style scoped>
.preview {
  position: absolute;
  z-index: 5;
  top: 68px;
  right: 14px;
  bottom: 14px;
  display: grid;
  grid-template-rows: auto 1fr auto;
  width: min(360px, calc(100% - 28px));
  padding: 14px;
  border: 1px solid var(--pb-line);
  border-radius: 20px;
  background: color-mix(in srgb, var(--pb-glass-strong) 94%, transparent);
  box-shadow: 0 24px 60px var(--pb-shadow);
  backdrop-filter: blur(30px);
}

.preview--standalone {
  position: relative;
  inset: auto;
  width: 100%;
  height: 100%;
  border: 0;
  border-radius: 0;
  background: var(--pb-window-bg);
  box-shadow: none;
  backdrop-filter: none;
}

header,
footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

header div {
  display: grid;
  gap: 2px;
}

header span {
  color: var(--pb-violet);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.13em;
  text-transform: uppercase;
}

header strong {
  font-size: 14px;
}

button {
  border: 1px solid var(--pb-line);
  border-radius: 10px;
  background: var(--pb-glass);
  cursor: pointer;
}

header button {
  width: 28px;
  height: 28px;
  font-size: 18px;
}

pre {
  margin: 14px 0;
  overflow: auto;
  color: var(--pb-ink);
  font: 12px/1.5 "SFMono-Regular", Consolas, monospace;
  white-space: pre-wrap;
}

.preview-body {
  display: grid;
  min-height: 0;
  grid-template-rows: minmax(150px, 1fr) auto;
  gap: 10px;
  overflow: hidden;
}

.media {
  min-height: 0;
  margin: 14px 0;
  overflow: hidden;
  border: 1px solid var(--pb-line);
  border-radius: 15px;
  background: rgba(0, 0, 0, 0.08);
}

.preview-body .media { margin-bottom: 0; }
.media img,
.media object {
  display: block;
  width: 100%;
  height: 100%;
  min-height: 180px;
  border: 0;
  object-fit: contain;
}

.ocr-text {
  max-height: 110px;
  margin: 0;
  padding: 10px;
  border: 1px solid var(--pb-line);
  border-radius: 12px;
  background: color-mix(in srgb, var(--pb-glass) 72%, transparent);
}

footer {
  color: var(--pb-muted);
  font-size: 10px;
}

footer button {
  min-height: 32px;
  padding: 0 16px;
  background: var(--pb-violet);
  color: white;
}

footer div {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

footer button.secondary {
  background: var(--pb-glass);
  color: var(--pb-violet);
}

.rotation-group {
  display: inline-flex;
  overflow: hidden;
  border: 1px solid var(--pb-line);
  border-radius: 10px;
}

.rotation-group .icon-button {
  min-width: 32px;
  padding: 0;
  border: 0;
  border-radius: 0;
  font-size: 17px;
}

.rotation-group .icon-button + .icon-button {
  border-left: 1px solid var(--pb-line);
}
</style>
