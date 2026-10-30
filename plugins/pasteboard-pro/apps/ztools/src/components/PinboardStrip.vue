<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, ref, watch, type ComponentPublicInstance } from "vue";

import type { Pinboard } from "@pasteboard-pro/core";
import type { ShelfUiVersion } from "../../preload/window-preferences";

import { primaryModifierLabel, resolveShortcutPlatform } from "../platform-shortcuts";
import type { SmartPinboard } from "../smart-pinboards";
import { useImeSubmitGuard } from "../use-ime-submit-guard";
import { usePinboardReorder, type PinboardReorderRequest } from "../use-pinboard-reorder";
import { shelfUiVersionKey } from "../shelf-presentation";
import { placePopover, type PopupPlacement } from "./popup-position";
import PinboardNameDialog from "./PinboardNameDialog.vue";
import "../styles/popover-theme.css";

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
  reorder: [value: PinboardReorderRequest];
  delete: [id: string];
  assign: [pinboardId: string | undefined, itemId: string];
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
const managementAnchor = ref<DOMRect | { left: number; right: number; top: number; bottom: number }>();
const managementAlign = ref<"start" | "end">("end");
const managementPanel = ref<HTMLElement>();
const managementMenu = ref<{ pinboardId: string }>();
const managementPlacement = ref<PopupPlacement>({ left: 8, top: 8 });
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
const managedPinboard = computed(() =>
  managementMenu.value === undefined
    ? undefined
    : props.pinboards.find((pinboard) => pinboard.id === managementMenu.value?.pinboardId),
);
const managementMenuStyle = computed(() => ({
  left: `${managementPlacement.value.left}px`,
  top: `${managementPlacement.value.top}px`,
}));

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
  document.removeEventListener("pointerdown", onDocumentPointerDown);
  window.removeEventListener("keydown", closeManagementMenuOnEscape);
  window.removeEventListener("resize", updateManagementPlacement);
  window.removeEventListener("scroll", updateManagementPlacement, true);
  managementMenu.value = undefined;
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

function onDocumentPointerDown(event: PointerEvent): void {
  const target = event.target;
  if (
    target instanceof Node &&
    !managementTrigger.value?.contains(target) &&
    !managementPanel.value?.contains(target)
  ) {
    closeManagementMenu(false);
  }
}

function closeManagementMenuOnEscape(event: KeyboardEvent): void {
  if (event.key !== "Escape") return;
  event.preventDefault();
  event.stopImmediatePropagation();
  closeManagementMenu(true);
}

function handleManagementMenuKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    closeManagementMenu(true);
    return;
  }
  if (!(["ArrowDown", "ArrowUp", "Home", "End"] as const).includes(event.key as "ArrowDown" | "ArrowUp" | "Home" | "End")) return;
  event.preventDefault();
  event.stopPropagation();
  const items = [...(managementPanel.value?.querySelectorAll<HTMLElement>(
    '[role="menuitem"]:not([aria-disabled="true"])',
  ) ?? [])];
  if (items.length === 0) return;
  const current = items.indexOf(document.activeElement as HTMLElement);
  const next = event.key === "Home"
    ? 0
    : event.key === "End"
      ? items.length - 1
      : (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
  items[next]?.focus({ preventScroll: true });
}

