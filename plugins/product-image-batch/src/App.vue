<template>
  <main class="workspace">
    <section class="header">
      <p class="eyebrow">Batch Studio</p>
      <h1>商品图批量处理</h1>
      <p>压缩、改尺寸、转格式、加水印、导出平台尺寸包，一次排好。</p>
    </section>

    <section class="operations">
      <label v-for="operation in operationItems" :key="operation.key" class="operation">
        <input v-model="operations[operation.key]" type="checkbox" />
        <span>{{ operation.label }}</span>
      </label>
    </section>

    <section class="dropzone">
      <strong>拖入商品图片或文件夹</strong>
      <small>已选择 {{ activeCount }} 项处理动作</small>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, reactive } from 'vue'

const operations = reactive({
  compress: true,
  resize: true,
  convert: false,
  watermark: false,
  platformPack: true
})

const operationItems: Array<{ key: keyof typeof operations; label: string }> = [
  { key: 'compress', label: '压缩' },
  { key: 'resize', label: '改尺寸' },
  { key: 'convert', label: '转格式' },
  { key: 'watermark', label: '加水印' },
  { key: 'platformPack', label: '平台尺寸包' }
]

const activeCount = computed(() => Object.values(operations).filter(Boolean).length)
</script>

<style scoped>
:global(body) {
  margin: 0;
  color: #182027;
  background: #eef3f1;
  font-family:
    "Avenir Next", "PingFang SC", "Microsoft YaHei", sans-serif;
}

.workspace {
  min-height: 100vh;
  box-sizing: border-box;
  padding: 30px;
  background:
    linear-gradient(135deg, rgba(28, 121, 100, 0.14), transparent 38%),
    linear-gradient(315deg, rgba(212, 72, 43, 0.12), transparent 42%), #eef3f1;
}

.header {
  max-width: 660px;
}

.eyebrow {
  margin: 0 0 8px;
  color: #1c7964;
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
  color: #52615b;
}

.operations {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 10px;
  margin-top: 28px;
}

.operation {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 54px;
  border: 1px solid rgba(24, 32, 39, 0.16);
  border-radius: 8px;
  padding: 0 14px;
  background: rgba(255, 255, 255, 0.78);
}

.operation input {
  accent-color: #1c7964;
}

.dropzone {
  display: grid;
  min-height: 260px;
  margin-top: 16px;
  place-items: center;
  border: 1px dashed #1c7964;
  border-radius: 8px;
  color: #182027;
  background: rgba(255, 255, 255, 0.72);
  text-align: center;
}

.dropzone strong {
  display: block;
  font-size: 24px;
}

.dropzone small {
  display: block;
  margin-top: 8px;
  color: #60706a;
}
</style>
