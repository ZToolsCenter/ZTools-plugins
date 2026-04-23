<script lang="ts" setup>
import { ref } from 'vue'
import { ElMessage } from 'element-plus'

const hue = ref(0)
const saturation = ref(70)
const lightness = ref(50)
const color = ref('')
const history = ref<string[]>([])

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  s /= 100
  l /= 100
  const k = (n: number) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)]
}

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')
}

function generateRandom() {
  const rand = new Uint32Array(3)
  crypto.getRandomValues(rand)
  hue.value = rand[0] % 360
  saturation.value = (rand[1] % 60) + 40
  lightness.value = (rand[2] % 40) + 30
  applyColor()
}

function applyColor() {
  const [r, g, b] = hslToRgb(hue.value, saturation.value, lightness.value)
  const hex = rgbToHex(r, g, b)
  color.value = hex
  if (!history.value.includes(hex)) {
    history.value.unshift(hex)
    if (history.value.length > 12) history.value.pop()
  }
}

function copyText(text: string) {
  const doCopy = (window as any).ztools?.copyText
    ? Promise.resolve((window as any).ztools.copyText(text))
    : navigator.clipboard.writeText(text)
  doCopy
    .then(() => ElMessage.success({ message: '已复制到剪贴板', duration: 800 }))
    .catch(() => ElMessage.error({ message: '复制失败', duration: 1000 }))
}

function copyAs(format: 'hex' | 'rgb' | 'hsl') {
  const [r, g, b] = hslToRgb(hue.value, saturation.value, lightness.value)
  let text = ''
  if (format === 'hex') text = color.value
  else if (format === 'rgb') text = `rgb(${r}, ${g}, ${b})`
  else text = `hsl(${hue.value}, ${saturation.value}%, ${lightness.value}%)`
  copyText(text)
}
</script>

<template>
  <div class="random-color">
    <h2>随机颜色</h2>
    <p class="desc">通过 HSL 滑块调色或随机生成颜色，支持 HEX/RGB/HSL 多格式复制</p>

    <div class="preview" :style="{ background: color }">
      <span v-if="color" class="preview-hex">{{ color }}</span>
      <span v-else class="preview-placeholder">点击生成</span>
    </div>

    <div class="sliders">
      <div class="slider-row">
        <span>H {{ hue }}°</span>
        <el-slider v-model="hue" :min="0" :max="360" :show-tooltip="false" style="flex: 1" @input="applyColor" />
      </div>
      <div class="slider-row">
        <span>S {{ saturation }}%</span>
        <el-slider v-model="saturation" :min="0" :max="100" :show-tooltip="false" style="flex: 1" @input="applyColor" />
      </div>
      <div class="slider-row">
        <span>L {{ lightness }}%</span>
        <el-slider v-model="lightness" :min="0" :max="100" :show-tooltip="false" style="flex: 1" @input="applyColor" />
      </div>
    </div>

    <div class="actions">
      <el-button type="primary" @click="generateRandom">随机生成</el-button>
      <el-button v-if="color" size="small" @click="copyAs('hex')">HEX</el-button>
      <el-button v-if="color" size="small" @click="copyAs('rgb')">RGB</el-button>
      <el-button v-if="color" size="small" @click="copyAs('hsl')">HSL</el-button>
    </div>

    <div v-if="history.length" class="history">
      <div class="history-label">历史记录</div>
      <div class="history-grid">
        <div
          v-for="c in history"
          :key="c"
          class="history-item"
          :style="{ background: c }"
          @click="copyText(c)"
          :title="c"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.random-color {
  padding: 12px;
  max-width: 400px;
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

.preview {
  height: 120px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 16px;
  border: 1px solid var(--border-color, #e5e5e5);
  transition: background 0.15s;
}

.preview-hex {
  font-family: 'Consolas', monospace;
  font-size: 22px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.9);
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
}

.preview-placeholder {
  color: #999;
  font-size: 14px;
}

.sliders {
  margin-bottom: 16px;
}

.slider-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}

.slider-row span {
  width: 70px;
  font-size: 12px;
  color: var(--text-secondary, #888);
  flex-shrink: 0;
}

.actions {
  display: flex;
  gap: 8px;
  margin-bottom: 20px;
  flex-wrap: wrap;
}

.history {
  margin-top: 8px;
}

.history-label {
  font-size: 12px;
  color: var(--text-secondary, #888);
  margin-bottom: 8px;
}

.history-grid {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.history-item {
  width: 32px;
  height: 32px;
  border-radius: 6px;
  cursor: pointer;
  border: 1px solid var(--border-color, #e5e5e5);
  transition: transform 0.15s;
}

.history-item:hover {
  transform: scale(1.15);
}

@media (prefers-color-scheme: dark) {
  .history-item {
    border-color: #555;
  }

  h2 {
    color: #e0e0e0;
  }

  .desc {
    color: #8a8a8a;
  }
}
</style>
