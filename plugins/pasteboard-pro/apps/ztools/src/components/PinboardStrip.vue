<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";

import type { Pinboard } from "@pasteboard-pro/core";

import { primaryModifierLabel, resolveShortcutPlatform } from "../platform-shortcuts";
import type { SmartPinboard } from "../smart-pinboards";
import { containContextMenuKeydown } from "../context-menu-keyboard";

const props = defineProps<{
  pinboards: readonly Pinboard[];
  smartPinboards: readonly SmartPinboard[];
  activeId: string | undefined;
}>();
const emit = defineEmits<{
  select: [id: string | undefined];
  create: [name: string];
  rename: [id: string, name: string];
  updateColor: [value: { id: string; color: string }];
  move: [value: { id: string; direction: -1 | 1 }];
  delete: [id: string];
  assign: [pinboardId: string | undefined, itemId: string];
}>();

const quickPasteShortcutLabel = computed(() => {
  const platform = resolveShortcutPlatform(
    window.pasteboardPro?.getPlatformCapabilities().platform,
  );
  return `${primaryModifierLabel(platform)} 1–9 快捷粘贴`;
});

const creating = ref(false);
const editingId = ref<string>();
const draft = ref("");
const managementMenu = ref<{ pinboardId: string; x: number; y: number }>();
const managedPinboard = computed(() =>
  managementMenu.value === undefined
    ? undefined
    : props.pinboards.find((pinboard) => pinboard.id === managementMenu.value?.pinboardId),
);

function beginCreate(): void {
  editingId.value = undefined;
  draft.value = "";
  creating.value = true;
}

function beginRename(pinboard: Pinboard): void {
  creating.value = false;
  editingId.value = pinboard.id;
  draft.value = pinboard.name;
}

function beginRenameFromMenu(pinboard: Pinboard): void {
  closeManagementMenu();
  beginRename(pinboard);
}

function closeManagementMenu(): void {
  document.removeEventListener("pointerdown", closeManagementMenu);
  window.removeEventListener("keydown", closeManagementMenuOnEscape);
  managementMenu.value = undefined;
}

function closeManagementMenuOnEscape(event: KeyboardEvent): void {
  if (event.key === "Escape") closeManagementMenu();
}

function handleManagementMenuKeydown(event: KeyboardEvent): void {
  containContextMenuKeydown(event, closeManagementMenu);
}

function openManagementMenu(event: MouseEvent, pinboard: Pinboard): void {
  const trigger = event.currentTarget;
  const bounds = trigger instanceof HTMLElement
    ? trigger.getBoundingClientRect()
    : undefined;
  const fromContextMenu = event.type === "contextmenu";
  if (!fromContextMenu && managementMenu.value?.pinboardId === pinboard.id) {
    closeManagementMenu();
    return;
  }
  const requestedX = fromContextMenu ? event.clientX : (bounds?.right ?? event.clientX) - 184;
  const requestedY = fromContextMenu ? event.clientY : (bounds?.bottom ?? event.clientY) + 5;
  closeManagementMenu();
  managementMenu.value = {
    pinboardId: pinboard.id,
    x: Math.max(8, Math.min(requestedX, window.innerWidth - 192)),
    y: Math.max(8, Math.min(requestedY, window.innerHeight - 248)),
  };
  document.addEventListener("pointerdown", closeManagementMenu);
  window.addEventListener("keydown", closeManagementMenuOnEscape);
}

function cancelEdit(): void {
  creating.value = false;
  editingId.value = undefined;
  draft.value = "";
}

function commitCreate(): void {
  const name = draft.value.trim();
  if (name.length > 0) emit("create", name);
  cancelEdit();
}

function commitRename(id: string): void {
  const name = draft.value.trim();
  if (name.length > 0) emit("rename", id, name);
  cancelEdit();
}

function dropItem(event: DragEvent, pinboardId: string | undefined): void {
  const itemId = event.dataTransfer?.getData("application/x-pasteboard-pro-item");
  if (itemId) emit("assign", pinboardId, itemId);
}

function changeColor(event: Event, id: string): void {
  const target = event.target;
  if (target instanceof HTMLInputElement) {
    emit("updateColor", { id, color: target.value });
    closeManagementMenu();
  }
}

function moveFromMenu(id: string, direction: -1 | 1): void {
  closeManagementMenu();
  emit("move", { id, direction });
}

