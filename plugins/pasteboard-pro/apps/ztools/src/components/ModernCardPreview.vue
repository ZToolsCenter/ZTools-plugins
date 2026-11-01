<script setup lang="ts">
import { computed } from "vue";
import type { PasteItem } from "@pasteboard-pro/core";
import { fileNames, itemLink } from "../card-presentation";
const props = defineProps<{ item: PasteItem; fallbackText: string; dragTitle?: string | undefined }>();
const link = computed(() => itemLink(props.item));
const files = computed(() => fileNames(props.item));
const isFile = computed(() => props.item.kind === "files" || props.item.kind === "pdf");
const title = computed(() => {
  const value = props.item.title?.trim();
  return value && value !== props.fallbackText.trim() ? value : undefined;
});
const color = computed(() => {
  const value = props.item.payload.text ?? "";
  return CSS.supports("color", value) ? value : "transparent";
});
</script>
<template>
  <div v-if="item.kind === 'color'" class="modern-preview modern-preview--color">
    <div class="modern-preview__swatch" :style="{ backgroundColor: color }"></div>
    <code>{{ item.payload.text }}</code>
  </div>
  <div v-else-if="item.kind === 'url'" class="modern-preview modern-preview--link">
    <div class="modern-preview__site" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="m10 13 4-4m-7 7-1 1a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0m2 2 1-1a4 4 0 1 1 6 6l-5 5a4 4 0 0 1-6 0" transform="translate(2 1) scale(.85)" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" /></svg><span>{{ link?.hostname ?? "网页链接" }}</span></div>
    <strong>{{ title ?? link?.hostname ?? '链接' }}</strong>
    <p>{{ item.payload.text }}</p>
    <span class="modern-preview__link-hint">{{ link?.pathname !== '/' ? link?.pathname : "网页链接" }}</span>
  </div>
  <div
    v-else-if="isFile"
    class="modern-preview modern-preview--file"
    :class="{ 'file-drag-source': item.payload.filePaths !== undefined }"
    :draggable="item.payload.filePaths !== undefined"
    :title="dragTitle"
  >
    <svg class="modern-preview__document" viewBox="0 0 64 76" fill="none" aria-hidden="true"><path d="M10 2h29l15 15v55H10z" fill="currentColor" fill-opacity=".08" stroke="currentColor" stroke-opacity=".35"/><path d="M39 2v16h15M20 31h24M20 39h24M20 47h16" stroke="currentColor" stroke-opacity=".4" stroke-width="2"/><rect x="5" y="52" width="34" height="17" rx="4" fill="var(--pb-violet)"/><text x="22" y="64" text-anchor="middle" fill="var(--pb-on-accent)" font-size="10" font-family="sans-serif">{{ item.kind === 'pdf' ? 'PDF' : 'FILE' }}</text></svg>
    <strong>{{ files[0] ?? title ?? 'PDF 文档' }}</strong>
    <span v-if="files.length > 1">另有 {{ files.length - 1 }} 个文件</span>
  </div>
  <div v-else class="modern-preview modern-preview--text">
    <strong v-if="title">{{ title }}</strong>
    <p>{{ fallbackText }}</p>
  </div>
</template>
<style scoped>
.modern-preview{min-width:0;min-height:0;overflow:hidden;color:var(--pb-ink)}
.modern-preview strong{display:-webkit-box;overflow:hidden;font-size:15px;font-weight:600;line-height:1.5;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow-wrap:anywhere}
.modern-preview p{margin:0;font-size:13px;line-height:1.65;overflow-wrap:anywhere;white-space:pre-wrap}
.modern-preview--text{display:flex;flex-direction:column;gap:10px}
.modern-preview--text>p{overflow:hidden;display:-webkit-box;-webkit-line-clamp:8;-webkit-box-orient:vertical}
.modern-preview--link{display:flex;flex-direction:column;gap:10px}
.modern-preview--link p{font-size:12px;color:var(--pb-muted);word-break:break-all}
.modern-preview__site{display:flex;gap:6px;align-items:center;color:var(--pb-muted);font-size:11px}
.modern-preview__site svg{width:17px;height:17px;flex:none}
.modern-preview__site span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.modern-preview__link-hint{margin-top:auto;padding:12px;border:1px solid var(--pb-line);border-radius:10px;background:color-mix(in srgb,var(--pb-ink) 3%,transparent);color:var(--pb-muted);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.modern-preview--file{display:flex;flex-direction:column;gap:9px;align-items:center;justify-content:center;text-align:center}
.modern-preview__document{width:65px;height:79px;color:var(--pb-ink);margin-bottom:3px}
.modern-preview--file strong{font-size:13px}
.modern-preview--file>span{font-size:11px;color:var(--pb-muted)}
.modern-preview--color{display:flex;flex-direction:column;gap:12px}
.modern-preview__swatch{flex:1;min-height:70px;border:1px solid var(--pb-line);border-radius:10px}
.modern-preview--color code{font:13px/1.4 ui-monospace,SFMono-Regular,Consolas,monospace;overflow-wrap:anywhere}
</style>
