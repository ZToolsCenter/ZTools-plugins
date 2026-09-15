<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  formatShortcut,
  isModifierKey,
  shortcutFromKeyboardEvent,
} from '../utils/shortcut';

const props = defineProps<{
  modelValue?: string;
  placeholder?: string;
  ariaLabel?: string;
}>();

const emit = defineEmits<{
  (event: 'update:modelValue', value: string): void;
  (event: 'recordingChange', value: boolean): void;
}>();

const { t } = useI18n();
const recording = ref(false);
const modifierPreview = ref('');
const invalid = ref(false);

const displayValue = computed(() => {
  if (recording.value) {
    return modifierPreview.value || t('settings.shortcutRecording');
  }
  return formatShortcut(props.modelValue || '') || props.placeholder || '';
});

function startRecording() {
  if (recording.value) return;
  recording.value = true;
  modifierPreview.value = '';
  invalid.value = false;
  emit('recordingChange', true);
}

function stopRecording() {
  if (!recording.value) return;
  recording.value = false;
  modifierPreview.value = '';
  invalid.value = false;
  emit('recordingChange', false);
}

function updateModifierPreview(event: KeyboardEvent) {
  const modifiers: string[] = [];
  if (event.ctrlKey) modifiers.push('Ctrl');
  if (event.metaKey) modifiers.push('Cmd');
  if (event.altKey) modifiers.push('Alt');
  if (event.shiftKey) modifiers.push('Shift');
  modifierPreview.value = modifiers.join('+');
}

function handleKeydown(event: KeyboardEvent) {
  if (!recording.value) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      startRecording();
    }
    return;
  }

  if (event.key === 'Tab' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
    stopRecording();
    return;
  }

  event.preventDefault();
  event.stopPropagation();

  if (event.key === 'Escape') {
    stopRecording();
    return;
  }

  if (isModifierKey(event.key)) {
    invalid.value = false;
    updateModifierPreview(event);
    return;
  }

  const shortcut = shortcutFromKeyboardEvent(event);
  if (!shortcut) {
    invalid.value = true;
    updateModifierPreview(event);
    return;
  }

  emit('update:modelValue', shortcut);
  stopRecording();
}
</script>

<template>
  <div class="shortcut-recorder-wrap">
    <button
      type="button"
      class="shortcut-recorder"
      :class="{ 'is-recording': recording, 'is-invalid': invalid }"
      :aria-label="ariaLabel"
      :aria-pressed="recording"
      @click="startRecording"
      @keydown="handleKeydown"
      @blur="stopRecording"
    >
      <span class="i-mdi-keyboard-outline shortcut-recorder-icon" aria-hidden="true" />
      <kbd>{{ displayValue }}</kbd>
      <span class="shortcut-recorder-action">
        {{ recording ? t('settings.shortcutCancelHint') : t('settings.shortcutRecord') }}
      </span>
    </button>
    <div v-if="invalid" class="shortcut-recorder-error" role="alert">
      {{ t('settings.shortcutRequiresModifierOrFunctionKey') }}
    </div>
  </div>
</template>

<style scoped>
.shortcut-recorder-wrap {
  width: 280px;
}

.shortcut-recorder {
  width: 100%;
  min-height: 42px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border: 1px solid var(--app-border);
  border-radius: var(--app-radius-sm);
  background: var(--app-surface-soft);
  color: var(--app-text-secondary);
  cursor: pointer;
  transition:
    border-color var(--app-duration-fast) var(--app-ease),
    background-color var(--app-duration-fast) var(--app-ease),
    box-shadow var(--app-duration-fast) var(--app-ease);
}

.shortcut-recorder:hover {
  border-color: color-mix(in srgb, var(--app-primary) 45%, var(--app-border));
  background: var(--app-surface-raised);
}

.shortcut-recorder:focus-visible,
.shortcut-recorder.is-recording {
  outline: none;
  border-color: var(--app-primary);
  box-shadow: 0 0 0 3px var(--app-primary-soft);
}

.shortcut-recorder.is-invalid {
  border-color: var(--app-danger);
}

.shortcut-recorder-icon {
  flex: 0 0 auto;
  font-size: 18px;
}

.shortcut-recorder kbd {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--app-text);
  font-family: var(--font-mono);
  font-size: 13px;
  font-weight: 600;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.shortcut-recorder-action {
  flex: 0 0 auto;
  font-size: var(--app-font-meta);
  color: var(--app-text-muted);
}

.shortcut-recorder-error {
  margin-top: 5px;
  color: var(--app-danger);
  font-size: var(--app-font-meta);
  line-height: 1.4;
}
</style>
