<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, ref, watch, type ComponentPublicInstance } from "vue";

import type { Pinboard } from "@pasteboard-pro/core";
import type { DockEdge } from "@pasteboard-pro/design-tokens";
import type { ShelfUiVersion } from "../../preload/window-preferences";

import { primaryModifierLabel, resolveShortcutPlatform } from "../platform-shortcuts";
import type { SmartPinboard } from "../smart-pinboards";
import { useImeSubmitGuard } from "../use-ime-submit-guard";
import { usePinboardReorder, type PinboardReorderRequest } from "../use-pinboard-reorder";
import { shelfUiVersionKey } from "../shelf-presentation";
import { placePopover, type PopupPlacement } from "./popup-position";
import PinboardChip from "./PinboardChip.vue";
import PinboardManageMenu from "./PinboardManageMenu.vue";
import PinboardNameDialog from "./PinboardNameDialog.vue";
import type { PopupRect } from "./popup-position";
import "../styles/popover-theme.css";

const props = withDefaults(
  defineProps<{
    pinboards: readonly Pinboard[];
    smartPinboards: readonly SmartPinboard[];
    activeId: string | undefined;
    edge?: DockEdge;
  }>(),
  { edge: "bottom" },
);

const isVertical = computed(() => props.edge === "left" || props.edge === "right");
const emit = defineEmits<{
  select: [id: string | undefined]; create: [name: string]; rename: [id: string, name: string];
  updateColor: [value: { id: string; color: string }]; reorder: [value: PinboardReorderRequest];
  delete: [id: string]; assign: [pinboardId: string | undefined, itemId: string];
}>();

const quickPasteShortcutLabel = computed(() => {
  const platform = resolveShortcutPlatform(
    window.pasteboardPro?.getPlatformCapabilities().platform,
  );
  return `${primaryModifierLabel(platform)} 1–9 快捷粘贴`;
});

const uiVersion = inject(shelfUiVersionKey, ref<ShelfUiVersion>("modern"));
const nameDialogOpen = ref(false);
const nameDialogMode = ref<"create" | "rename">("create");
const nameDialogPinboardId = ref<string>();
const nameDialogInitialName = ref("");
const nameDialogReturnFocus = ref<HTMLElement>();
const pinboardNav = ref<HTMLElement>();
const addButton = ref<HTMLButtonElement>();
const inlineNameInput = ref<HTMLInputElement>();
const managementTrigger = ref<HTMLElement>();
const managementAnchor = ref<PopupRect>();
const managementAlign = ref<"start" | "end">("end");
const managedPinboard = ref<Pinboard>();
const imeSubmitGuard = useImeSubmitGuard();
const pinboardIds = computed(() => props.pinboards.map((pinboard) => pinboard.id));
const {
  active: reorderState,
  offsets: reorderOffsets,
  start: beginPointerReorder,
} = usePinboardReorder(
  pinboardNav,
  pinboardIds,
  (value) => emit("reorder", value),
);
const classicCreateOpen = computed(() =>
  uiVersion.value === "classic" && nameDialogOpen.value && nameDialogMode.value === "create",
);
const classicRenameId = computed(() =>
  uiVersion.value === "classic" && nameDialogOpen.value && nameDialogMode.value === "rename"
    ? nameDialogPinboardId.value
    : undefined,
);

// Moving keyed DOM nodes can blur the focused management button after the
// asynchronous order reload. Restore only focus that the patch itself lost.
watch(() => props.pinboards.map((pinboard) => pinboard.id).join("\0"), async () => {
  const focused = document.activeElement;
  if (!(focused instanceof HTMLElement) || !pinboardNav.value?.contains(focused)) return;
  await nextTick();
  if (focused.isConnected && document.activeElement === document.body) {
    focused.focus({ preventScroll: true });
  }
});

function beginCreate(): void {
  closeManagementMenu(false);
  nameDialogMode.value = "create";
  nameDialogPinboardId.value = undefined;
  nameDialogInitialName.value = "";
  nameDialogReturnFocus.value = addButton.value ?? activeElement();
  nameDialogOpen.value = true;
  focusInlineNameInput();
}

