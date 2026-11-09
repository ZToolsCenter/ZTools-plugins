<script setup lang="ts">
import { computed } from "vue";
import type { Pinboard } from "@pasteboard-pro/core";

const props = defineProps<{
  pinboard: Pinboard;
  active: boolean;
  dragging?: boolean;
  reorderTarget?: "before" | "after" | undefined;
  reorderOffset?: number | undefined;
  isManaged?: boolean;
  isRenaming?: boolean;
}>();

const emit = defineEmits<{
  select: [id: string];
  beginRename: [pinboard: Pinboard, trigger: HTMLElement];
  openMenu: [event: MouseEvent, pinboard: Pinboard];
  startReorder: [event: PointerEvent, id: string];
  drop: [event: DragEvent, id: string];
}>();

const chipStyle = computed(() => ({
  transform: props.reorderOffset ? `translateX(${props.reorderOffset}px)` : undefined,
}));

function handleDblClick(event: MouseEvent): void {
  const target = event.currentTarget;
  if (target instanceof HTMLElement) {
    emit("beginRename", props.pinboard, target);
  }
}

function handlePointerDown(event: PointerEvent): void {
  emit("startReorder", event, props.pinboard.id);
}
</script>

<template>
  <div
    class="pinboard-chip"
    :class="{
      'pinboard-chip--active': active,
      'pinboard-chip--dragging': dragging,
    }"
    :data-pb-pinboard-id="pinboard.id"
    :data-pb-reorder-target="reorderTarget"
    :style="chipStyle"
    @contextmenu.prevent.stop="emit('openMenu', $event, pinboard)"
    @dragover.prevent
    @drop.prevent="emit('drop', $event, pinboard.id)"
  >
    <button
      v-show="!isRenaming"
      type="button"
      @click="emit('select', pinboard.id)"
      @dblclick.stop="handleDblClick"
    >
      <span class="dot" :style="{ background: pinboard.color }"></span>
      <span>{{ pinboard.name }}</span>
    </button>
    <button
      v-show="!isRenaming"
      type="button"
      class="manage-button"
      :aria-label="`管理 ${pinboard.name}`"
      aria-haspopup="menu"
      :aria-expanded="isManaged"
      data-pb-reorder-handle
      title="拖动调整顺序；点击打开分组菜单"
      @pointerdown.stop="handlePointerDown"
      @click.stop="emit('openMenu', $event, pinboard)"
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
    <slot name="inline-rename" />
  </div>
</template>

<style scoped src="../styles/pinboard-strip.css"></style>
