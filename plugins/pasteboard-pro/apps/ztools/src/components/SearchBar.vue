<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";

import { primaryModifierLabel, resolveShortcutPlatform } from "../platform-shortcuts";

const props = withDefaults(
  defineProps<{ modelValue: string; collapsible?: boolean }>(),
  { collapsible: false },
);
const emit = defineEmits<{ "update:modelValue": [value: string] }>();

const expanded = ref(!props.collapsible || props.modelValue.length > 0);
const draft = ref(props.modelValue);
const input = ref<HTMLInputElement>();
const root = ref<HTMLElement>();
let outsidePointer = false;
let composing = false;
let lastEmittedValue = props.modelValue;

const searchShortcutLabel = computed(() => {
  const platform = resolveShortcutPlatform(
    window.pasteboardPro?.getPlatformCapabilities().platform,
  );
  return primaryModifierLabel(platform) + " F";
});

watch(
  () => props.modelValue,
  (value) => {
    lastEmittedValue = value;
    if (composing) return;
    draft.value = value;
    if (value.length > 0) expanded.value = true;
  },
);

function activateSearch(): void {
  if (props.collapsible) expanded.value = true;
  void nextTick(() => input.value?.focus());
}

function collapseEmptySearch(): void {
  if (props.collapsible && props.modelValue.length === 0 && document.activeElement !== input.value) {
    expanded.value = false;
  }
}

function handleBlur(): void {
  // An empty search must not move a collection between pointerdown and click.
  if (!outsidePointer) collapseEmptySearch();
}

function handleDocumentPointerDown(event: PointerEvent): void {
  outsidePointer = document.activeElement === input.value && event.target instanceof Node && !root.value?.contains(event.target);
}

function handleDocumentClick(): void {
  queueMicrotask(() => {
    outsidePointer = false;
    collapseEmptySearch();
  });
}

function emitInputValue(value: string): void {
  if (value === lastEmittedValue) return;
  lastEmittedValue = value;
  emit("update:modelValue", value);
}

function handleInput(event: Event): void {
  const target = event.currentTarget;
  if (!(target instanceof HTMLInputElement)) return;
  draft.value = target.value;
  const inputEvent = event as InputEvent;
  if (composing || inputEvent.isComposing) return;
  emitInputValue(target.value);
}

function handleCompositionStart(): void {
  composing = true;
  draft.value = input.value?.value ?? draft.value;
}

function handleCompositionEnd(event: CompositionEvent): void {
  const target = event.currentTarget;
  if (!(target instanceof HTMLInputElement)) return;
  draft.value = target.value;
  composing = false;
  emitInputValue(target.value);
}

onMounted(() => {
  document.addEventListener("pointerdown", handleDocumentPointerDown, true);
  document.addEventListener("click", handleDocumentClick, true);
  document.addEventListener("pointercancel", handleDocumentClick, true);
});

onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", handleDocumentPointerDown, true);
  document.removeEventListener("click", handleDocumentClick, true);
  document.removeEventListener("pointercancel", handleDocumentClick, true);
});

function handleKeydown(event: KeyboardEvent): void {
  if (event.isComposing || event.key !== "Escape" || !props.collapsible) return;
  event.preventDefault();
  event.stopPropagation();
  if (props.modelValue.length > 0) {
    emit("update:modelValue", "");
    return;
  }
  expanded.value = false;
  input.value?.blur();
}
</script>

<template>
  <div
    ref="root"
    class="search-bar"
    :class="{ 'search-bar--collapsible': collapsible, 'search-bar--expanded': expanded }"
    role="search"
    @click="activateSearch"
  >
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <circle cx="11" cy="11" r="7"></circle>
      <path d="m16.2 16.2 4 4"></path>
    </svg>
    <span class="visually-hidden">搜索剪贴板历史</span>
    <input
      ref="input"
      data-pb-search
      :value="draft"
      type="search"
      placeholder="搜索内容、来源 App、日期或分组"
      autocomplete="off"
      aria-label="搜索剪贴板历史"
      @input="handleInput"
      @compositionstart="handleCompositionStart"
      @compositionend="handleCompositionEnd"
      @focus="expanded = true"
      @blur="handleBlur"
      @keydown="handleKeydown"
    />
    <kbd>{{ searchShortcutLabel }}</kbd>
  </div>
</template>

<style scoped>
.search-bar {
  position: relative;
  display: grid;
  flex: 0 1 420px;
  grid-template-columns: 17px minmax(0, 1fr) auto;
  gap: 9px;
  align-items: center;
  min-width: 150px;
  min-height: 38px;
  padding: 0 11px;
  border: 1px solid var(--pb-line);
  border-radius: 13px;
  background: color-mix(in srgb, var(--pb-glass-strong) 72%, transparent);

}

.search-bar svg {
  width: 17px;
  fill: none;
  stroke: var(--pb-muted);
  stroke-linecap: round;
  stroke-width: 1.8;
}

.search-bar input {
  width: 100%;
  min-width: 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--pb-ink);
}

.search-bar input::placeholder {
  color: var(--pb-muted);
}

.search-bar kbd {
  padding: 2px 6px;
  border: 1px solid var(--pb-line);
  border-radius: 6px;
  color: var(--pb-muted);
  font-size: 10px;
  white-space: nowrap;
}

.search-bar:focus-within {
  outline: 2px solid color-mix(in srgb, var(--pb-violet) 58%, transparent);
  outline-offset: 2px;
}

.search-bar--collapsible {
  min-height: 36px;
  border-radius: 11px;
  transition:
    width 300ms cubic-bezier(0.22, 1, 0.36, 1),
    min-width 300ms cubic-bezier(0.22, 1, 0.36, 1),
    flex-basis 300ms cubic-bezier(0.22, 1, 0.36, 1),
    grid-template-columns 300ms cubic-bezier(0.22, 1, 0.36, 1),
    gap 300ms cubic-bezier(0.22, 1, 0.36, 1),
    background 160ms ease,
    border-color 160ms ease;
  flex: 0 1 80px;
  width: 80px;
  min-width: 80px;
  grid-template-columns: 17px minmax(0, 0fr) auto;
  gap: 7px;
  padding: 0 9px;
  cursor: text;
}

.search-bar--collapsible input {
  width: 0;
  padding: 0;
  opacity: 0;
  pointer-events: none;
  transition: width 300ms cubic-bezier(0.22, 1, 0.36, 1), opacity 180ms ease;
}

.search-bar--collapsible kbd {
  padding: 1px 4px;
  border: 0;
  font-size: 10px;
}

.search-bar--collapsible.search-bar--expanded {
  flex: 0 1 340px;
  width: min(340px, 40vw);
  min-width: min(210px, 44vw);
  grid-template-columns: 17px minmax(0, 1fr) auto;
  cursor: text;
}

.search-bar--collapsible.search-bar--expanded input {
  width: 100%;
  opacity: 1;
  pointer-events: auto;
}

.search-bar--collapsible.search-bar--expanded kbd {
  padding: 2px 6px;
  border: 1px solid var(--pb-line);
}

@media (max-width: 760px) {
  .search-bar--collapsible.search-bar--expanded {
    flex-basis: 250px;
    width: min(250px, 56vw);
    min-width: min(180px, 56vw);
  }
}

@media (max-width: 440px) {
  .search-bar--collapsible.search-bar--expanded {
    flex-basis: 160px;
    width: min(160px, 44vw);
    min-width: 120px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .search-bar--collapsible {
    transition: none;
  }

  .search-bar--collapsible input {
    transition: none;
  }
}
</style>
