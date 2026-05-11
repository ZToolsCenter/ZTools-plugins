<template>
  <label
    class="switch"
    :class="{ 'switch--disabled': disabled, 'switch--with-text': activeText || inactiveText }"
  >
    <input
      type="checkbox"
      class="switch__input"
      :checked="modelValue"
      :disabled="disabled"
      @change="handleChange"
    />
    <span class="switch__slider">
      <span v-if="inactiveText" class="switch__text switch__text--inactive">{{
        inactiveText
      }}</span>
      <span v-if="activeText" class="switch__text switch__text--active">{{ activeText }}</span>
      <span class="switch__thumb"></span>
    </span>
  </label>
</template>

<script setup lang="ts">
interface Props {
  modelValue: boolean
  disabled?: boolean
  activeText?: string
  inactiveText?: string
}

defineProps<Props>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
}>()

function handleChange(event: Event): void {
  emit('update:modelValue', (event.target as HTMLInputElement).checked)
}
</script>

<style scoped>
.switch {
  position: relative;
  display: inline-flex;
  height: 24px;
  cursor: pointer;
  user-select: none;
}

.switch--disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.switch__input {
  opacity: 0;
  width: 0;
  height: 0;
}

.switch__slider {
  position: relative;
  cursor: pointer;
  display: flex;
  align-items: center;
  height: 24px;
  width: 44px;
  background-color: var(--control-bg);
  border: 2px solid var(--control-border);
  transition: all 0.3s;
  border-radius: 24px;
  box-sizing: border-box;
  padding: 0 2px;
}

.switch--with-text .switch__slider {
  width: 64px;
}

.switch__text {
  position: absolute;
  font-size: 10px;
  font-weight: 600;
  line-height: 1;
  transition: opacity 0.3s;
  white-space: nowrap;
  z-index: 2;
}

.switch__text--inactive {
  left: 50%;
  transform: translateX(calc(-50% + 10px));
  color: var(--text-color);
  opacity: 1;
}

.switch__text--active {
  right: 50%;
  transform: translateX(calc(50% - 10px));
  color: white;
  opacity: 0;
}

.switch__thumb {
  position: absolute;
  height: 16px;
  width: 16px;
  left: 2px;
  top: 50%;
  transform: translateY(-50%);
  background-color: var(--text-color);
  transition: all 0.3s;
  border-radius: 50%;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
  z-index: 1;
}

.switch:not(.switch--disabled):hover .switch__slider {
  background-color: var(--hover-bg);
}

.switch:not(.switch--disabled):hover .switch__thumb {
  transform: translateY(-50%) scale(1.15);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
}

.switch__input:checked + .switch__slider {
  background-color: color-mix(in srgb, var(--primary-color), black 15%);
  border-color: color-mix(in srgb, var(--primary-color), black 15%);
}

.switch__input:checked + .switch__slider .switch__thumb {
  left: calc(100% - 18px);
  transform: translateY(-50%);
  background-color: white;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
}

.switch__input:checked + .switch__slider .switch__text--inactive {
  opacity: 0;
}

.switch__input:checked + .switch__slider .switch__text--active {
  opacity: 1;
}

.switch:not(.switch--disabled):hover .switch__input:checked + .switch__slider {
  background-color: color-mix(in srgb, var(--primary-color), black 25%);
  border-color: color-mix(in srgb, var(--primary-color), black 25%);
}

.switch:not(.switch--disabled):hover .switch__input:checked + .switch__slider .switch__thumb {
  transform: translateY(-50%) scale(1.15);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
}
</style>
