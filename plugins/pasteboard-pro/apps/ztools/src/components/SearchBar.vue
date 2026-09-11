<script setup lang="ts">
defineProps<{ modelValue: string }>();
const emit = defineEmits<{ "update:modelValue": [value: string] }>();
</script>

<template>
  <label class="search-bar">
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <circle cx="11" cy="11" r="7"></circle>
      <path d="m16.2 16.2 4 4"></path>
    </svg>
    <span class="visually-hidden">搜索剪贴板历史</span>
    <input
      data-pb-search
      :value="modelValue"
      type="search"
      placeholder="搜索内容、来源 App、日期或分组"
      autocomplete="off"
      @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
    />
    <kbd>⌘ F</kbd>
  </label>
</template>

<style scoped>
.search-bar {
  display: grid;
  grid-template-columns: 17px minmax(0, 1fr) auto;
  gap: 9px;
  align-items: center;
  min-height: 38px;
  padding: 0 11px;
  border: 1px solid var(--pb-line);
  border-radius: 13px;
  background: color-mix(in srgb, var(--pb-glass-strong) 72%, transparent);
}

svg {
  width: 17px;
  fill: none;
  stroke: var(--pb-muted);
  stroke-linecap: round;
  stroke-width: 1.8;
}

input {
  min-width: 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--pb-ink);
}

input::placeholder {
  color: var(--pb-muted);
}

kbd {
  padding: 2px 6px;
  border: 1px solid var(--pb-line);
  border-radius: 6px;
  color: var(--pb-muted);
  font-size: 10px;
}

.search-bar:focus-within {
  outline: 2px solid color-mix(in srgb, var(--pb-violet) 70%, transparent);
  outline-offset: 2px;
}
</style>
