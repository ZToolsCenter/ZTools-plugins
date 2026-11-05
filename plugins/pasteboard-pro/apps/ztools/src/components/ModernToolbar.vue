<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from "vue";

import type { PasteItem, PasteStackDirection } from "@pasteboard-pro/core";
import type { DockEdge } from "@pasteboard-pro/design-tokens";

import { primaryModifierName, resolveShortcutPlatform } from "../platform-shortcuts";
import { readModernPalette } from "./modern-palette";
import { placePopover, type PopupPlacement } from "./popup-position";
import SearchBar from "./SearchBar.vue";
import ShelfFilters from "./ShelfFilters.vue";

const props = defineProps<{
  query: string;
  paused: boolean;
  compact: boolean;
  canCaptureScreen: boolean;
  edge: DockEdge;
  items: readonly PasteItem[];
  pasteStackCount: number;
  pasteStackPending: boolean;
  pasteStackDirection: PasteStackDirection;
}>();

const emit = defineEmits<{
  "update:query": [value: string];
  togglePause: [];
  toggleCompact: [];
  openPrivacySettings: [];
  createText: [];
  captureScreen: [];
  toggleStackDirection: [];
  startStack: [];
  clearStack: [];
}>();

const moreOpen = ref(false);
const moreTrigger = ref<HTMLButtonElement>();
const morePanel = ref<HTMLElement>();
const morePlacement = ref<PopupPlacement>({ left: 8, top: 8 });
const morePalette = ref<Record<string, string>>({});
const isVerticalDock = computed(() => props.edge === "left" || props.edge === "right");
const createTextShortcutTitle = computed(() => {
  const platform = resolveShortcutPlatform(
    window.pasteboardPro?.getPlatformCapabilities().platform,
  );
  return "新建文本（" + primaryModifierName(platform) + "-N）";
});
const menuStyle = computed(() => ({
  left: morePlacement.value.left + "px",
  top: morePlacement.value.top + "px",
  ...morePalette.value,
}));

function toggleMoreMenu(): void {
  if (moreOpen.value) {
    closeMoreMenu();
    return;
  }
  moreOpen.value = true;
  if (moreTrigger.value !== undefined) {
    morePalette.value = readModernPalette(moreTrigger.value);
  }
  document.addEventListener("pointerdown", onDocumentPointerDown, true);
  window.addEventListener("keydown", onWindowKeydown, true);
  window.addEventListener("resize", updateMorePlacement);
  window.addEventListener("scroll", updateMorePlacement, true);
  void nextTick(updateMorePlacement);
}

function closeMoreMenu(): void {
  if (!moreOpen.value) return;
  moreOpen.value = false;
  document.removeEventListener("pointerdown", onDocumentPointerDown, true);
  window.removeEventListener("keydown", onWindowKeydown, true);
  window.removeEventListener("resize", updateMorePlacement);
  window.removeEventListener("scroll", updateMorePlacement, true);
}

function onDocumentPointerDown(event: PointerEvent): void {
  const target = event.target;
  if (
    target instanceof Node &&
    !moreTrigger.value?.contains(target) &&
    !morePanel.value?.contains(target)
  ) {
    closeMoreMenu();
  }
}

function onWindowKeydown(event: KeyboardEvent): void {
  if (event.key !== "Escape") return;
  event.preventDefault();
  event.stopImmediatePropagation();
  closeMoreMenu();
  void nextTick(() => moreTrigger.value?.focus());
}

function updateMorePlacement(): void {
  if (!moreOpen.value || moreTrigger.value === undefined || morePanel.value === undefined) return;
  morePlacement.value = placePopover(
    moreTrigger.value.getBoundingClientRect(),
    morePanel.value.getBoundingClientRect(),
    { width: window.innerWidth, height: window.innerHeight },
    { align: props.edge === "left" ? "start" : "end", preferAbove: props.edge !== "top", gap: 10, margin: 10 },
  );
}

function runMenuAction(action: "createText" | "captureScreen" | "openPrivacySettings" | "toggleCompact"): void {
  closeMoreMenu();
  switch (action) {
    case "createText":
      emit("createText");
      break;
    case "captureScreen":
      emit("captureScreen");
      break;
    case "openPrivacySettings":
      emit("openPrivacySettings");
      break;
    case "toggleCompact":
      emit("toggleCompact");
      break;
  }
}

onBeforeUnmount(closeMoreMenu);
</script>