function beginRename(pinboard: Pinboard, trigger?: EventTarget | null): void {
  closeManagementMenu(false);
  nameDialogMode.value = "rename";
  nameDialogPinboardId.value = pinboard.id;
  nameDialogInitialName.value = pinboard.name;
  nameDialogReturnFocus.value = trigger instanceof HTMLElement
    ? trigger
    : managementTrigger.value ?? activeElement();
  nameDialogOpen.value = true;
  focusInlineNameInput();
}

function focusInlineNameInput(): void {
  if (uiVersion.value !== "classic") return;
  void nextTick(() => {
    inlineNameInput.value?.focus({ preventScroll: true });
    if (nameDialogMode.value === "rename") inlineNameInput.value?.select();
  });
}

function setInlineNameInput(element: Element | ComponentPublicInstance | null): void {
  inlineNameInput.value = element instanceof HTMLInputElement ? element : undefined;
}

function beginRenameFromMenu(pinboard: Pinboard): void {
  const trigger = managementTrigger.value;
  beginRename(pinboard, trigger);
}

function activeElement(): HTMLElement | undefined {
  return document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
}

function closeManagementMenu(restoreFocus = false): void {
  managedPinboard.value = undefined;
  managementAnchor.value = undefined;
  const trigger = managementTrigger.value;
  managementTrigger.value = undefined;
  if (restoreFocus && trigger?.isConnected) {
    void nextTick(() => trigger.focus({ preventScroll: true }));
  }
}

watch(reorderState, (active, previous) => {
  if (active !== undefined && previous === undefined) closeManagementMenu(false);
}, { flush: "sync" });

function openManagementMenu(event: MouseEvent, pinboard: Pinboard): void {
  const trigger = event.currentTarget instanceof HTMLElement ? event.currentTarget : undefined;
  const fromContextMenu = event.type === "contextmenu";
  if (!fromContextMenu && managedPinboard.value?.id === pinboard.id) {
    closeManagementMenu(true);
    return;
  }
  closeManagementMenu(false);
  managementTrigger.value = trigger?.matches("button")
    ? trigger
    : trigger?.querySelector<HTMLElement>(".manage-button") ?? undefined;
  managementAlign.value = fromContextMenu ? "start" : "end";
  managementAnchor.value = fromContextMenu
    ? { left: event.clientX, right: event.clientX, top: event.clientY, bottom: event.clientY }
    : trigger?.getBoundingClientRect();
  managedPinboard.value = pinboard;
}

function handleColorUpdate(color: string): void {
  if (managedPinboard.value) {
    emit("updateColor", { id: managedPinboard.value.id, color });
    closeManagementMenu(true);
  }
}

function closeNameDialog(): void {
  nameDialogOpen.value = false;
  const trigger = nameDialogReturnFocus.value;
  nameDialogReturnFocus.value = undefined;
  nameDialogPinboardId.value = undefined;
  void nextTick(() => {
    if (trigger?.isConnected) trigger.focus({ preventScroll: true });
  });
}

function commitName(name: string): void {
  if (!nameDialogOpen.value) return;
  const normalizedName = name.trim();
  if (normalizedName.length === 0) {
    closeNameDialog();
    return;
  }
  if (nameDialogMode.value === "create") {
    emit("create", normalizedName);
  } else if (nameDialogPinboardId.value !== undefined) {
    emit("rename", nameDialogPinboardId.value, normalizedName);
  }
  closeNameDialog();
}

function submitInlineName(): void {
  if (!nameDialogOpen.value) return;
  if (imeSubmitGuard.shouldSuppressSubmit()) return;
  commitName(nameDialogInitialName.value);
}

function startPinboardReorder(event: PointerEvent, id: string): void {
  const handle = event.currentTarget;
  if (handle instanceof HTMLElement) beginPointerReorder(event, id, handle);
}

function dropItem(event: DragEvent, pinboardId: string | undefined): void {
  const itemId = event.dataTransfer?.getData("application/x-pasteboard-pro-item");
  if (itemId) emit("assign", pinboardId, itemId);
}


