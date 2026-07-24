<script setup lang="ts">
import type { ContextMenuItem } from "../composables/useContextMenu";

defineProps<{
  visible: boolean;
  x: number;
  y: number;
  items: ContextMenuItem[];
}>();

const emit = defineEmits<{
  select: [item: ContextMenuItem];
}>();
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible"
      class="context-menu"
      :style="{ left: `${x}px`, top: `${y}px` }"
      @pointerdown.stop
      @click.stop
      @contextmenu.prevent.stop
    >
      <template v-for="item in items" :key="item.id">
        <div v-if="item.separator" class="context-menu-separator"></div>
        <button
          v-else
          type="button"
          class="context-menu-item"
          :class="{ danger: item.danger }"
          :disabled="item.disabled"
          @click="emit('select', item)"
        >
          {{ item.label }}
        </button>
      </template>
    </div>
  </Teleport>
</template>

<style scoped>
.context-menu {
  position: fixed;
  z-index: 1000;
  width: 180px;
  box-sizing: border-box;
  padding: 5px;
  color: #e5e7eb;
  background: #2b2e33;
  border: 1px solid #515862;
  border-radius: 6px;
  box-shadow: 0 12px 28px rgb(0 0 0 / 32%);
}

.context-menu-item {
  display: block;
  width: 100%;
  height: 30px;
  padding: 0 10px;
  color: inherit;
  background: transparent;
  border: 0;
  border-radius: 4px;
  font: inherit;
  font-size: 12px;
  line-height: 1;
  text-align: left;
  cursor: pointer;
}

.context-menu-item:hover:not(:disabled) {
  background: #424751;
}

.context-menu-item.danger {
  color: #ffb4b4;
}

.context-menu-item:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.context-menu-item:focus,
.context-menu-item:focus-visible {
  outline: none;
  box-shadow: none;
}

.context-menu-separator {
  height: 1px;
  margin: 4px 5px;
  background: #444a53;
}

@media (prefers-color-scheme: light) {
  .context-menu {
    color: #1f2937;
    background: #ffffff;
    border-color: #c8d0da;
    box-shadow: 0 12px 28px rgb(15 23 42 / 16%);
  }

  .context-menu-item:hover:not(:disabled) {
    background: #e9eef6;
  }

  .context-menu-item.danger {
    color: #c24141;
  }

  .context-menu-separator {
    background: #e4e9f1;
  }
}
</style>
