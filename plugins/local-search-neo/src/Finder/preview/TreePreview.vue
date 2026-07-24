<script setup lang="ts">
defineProps<{
  content: string;
  label: string;
  status: string;
}>();
</script>

<template>
  <div class="tree-preview">
    <header class="tree-info-bar">
      <span>{{ label }}</span>
      <span>{{ status }}</span>
    </header>
    <pre class="tree-content">{{ content }}</pre>
  </div>
</template>

<style scoped>
.tree-preview {
  display: grid;
  grid-template-rows: 30px minmax(0, 1fr);
  min-width: 0;
  min-height: 0;
  background: #121315;
}

.tree-info-bar {
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

.tree-info-bar span:first-child {
  min-width: 72px;
  color: #9ba1a8;
  font-family: Consolas, "Cascadia Mono", monospace;
}

.tree-info-bar span:last-child {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tree-content {
  overflow: auto;
  min-width: 0;
  min-height: 0;
  margin: 0;
  padding: 10px 14px;
  color: #ffffff;
  font-family: Consolas, "Cascadia Mono", monospace;
  font-size: 12px;
  line-height: 1.35;
  white-space: pre;
}

@media (prefers-color-scheme: light) {
  .tree-preview {
    background: #ffffff;
  }

  .tree-info-bar {
    color: #667085;
    border-bottom-color: #d9dee7;
  }

  .tree-info-bar span:first-child {
    color: #4f5b6a;
  }

  .tree-content {
    color: #111827;
  }
}
</style>
