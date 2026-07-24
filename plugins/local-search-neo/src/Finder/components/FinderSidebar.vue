<script setup lang="ts">
import { Settings } from "@lucide/vue";
import { computed } from "vue";
import type { FinderCategory } from "../core/finderLogic";

const props = defineProps<{
  categories: FinderCategory[];
  activeCategoryId: string;
}>();

const emit = defineEmits<{
  select: [category: FinderCategory];
  openSettings: [];
}>();

const builtInCategories = computed(() =>
  props.categories.filter((category) => category.kind !== "custom"),
);
const customCategories = computed(() =>
  props.categories.filter((category) => category.kind === "custom"),
);
</script>

<template>
  <aside class="finder-sidebar">
    <button
      v-for="category in builtInCategories"
      :key="category.id"
      class="category-button"
      :class="{ active: category.id === activeCategoryId }"
      tabindex="-1"
      @mousedown.left.prevent
      @click="emit('select', category)"
    >
      <span>{{ category.label }}</span>
    </button>

    <div v-if="customCategories.length > 0" class="category-separator"></div>

    <button
      v-for="category in customCategories"
      :key="category.id"
      class="category-button custom-category-button"
      :class="{ active: category.id === activeCategoryId }"
      tabindex="-1"
      @mousedown.left.prevent
      @click="emit('select', category)"
    >
      <span>{{ category.label }}</span>
    </button>

    <button
      class="sidebar-settings"
      title="设置"
      tabindex="-1"
      @mousedown.left.prevent
      @click="emit('openSettings')"
    >
      <Settings class="sidebar-settings-icon" :size="18" :stroke-width="2" aria-hidden="true" />
    </button>
  </aside>
</template>

<style scoped>
.finder-sidebar {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-height: 0;
  max-height: 100%;
  overflow: hidden auto;
  padding: 10px 5px 8px;
  border-right: 1px solid #47494c;
  background: #2b2d2f;
}

.category-button,
.sidebar-settings {
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
}

.category-button:focus,
.category-button:focus-visible,
.sidebar-settings:focus,
.sidebar-settings:focus-visible {
  outline: none;
}

.category-button {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 38px;
  padding: 0 2px;
  color: #c8d0db;
  cursor: pointer;
  font-size: 12px;
  white-space: nowrap;
}

.category-button.active {
  color: #3b82f6;
}

.category-button:not(:disabled):active {
  opacity: 1;
}

.custom-category-button {
  color: #d4d8df;
}

.category-separator {
  height: 1px;
  margin: 6px 6px;
  background: #444a53;
}

.sidebar-settings {
  display: grid;
  place-items: center;
  width: 100%;
  height: 34px;
  margin-top: auto;
  color: #d5d9df;
  cursor: pointer;
  border-radius: 4px;
}

.sidebar-settings:hover {
  background: #3a3d42;
}

.sidebar-settings-icon {
  display: block;
  width: 18px;
  height: 18px;
}

@media (prefers-color-scheme: light) {
  .finder-sidebar {
    background: #eef1f5;
    border-right-color: #d5dbe3;
  }

  .category-button {
    color: #4f5b6a;
  }

  .category-button.active {
    color: #2563eb;
  }

  .custom-category-button {
    color: #374151;
  }

  .category-separator {
    background: #d7dee8;
  }

  .sidebar-settings {
    color: #4f5b6a;
  }

  .sidebar-settings:hover {
    background: #dce3ec;
  }
}
</style>
