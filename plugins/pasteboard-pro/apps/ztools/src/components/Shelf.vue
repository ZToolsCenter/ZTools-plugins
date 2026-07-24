<script setup lang="ts">
import { computed } from "vue";

import type { PasteItem, PasteStackDirection, Pinboard } from "@pasteboard-pro/core";
import type { DockEdge } from "@pasteboard-pro/design-tokens";

import { visualState, type ShelfDensity } from "../state";
import PasteStack from "./PasteStack.vue";
import PinboardStrip from "./PinboardStrip.vue";
import Timeline from "./Timeline.vue";
import Toolbar from "./Toolbar.vue";

const props = defineProps<{
  items: readonly PasteItem[];
  pinboards: readonly Pinboard[];
  selectedIds: readonly string[];
  focusedItemId: string | undefined;
  query: string;
  paused: boolean;
  edge: DockEdge;
  density: ShelfDensity;
  activePinboardId: string | undefined;
  pasteStackCount: number;
  pasteStackDirection: PasteStackDirection;
}>();

const emit = defineEmits<{
  "update:query": [value: string];
  select: [itemId: string, extend: boolean, toggle: boolean];
  paste: [itemId: string, plainText?: boolean];
  preview: [itemId: string];
  latestVisible: [itemId: string];
  selectPinboard: [id: string | undefined];
  createPinboard: [name: string];
  renamePinboard: [id: string, name: string];
  updatePinboardColor: [id: string, color: string];
  movePinboard: [id: string, direction: -1 | 1];
  deletePinboard: [id: string];
  assignPinboard: [pinboardId: string | undefined, itemId: string];
  togglePause: [];
  toggleCompact: [];
  toggleStackDirection: [];
  clearStack: [];
  openPrivacySettings: [];
  createText: [];
}>();

const style = computed(() => visualState(props.edge, props.density));

function forwardSelect(itemId: string, extend: boolean, toggle: boolean): void {
  emit("select", itemId, extend, toggle);
}

function forwardRenamePinboard(id: string, name: string): void {
  emit("renamePinboard", id, name);
}

function forwardAssignPinboard(
  pinboardId: string | undefined,
  itemId: string,
): void {
  emit("assignPinboard", pinboardId, itemId);
}

</script>

<template>
  <section
    class="shelf glass-surface"
    :class="style.dockClass"
    :style="{ '--pb-card-width': `${style.cardWidth}px`, '--pb-dock-ms': `${style.transitionMs}ms` }"
    aria-label="Paste剪切板"
  >
    <Toolbar
      :query="query"
      :paused="paused"
      :compact="density === 'compact'"
      :edge="edge"
      @update:query="emit('update:query', $event)"
      @toggle-pause="emit('togglePause')"
      @toggle-compact="emit('toggleCompact')"
      @open-privacy-settings="emit('openPrivacySettings')"
      @create-text="emit('createText')"
    />
    <PinboardStrip
      :pinboards="pinboards"
      :active-id="activePinboardId"
      @select="emit('selectPinboard', $event)"
      @create="emit('createPinboard', $event)"
      @rename="forwardRenamePinboard"
      @update-color="emit('updatePinboardColor', $event.id, $event.color)"
      @move="emit('movePinboard', $event.id, $event.direction)"
      @delete="emit('deletePinboard', $event)"
      @assign="forwardAssignPinboard"
    />
    <Timeline
      :items="items"
      :selected-ids="selectedIds"
      :focused-id="focusedItemId"
      :vertical="edge === 'left' || edge === 'right'"
      :compact="density === 'compact'"
      @select="forwardSelect"
      @paste="emit('paste', $event)"
      @preview="emit('preview', $event)"
      @latest-visible="emit('latestVisible', $event)"
    />
    <PasteStack
      :count="pasteStackCount"
      :direction="pasteStackDirection"
      @toggle-direction="emit('toggleStackDirection')"
      @clear="emit('clearStack')"
    />
  </section>
</template>

<style scoped>
.shelf {
  position: relative;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  border-radius: var(--pb-radius);
  transition: border-radius var(--pb-dock-ms) ease, transform var(--pb-dock-ms) ease;
}

.shelf--bottom,
.shelf--top {
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
}

.shelf--bottom {
  border-right: 0;
  border-bottom: 0;
  border-left: 0;
  border-bottom-right-radius: 0;
  border-bottom-left-radius: 0;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.7);
}

.shelf--top {
  border-top: 0;
  border-right: 0;
  border-left: 0;
  border-top-right-radius: 0;
  border-top-left-radius: 0;
  box-shadow: inset 0 -1px 0 rgba(255, 255, 255, 0.7);
}

.shelf--left {
  display: grid;
  height: 100%;
  grid-template-rows: auto auto minmax(0, 1fr);
  border-top: 0;
  border-bottom: 0;
  border-left: 0;
  border-top-left-radius: 0;
  border-bottom-left-radius: 0;
  box-shadow: inset -1px 0 0 rgba(255, 255, 255, 0.7);
}

.shelf--right {
  display: grid;
  height: 100%;
  grid-template-rows: auto auto minmax(0, 1fr);
  border-top: 0;
  border-right: 0;
  border-bottom: 0;
  border-top-right-radius: 0;
  border-bottom-right-radius: 0;
  box-shadow: inset 1px 0 0 rgba(255, 255, 255, 0.7);
}

@media (prefers-reduced-motion: reduce) {
  .shelf {
    transition: none;
  }
}
</style>
