<template>
  <main class="workspace">
    <section class="hero">
      <div>
        <p class="eyebrow">Ecommerce QA</p>
        <h1>商品主图规范检查</h1>
        <p class="summary">把尺寸、格式、留白、文件大小和平台规则放到同一个检查台。</p>
      </div>
      <select v-model="platform" class="platform-select" aria-label="平台预设">
        <option value="general-square">通用方图</option>
        <option value="taobao">淘宝/天猫</option>
        <option value="jd">京东</option>
        <option value="pdd">拼多多</option>
        <option value="douyin">抖音电商</option>
        <option value="xiaohongshu">小红书</option>
      </select>
    </section>

    <section class="dropzone">
      <div class="frame">
        <span class="corner top-left"></span>
        <span class="corner top-right"></span>
        <span class="corner bottom-left"></span>
        <span class="corner bottom-right"></span>
        <strong>拖入商品图或文件夹</strong>
        <small>当前预设：{{ currentPlatform.label }}，建议尺寸 {{ currentPlatform.size }}</small>
      </div>
    </section>

    <section class="checks" aria-label="检查项">
      <article v-for="item in checks" :key="item.name" class="check-card">
        <span>{{ item.value }}</span>
        <strong>{{ item.name }}</strong>
      </article>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

const platform = ref('general-square')
const platforms = {
  'general-square': { label: '通用方图', size: '800 x 800+' },
  taobao: { label: '淘宝/天猫', size: '800 x 800+' },
  jd: { label: '京东', size: '800 x 800+' },
  pdd: { label: '拼多多', size: '800 x 800+' },
  douyin: { label: '抖音电商', size: '1:1 或 3:4' },
  xiaohongshu: { label: '小红书', size: '3:4 优先' }
}

const currentPlatform = computed(() => platforms[platform.value as keyof typeof platforms])
const checks = [
  { name: '尺寸与比例', value: '01' },
  { name: '格式与体积', value: '02' },
  { name: '主体留白', value: '03' },
  { name: '透明与背景', value: '04' }
]
</script>

<style scoped>
:global(body) {
  margin: 0;
  color: #17201b;
  background: #f6f1e7;
  font-family:
    "Avenir Next", "PingFang SC", "Microsoft YaHei", sans-serif;
}

.workspace {
  min-height: 100vh;
  box-sizing: border-box;
  padding: 28px;
  background:
    linear-gradient(90deg, rgba(23, 32, 27, 0.05) 1px, transparent 1px),
    linear-gradient(rgba(23, 32, 27, 0.05) 1px, transparent 1px), #f6f1e7;
  background-size: 32px 32px;
}

.hero {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
}

.eyebrow {
  margin: 0 0 8px;
  color: #b5482f;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0;
  text-transform: uppercase;
}

h1 {
  margin: 0;
  font-size: 34px;
  line-height: 1.08;
}

.summary {
  max-width: 520px;
  margin: 12px 0 0;
  color: #5b635e;
}

.platform-select {
  min-width: 156px;
  border: 1px solid #17201b;
  border-radius: 8px;
  padding: 10px 12px;
  color: #17201b;
  background: #fffdf8;
}

.dropzone {
  margin-top: 30px;
  border: 1px solid #17201b;
  border-radius: 8px;
  background: #fffdf8;
}

.frame {
  position: relative;
  display: grid;
  min-height: 260px;
  place-items: center;
  padding: 32px;
  text-align: center;
}

.frame strong {
  display: block;
  font-size: 24px;
}

.frame small {
  display: block;
  margin-top: 10px;
  color: #687069;
}

.corner {
  position: absolute;
  width: 34px;
  height: 34px;
  border-color: #b5482f;
}

.top-left {
  top: 18px;
  left: 18px;
  border-top: 3px solid;
  border-left: 3px solid;
}

.top-right {
  top: 18px;
  right: 18px;
  border-top: 3px solid;
  border-right: 3px solid;
}

.bottom-left {
  bottom: 18px;
  left: 18px;
  border-bottom: 3px solid;
  border-left: 3px solid;
}

.bottom-right {
  right: 18px;
  bottom: 18px;
  border-right: 3px solid;
  border-bottom: 3px solid;
}

.checks {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin-top: 16px;
}

.check-card {
  min-height: 84px;
  border: 1px solid rgba(23, 32, 27, 0.2);
  border-radius: 8px;
  padding: 14px;
  background: rgba(255, 253, 248, 0.84);
}

.check-card span {
  color: #b5482f;
  font-weight: 800;
}

.check-card strong {
  display: block;
  margin-top: 16px;
}
</style>
