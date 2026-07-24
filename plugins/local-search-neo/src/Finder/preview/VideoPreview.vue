<script setup lang="ts">
defineProps<{
  source: string;
}>();
</script>

<template>
  <div class="preview-media-shell">
    <video class="preview-video" :src="source" controls preload="metadata"></video>
  </div>
</template>

<style scoped>
.preview-media-shell {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  box-sizing: border-box;
  padding: 12px;
  overflow: hidden;
  background: #0f1012;
}

.preview-video {
  display: block;
  width: auto;
  height: auto;
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  background: #000000;
}

@media (prefers-color-scheme: light) {
  .preview-media-shell {
    background: #f8fafc;
  }
}
</style>
