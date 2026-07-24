<script setup lang="ts">
defineEmits<{
  (e: 'click'): void
}>()
</script>
<template>
  <button class="refresh-btn" @click="$emit('click')">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M17.65 6.35A7.958 7.958 0 0012 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0112 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"
        fill="currentColor"
      />
    </svg>
    <span>换一批</span>
  </button>
</template>

<style scoped>
.refresh-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
  transition:
    color 0.15s,
    background-color 0.15s;
}

.refresh-btn:hover {
  color: var(--primary-color);
  background: var(--primary-light-bg);
}

.refresh-btn svg {
  transition: transform 0.3s ease;
}

.refresh-btn:active svg {
  transform: rotate(-180deg);
}
</style>
