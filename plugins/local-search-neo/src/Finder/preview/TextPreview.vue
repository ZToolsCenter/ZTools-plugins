<script setup lang="ts">
defineProps<{
  content: string;
  encoding: string;
  status: string;
}>();
</script>

<template>
  <div class="text-preview">
    <header class="text-info-bar">
      <span>{{ encoding }}</span>
      <span>{{ status }}</span>
    </header>
    <pre class="preview-content">{{ content }}</pre>
  </div>
</template>

<style scoped>
.text-preview {
  display: grid;
  grid-template-rows: 30px minmax(0, 1fr);
  min-width: 0;
  min-height: 0;
  background: #121315;
}

.text-info-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-width: 0;
  padding: 0 12px;
  color: #c3c8cf;
  border-bottom: 1px solid #282a2d;
  font-size: 12px;
}

.text-info-bar span:first-child {
  min-width: 72px;
  color: #9ba1a8;
  font-family: Consolas, "Cascadia Mono", monospace;
}

.text-info-bar span:last-child {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preview-content {
  overflow: auto;
  min-width: 0;
  min-height: 0;
  margin: 0;
  padding: 10px 14px;
  color: #ffffff;
  font-family: "Microsoft YaHei", "Segoe UI", sans-serif;
  font-size: 12px;
  line-height: 1.28;
  white-space: pre-wrap;
  word-break: break-word;
}

@media (prefers-color-scheme: light) {
  .text-preview {
    background: #ffffff;
  }

  .text-info-bar {
    color: #667085;
    border-bottom-color: #d9dee7;
  }

  .text-info-bar span:first-child {
    color: #4f5b6a;
  }

  .preview-content {
    color: #111827;
  }
}
</style>
