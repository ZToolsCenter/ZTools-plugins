<script setup lang="ts">
import { computed, provide, ref } from "vue";

import type { PasteItem, PasteStackDirection, Pinboard } from "@pasteboard-pro/core";
import type { DockEdge } from "@pasteboard-pro/design-tokens";

import { visualState, type ShelfDensity } from "../state";
import type { SmartPinboard } from "../smart-pinboards";
import type { PinboardReorderRequest } from "../use-pinboard-reorder";
import { listOrderScope, type ListReorderRequest } from "../list-order";
import PasteStack from "./PasteStack.vue";
import PinboardStrip from "./PinboardStrip.vue";
import Timeline from "./Timeline.vue";
import Toolbar from "./Toolbar.vue";
import ModernToolbar from "./ModernToolbar.vue";
import ThemeImageBackdrop from "./ThemeImageBackdrop.vue";
import { modernShelfVariables, shelfUiVersionKey } from "../shelf-presentation";
import type { ThemeBackground } from "../../preload/window-theme-preferences";
import type { ThemePreferences, ShelfUiVersion } from "../../preload/window-preferences";

const props = defineProps<{
  uiVersion?: ShelfUiVersion;
  accentColor?: string;
  darkMode?: boolean;
  themeBackground?: ThemeBackground;
  cardBackground?: ThemePreferences["cardBackground"];
  backgroundBaseColor?: string | undefined;
  items: readonly PasteItem[];
  total?: number;
  hasMore?: boolean;
  pinboards: readonly Pinboard[];
  smartPinboards: readonly SmartPinboard[];
  selectedIds: readonly string[];
  focusedItemId: string | undefined;
  query: string;
  paused: boolean;
  edge: DockEdge;
  density: ShelfDensity;
  activePinboardId: string | undefined;
  pasteStackCount: number;
  pasteStackDirection: PasteStackDirection;
  reorderEnabled: boolean;
  canCaptureScreen: boolean;
}>();

const emit = defineEmits<{
  "update:query": [value: string];
  loadMore: [];
  select: [itemId: string, extend: boolean, toggle: boolean];
  paste: [itemId: string, plainText?: boolean];
  preview: [itemId: string];
  latestVisible: [itemId: string];
  selectPinboard: [id: string | undefined];
  createPinboard: [name: string];
  renamePinboard: [id: string, name: string];
  updatePinboardColor: [id: string, color: string];
  reorderPinboard: [value: PinboardReorderRequest];
  deletePinboard: [id: string];
  assignPinboard: [pinboardId: string | undefined, itemId: string];
  togglePause: [];
  toggleCompact: [];
  toggleStackDirection: [];
  startStack: [];
  clearStack: [];
  openPrivacySettings: [];
  createText: [];
  captureScreen: [];
  pointerReorderActive: [active: boolean];
  reorder: [value: ListReorderRequest];
}>();

const uiVersion = computed(() => props.uiVersion ?? "modern");
provide(shelfUiVersionKey, uiVersion);
const modern = computed(() => uiVersion.value === "modern");
const pasteStackPending = computed(
  () => modern.value && props.pasteStackCount === 0 && props.selectedIds.length > 1,
);
const displayedPasteStackCount = computed(() => {
  if (props.pasteStackCount > 0) return props.pasteStackCount;
  return pasteStackPending.value ? props.selectedIds.length : 0;
});
const style = computed(() => visualState(props.edge, props.density));
const shelfStyle = computed<Record<string, string>>(() => {
  const variables: Record<string, string> = {
    "--pb-card-width": `${modern.value ? (props.density === "compact" ? 200 : 264) : style.value.cardWidth}px`,
    "--pb-dock-ms": `${style.value.transitionMs}ms`,
  };
  if (modern.value) {
    Object.assign(
      variables,
      modernShelfVariables(
        props.accentColor,
        props.darkMode ?? false,
        props.themeBackground,
        {
          ...(props.cardBackground === undefined ? {} : { cardBackground: props.cardBackground }),
          ...(props.backgroundBaseColor === undefined ? {} : { backgroundBaseColor: props.backgroundBaseColor }),
        },
      ),
    );
  }
  if (props.themeBackground?.type === "image") {
    variables["--pb-theme-background-image"] = "none";
  }
  return variables;
});
const pinboardStrip = ref<InstanceType<typeof PinboardStrip>>();
const timeline = ref<InstanceType<typeof Timeline>>();

