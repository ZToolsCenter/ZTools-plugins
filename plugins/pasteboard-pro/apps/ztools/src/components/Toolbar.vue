<script setup lang="ts">
import type { DockEdge } from "@pasteboard-pro/design-tokens";

import SearchBar from "./SearchBar.vue";

defineProps<{
  query: string;
  paused: boolean;
  compact: boolean;
  edge: DockEdge;
}>();

const emit = defineEmits<{
  "update:query": [value: string];
  togglePause: [];
  toggleCompact: [];
  openPrivacySettings: [];
  createText: [];
}>();
</script>

<template>
  <header class="toolbar" :class="{ 'toolbar--vertical': edge === 'left' || edge === 'right' }">
    <div class="brand" aria-label="Paste剪切板">
      <img class="brand__logo" src="/logo.png" alt="" />
      <span>Paste剪切板</span>
    </div>
    <SearchBar :model-value="query" @update:model-value="emit('update:query', $event)" />
    <div class="toolbar__actions">
      <button type="button" class="tool-button" title="新建文本（Command-N）" @click="emit('createText')"><span aria-hidden="true">＋</span>新建</button>
      <button
        type="button"
        class="tool-button"
        title="打开设置中心"
        @click="emit('openPrivacySettings')"
      >
        <span aria-hidden="true">⚙</span>
        设置
      </button>
      <button
        type="button"
        class="tool-button"
        :aria-pressed="compact"
        title="切换紧凑模式"
        @click="emit('toggleCompact')"
      >
        <span aria-hidden="true">↔</span>
        {{ compact ? "展开" : "紧凑" }}
      </button>
      <button
        type="button"
        class="tool-button"
        :class="{ 'tool-button--active': paused }"
        :aria-pressed="paused"
        @click="emit('togglePause')"
      >
        <span aria-hidden="true">{{ paused ? "▶" : "Ⅱ" }}</span>
        {{ paused ? "继续捕获" : "暂停捕获" }}
      </button>
    </div>
  </header>
</template>

<style scoped>
.toolbar {
  display: grid;
  grid-template-columns: auto minmax(260px, 520px) auto;
  gap: 16px;
  align-items: center;
  min-height: 62px;
  padding: 11px 16px;
  border-bottom: 1px solid var(--pb-line);
}

.brand {
  display: flex;
  gap: 10px;
  align-items: center;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: -0.01em;
}

.brand__logo {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  box-shadow: 0 6px 16px color-mix(in srgb, var(--pb-violet) 20%, transparent);
}

.toolbar__actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

.tool-button {
  display: flex;
  gap: 6px;
  align-items: center;
  min-height: 34px;
  padding: 0 11px;
  border: 1px solid var(--pb-line);
  border-radius: 11px;
  background: color-mix(in srgb, var(--pb-glass-strong) 60%, transparent);
  color: var(--pb-muted);
  cursor: pointer;
  font-size: 12px;
}

.tool-button:hover,
.tool-button:focus-visible {
  color: var(--pb-ink);
  outline: 2px solid color-mix(in srgb, var(--pb-violet) 56%, transparent);
  outline-offset: 1px;
}

.tool-button--active {
  background: color-mix(in srgb, #ffb65c 18%, var(--pb-glass-strong));
  color: #9b5410;
}

.toolbar--vertical {
  grid-template-columns: minmax(0, 1fr);
  gap: 10px;
  padding: 13px 12px 11px;
}

.toolbar--vertical .toolbar__actions {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
}

.toolbar--vertical .tool-button {
  min-width: 0;
  padding: 0 7px;
  justify-content: center;
  font-size: 10px;
}

@media (max-width: 760px) {
  .toolbar {
    grid-template-columns: auto minmax(0, 1fr);
  }

  .toolbar:not(.toolbar--vertical) .brand span:last-child,
  .toolbar:not(.toolbar--vertical) .toolbar__actions .tool-button:nth-child(-n + 2) {
    display: none;
  }
}
</style>
