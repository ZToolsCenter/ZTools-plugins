<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { usePersistStorage } from "../composables/usePersistStorage";
import type { FinderSortMode } from "../core/finderLogic";

const SORT_OPTIONS: Array<{ value: FinderSortMode; label: string }> = [
  { value: "modified-desc", label: "按修改时间降序" },
  { value: "modified-asc", label: "按修改时间升序" },
  { value: "name-asc", label: "按名称升序" },
  { value: "name-desc", label: "按名称降序" },
  { value: "path-asc", label: "按路径升序" },
  { value: "path-desc", label: "按路径降序" },
  { value: "size-asc", label: "按大小升序" },
  { value: "size-desc", label: "按大小降序" },
];

const { previewEnabled, sortMode } = usePersistStorage();

defineProps<{
  everythingTotal: number;
}>();

const emit = defineEmits<{
  requestInputFocus: [];
  sortMenuOpenChange: [open: boolean];
}>();

const showSortMenu = ref(false);
const activeSortLabel = computed(
  () => SORT_OPTIONS.find((option) => option.value === sortMode.value)?.label ?? "排序",
);
const previewLabel = computed(() => (previewEnabled.value ? "关闭文件预览" : "开启文件预览"));

function setSortMenuOpen(open: boolean) {
  showSortMenu.value = open;
  emit("sortMenuOpenChange", open);
}

function toggleSortMenu() {
  setSortMenuOpen(!showSortMenu.value);
}

function selectSortMode(mode: FinderSortMode) {
  sortMode.value = mode;
  setSortMenuOpen(false);
  emit("requestInputFocus");
}

function handleGlobalPointerdown(event: PointerEvent) {
  if (!showSortMenu.value) return;
  if (event.target instanceof HTMLElement && event.target.closest(".sort-select")) return;
  setSortMenuOpen(false);
}

onMounted(() => {
  window.addEventListener("pointerdown", handleGlobalPointerdown);
});

onUnmounted(() => {
  window.removeEventListener("pointerdown", handleGlobalPointerdown);
});
</script>

<template>
  <footer class="finder-footer">
    <div class="sort-select">
      <button
        class="sort-trigger"
        type="button"
        tabindex="-1"
        aria-label="排序方式"
        :aria-expanded="showSortMenu"
        @mousedown.left.prevent
        @click="toggleSortMenu"
      >
        <span>{{ activeSortLabel }}</span>
        <span class="sort-trigger-arrow" aria-hidden="true"></span>
      </button>
      <div v-if="showSortMenu" class="sort-menu">
        <button
          v-for="option in SORT_OPTIONS"
          :key="option.value"
          type="button"
          class="sort-option"
          :class="{ active: option.value === sortMode }"
          tabindex="-1"
          @mousedown.left.prevent
          @click="selectSortMode(option.value)"
        >
          {{ option.label }}
        </button>
      </div>
    </div>
    <label class="preview-toggle">
      <span>{{ previewLabel }}</span>
      <input v-model="previewEnabled" type="checkbox" />
      <span class="toggle-track"></span>
    </label>
    <span class="result-count">共 {{ everythingTotal }} 条结果</span>
  </footer>
</template>

<style scoped>
.finder-footer {
  position: relative;
  z-index: 5;
  display: grid;
  grid-template-columns: minmax(120px, 1fr) auto max-content;
  align-items: center;
  gap: 14px;
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  overflow: visible;
  padding: 0 14px;
  background: #3a3a39;
  color: #c6ccd3;
  font-size: 12px;
}

.sort-trigger,
.sort-option {
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
}

.sort-trigger:focus,
.sort-trigger:focus-visible,
.sort-option:focus,
.sort-option:focus-visible {
  outline: none;
  box-shadow: none;
}

.sort-select {
  --sort-select-width: 158px;
  position: relative;
  display: flex;
  align-items: center;
  min-width: 0;
}

.sort-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  width: var(--sort-select-width);
  height: 30px;
  box-sizing: border-box;
  padding: 0 11px 0 12px;
  color: #e7ebf0;
  background: #34373b;
  border: 1px solid #555b63;
  border-radius: 5px;
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
  transition:
    background-color 0.16s ease,
    border-color 0.16s ease,
    color 0.16s ease;
}

.sort-trigger:hover,
.sort-trigger[aria-expanded="true"] {
  background: #3d4147;
  border-color: #68707a;
}

.sort-trigger-arrow {
  width: 6px;
  height: 6px;
  margin-top: -3px;
  border-right: 1.5px solid currentColor;
  border-bottom: 1.5px solid currentColor;
  color: #aeb4bb;
  transform: rotate(45deg);
}

.sort-menu {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 0;
  z-index: 30;
  display: grid;
  width: var(--sort-select-width);
  box-sizing: border-box;
  padding: 6px;
  background: #2b2e33;
  border: 1px solid #515862;
  border-radius: 6px;
  box-shadow: 0 12px 28px rgb(0 0 0 / 30%);
}

.sort-option {
  height: 30px;
  padding: 0 10px;
  color: #dfe4ea;
  background: transparent;
  border-radius: 4px;
  font-size: 12px;
  line-height: 1;
  text-align: left;
  cursor: pointer;
}

.sort-option:hover,
.sort-option.active {
  color: #ffffff;
  background: #424751;
}

.preview-toggle {
  grid-column: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-width: 150px;
}

.preview-toggle input {
  position: absolute;
  opacity: 0;
}

.toggle-track {
  width: 36px;
  height: 18px;
  border-radius: 999px;
  background: #80848a;
  position: relative;
}

.toggle-track::after {
  content: "";
  position: absolute;
  top: 2px;
  left: 2px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #e8eaed;
  transition: transform 0.15s ease;
}

.preview-toggle input:checked + .toggle-track {
  background: #3b82f6;
}

.preview-toggle input:checked + .toggle-track::after {
  transform: translateX(18px);
}

.result-count {
  grid-column: 3;
  justify-self: end;
  color: #aeb4bb;
}

@media (prefers-color-scheme: light) {
  .finder-footer {
    background: #e9edf3;
    color: #4f5b6a;
  }

  .sort-trigger {
    color: #1f2937;
    background: #ffffff;
    border-color: #c8d0da;
  }

  .sort-trigger:hover,
  .sort-trigger[aria-expanded="true"] {
    background: #f4f7fb;
    border-color: #aab4c2;
  }

  .sort-trigger-arrow {
    color: #667085;
  }

  .sort-menu {
    background: #ffffff;
    border-color: #c8d0da;
    box-shadow: 0 12px 28px rgb(15 23 42 / 16%);
  }

  .sort-option {
    color: #1f2937;
  }

  .sort-option:hover,
  .sort-option.active {
    color: #111827;
    background: #e9eef6;
  }

  .toggle-track {
    background: #b9c2ce;
  }

  .toggle-track::after {
    background: #ffffff;
  }

  .preview-toggle input:checked + .toggle-track {
    background: #2563eb;
  }

  .result-count {
    color: #667085;
  }
}

@media (max-width: 760px) {
  .finder-footer {
    grid-template-columns: max-content minmax(12px, 1fr) max-content;
  }

  .preview-toggle {
    min-width: 126px;
    justify-content: flex-end;
  }

  .result-count {
    display: none;
  }
}
</style>
