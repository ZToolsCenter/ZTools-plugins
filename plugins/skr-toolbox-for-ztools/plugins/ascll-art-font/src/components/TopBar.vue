<script lang="ts" setup>
defineProps<{
  modelValue: string
  selectedFont: string
  fontList: string[]
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  'update:selectedFont': [value: string]
  openSettings: []
}>()
</script>

<template>
  <div class="top-bar">
    <input
      class="text-input"
      type="text"
      placeholder="输入字符试试吧~仅支持 ASCII 字符, 部分字体仅支持纯英文"
      :value="modelValue"
      @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
    />
    <select
      class="font-select"
      :value="selectedFont"
      @change="emit('update:selectedFont', ($event.target as HTMLSelectElement).value)"
    >
      <option v-for="font in fontList" :key="font" :value="font">{{ font }}</option>
    </select>
    <button class="settings-btn" @click="emit('openSettings')" title="字体设置">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="3"/>
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
      </svg>
    </button>
  </div>
</template>

<style scoped>
.top-bar {
  display: flex;
  gap: 8px;
  padding: 12px 16px;
  align-items: center;
}

.text-input {
  flex: 1;
  height: 40px;
  padding: 0 12px;
  border: 2px solid #d0d5dd;
  border-radius: 8px;
  font-size: 14px;
  outline: none;
  transition: border-color 0.2s;
  background: var(--input-bg, #fff);
  color: var(--input-color, #333);
}

.text-input:focus {
  border-color: #3b82f6;
}

.font-select {
  width: 180px;
  height: 40px;
  padding: 0 12px;
  border: 2px solid #d0d5dd;
  border-radius: 8px;
  font-size: 14px;
  outline: none;
  cursor: pointer;
  background: var(--input-bg, #fff);
  color: var(--input-color, #333);
  appearance: auto;
}

.font-select:focus {
  border-color: #3b82f6;
}

.settings-btn {
  width: 40px;
  height: 40px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #3b5ae0;
  color: #fff;
  cursor: pointer;
  border: none;
  padding: 0;
  flex-shrink: 0;
  transition: opacity 0.2s;
  line-height: 1;
}

.settings-btn:active {
  opacity: 0.7;
}

@media (prefers-color-scheme: dark) {
  .text-input,
  .font-select {
    background: #424242;
    color: #fff;
    border-color: #555;
  }
  .text-input:focus,
  .font-select:focus {
    border-color: #5b8def;
  }
}
</style>
