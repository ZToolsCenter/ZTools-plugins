<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

const keyword = ref('')
const aumid = ref('')
const apps = ref<any[]>([])
const rows = ref<NoticeEntry[]>([])
const page = ref(1)
const PAGE_SIZE = 50
const pagedRows = computed(() => rows.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE))

function load() {
  const limit = Number(window.services.notice.getConfig().historyLimit) || 200
  rows.value = window.services.notice
    .search(keyword.value, limit)
    .filter((r) => !aumid.value || r.aumid === aumid.value)
  page.value = 1
}

function exportAs(format: string) {
  const file = window.services.notice.exportHistory(format, keyword.value, aumid.value)
  window.ztools.shellShowItemInFolder(file)
}

function fmt(ms: number) {
  return new Date(ms).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}

onMounted(async () => {
  apps.value = await window.services.notice.getApps()
  load()
})
</script>

<template>
  <div class="history">
    <div class="bar">
      <el-input v-model="keyword" placeholder="搜索标题/正文" clearable style="width: 220px" @input="load" @clear="load" />
      <el-select v-model="aumid" placeholder="全部应用" clearable style="width: 180px" @change="load">
        <el-option v-for="a in apps" :key="a.aumid" :label="a.name + '（' + a.count + '）'" :value="a.aumid" />
      </el-select>
      <el-button @click="exportAs('csv')">导出 CSV</el-button>
      <el-button @click="exportAs('json')">导出 JSON</el-button>
      <span class="meta">{{ rows.length }} 条</span>
    </div>
    <el-table :data="pagedRows" height="440" size="small">
      <el-table-column label="时间" width="150">
        <template #default="{ row }">{{ fmt(row.at) }}</template>
      </el-table-column>
      <el-table-column prop="name" label="应用" width="110" />
      <el-table-column prop="title" label="标题" min-width="160" show-overflow-tooltip />
      <el-table-column prop="body" label="正文" min-width="220" show-overflow-tooltip />
    </el-table>
    <el-pagination
      v-model:current-page="page"
      :page-size="PAGE_SIZE"
      :total="rows.length"
      layout="prev, pager, next"
      small
      style="margin-top: 8px; justify-content: flex-end"
    />
  </div>
</template>

<style scoped>
.history {
  padding: 4px 2px;
}
.bar {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 10px;
  flex-wrap: wrap;
}
.meta {
  opacity: 0.6;
  font-size: 12px;
}
</style>