defineExpose({ focusItem: (itemId: string) => timeline.value?.focusItem(itemId) });

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

function requestCreatePinboard(): void {
  pinboardStrip.value?.beginCreate();
}

</script>

<template>
  <section
    class="shelf glass-surface"
    :class="[
      style.dockClass,
      {
        'shelf--modern': modern,
        'shelf--theme-background': themeBackground?.type === 'color' || themeBackground?.type === 'image' || backgroundBaseColor !== undefined,
        'shelf--custom-card-background': cardBackground !== undefined,
        'shelf--custom-base-background': backgroundBaseColor !== undefined && themeBackground?.type !== 'image',
        'shelf--theme-background-image': themeBackground?.type === 'image',
        'shelf--image-frosted': themeBackground?.type === 'image' && themeBackground.frosted === true,
      },
    ]"
    :style="shelfStyle"
    aria-label="Paste剪切板"
  >
    <ThemeImageBackdrop
      v-if="themeBackground?.type === 'image'"
      :background="themeBackground"
    />
    <component
      :is="modern ? ModernToolbar : Toolbar"
      :query="query"
      :paused="paused"
      :compact="density === 'compact'"
      :can-capture-screen="canCaptureScreen"
      :edge="edge"
      :items="items"
      :paste-stack-count="displayedPasteStackCount"
      :paste-stack-pending="pasteStackPending"
      :paste-stack-direction="pasteStackDirection"
      @toggle-stack-direction="emit('toggleStackDirection')"
      @start-stack="emit('startStack')"
      @clear-stack="emit('clearStack')"
      @update:query="emit('update:query', $event)"
      @toggle-pause="emit('togglePause')"
      @toggle-compact="emit('toggleCompact')"
      @open-privacy-settings="emit('openPrivacySettings')"
      @create-text="emit('createText')"
      @capture-screen="emit('captureScreen')"
    >
      <template v-if="modern" #collections>
    <PinboardStrip
      ref="pinboardStrip"
      :pinboards="pinboards"
      :smart-pinboards="smartPinboards"
      :active-id="activePinboardId"
      @select="emit('selectPinboard', $event)"
      @create="emit('createPinboard', $event)"
      @rename="forwardRenamePinboard"
      @update-color="emit('updatePinboardColor', $event.id, $event.color)"
      @reorder="emit('reorderPinboard', $event)"
      @delete="emit('deletePinboard', $event)"
      @assign="forwardAssignPinboard"
    />
      </template>
    </component>
    <PinboardStrip
      v-if="!modern"
      ref="pinboardStrip"
      :pinboards="pinboards"
      :smart-pinboards="smartPinboards"
      :active-id="activePinboardId"
      @select="emit('selectPinboard', $event)"
      @create="emit('createPinboard', $event)"
      @rename="forwardRenamePinboard"
      @update-color="emit('updatePinboardColor', $event.id, $event.color)"
      @reorder="emit('reorderPinboard', $event)"
      @delete="emit('deletePinboard', $event)"
      @assign="forwardAssignPinboard"
    />
    <Timeline
      ref="timeline"
      :reorder-enabled="reorderEnabled"
      :reorder-scope="listOrderScope(activePinboardId)"
      :items="items"
      :total="total ?? items.length"
      :has-more="hasMore ?? false"
      @load-more="emit('loadMore')"
      :pinboards="pinboards"
      :selected-ids="selectedIds"
      :focused-id="focusedItemId"
      :vertical="edge === 'left' || edge === 'right'"
      :compact="density === 'compact'"
      @select="forwardSelect"
      @paste="emit('paste', $event)"
      @preview="emit('preview', $event)"
      @assign-pinboard="forwardAssignPinboard"
      @create-pinboard="requestCreatePinboard"
      @latest-visible="emit('latestVisible', $event)"
      @pointer-reorder-active="emit('pointerReorderActive', $event)"
      @reorder="emit('reorder', $event)"
    />
    <PasteStack
      v-if="!modern"
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

<style src="../styles/modern-shelf.css"></style>
