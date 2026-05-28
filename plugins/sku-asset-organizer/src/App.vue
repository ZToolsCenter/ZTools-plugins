<template>
  <main class="workspace">
    <section class="header">
      <p class="eyebrow">SKU Delivery</p>
      <h1>SKU 素材整理</h1>
      <p>把素材文件夹、SKU 表和命名预览放在同一个交付面板。</p>
    </section>

    <section class="panels">
      <article class="panel">
        <h2>素材文件夹</h2>
        <div class="dropzone">拖入商品素材文件夹</div>
      </article>
      <article class="panel">
        <h2>SKU 表</h2>
        <div class="dropzone">拖入 CSV/TSV 文件</div>
      </article>
      <article class="panel preview">
        <h2>命名预览</h2>
        <code>{{ namingPattern }}</code>
      </article>
    </section>
  </main>
</template>

<script setup lang="ts">
const namingPattern = 'SKU_颜色_尺码_序号.jpg'
</script>

<style scoped>
:global(body) {
  margin: 0;
  color: #201b18;
  background: #f4eee6;
  font-family:
    "Avenir Next", "PingFang SC", "Microsoft YaHei", sans-serif;
}

.workspace {
  min-height: 100vh;
  box-sizing: border-box;
  padding: 30px;
}

.eyebrow {
  margin: 0 0 8px;
  color: #7c4d21;
  font-size: 12px;
  font-weight: 900;
  letter-spacing: 0;
  text-transform: uppercase;
}

h1 {
  margin: 0;
  font-size: 34px;
}

.header p:last-child {
  color: #6f6259;
}

.panels {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
  margin-top: 28px;
}

.panel {
  min-height: 170px;
  border: 1px solid rgba(32, 27, 24, 0.18);
  border-radius: 8px;
  padding: 18px;
  background: #fffaf2;
}

.panel h2 {
  margin: 0 0 14px;
  font-size: 17px;
}

.dropzone {
  display: grid;
  min-height: 96px;
  place-items: center;
  border: 1px dashed #7c4d21;
  border-radius: 8px;
  color: #7c4d21;
}

.preview {
  grid-column: 1 / -1;
  min-height: 108px;
}

code {
  display: block;
  border-radius: 8px;
  padding: 18px;
  color: #201b18;
  background: #eadfd0;
  font-size: 18px;
}
</style>
