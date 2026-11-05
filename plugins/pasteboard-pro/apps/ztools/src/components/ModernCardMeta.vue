<script setup lang="ts">
import { computed } from "vue";
import type { PasteItem } from "@pasteboard-pro/core";
import { copiedTimeLabel, itemSummary } from "../card-presentation";
import { primaryModifierLabel, resolveShortcutPlatform } from "../platform-shortcuts";
import SourceAppIcon from "./SourceAppIcon.vue";
const props = defineProps<{
  item: PasteItem;
  index: number;
  placement: "header" | "footer";
  imageDimensions?: string | undefined;
  reorderEnabled?: boolean | undefined;
}>();
const source = computed(() => props.item.sourceApp?.name ?? "未知来源");
const initial = computed(() => Array.from(source.value).slice(0, 1).join(""));
const shortcut = primaryModifierLabel(resolveShortcutPlatform(window.pasteboardPro?.getPlatformCapabilities().platform));
</script>
<template>
  <header v-if="placement === 'header'" class="modern-card-source">
    <span class="modern-card-source__app" :title="source"><SourceAppIcon :source-app="item.sourceApp" :fallback="initial" /><span>{{ source }}</span></span>
    <time :datetime="item.copiedAt" :title="new Date(item.copiedAt).toLocaleString()">{{ copiedTimeLabel(item.copiedAt) }}</time>
    <button
      v-if="reorderEnabled !== false"
      class="modern-card-reorder-handle"
      type="button"
      data-pb-reorder-handle
      aria-label="拖动排序"
      title="拖动排序"
      draggable="false"
    >
      <svg viewBox="0 0 12 16" fill="currentColor" aria-hidden="true">
        <circle cx="3" cy="3" r="1.1" /><circle cx="9" cy="3" r="1.1" />
        <circle cx="3" cy="8" r="1.1" /><circle cx="9" cy="8" r="1.1" />
        <circle cx="3" cy="13" r="1.1" /><circle cx="9" cy="13" r="1.1" />
      </svg>
    </button>
    <svg v-if="item.pinned" class="modern-card-source__pin" viewBox="0 0 24 24" fill="none" aria-label="已固定"><path d="m15 3 6 6-4 1-4 5-4-4 5-4 1-4Zm-6 12-6 6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" /></svg>
  </header>
  <footer v-else class="modern-card-summary">
    <span :title="itemSummary(item, imageDimensions)">{{ itemSummary(item, imageDimensions) }}</span>
    <kbd v-if="index < 9" :aria-label="`快速粘贴 ${index + 1}`">{{ shortcut }}{{ index + 1 }}</kbd>
  </footer>
</template>
<style scoped>
.modern-card-source,.modern-card-summary{display:flex;align-items:center;gap:8px;min-width:0;color:var(--pb-muted);font-size:11px;font-weight:400;line-height:1.4}
.modern-card-source{min-height:24px;margin-bottom:13px}
.modern-card-source__app{display:flex;align-items:center;gap:7px;min-width:0;flex:1;color:var(--pb-ink)}
.modern-card-source__app>span:last-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.modern-card-source__icon{display:grid;flex:none;place-items:center;width:21px;height:21px;border:1px solid var(--pb-line);border-radius:6px;background:color-mix(in srgb,var(--pb-violet) 14%,var(--pb-glass-strong));font-size:11px;font-weight:600}
.modern-card-source__icon:is(img){display:block;object-fit:contain;background:var(--pb-glass-strong)}
.modern-card-source time{flex:none;font-size:10px;white-space:nowrap}
.modern-card-reorder-handle{display:grid;flex:none;place-items:center;width:22px;height:22px;padding:0;border:1px solid transparent;border-radius:6px;background:transparent;color:var(--pb-muted);cursor:grab;opacity:.72;transition:background-color 120ms ease,border-color 120ms ease,color 120ms ease,opacity 120ms ease}
.modern-card-reorder-handle svg{width:10px;height:14px}
.modern-card-reorder-handle:hover,.modern-card-reorder-handle:focus-visible{border-color:var(--pb-line);background:color-mix(in srgb,var(--pb-violet) 10%,transparent);color:var(--pb-violet);opacity:1;outline:0}
.modern-card-reorder-handle:active{cursor:grabbing}
.modern-card-source__pin{width:13px;height:13px;flex:none;color:var(--pb-ink)}
.modern-card-summary{padding-top:12px}
.modern-card-summary>span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.modern-card-summary kbd{flex:none;padding:2px 5px;border:1px solid var(--pb-line);border-radius:5px;background:color-mix(in srgb,var(--pb-ink) 3%,transparent);color:var(--pb-muted);font-size:10px;line-height:1.3;font-family:inherit}
</style>
