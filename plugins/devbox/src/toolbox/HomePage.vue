<script lang="ts" setup>
import { categories, type Tool } from './tools'

defineProps<{
  /** 常用工具（按打开次数自动统计，无使用数据时为空数组） */
  frequent: Tool[]
}>()

const emit = defineEmits<{
  /** 点击工具卡片：新开 / 激活对应标签 */
  select: [code: string]
}>()
</script>

<template>
  <div class="home-page">
    <template v-if="frequent.length">
      <div class="section-title">常用</div>
      <div class="tool-grid">
        <el-card
          v-for="tool in frequent"
          :key="tool.code"
          shadow="hover"
          class="tool-card"
          @click="emit('select', tool.code)"
        >
          {{ tool.explain }}
        </el-card>
      </div>
    </template>

    <template v-for="cat in categories" :key="cat.code">
      <div class="section-title">{{ cat.name }}</div>
      <div class="tool-grid">
        <el-card
          v-for="tool in cat.tools"
          :key="tool.code"
          shadow="hover"
          class="tool-card"
          @click="emit('select', tool.code)"
        >
          {{ tool.explain }}
        </el-card>
      </div>
    </template>
  </div>
</template>

<style scoped>
.home-page {
  padding: 20px 16px;
  max-width: 760px;
  margin: 0 auto;
}

.section-title {
  padding: 6px 2px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary, #999);
  letter-spacing: 0.5px;
}

.tool-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
  gap: 10px;
  margin-bottom: 8px;
}

.tool-card {
  --el-card-padding: 16px 8px;
  cursor: pointer;
  text-align: center;
  font-size: 13px;
  color: var(--text-primary, #333);
}

.tool-card:hover {
  color: #667eea;
  border-color: #667eea;
}

@media (prefers-color-scheme: dark) {
  .section-title {
    color: #777;
  }

  .tool-card {
    --el-card-bg-color: #333;
    --el-card-border-color: #444;
    color: #ccc;
  }

  .tool-card:hover {
    color: #8ba4f7;
    border-color: #8ba4f7;
  }
}
</style>
