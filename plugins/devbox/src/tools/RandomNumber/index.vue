<script lang="ts" setup>
import { ref } from 'vue'
import { ElMessage } from 'element-plus'

const min = ref(1)
const max = ref(100)
const count = ref(1)
const decimalPlaces = ref(0)
const results = ref<number[]>([])

function generate() {
  const res: number[] = []
  const randArray = new Uint32Array(Math.min(count.value, 100))
  crypto.getRandomValues(randArray)
  for (let i = 0; i < Math.min(count.value, 100); i++) {
    const rawRand = randArray[i] / 0xFFFFFFFF
    const val = decimalPlaces.value > 0
      ? parseFloat((rawRand * (max.value - min.value) + min.value).toFixed(decimalPlaces.value))
      : Math.floor(rawRand * (max.value - min.value + 1)) + min.value
    res.push(val)
  }
  results.value = res
}

function copyText(text: string) {
  const doCopy = (window as any).ztools?.copyText
    ? Promise.resolve((window as any).ztools.copyText(text))
    : navigator.clipboard.writeText(text)
  doCopy
    .then(() => ElMessage.success({ message: '已复制到剪贴板', duration: 800 }))
    .catch(() => ElMessage.error({ message: '复制失败', duration: 1000 }))
}
</script>

<template>
  <div class="random-number">
    <h2>随机数字</h2>
    <p class="desc">在指定范围内随机生成整数或小数，支持批量和自定义小数位数</p>

    <div class="config">
      <div class="config-row">
        <span>最小值</span>
        <el-input-number v-model="min" size="small" />
        <span>最大值</span>
        <el-input-number v-model="max" size="small" />
      </div>
      <div class="config-row">
        <span>生成个数</span>
        <el-input-number v-model="count" :min="1" :max="100" size="small" />
        <span>小数位数</span>
        <el-input-number v-model="decimalPlaces" :min="0" :max="10" size="small" />
      </div>
    </div>

    <div class="actions">
      <el-button type="primary" @click="generate">生成</el-button>
      <el-button v-if="results.length" size="small" @click="copyText(results.join('\n'))">复制全部</el-button>
    </div>

    <div v-if="results.length" class="result-grid">
      <div
        v-for="(num, idx) in results"
        :key="idx"
        class="result-item"
        @click="copyText(String(num))"
      >
        {{ num }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.random-number {
  padding: 12px;
  max-width: 500px;
  margin: 0 auto;
  font-size: 13px;
}

h2 {
  margin: 0 0 4px;
  font-size: 20px;
  font-weight: 600;
}

.desc {
  color: #909399;
  margin: 0 0 16px;
  font-size: 13px;
}

.config {
  margin-bottom: 16px;
}

.config-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}

.config-row span {
  color: var(--text-secondary, #888);
  flex-shrink: 0;
}

.actions {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 16px;
}

.result-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(80px, 1fr));
  gap: 8px;
}

.result-item {
  padding: 10px;
  text-align: center;
  background: var(--bg-card, #fff);
  border: 1px solid var(--border-color, #e5e5e5);
  border-radius: 6px;
  cursor: pointer;
  font-family: 'Consolas', monospace;
  font-size: 16px;
  color: var(--text-primary, #333);
  transition: background 0.15s;
}

.result-item:hover {
  background: var(--bg-hover, #f5f7ff);
  border-color: #667eea;
}

@media (prefers-color-scheme: dark) {
  .result-item {
    background: #2c2c2c;
    border-color: #444;
    color: #ddd;
  }

  .result-item:hover {
    background: #363640;
    border-color: #667eea;
  }

  h2 {
    color: #e0e0e0;
  }

  .desc {
    color: #8a8a8a;
  }
}
</style>