function deleteFromMenu(id: string): void {
  closeManagementMenu(false);
  emit("delete", id);
  void nextTick(() => addButton.value?.focus({ preventScroll: true }));
}

const customExpanded = ref(false);
const isCustomPinboardActive = computed(() =>
  props.pinboards.some((pinboard) => pinboard.id === props.activeId),
);
const activeCustomPinboard = computed(() =>
  props.pinboards.find((pinboard) => pinboard.id === props.activeId),
);

function toggleCustomExpanded(): void {
  customExpanded.value = !customExpanded.value;
}

function selectPinboardChip(id: string): void {
  if (props.activeId === id) {
    emit("select", undefined);
  } else {
    emit("select", id);
  }
}

function dropItemOnDot(event: DragEvent): void {
  if (isCustomPinboardActive.value && activeCustomPinboard.value) {
    dropItem(event, activeCustomPinboard.value.id);
  } else {
    customExpanded.value = true;
  }
}

let hoverTimer: number | undefined;

function onPinboardMouseEnter(): void {
  if (hoverTimer !== undefined) {
    clearTimeout(hoverTimer);
    hoverTimer = undefined;
  }
  customExpanded.value = true;
}

function onPinboardMouseLeave(): void {
  if (hoverTimer !== undefined) clearTimeout(hoverTimer);
  hoverTimer = window.setTimeout(() => {
    if (managedPinboard.value || nameDialogOpen.value || reorderState.value) return;
    customExpanded.value = false;
  }, 240);
}

defineExpose({ beginCreate });

onBeforeUnmount(() => {
  if (hoverTimer !== undefined) clearTimeout(hoverTimer);
  closeManagementMenu(false);
});
</script>