function deleteFromMenu(id: string): void {
  closeManagementMenu();
  emit("delete", id);
}

defineExpose({ beginCreate });

onBeforeUnmount(closeManagementMenu);
</script>

<template>
  <nav class="pinboards" aria-label="分组">
    <button
      type="button"
      :class="{ active: activeId === undefined }"
      @dragover.prevent
      @drop.prevent="dropItem($event, undefined)"
      @click="emit('select', undefined)"
    >
      全部
    </button>
    <button
      v-for="pinboard in smartPinboards"
      :key="pinboard.id"
      type="button"
      class="smart-pinboard"
      :class="{ active: activeId === pinboard.id }"
      :title="`${pinboard.name}会根据全部历史中的内容类型自动同步`"
      @click="emit('select', pinboard.id)"
    >
      <span class="smart-pinboard__icon" :style="{ color: pinboard.color }" aria-hidden="true">{{ pinboard.icon === "text" ? "T" : "▧" }}</span>
      <span>{{ pinboard.name }}</span>
    </button>
    <div
      v-for="pinboard in pinboards"
      :key="pinboard.id"
      class="pinboard-chip"
      :class="{ 'pinboard-chip--active': activeId === pinboard.id }"
      @contextmenu.prevent.stop="openManagementMenu($event, pinboard)"
      @dragover.prevent
      @drop.prevent="dropItem($event, pinboard.id)"
    >
      <button
        v-if="editingId !== pinboard.id"
        type="button"
        @click="emit('select', pinboard.id)"
        @dblclick.stop="beginRename(pinboard)"
      >
        <span class="dot" :style="{ background: pinboard.color }"></span>
        <span>{{ pinboard.name }}</span>
      </button>
      <button
        v-if="editingId !== pinboard.id"
        type="button"
        class="manage-button"
        :aria-label="`管理 ${pinboard.name}`"
        aria-haspopup="menu"
        :aria-expanded="managementMenu?.pinboardId === pinboard.id"
        @pointerdown.stop
        @click.stop="openManagementMenu($event, pinboard)"
      >•••</button>
      <input
        v-else
        v-model="draft"
        class="inline-name"
        aria-label="重命名分组"
        autofocus
        @click.stop
        @keydown.enter.prevent="commitRename(pinboard.id)"
        @keydown.escape.prevent="cancelEdit"
        @blur="commitRename(pinboard.id)"
      />
    </div>
    <input
      v-if="creating"
      v-model="draft"
      class="inline-name inline-name--new"
      aria-label="新建分组"
      placeholder="分组名称"
      autofocus
      @keydown.enter.prevent="commitCreate"
      @keydown.escape.prevent="cancelEdit"
      @blur="commitCreate"
    />
    <button v-else type="button" class="add-button" aria-label="新建分组" @click="beginCreate">+</button>
    <span class="pinboards__hint">{{ quickPasteShortcutLabel }}</span>
  </nav>
  <Teleport to="body">
    <div
      v-if="managementMenu && managedPinboard"
      class="pinboard-manage-menu glass-surface"
      role="menu"
      :aria-label="`${managedPinboard.name} 管理选项`"
      :style="{ left: `${managementMenu.x}px`, top: `${managementMenu.y}px` }"
      @pointerdown.stop
      @contextmenu.prevent
      @keydown="handleManagementMenuKeydown"
    >
      <strong>{{ managedPinboard.name }}</strong>
      <button type="button" role="menuitem" @click="beginRenameFromMenu(managedPinboard)">重命名</button>
      <label class="color-action" role="menuitem">
        <input
          class="color-input"
          type="color"
          :value="managedPinboard.color"
          aria-label="分组颜色"
          @change="changeColor($event, managedPinboard.id)"
        />
        <span>更换颜色</span>
      </label>
      <button
        v-if="pinboards[0]?.id !== managedPinboard.id"
        type="button"
        role="menuitem"
        @click="moveFromMenu(managedPinboard.id, -1)"
      >← 移到左侧</button>
      <button
        v-if="pinboards.at(-1)?.id !== managedPinboard.id"
        type="button"
        role="menuitem"
        @click="moveFromMenu(managedPinboard.id, 1)"
      >移到右侧 →</button>
      <button
        type="button"
        role="menuitem"
        class="danger-button"
        @click="deleteFromMenu(managedPinboard.id)"
      >删除分组</button>
    </div>
  </Teleport>
