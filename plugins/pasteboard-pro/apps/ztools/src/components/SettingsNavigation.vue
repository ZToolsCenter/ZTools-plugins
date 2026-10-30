<script setup lang="ts">
import { nextTick } from "vue";
import type { SettingsTab, SettingsTabItem } from "./settings-tabs";

const props = defineProps<{
  modelValue: SettingsTab;
  tabs: readonly SettingsTabItem[];
  syncTone: string;
}>();
const emit = defineEmits<{ "update:modelValue": [value: SettingsTab] }>();

async function moveTab(event: KeyboardEvent): Promise<void> {
  const offset = event.key === "ArrowRight" || event.key === "ArrowDown"
    ? 1
    : event.key === "ArrowLeft" || event.key === "ArrowUp"
      ? -1
      : 0;
  const buttons = [...(event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>("[role=tab]")];
  const activeButton = (event.target as HTMLElement).closest<HTMLButtonElement>("[role=tab]");
  if (offset === 0 || activeButton === null || buttons.length === 0) return;
  event.preventDefault();
  const index = buttons.indexOf(activeButton);
  const next = (index + offset + buttons.length) % buttons.length;
  emit("update:modelValue", props.tabs[next]!.id);
  await nextTick();
  buttons[next]?.focus();
}
</script>

<template>
  <nav class="settings-tabs" role="tablist" aria-label="设置分类" @keydown="moveTab">
    <button
      v-for="tab in tabs"
      :id="`${tab.id}-tab`"
      :key="tab.id"
      type="button"
      role="tab"
      :aria-controls="`${tab.id}-panel`"
      :aria-selected="modelValue === tab.id"
      :tabindex="modelValue === tab.id ? 0 : -1"
      :class="{ 'settings-tab--active': modelValue === tab.id }"
      @click="emit('update:modelValue', tab.id)"
    >
      <svg v-if="tab.id === 'general'" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path d="M3.5 5.5h13m-13 4.5h13m-13 4.5h13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
        <circle cx="7" cy="5.5" r="1.5" fill="var(--settings-canvas)" stroke="currentColor" stroke-width="1.5" />
        <circle cx="12" cy="10" r="1.5" fill="var(--settings-canvas)" stroke="currentColor" stroke-width="1.5" />
        <circle cx="8.5" cy="14.5" r="1.5" fill="var(--settings-canvas)" stroke="currentColor" stroke-width="1.5" />
      </svg>
      <svg v-else-if="tab.id === 'appearance'" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path d="M10 2.8a7.2 7.2 0 1 0 0 14.4h1.1a1.8 1.8 0 0 0 1.3-3.1 1.3 1.3 0 0 1 .9-2.2h1.3A3.4 3.4 0 0 0 18 8.5C17.3 5.2 14 2.8 10 2.8Z" stroke="currentColor" stroke-width="1.5" />
        <circle cx="6.3" cy="8" r=".9" fill="currentColor" /><circle cx="9.4" cy="5.6" r=".9" fill="currentColor" /><circle cx="13" cy="6" r=".9" fill="currentColor" />
      </svg>
      <svg v-else-if="tab.id === 'privacy'" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path d="M10 2.7 16 5v4.4c0 3.7-2.5 6.4-6 7.9-3.5-1.5-6-4.2-6-7.9V5l6-2.3Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" />
        <path d="m7.3 9.9 1.8 1.8 3.7-3.8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
      <svg v-else viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path d="M16.3 7.3A6.8 6.8 0 0 0 4.7 5.2L3 7m0 0V3.8M3 7h3.2m-2.5 5.7a6.8 6.8 0 0 0 11.6 2.1L17 13m0 0v3.2M17 13h-3.2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
      <span>{{ tab.label }}</span>
      <span v-if="tab.id === 'sync'" class="settings-tab__status" :class="`settings-tab__status--${syncTone}`" aria-hidden="true"></span>
    </button>
  </nav>
</template>