<template>
  <nav
    ref="pinboardNav"
    class="pinboards"
    aria-label="分组"
    :data-pb-reorder-active="reorderState ? 'true' : undefined"
  >
    <!-- Classic view: original full display -->
    <template v-if="uiVersion === 'classic'">
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
      <PinboardChip
        v-for="pinboard in pinboards"
        :key="pinboard.id"
        :pinboard="pinboard"
        :active="activeId === pinboard.id"
        :dragging="reorderState?.id === pinboard.id"
        :reorder-target="reorderState?.target?.id === pinboard.id ? reorderState.target.position : undefined"
        :reorder-offset="reorderOffsets[pinboard.id]"
        :is-managed="managedPinboard?.id === pinboard.id"
        :is-renaming="classicRenameId === pinboard.id"
        @select="emit('select', $event)"
        @begin-rename="beginRename"
        @open-menu="openManagementMenu"
        @start-reorder="startPinboardReorder"
        @drop="dropItem"
      >
        <template #inline-rename>
          <form
            v-if="classicRenameId === pinboard.id"
            class="pinboard-inline-name"
            @submit.prevent="submitInlineName"
          >
            <input
              :ref="setInlineNameInput"
              v-model="nameDialogInitialName"
              type="text"
              autocomplete="off"
              aria-label="重命名分组"
              @click.stop
              @keydown="imeSubmitGuard.noteKeydown"
              @keydown.esc.stop.prevent="closeNameDialog"
              @blur="submitInlineName"
            />
          </form>
        </template>
      </PinboardChip>
      <form
        v-if="classicCreateOpen"
        class="pinboard-inline-name pinboard-inline-name--new"
        @submit.prevent="submitInlineName"
      >
        <input
          :ref="setInlineNameInput"
          v-model="nameDialogInitialName"
          type="text"
          autocomplete="off"
          aria-label="新建分组"
          placeholder="分组名称"
          @keydown="imeSubmitGuard.noteKeydown"
          @keydown.esc.stop.prevent="closeNameDialog"
          @blur="submitInlineName"
        />
      </form>
      <button
        ref="addButton"
        v-show="!classicCreateOpen"
        type="button"
        class="add-button"
        aria-label="新建分组"
        @click="beginCreate"
      >+</button>
    </template>

    <!-- Modern view: smart pinboards hidden, custom pinboards collapsed into a dot -->
    <template v-else>
      <div
        class="pinboards__modern-group"
        @mouseenter="onPinboardMouseEnter"
        @mouseleave="onPinboardMouseLeave"
      >
        <button
          v-if="pinboards.length > 0"
          type="button"
          class="pinboard-dot-toggle"
          :class="{
            'pinboard-dot-toggle--expanded': customExpanded,
            'pinboard-dot-toggle--active': isCustomPinboardActive,
          }"
          :title="customExpanded ? '收起收藏夹列表' : (isCustomPinboardActive ? '当前分组：' + activeCustomPinboard?.name + '（点击或悬停展开）' : '展开收藏夹列表 (' + pinboards.length + ')')"
          :aria-label="customExpanded ? '收起收藏夹列表' : '展开收藏夹列表'"
          :aria-expanded="customExpanded"
          @click="toggleCustomExpanded"
          @dragover.prevent
          @drop.prevent="dropItemOnDot"
        >
          <span
            class="dot"
            :style="{ background: activeCustomPinboard?.color ?? 'var(--pb-violet, #7a68e8)' }"
            aria-hidden="true"
          ></span>
          <span v-if="!customExpanded && isCustomPinboardActive" class="pinboard-dot-toggle__name">
            {{ activeCustomPinboard?.name }}
          </span>
          <svg
            class="pinboard-dot-toggle__chevron"
            :class="{
              'pinboard-dot-toggle__chevron--open': customExpanded,
              'pinboard-dot-toggle__chevron--vertical': isVertical,
            }"
            viewBox="0 0 12 12"
            width="10"
            height="10"
            aria-hidden="true"
          >
            <path d="M4.5 3l3 3-3 3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>

        <div
          class="pinboards__collapsible"
          :class="{
            'pinboards__collapsible--expanded': customExpanded,
            'pinboards__collapsible--vertical': isVertical,
          }"
        >
          <button
            type="button"
            class="pinboard-chip-all"
            :class="{ 'pinboard-chip-all--active': activeId === undefined }"
            @dragover.prevent
            @drop.prevent="dropItem($event, undefined)"
            @click="emit('select', undefined)"
          >
            全部
          </button>
        <PinboardChip
          v-for="pinboard in pinboards"
          :key="pinboard.id"
          :pinboard="pinboard"
          :active="activeId === pinboard.id"
          :dragging="reorderState?.id === pinboard.id"
          :reorder-target="reorderState?.target?.id === pinboard.id ? reorderState.target.position : undefined"
          :reorder-offset="reorderOffsets[pinboard.id]"
          :is-managed="managedPinboard?.id === pinboard.id"
          @select="selectPinboardChip"
          @begin-rename="beginRename"
          @open-menu="openManagementMenu"
          @start-reorder="startPinboardReorder"
          @drop="dropItem"
        />

        <button
          ref="addButton"
          type="button"
          class="add-button"
          title="新建分组"
          aria-label="新建分组"
          @click="beginCreate"
        >+</button>
        </div>
      </div>

      <button
        v-if="pinboards.length === 0"
        ref="addButton"
        type="button"
        class="add-button"
        title="新建分组"
        aria-label="新建分组"
        @click="beginCreate"
      >+</button>
    </template>
    <span class="pinboards__hint">{{ quickPasteShortcutLabel }}</span>
  </nav>
  <PinboardManageMenu
    :pinboard="managedPinboard"
    :anchor="managementAnchor"
    :align="managementAlign"
    @close="closeManagementMenu"
    @rename="beginRenameFromMenu"
    @update-color="handleColorUpdate"
    @delete="deleteFromMenu"
  />
  <PinboardNameDialog
    :open="nameDialogOpen && uiVersion === 'modern'"
    :mode="nameDialogMode"
    :initial-name="nameDialogInitialName"
    @close="closeNameDialog"
    @submit="commitName"
  />
</template>

<style scoped src="../styles/pinboard-strip.css"></style>
