<script setup lang="ts">
import { computed } from "vue";
import { LoaderCircle } from "@lucide/vue";
import type { ContextMenuItem } from "../composables/useContextMenu";
import { useFileIcons } from "../composables/useFileIcons";
import type { ResultActions } from "../composables/useResultActions";
import type { FinderResult, SelectionMode } from "../core/finderLogic";
import { formatBytes } from "../core/formatters";

const props = defineProps<{
  visibleResults: FinderResult[];
  activePath: string;
  selectedPaths: string[];
  selectedItems: FinderResult[];
  isLoading: boolean;
  statusText: string;
  previewOpen: boolean;
  prefix: string;
  isFolderQuery: boolean;
  actions: ResultActions;
}>();

interface HighlightSegment {
  text: string;
  highlighted: boolean;
}

const emit = defineEmits<{
  nearBottom: [];
  select: [item: FinderResult, mode?: SelectionMode];
  open: [item: FinderResult];
  "context-menu": [event: MouseEvent, items: ContextMenuItem[]];
}>();

const selectedPathSet = computed(() => new Set(props.selectedPaths));

function isRowSelected(fullPath: string): boolean {
  return selectedPathSet.value.has(fullPath);
}

const { displayItem, iconFor } = useFileIcons({
  visibleResults: () => props.visibleResults,
  isFolderQuery: () => props.isFolderQuery,
});

function handleListScroll(event: Event) {
  const element = event.currentTarget as HTMLElement;
  const distanceToBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
  if (distanceToBottom < 120) emit("nearBottom");
}

function handleRowClick(event: MouseEvent, item: FinderResult) {
  let mode: SelectionMode = "single";
  if (event.ctrlKey || event.metaKey) {
    mode = "toggle";
  } else if (event.shiftKey) {
    mode = "range";
  }
  emit("select", item, mode);
}

