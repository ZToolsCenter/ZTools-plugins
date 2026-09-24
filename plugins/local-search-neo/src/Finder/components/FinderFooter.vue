<script setup lang="ts">
import { ArrowUpDown, Check, ChevronDown } from "@lucide/vue";
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
  const target = event.target;
  if (target instanceof Element) {
    if (target.closest(".sort-trigger") || target.closest(".sort-menu")) {
      return;
    }
  }
  setSortMenuOpen(false);
}

onMounted(() => {
  window.addEventListener("pointerdown", handleGlobalPointerdown, true);
});

onUnmounted(() => {
  window.removeEventListener("pointerdown", handleGlobalPointerdown, true);
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
        <ArrowUpDown class="sort-trigger-icon" :size="13" :stroke-width="1.8" aria-hidden="true" />
        <span class="sort-trigger-text">{{ activeSortLabel }}</span>
        <ChevronDown
          class="sort-trigger-chevron"
          :size="13"
          :stroke-width="1.8"
          aria-hidden="true"
        />
      </button>
      <Transition name="sort-menu-pop">
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
            <span>{{ option.label }}</span>
            <Check
              v-if="option.value === sortMode"
              class="sort-option-check"
              :size="13"
              :stroke-width="2"
              aria-hidden="true"
            />
          </button>
        </div>
      </Transition>
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
  z-index: 25;
  display: grid;
  grid-template-columns: minmax(120px, 1fr) auto max-content;
  align-items: center;
  gap: 12px;
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  overflow: visible;
  padding: 0 12px;
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
  position: relative;
  display: flex;
  align-items: center;
  width: fit-content;
  min-width: 0;
}

.sort-trigger {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 24px;
  box-sizing: border-box;
  padding: 0 6px;
  color: #b8bec7;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 4px;
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
  transition:
    background-color 0.16s ease,
    color 0.16s ease;
}

.sort-trigger:hover,
.sort-trigger[aria-expanded="true"] {
  color: #ffffff;
  background: rgb(255 255 255 / 8%);
}

.sort-trigger-icon {
  flex-shrink: 0;
  color: #9aa1ab;
  pointer-events: none;
  transition: color 0.16s ease;
}

.sort-trigger:hover .sort-trigger-icon,
.sort-trigger[aria-expanded="true"] .sort-trigger-icon {
  color: #ffffff;
}

.sort-trigger-text {
  white-space: nowrap;
}

.sort-trigger-chevron {
  flex-shrink: 0;
  color: #8b929c;
  pointer-events: none;
  transition:
    transform 0.16s ease,
    color 0.16s ease;
}

.sort-trigger:hover .sort-trigger-chevron,
.sort-trigger[aria-expanded="true"] .sort-trigger-chevron {
  color: #ffffff;
}

.sort-trigger[aria-expanded="true"] .sort-trigger-chevron {
  transform: rotate(180deg);
}

.sort-menu {
  position: absolute;
  bottom: calc(100% + 6px);
  left: 0;
  z-index: 30;
  display: grid;
  width: 100%;
  box-sizing: border-box;
  padding: 4px;
  background: #25272a;
  border: 1px solid rgb(255 255 255 / 10%);
  border-radius: 6px;
  box-shadow:
    0 12px 28px rgb(0 0 0 / 40%),
    0 2px 6px rgb(0 0 0 / 20%);
  transform-origin: bottom left;
}

.sort-menu-pop-enter-active {
  transition:
    opacity 0.16s ease,
    transform 0.16s cubic-bezier(0.16, 1, 0.3, 1);
}

.sort-menu-pop-leave-active {
  transition:
    opacity 0.12s ease,
    transform 0.12s ease;
}

.sort-menu-pop-enter-from {
  opacity: 0;
  transform: translateY(4px) scale(0.96);
}

.sort-menu-pop-leave-to {
  opacity: 0;
  transform: translateY(3px) scale(0.97);
}

.sort-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 26px;
  padding: 0 6px;
  color: #cfd4dc;
  background: transparent;
  border-radius: 4px;
  font-size: 12px;
  line-height: 1;
  text-align: left;
  cursor: pointer;
  transition:
    background-color 0.12s ease,
    color 0.12s ease;
}

.sort-option:hover {
  color: #ffffff;
  background: rgb(255 255 255 / 8%);
}

.sort-option.active {
  color: #ffffff;
  background: var(--primary-color-dark-subtle-hover, rgb(255 255 255 / 12%));
  font-weight: 500;
}

.sort-option-check {
  flex-shrink: 0;
  color: var(--primary-color, #60a5fa);
}

.preview-toggle {
  grid-column: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  min-width: 140px;
}

.preview-toggle input {
  position: absolute;
  opacity: 0;
}

.toggle-track {
  width: 30px;
  height: 16px;
  border-radius: 999px;
  background: #80848a;
  position: relative;
}

.toggle-track::after {
  content: "";
  position: absolute;
  top: 2px;
  left: 2px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #e8eaed;
  transition: transform 0.15s ease;
}

.preview-toggle input:checked + .toggle-track {
  background: var(--primary-color);
}

.preview-toggle input:checked + .toggle-track::after {
  transform: translateX(14px);
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
    color: #4f5b6a;
    background: transparent;
    border-color: transparent;
  }

  .sort-trigger:hover,
  .sort-trigger[aria-expanded="true"] {
    color: #111827;
    background: rgb(0 0 0 / 6%);
  }

  .sort-trigger-icon {
    color: #667085;
  }

  .sort-trigger:hover .sort-trigger-icon,
  .sort-trigger[aria-expanded="true"] .sort-trigger-icon {
    color: #111827;
  }

  .sort-trigger-chevron {
    color: #7d8896;
  }

  .sort-trigger:hover .sort-trigger-chevron,
  .sort-trigger[aria-expanded="true"] .sort-trigger-chevron {
    color: #111827;
  }

  .sort-menu {
    background: #ffffff;
    border-color: rgb(15 23 42 / 12%);
    box-shadow:
      0 12px 28px rgb(15 23 42 / 14%),
      0 2px 6px rgb(15 23 42 / 6%);
  }

  .sort-option {
    color: #374151;
  }

  .sort-option:hover {
    color: #111827;
    background: rgb(0 0 0 / 5%);
  }

  .sort-option.active {
    color: var(--primary-color, #2563eb);
    background: var(--primary-color-subtle-hover, #eef2f8);
    font-weight: 500;
  }

  .sort-option-check {
    color: var(--primary-color, #2563eb);
  }

  .toggle-track {
    background: #b9c2ce;
  }

  .toggle-track::after {
    background: #ffffff;
  }

  .preview-toggle input:checked + .toggle-track {
    background: var(--primary-color);
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
