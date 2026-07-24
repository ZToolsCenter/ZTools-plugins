<script setup lang="ts">
import { LoaderCircle } from "@lucide/vue";
import type { ContextMenuItem } from "../composables/useContextMenu";
import { useFileIcons } from "../composables/useFileIcons";
import type { ResultActions } from "../composables/useResultActions";
import { formatBytes, type FinderResult } from "../core/finderLogic";

const props = defineProps<{
  visibleResults: FinderResult[];
  selectedPath: string;
  isLoading: boolean;
  statusText: string;
  previewOpen: boolean;
  isFolderQuery: boolean;
  actions: ResultActions;
}>();

interface HighlightSegment {
  text: string;
  highlighted: boolean;
}

const emit = defineEmits<{
  nearBottom: [];
  select: [item: FinderResult];
  open: [];
  "context-menu": [event: MouseEvent, items: ContextMenuItem[]];
}>();

const { displayItem, iconFor } = useFileIcons({
  visibleResults: () => props.visibleResults,
  isFolderQuery: () => props.isFolderQuery,
});

function handleListScroll(event: Event) {
  const element = event.currentTarget as HTMLElement;
  const distanceToBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
  if (distanceToBottom < 120) emit("nearBottom");
}

function fileInitial(item: FinderResult) {
  const display = displayItem(item);
  if (display.isDirectory) return "DIR";
  const extension =
    display.extension || (display.name.includes(".") ? display.name.split(".").pop() : "");
  return (extension || "FILE").slice(0, 4).toUpperCase();
}