</template>

<style scoped>
.pinboards {
  display: flex;
  gap: 6px;
  align-items: center;
  min-height: 38px;
  padding: 6px 16px 4px;
  overflow-x: auto;
  scrollbar-width: none;
}

.pinboards::-webkit-scrollbar {
  display: none;
}

button {
  display: inline-flex;
  flex: 0 0 auto;
  gap: 6px;
  align-items: center;
  min-height: 26px;
  padding: 0 10px;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: var(--pb-muted);
  cursor: pointer;
  font-size: 11px;
  font-weight: 600;
}

button.active {
  background: color-mix(in srgb, var(--pb-violet) 13%, transparent);
  color: var(--pb-violet);
}

.smart-pinboard {
  gap: 5px;
}

.smart-pinboard__icon {
  display: grid;
  width: 16px;
  height: 16px;
  border: 1px solid currentColor;
  border-radius: 5px;
  font-size: 9px;
  font-weight: 800;
  line-height: 1;
  place-items: center;
}

.pinboard-chip {
  position: relative;
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  min-height: 26px;
  border-radius: 9px;
}

.manage-button {
  width: 22px;
  min-width: 22px;
  padding: 0;
  overflow: hidden;
  opacity: 0;
  transition: opacity 120ms ease;
}

.pinboard-chip:hover .manage-button,
.pinboard-chip:focus-within .manage-button {
  opacity: 1;
}

.color-action {
  display: inline-flex;
  gap: 5px;
  align-items: center;
  min-height: 23px;
  padding: 0 7px;
  border-radius: 8px;
  color: var(--pb-muted);
  cursor: pointer;
  font-size: 11px;
  font-weight: 600;
}

.pinboard-manage-menu {
  position: fixed;
  z-index: 120;
  display: grid;
  width: 184px;
  padding: 7px;
  border: 1px solid var(--pb-line);
  border-radius: 13px;
  background: color-mix(in srgb, var(--pb-glass-strong) 96%, transparent);
  box-shadow: 0 18px 48px var(--pb-shadow);
}

.pinboard-manage-menu > strong {
  padding: 7px 9px;
  overflow: hidden;
  color: var(--pb-muted);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pinboard-manage-menu > button,
.pinboard-manage-menu > .color-action {
  justify-content: flex-start;
  width: 100%;
  min-height: 32px;
  padding: 0 9px;
  border-radius: 9px;
  color: var(--pb-ink);
}

.pinboard-manage-menu > button:hover,
.pinboard-manage-menu > button:focus-visible,
.pinboard-manage-menu > .color-action:hover,
.pinboard-manage-menu > .color-action:focus-within {
  background: color-mix(in srgb, var(--pb-violet) 12%, transparent);
  outline: 0;
}

.pinboard-manage-menu > .danger-button {
  margin-top: 4px;
  border-top: 1px solid var(--pb-line);
  border-radius: 0 0 9px 9px;
  color: #d94b57;
}

.color-action:hover {
  background: color-mix(in srgb, var(--pb-violet) 10%, transparent);
  color: var(--pb-ink);
}

.color-input {
  width: 18px;
  height: 23px;
  padding: 3px 0;
  border: 0;
  background: transparent;
  cursor: pointer;
}

.danger-button {
  color: #d94b57;
}

.pinboard-chip > button {
  min-height: 26px;
}

.pinboard-chip--active {
  background: color-mix(in srgb, var(--pb-violet) 13%, transparent);
}

.pinboard-chip--active > button {
  color: var(--pb-violet);
}

button:focus-visible {
  outline: 2px solid var(--pb-violet);
}

.inline-name {
  width: 92px;
  min-height: 22px;
  padding: 0 5px;
  border: 1px solid var(--pb-violet);
  border-radius: 7px;
  outline: 0;
  background: var(--pb-glass-strong);
  color: var(--pb-ink);
  font-size: 11px;
}

.inline-name--new {
  flex: 0 0 116px;
}

.add-button {
  width: 26px;
  padding: 0;
  justify-content: center;
  border: 1px dashed var(--pb-line);
  font-size: 16px;
}

.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
}

.pinboards__hint {
  margin-left: auto;
  padding-left: 16px;
  color: var(--pb-muted);
  font-size: 10px;
  white-space: nowrap;
}
</style>
