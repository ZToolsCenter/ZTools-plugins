<script setup lang="ts">
defineProps<{
  status: string;
}>();
</script>

<template>
  <div class="preview-empty">{{ status }}</div>
</template>

<style scoped>
.preview-empty {
  display: grid;
  min-height: 180px;
  place-items: center;
  color: #a6abb2;
}

@media (prefers-color-scheme: light) {
  .preview-empty {
    color: #697386;
  }
}
</style>
