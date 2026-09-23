<script setup lang="ts">
import { onMounted, ref } from 'vue'
import MdToExcel from './MdToExcel/index.vue'
import ExcelToMd from './ExcelToMd/index.vue'

const route = ref('')
const enterAction = ref<any>({})

onMounted(() => {
  window.ztools.onPluginEnter((action: any) => {
    route.value = action.code
    enterAction.value = action
  })
  window.ztools.onPluginOut(() => {
    route.value = ''
  })
})

function navigate(code: string) {
  enterAction.value = { code }
  route.value = code
}
</script>

<template>
  <MdToExcel v-if="route === 'md-to-excel'" :enter-action="enterAction" @navigate="navigate" />
  <ExcelToMd v-else-if="route === 'excel-to-md'" :enter-action="enterAction" @navigate="navigate" />
  <div v-else class="home-root">
    <h2>📊 Markdown 表格互转</h2>
    <p class="home-sub">双向转换 Markdown 表格与可复制表格</p>
    <div class="home-cards">
      <div class="home-card" @click="navigate('md-to-excel')">
        <div class="card-icon">📝 → 📋</div>
        <div class="card-title">Markdown → 表格</div>
        <div class="card-desc">粘贴 Markdown 表格文本，转换为可复制到 Excel 的表格</div>
        <div class="card-cmd">指令: md转excel</div>
      </div>
      <div class="home-card" @click="navigate('excel-to-md')">
        <div class="card-icon">📋 → 📝</div>
        <div class="card-title">表格 → Markdown</div>
        <div class="card-desc">粘贴从 Excel 复制的内容，转换为 Markdown 表格代码</div>
        <div class="card-cmd">指令: excel转md</div>
      </div>
    </div>
  </div>
</template>

<style>
.home-root {
  padding: 30px 24px;
  box-sizing: border-box;
}

.home-root h2 {
  margin: 0 0 6px 0;
  font-size: 20px;
}

.home-sub {
  margin: 0 0 28px 0;
  font-size: 13px;
  color: #888;
}

.home-cards {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.home-card {
  border: 1px solid #ddd;
  border-radius: 8px;
  padding: 18px 20px;
  cursor: pointer;
  transition: background-color 0.15s, border-color 0.15s;
}

.home-card:hover {
  background-color: rgba(88, 164, 246, 0.08);
  border-color: var(--blue);
}

.card-icon {
  font-size: 22px;
  margin-bottom: 6px;
}

.card-title {
  font-size: 15px;
  font-weight: bold;
  margin-bottom: 4px;
}

.card-desc {
  font-size: 13px;
  color: #666;
  margin-bottom: 6px;
}

.card-cmd {
  font-size: 12px;
  color: var(--blue);
  font-family: 'Courier New', monospace;
}

@media (prefers-color-scheme: dark) {
  .home-sub { color: #aaa; }
  .home-card { border-color: #555; }
  .home-card:hover { background-color: rgba(88, 164, 246, 0.12); }
  .card-desc { color: #bbb; }
}
</style>