<template>
  <header
    class="modern-toolbar"
    :class="{
      'modern-toolbar--vertical': isVerticalDock,
      'modern-toolbar--paused': paused,
    }"
    role="toolbar"
    aria-label="Paste 剪贴板工具栏"
  >
    <div class="modern-toolbar__identity" aria-label="Paste 剪贴板">
      <img src="/logo.png" alt="" />
      <span>Paste</span>
    </div>

    <SearchBar
      :model-value="query"
      collapsible
      @update:model-value="emit('update:query', $event)"
    />

    <div class="modern-toolbar__collections" aria-label="收藏夹">
      <slot name="collections" />
    </div>

    <div class="modern-toolbar__spacer" aria-hidden="true"></div>

    <div class="modern-toolbar__controls">
      <button
        type="button"
        class="modern-control modern-status"
        :class="{ 'modern-status--paused': paused }"
        :aria-pressed="paused"
        :title="paused ? '已暂停记录，点击继续' : '正在记录，点击暂停'"
        @click="emit('togglePause')"
      >
        <span class="modern-status__dot" aria-hidden="true"></span>
        <span>{{ paused ? "已暂停" : "正在记录" }}</span>
      </button>

      <div class="modern-stack">
        <button
          type="button"
          class="modern-control modern-stack__direction"
          :title="pasteStackPending ? '将已选 ' + pasteStackCount + ' 项加入粘贴队列' : pasteStackDirection === 'forward' ? '当前正序粘贴，点击切换倒序' : '当前倒序粘贴，点击切换正序'"
          :aria-label="pasteStackPending ? '将已选 ' + pasteStackCount + ' 项加入粘贴队列' : '粘贴队列 ' + pasteStackCount + ' 项，' + (pasteStackDirection === 'forward' ? '正序' : '倒序') + '，点击切换方向'"
          @click="pasteStackPending ? emit('startStack') : emit('toggleStackDirection')"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d="M4 7h13M7 4l-3 3 3 3M20 17H7m10-3 3 3-3 3"></path>
          </svg>
          <span class="modern-stack__label">{{ pasteStackPending ? "加入" : "队列" }}</span>
          <span class="modern-stack__count">{{ pasteStackCount }}</span>
          <span v-if="!pasteStackPending" class="modern-stack__order">{{ pasteStackDirection === "forward" ? "正序" : "倒序" }}</span>
        </button>
        <button
          v-if="pasteStackPending"
          type="button"
          class="modern-control modern-stack__pending-direction"
          :title="pasteStackDirection === 'forward' ? '当前正序加入，点击切换倒序' : '当前倒序加入，点击切换正序'"
          :aria-label="'切换队列方向，当前' + (pasteStackDirection === 'forward' ? '正序' : '倒序')"
          @click="emit('toggleStackDirection')"
        >
          <span aria-hidden="true">{{ pasteStackDirection === "forward" ? "正" : "倒" }}</span>
        </button>
        <button
          v-if="pasteStackPending || pasteStackCount > 0"
          type="button"
          class="modern-control modern-stack__clear"
          aria-label="清空粘贴队列"
          title="清空粘贴队列"
          @click="emit('clearStack')"
          >×</button>
      </div>

      <ShelfFilters
        :query="query"
        :items="items"
        :edge="edge"
        @update:query="emit('update:query', $event)"
      />

      <div class="modern-more-anchor">
        <button
          ref="moreTrigger"
          type="button"
          class="modern-control modern-more-button"
          aria-label="更多操作"
          title="更多操作"
          aria-haspopup="menu"
          :aria-expanded="moreOpen"
          @click="toggleMoreMenu"
        >•••</button>
      </div>
    </div>

    <Teleport to="body">
      <nav
        v-if="moreOpen"
        ref="morePanel"
        class="modern-more-menu popover-surface"
        role="menu"
        aria-label="更多操作"
        :style="menuStyle"
        @pointerdown.stop
        >
        <button type="button" class="popover-item" role="menuitem" @click="runMenuAction('createText')">
          <span class="modern-menu-icon" aria-hidden="true">＋</span>
          <span>新建文本</span>
          <kbd>{{ createTextShortcutTitle.split("（")[1]?.replace("）", "") }}</kbd>
        </button>
        <button
          v-if="canCaptureScreen"
          type="button"
          class="popover-item"
          role="menuitem"
          @click="runMenuAction('captureScreen')"
        >
          <span class="modern-menu-icon" aria-hidden="true">▧</span>
          <span>截取屏幕</span>
        </button>
        <button type="button" class="popover-item" role="menuitem" @click="runMenuAction('openPrivacySettings')">
          <span class="modern-menu-icon" aria-hidden="true">⚙</span>
          <span>设置</span>
        </button>
        <div class="modern-menu-divider"></div>
        <button
          type="button"
          class="popover-item"
          role="menuitemcheckbox"
          :aria-checked="compact"
          @click="runMenuAction('toggleCompact')"
        >
          <span class="modern-menu-icon" aria-hidden="true">↔</span>
          <span>{{ compact ? "展开卡片" : "紧凑卡片" }}</span>
          <span class="modern-menu-check" aria-hidden="true">{{ compact ? "✓" : "" }}</span>
        </button>
      </nav>
    </Teleport>
  </header>
</template>

<style scoped src="./ModernToolbar.css"></style>
