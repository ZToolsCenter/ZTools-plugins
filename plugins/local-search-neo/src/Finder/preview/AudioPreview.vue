<script setup lang="ts">
defineProps<{
  source: string;
}>();
</script>

<template>
  <div class="preview-audio-shell">
    <audio class="preview-audio" :src="source" controls autoplay preload="metadata"></audio>
  </div>
</template>

<style scoped>
.preview-audio-shell {
  display: grid;
  min-width: 0;
  min-height: 0;
  place-items: center;
  padding: 24px;
  background: #0f1012;
}

.preview-audio {
  width: min(100%, 520px);
}

@media (prefers-color-scheme: light) {
  .preview-audio-shell {
    background: #f8fafc;
  }
}
</style>
