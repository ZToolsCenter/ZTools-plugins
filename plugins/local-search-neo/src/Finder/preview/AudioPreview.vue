<script setup lang="ts">
const { source, autoplay = true } = defineProps<{
  source: string;
  autoplay?: boolean;
}>();
</script>

<template>
  <div class="preview-audio-shell">
    <audio
      :key="source"
      class="preview-audio"
      :src="source"
      controls
      :autoplay="autoplay"
      preload="metadata"
    ></audio>
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
