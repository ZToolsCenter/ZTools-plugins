<template>
  <main class="workspace">
    <section class="header">
      <p class="eyebrow">Promo Canvas</p>
      <h1>电商营销图生成器</h1>
      <p>从商品图出发，快速选择主图贴、角标、优惠券、横幅和商品卡片模板。</p>
    </section>

    <section class="template-grid">
      <button
        v-for="template in templates"
        :key="template.value"
        :class="{ active: selectedTemplate === template.value }"
        type="button"
        @click="selectedTemplate = template.value"
      >
        {{ template.label }}
      </button>
    </section>

    <section class="dropzone">
      <strong>拖入商品图开始套模板</strong>
      <small>当前模板：{{ currentTemplate }}</small>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

const selectedTemplate = ref('main-badge')
const templates = [
  { value: 'main-badge', label: '主图卖点贴' },
  { value: 'promotion-corner', label: '促销角标' },
  { value: 'coupon', label: '优惠券图' },
  { value: 'banner', label: '横幅' },
  { value: 'product-card', label: '商品卡片' }
]

const currentTemplate = computed(
  () => templates.find(template => template.value === selectedTemplate.value)?.label || '主图卖点贴'
)
</script>

<style scoped>
:global(body) {
  margin: 0;
  color: #211e2a;
  background: #f4f0f7;
  font-family:
    "Avenir Next", "PingFang SC", "Microsoft YaHei", sans-serif;
}

.workspace {
  min-height: 100vh;
  box-sizing: border-box;
  padding: 30px;
  background:
    radial-gradient(circle at top right, rgba(225, 80, 71, 0.18), transparent 34%),
    linear-gradient(120deg, rgba(50, 84, 132, 0.12), transparent 46%), #f4f0f7;
}

.eyebrow {
  margin: 0 0 8px;
  color: #cc4339;
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
  color: #60586a;
}

.template-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 10px;
  margin-top: 28px;
}

button {
  min-height: 58px;
  border: 1px solid rgba(33, 30, 42, 0.18);
  border-radius: 8px;
  color: #211e2a;
  background: rgba(255, 255, 255, 0.76);
  font: inherit;
  cursor: pointer;
}

button.active {
  border-color: #cc4339;
  color: #fff;
  background: #cc4339;
}

.dropzone {
  display: grid;
  min-height: 270px;
  margin-top: 16px;
  place-items: center;
  border: 1px solid rgba(33, 30, 42, 0.2);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.74);
  text-align: center;
}

.dropzone strong {
  display: block;
  font-size: 24px;
}

.dropzone small {
  display: block;
  margin-top: 8px;
  color: #6a6274;
}
</style>