function handleDragStart(event: DragEvent, item: FinderResult) {
  event.preventDefault();
  if (!selectedPathSet.value.has(item.fullPath)) {
    emit("select", item, "single");
  }
  props.actions.startDrag(item, props.selectedPaths);
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

/**
 * 判断当前高亮片段是否属于搜索前缀目录本身。
 *
 * 背景与原理：
 * 在「文件夹内搜索」模式下，前缀目录路径（如 "D:\Projects\App"）会被拼入 Everything 查询语句。
 * Everything 会将前缀路径视作匹配项，导致返回的 `highlightedPath` 中前缀目录被包裹 `*...*` 高亮标记。
 *
 * 为消除前缀高亮并保留子路径中用户真实搜索词的高亮：
 * 1. 在当前结果的所有路径中，前 [0, cleanPrefix.length] 字符区间物理上必定属于前缀目录；
 * 2. 若当前片段的结束位置 `plainOffset + text.length` 未超出前缀目录长度，说明其纯粹由前缀匹配引起，应消除高亮；
 * 3. `normText === normPrefix` 作为后备兜底，防止极端斜杠或分词切分差异。
 */
function isPrefixSegment(text: string, plainOffset: number, prefix: string): boolean {
  if (!prefix) return false;
  const cleanPrefix = prefix
    .replace(/^"|"$/g, "")
    .trim()
    .replace(/[\\/]+$/, "");
  if (!cleanPrefix) return false;

  // 片段结束位置在前缀长度范围内（+1 兼容尾部路径分隔符 \），属于前缀路径
  if (plainOffset + text.length <= cleanPrefix.length + 1) {
    return true;
  }

  // 兜底：忽略大小写与斜杠差异的全等比对
  const normText = text.replace(/\\+/g, "/").replace(/\/+$/, "").toLowerCase();
  const normPrefix = cleanPrefix.replace(/\\+/g, "/").replace(/\/+$/, "").toLowerCase();
  return normText === normPrefix;
}

/**
 * 解析 Everything 返回的高亮标记字符串（成对的 `*` 包裹匹配项），拆分为片段列表供模板渲染。
 *
 * @param value Everything 返回的含 `*` 高亮标记文本（如 `*C:\path*\*file*.txt`）
 * @param fallback 无高亮标记时的回退纯文本
 * @param isPath 是否为路径字段；为 true 时会结合 props.prefix 消除前缀目录的高亮
 */
function highlightSegments(
  value: string | undefined,
  fallback = "",
  isPath = false,
): HighlightSegment[] {
  const source = value || fallback;
  if (!source) return [];

  const segments: HighlightSegment[] = [];
  let highlighted = false;
  let start = 0;
  let plainOffset = 0;

  for (let index = 0; index < source.length; index += 1) {
    if (source[index] !== "*") continue;

    if (index > start) {
      const text = source.slice(start, index);
      // 路径字段需检测是否为前缀目录本身；若为前缀匹配则消除高亮
      const isPrefix = isPath && props.prefix && isPrefixSegment(text, plainOffset, props.prefix);
      segments.push({ text, highlighted: !isPrefix && highlighted });
      plainOffset += text.length;
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
  if (!selectedPathSet.value.has(item.fullPath)) {
    emit("select", item, "single");
  }

  const isMulti = selectedPathSet.value.has(item.fullPath) && props.selectedItems.length > 1;
  const targetItems = isMulti ? props.selectedItems : [item];

  const count = targetItems.length;
  const countSuffix = isMulti ? ` (${count} 项)` : "";

  emit("context-menu", event, [
    {
      id: "open-file",
      label: `打开文件${countSuffix}`,
      action: () => props.actions.open(targetItems),
    },
    {
      id: "show-in-folder",
      label: `打开所在目录${countSuffix}`,
      action: () => props.actions.showInFolder(targetItems),
    },
    { id: "separator-open", label: "", separator: true },
    {
      id: "copy-full-path",
      label: `复制路径${countSuffix}`,
      action: () => props.actions.copyFullPath(targetItems),
    },
    {
      id: "copy-directory-path",
      label: `复制所在路径${countSuffix}`,
      action: () => props.actions.copyDirectoryPath(targetItems),
    },
    {
      id: "copy-file",
      label: `复制文件${countSuffix}`,
      action: () => props.actions.copyFile(targetItems),
    },
    { id: "separator-delete", label: "", separator: true },
    {
      id: "trash-item",
      label: isMulti ? `删除 ${count} 项（回收站）` : "删除（回收站）",
      danger: true,
      action: () => props.actions.trash(targetItems),
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
      :draggable="true"
      class="result-row"
      :class="{
        selected: isRowSelected(item.fullPath),
        'active-focus': item.fullPath === activePath,
      }"
      tabindex="-1"
      @dragstart="handleDragStart($event, item)"
      @contextmenu.prevent.stop="openResultMenu($event, item)"
      @click="handleRowClick($event, item)"
      @dblclick="emit('open', item)"
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
        <span class="file-path" :title="item.fullPath">
          <span
            v-for="(segment, segmentIndex) in highlightSegments(
              item.highlightedPath,
              item.path,
              true,
            )"
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
  outline: none;
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
  user-select: none;
}

.result-row:focus,
.result-row:focus-visible {
  outline: none;
}

.result-row:hover,
.result-row.selected {
  background: var(--primary-color-dark-subtle-hover, #3c3e40);
}

.result-row.selected {
  box-shadow: inset 2px 0 0 var(--primary-color-alpha-50);
}

.result-row.selected.active-focus,
.result-row.active-focus {
  background: var(--primary-color-dark-subtle-bg, #4a4b4d);
  box-shadow: inset 2px 0 0 var(--primary-color);
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
  color: var(--primary-color);
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
    background: var(--primary-color-subtle-hover);
  }

  .result-row.selected {
    box-shadow: inset 2px 0 0 var(--primary-color-alpha-50);
  }

  .result-row.selected.active-focus,
  .result-row.active-focus {
    background: var(--primary-color-subtle-bg);
    box-shadow: inset 2px 0 0 var(--primary-color-text, var(--primary-color));
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
