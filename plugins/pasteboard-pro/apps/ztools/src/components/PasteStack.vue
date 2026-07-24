<script setup lang="ts">
import type { PasteStackDirection } from "@pasteboard-pro/core";

defineProps<{
  count: number;
  direction: PasteStackDirection;
}>();

const emit = defineEmits<{
  toggleDirection: [];
  clear: [];
}>();
</script>

<template>
  <div v-if="count > 0" class="paste-stack" role="status">
    <span class="paste-stack__layers" aria-hidden="true"></span>
    <strong>粘贴队列</strong>
    <span>{{ count }} 项 · {{ direction === 'forward' ? '正序' : '倒序' }}</span>
    <button type="button" @click="emit('toggleDirection')">切换方向</button>
    <button type="button" @click="emit('clear')">清空</button>
  </div>
</template>

<style scoped>
.paste-stack {
  position: absolute;
  z-index: 4;
  right: 18px;
  bottom: 17px;
  display: flex;
  gap: 8px;
  align-items: center;
  min-height: 36px;
  padding: 0 10px;
  border: 1px solid var(--pb-line);
  border-radius: 13px;
  background: color-mix(in srgb, var(--pb-glass-strong) 92%, transparent);
  box-shadow: 0 10px 28px var(--pb-shadow);
  color: var(--pb-muted);
  font-size: 10px;
}

.paste-stack strong {
  color: var(--pb-ink);
}

.paste-stack__layers {
  width: 14px;
  height: 12px;
  border: 1px solid var(--pb-violet);
  border-radius: 4px;
  box-shadow: 3px -3px 0 color-mix(in srgb, var(--pb-violet) 20%, transparent);
}

button {
  border: 0;
  background: transparent;
  color: var(--pb-violet);
  cursor: pointer;
  font-size: 10px;
}
</style>