function openManagementMenu(event: MouseEvent, pinboard: Pinboard): void {
  const trigger = event.currentTarget instanceof HTMLElement ? event.currentTarget : undefined;
  const fromContextMenu = event.type === "contextmenu";
  if (!fromContextMenu && managementMenu.value?.pinboardId === pinboard.id) {
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
  managementMenu.value = { pinboardId: pinboard.id };
  document.addEventListener("pointerdown", onDocumentPointerDown);
  window.addEventListener("keydown", closeManagementMenuOnEscape);
  window.addEventListener("resize", updateManagementPlacement);
  window.addEventListener("scroll", updateManagementPlacement, true);
  void nextTick(() => {
    updateManagementPlacement();
    managementPanel.value?.querySelector<HTMLElement>("[role='menuitem']")?.focus({ preventScroll: true });
  });
}

function updateManagementPlacement(): void {
  const anchor = managementAnchor.value;
  const panel = managementPanel.value;
  if (!managementMenu.value || anchor === undefined || panel === undefined) return;
  const bounds = panel.getBoundingClientRect();
  managementPlacement.value = placePopover(
    anchor,
    { width: bounds.width, height: bounds.height },
    { width: window.innerWidth, height: window.innerHeight },
    { align: managementAlign.value, preferAbove: true, gap: 5, margin: 8 },
  );
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

function changeColor(event: Event, id: string): void {
  const target = event.target;
  if (target instanceof HTMLInputElement) {
    emit("updateColor", { id, color: target.value });
    closeManagementMenu(true);
  }
}

function deleteFromMenu(id: string): void {
  closeManagementMenu(false);
  emit("delete", id);
  void nextTick(() => addButton.value?.focus({ preventScroll: true }));
}

defineExpose({ beginCreate });

onBeforeUnmount(() => closeManagementMenu(false));
</script>

<template>
  <nav
    ref="pinboardNav"
    class="pinboards"
    aria-label="分组"
    :data-pb-reorder-active="reorderState ? 'true' : undefined"
  >
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
      :class="{
        'pinboard-chip--active': activeId === pinboard.id,
        'pinboard-chip--dragging': reorderState?.id === pinboard.id,
      }"
      :data-pb-pinboard-id="pinboard.id"
      :data-pb-reorder-target="reorderState?.target?.id === pinboard.id ? reorderState.target.position : undefined"
      :style="{ transform: reorderOffsets[pinboard.id] ? `translateX(${reorderOffsets[pinboard.id]}px)` : undefined }"
      @contextmenu.prevent.stop="openManagementMenu($event, pinboard)"
      @dragover.prevent
      @drop.prevent="dropItem($event, pinboard.id)"
    >
      <button
        type="button"
        v-show="classicRenameId !== pinboard.id"
        @click="emit('select', pinboard.id)"
        @dblclick.stop="beginRename(pinboard, $event.currentTarget)"
      >
        <span class="dot" :style="{ background: pinboard.color }"></span>
        <span>{{ pinboard.name }}</span>
      </button>
      <button
        type="button"
        class="manage-button"
        v-show="classicRenameId !== pinboard.id"
        :aria-label="`管理 ${pinboard.name}`"
        aria-haspopup="menu"
        :aria-expanded="managementMenu?.pinboardId === pinboard.id"
        data-pb-reorder-handle
        title="拖动调整顺序；点击打开分组菜单"
        @pointerdown.stop="startPinboardReorder($event, pinboard.id)"
        @click.stop="openManagementMenu($event, pinboard)"
      >
        <svg
          class="manage-button-icon"
          viewBox="0 0 16 16"
          aria-hidden="true"
          focusable="false"
        >
          <path d="M3 4h10M3 8h10M3 12h10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
        </svg>
      </button>
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
    </div>
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
    <span class="pinboards__hint">{{ quickPasteShortcutLabel }}</span>
  </nav>
  <Teleport to="body">
    <div
      v-if="managementMenu && managedPinboard"
      ref="managementPanel"
      class="pinboard-manage-menu popover-surface"
      role="menu"
      :aria-label="`${managedPinboard.name} 管理选项`"
      :style="managementMenuStyle"
      @pointerdown.stop
      @contextmenu.prevent
      @keydown="handleManagementMenuKeydown"
    >
      <strong class="popover-caption">{{ managedPinboard.name }}</strong>
      <button type="button" class="popover-item" role="menuitem" @click="beginRenameFromMenu(managedPinboard)">重命名</button>
      <label class="color-action popover-item">
        <input
          class="color-input"
          type="color"
          role="menuitem"
          :value="managedPinboard.color"
          aria-label="分组颜色"
          @change="changeColor($event, managedPinboard.id)"
        />
        <span>更换颜色</span>
      </label>
      <button
        type="button"
        class="popover-item popover-danger"
        role="menuitem"
        @click="deleteFromMenu(managedPinboard.id)"
      >删除分组</button>
    </div>
  </Teleport>
  <PinboardNameDialog
    :open="nameDialogOpen && uiVersion === 'modern'"
    :mode="nameDialogMode"
    :initial-name="nameDialogInitialName"
    @close="closeNameDialog"
    @submit="commitName"
  />
</template>

<style scoped src="../styles/pinboard-strip.css"></style>