function formatModified(value?: number) {
  if (!value) return "";
  const date = new Date(value);
  const pad = (part: number) => part.toString().padStart(2, "0");

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(
    date.getMinutes(),
  )}:${pad(date.getSeconds())}`;
}

function highlightSegments(value: string | undefined, fallback = ""): HighlightSegment[] {
  const source = value || fallback;
  if (!source) return [];

  const segments: HighlightSegment[] = [];
  let highlighted = false;
  let start = 0;

  for (let index = 0; index < source.length; index += 1) {
    if (source[index] !== "*") continue;

    if (index > start) {
      segments.push({ text: source.slice(start, index), highlighted });
    }

    highlighted = !highlighted;
    start = index + 1;
  }

  if (start < source.length) {
    segments.push({ text: source.slice(start), highlighted });
  }

  return segments.length > 0 ? segments : [{ text: fallback, highlighted: false }];
}

function openResultMenu(event: MouseEvent, item: FinderResult) {
  emit("select", item);
  const hasFullPath = !!item.fullPath;
  const hasDirectoryPath = !!item.path;

  emit("context-menu", event, [
    {
      id: "show-in-folder",
      label: "打开所在目录",
      disabled: !hasFullPath,
      action: () => props.actions.showInFolder(item),
    },
    {
      id: "copy-full-path",
      label: "复制路径",
      disabled: !hasFullPath,
      action: () => props.actions.copyFullPath(item),
    },
    {
      id: "copy-directory-path",
      label: "复制所在路径",
      disabled: !hasDirectoryPath,
      action: () => props.actions.copyDirectoryPath(item),
    },
    {
      id: "copy-file",
      label: "复制文件",
      disabled: !hasFullPath,
      action: () => props.actions.copyFile(item),
    },
    { id: "separator-delete", label: "", separator: true },
    {
      id: "trash-item",
      label: "删除（回收站）",
      danger: true,
      disabled: !hasFullPath,
      action: () => props.actions.trash(item),
    },
  ]);
}
</script>

<template>
  <div class="result-list" :class="{ 'preview-open': previewOpen }" @scroll="handleListScroll">
    <button
      v-for="(item, index) in visibleResults"
      :key="item.fullPath"
      :data-result-index="index"
      class="result-row"
      :class="{ selected: item.fullPath === selectedPath }"
      tabindex="-1"
      @mousedown.left.prevent
      @contextmenu.prevent.stop="openResultMenu($event, item)"
      @click="emit('select', item)"
      @dblclick="emit('open')"
    >
      <span class="file-icon" :class="{ 'fallback-icon': !iconFor(item) }">
        <img v-if="iconFor(item)" :src="iconFor(item)" alt="" />
        <span v-else>{{ fileInitial(item) }}</span>
      </span>
      <span class="file-text">
        <span class="file-name">
          <span
            v-for="(segment, segmentIndex) in highlightSegments(item.highlightedName, item.name)"
            :key="segmentIndex"
            :class="{ 'highlight-match': segment.highlighted }"
            >{{ segment.text }}</span
          >
        </span>
        <span class="file-path" :title="item.fullPath || item.path">
          <span
            v-for="(segment, segmentIndex) in highlightSegments(item.highlightedPath, item.path)"
            :key="segmentIndex"
            :class="{ 'highlight-match': segment.highlighted }"
            >{{ segment.text }}</span
          >
        </span>
      </span>
      <span class="file-meta">
        <span>{{ formatBytes(item.size) }}</span>
        <span>{{ formatModified(item.modifiedAt) }}</span>
      </span>
    </button>

    <div v-if="isLoading" class="empty-state loading-state">
      <LoaderCircle class="loading-icon" :size="22" :stroke-width="2" aria-hidden="true" />
      <span>{{ statusText }}</span>
    </div>
    <div v-else-if="visibleResults.length === 0" class="empty-state">{{ statusText }}</div>
  </div>
</template>

<style scoped>
.result-list {
  overflow: auto;
  min-height: 0;
  height: 100%;
}

.result-row {
  display: grid;
  grid-template-columns: 38px minmax(0, 1fr) auto;
  grid-template-areas:
    "icon name meta"
    "icon path path";
  column-gap: 10px;
  width: 100%;
  min-height: 48px;
  padding: 4px 12px 4px 10px;
  text-align: left;
  cursor: pointer;
  background: #303234;
  border: 0;
  border-bottom: 1px solid transparent;
  color: inherit;
  font: inherit;
}

.result-row:focus,
.result-row:focus-visible {
  outline: none;
}

.result-row:hover,
.result-row.selected {
  background: #4a4b4d;
}

.result-row.selected {
  box-shadow: inset 3px 0 0 #3b82f6;
}

.file-icon {
  grid-area: icon;
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  align-self: center;
  color: #cfd6df;
  background: transparent;
  font-size: 8px;
  font-weight: 700;
}

.file-icon img {
  display: block;
  width: 32px;
  height: 32px;
  object-fit: contain;
}

.file-icon.fallback-icon {
  border: 1px solid #6a7078;
  background: #383b3f;
  box-sizing: border-box;
}

.file-text {
  display: contents;
}

.file-name {
  grid-area: name;
  overflow: hidden;
  color: #ffffff;
  font-size: 15px;
  line-height: 1.25;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-path,
.file-meta {
  overflow: hidden;
  color: #9ba1a8;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-path {
  grid-area: path;
  font-size: 11px;
}

.highlight-match {
  color: #ffd166;
}

.file-meta {
  grid-area: meta;
  display: grid;
  grid-template-columns: 52px 118px;
  align-items: flex-end;
  justify-content: end;
  gap: 8px;
  align-self: start;
  padding-top: 3px;
  font-size: 12px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.result-list.preview-open .file-meta {
  grid-template-columns: 52px;
}

.result-list.preview-open .file-meta span:last-child {
  display: none;
}

.empty-state {
  display: grid;
  min-height: 180px;
  place-items: center;
  color: #a6abb2;
}

.loading-state {
  align-content: center;
  gap: 10px;
}

.loading-icon {
  color: #3b82f6;
  animation: loading-spin 0.9s linear infinite;
}

@keyframes loading-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-color-scheme: light) {
  .result-row {
    background: #ffffff;
    border-bottom-color: #eef1f5;
  }

  .result-row:hover,
  .result-row.selected {
    background: #e8edf4;
  }

  .result-row.selected {
    box-shadow: inset 3px 0 0 #2563eb;
  }

  .file-name {
    color: #111827;
  }

  .file-path,
  .file-meta {
    color: #667085;
  }

  .highlight-match {
    color: #b45309;
  }

  .file-icon {
    color: #4f5b6a;
  }

  .file-icon.fallback-icon {
    border-color: #b8c0cc;
    background: #eef1f5;
  }

  .empty-state {
    color: #697386;
  }
}

@media (max-width: 760px) {
  .result-list.preview-open .result-row {
    grid-template-columns: 38px minmax(0, 1fr);
    grid-template-areas:
      "icon name"
      "icon path";
  }

  .result-list.preview-open .file-meta {
    display: none;
  }
}

@media (max-width: 560px) {
  .result-row {
    grid-template-columns: 36px minmax(0, 1fr);
  }

  .file-meta {
    display: none;
  }
}
</style>
