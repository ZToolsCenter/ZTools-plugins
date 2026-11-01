<script setup lang="ts">
import type { ShelfUiVersion } from "../../preload/window-preferences";

const emit = defineEmits<{ "update:modelValue": [value: ShelfUiVersion] }>();
defineProps<{ modelValue: ShelfUiVersion }>();

const options: readonly Readonly<{ value: ShelfUiVersion; label: string }>[] = [
  { value: "modern", label: "新版" },
  { value: "classic", label: "经典版" },
];
</script>

<template>
  <fieldset class="ui-version-field">
    <legend>界面版本</legend>
    <div class="ui-version-field__options" role="radiogroup" aria-label="界面版本">
      <label v-for="option in options" :key="option.value">
        <input
          type="radio"
          name="shelf-ui-version"
          :value="option.value"
          :checked="modelValue === option.value"
          @change="emit('update:modelValue', option.value)"
        />
        <span>{{ option.label }}</span>
      </label>
    </div>
    <small>统一切换列表、分组、设置和弹窗界面，保存后生效，可随时切换回来。</small>
  </fieldset>
</template>

<style scoped>
.ui-version-field { display: grid; gap: 9px; margin: 0; padding: 0 0 15px; border: 0; border-bottom: 1px solid var(--settings-line); }
.ui-version-field legend { padding: 0; color: var(--settings-ink); font-size: 12px; font-weight: 650; }
.ui-version-field__options { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px; }
.ui-version-field__options label { position: relative; cursor: pointer; }
.ui-version-field__options input { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; }
.ui-version-field__options span { display: grid; min-height: 36px; border: 1px solid var(--settings-line); border-radius: 8px; background: var(--settings-surface); color: var(--settings-muted); cursor: pointer; font-size: 11px; font-weight: 590; place-items: center; }
.ui-version-field__options input:checked + span { border-color: color-mix(in srgb, var(--settings-accent) 58%, var(--settings-line)); background: color-mix(in srgb, var(--settings-accent) 10%, var(--settings-surface)); color: var(--settings-accent); }
.ui-version-field__options input:focus-visible + span { outline: 2px solid var(--settings-accent); outline-offset: 2px; }
.ui-version-field small { color: var(--settings-muted); font-size: 11px; line-height: 1.5; }
</style>
