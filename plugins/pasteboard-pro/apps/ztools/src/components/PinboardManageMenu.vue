<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";

import type { Pinboard } from "@pasteboard-pro/core";
import { placePopover, type PopupPlacement, type PopupRect } from "./popup-position";

const props = defineProps<{
  pinboard: Pinboard | undefined;
  anchor: PopupRect | undefined;
  align?: "start" | "end";
}>();

const emit = defineEmits<{
  close: [restoreFocus?: boolean];
  rename: [pinboard: Pinboard];
  updateColor: [color: string];
  delete: [id: string];
}>();

const panel = ref<HTMLElement>();
const placement = ref<PopupPlacement>({ left: 8, top: 8 });

const menuStyle = computed(() => ({
  left: `${placement.value.left}px`,
  top: `${placement.value.top}px`,
}));

watch(() => props.pinboard, (current) => {
  if (current) {
    document.addEventListener("pointerdown", onDocumentPointerDown);
    window.addEventListener("keydown", onWindowKeydown);
    window.addEventListener("resize", updatePlacement);
    window.addEventListener("scroll", updatePlacement, true);
    void nextTick(() => {
      updatePlacement();
      panel.value?.querySelector<HTMLElement>("[role='menuitem']")?.focus({ preventScroll: true });
    });
  } else {
    cleanup();
  }
});

function cleanup(): void {
  document.removeEventListener("pointerdown", onDocumentPointerDown);
  window.removeEventListener("keydown", onWindowKeydown);
  window.removeEventListener("resize", updatePlacement);
  window.removeEventListener("scroll", updatePlacement, true);
}

onBeforeUnmount(cleanup);

function onDocumentPointerDown(event: PointerEvent): void {
  const target = event.target;
  if (target instanceof Node && !panel.value?.contains(target)) {
    emit("close", false);
  }
}

function onWindowKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopImmediatePropagation();
    emit("close", true);
  }
}

function handleMenuKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    emit("close", true);
    return;
  }
  if (!(["ArrowDown", "ArrowUp", "Home", "End"] as const).includes(event.key as "ArrowDown" | "ArrowUp" | "Home" | "End")) return;
  event.preventDefault();
  event.stopPropagation();
  const items = [...(panel.value?.querySelectorAll<HTMLElement>(
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

function updatePlacement(): void {
  const anchor = props.anchor;
  const p = panel.value;
  if (!props.pinboard || anchor === undefined || p === undefined) return;
  const bounds = p.getBoundingClientRect();
  placement.value = placePopover(
    anchor,
    { width: bounds.width, height: bounds.height },
    { width: window.innerWidth, height: window.innerHeight },
    { align: props.align ?? "end", preferAbove: true, gap: 5, margin: 8 },
  );
}

function onColorChange(event: Event): void {
  const target = event.target;
  if (target instanceof HTMLInputElement) {
    emit("updateColor", target.value);
  }
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="pinboard"
      ref="panel"
      class="pinboard-manage-menu popover-surface"
      role="menu"
      :aria-label="`${pinboard.name} 管理选项`"
      :style="menuStyle"
      @pointerdown.stop
      @contextmenu.prevent
      @keydown="handleMenuKeydown"
    >
      <strong class="popover-caption">{{ pinboard.name }}</strong>
      <button type="button" class="popover-item" role="menuitem" @click="emit('rename', pinboard)">重命名</button>
      <label class="color-action popover-item">
        <input
          class="color-input"
          type="color"
          role="menuitem"
          :value="pinboard.color"
          aria-label="分组颜色"
          @change="onColorChange"
        />
        <span>更换颜色</span>
      </label>
      <button
        type="button"
        class="popover-item popover-danger"
        role="menuitem"
        @click="emit('delete', pinboard.id)"
      >删除分组</button>
    </div>
  </Teleport>
</template>

<style scoped src="../styles/pinboard-strip.css"></style>
