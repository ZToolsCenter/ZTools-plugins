<template>
  <section class="manual-panel" aria-label="手动编辑说明">
    <p>💡 粘贴多行文本（如 Excel 复制的整列），会按当前列表顺序填入目标文件名。</p>
  </section>
</template>

<style scoped>
.manual-panel { display: flex; align-items: center; height: 100%; }
.manual-panel p { width: 100%; margin: 0; padding: 12px; border: 1px dashed var(--border-input); border-radius: 8px; color: var(--muted); background: var(--surface-subdued); font-size: 13px; text-align: center; }
</style>
