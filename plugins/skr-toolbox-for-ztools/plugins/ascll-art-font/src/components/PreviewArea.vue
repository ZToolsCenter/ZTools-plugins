<script lang="ts" setup>
defineProps<{
  content: string
  foreColor: string
  bgColor: string
}>()
</script>

<template>
  <div class="preview-area" :style="{ backgroundColor: bgColor }">
    <pre class="preview-text" :style="{ color: foreColor }">{{ content }}</pre>
  </div>
</template>

<style scoped>
.preview-area {
  flex: 1;
  margin: 12px 16px 16px;
  border-radius: 10px;
  overflow: auto;
  min-height: 200px;
  box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.06);
}

.preview-text {
  margin: 0;
  padding: 24px;
  font-family: 'Courier New', 'Consolas', 'Monaco', 'Menlo', monospace;
  font-size: 14px;
  line-height: 1.2;
  white-space: pre;
  overflow: visible;
}
</style>
