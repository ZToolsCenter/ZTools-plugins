<script lang="ts" setup>
import { categories, type Tool } from './tools'
import type { TabPaneName } from 'element-plus'

const props = defineProps<{
  /** 已打开的 tab（按打开顺序） */
  tabs: Tool[]
  /** 当前激活 tab 的工具 code */
  activeCode: string
}>()

const emit = defineEmits<{
  /** 激活或新开某个工具 tab */
  select: [code: string]
  /** 关闭某个工具 tab */
  close: [code: string]
}>()

function isActive(tool: Tool): boolean {
  return tool.code === props.activeCode
}

function onTabChange(name: TabPaneName) {
  emit('select', String(name))
}

function onTabRemove(name: TabPaneName) {
  emit('close', String(name))
}
</script>

<template>
  <el-container class="toolbox-layout">
    <el-aside width="150px" class="sidebar">
      <template v-for="cat in categories" :key="cat.code">
        <div class="cat-title">{{ cat.name }}</div>
        <div
          v-for="tool in cat.tools"
          :key="tool.code"
          class="tool-item"
          :class="{ active: isActive(tool) }"
          @click="emit('select', tool.code)"
        >
          <span class="tool-icon">{{ tool.icon }}</span>
          <span class="tool-name">{{ tool.explain }}</span>
        </div>
      </template>
    </el-aside>
    <el-main class="content">
      <!-- 标签条：仅作为页签导航，工具内容在下方由 App.vue 统一渲染 -->
      <el-tabs
        v-if="tabs.length"
        :model-value="activeCode"
        type="card"
        closable
        class="tool-tabs"
        @tab-change="onTabChange"
        @tab-remove="onTabRemove"
      >
        <el-tab-pane v-for="tab in tabs" :key="tab.code" :name="tab.code">
          <template #label>{{ tab.explain }}</template>
        </el-tab-pane>
      </el-tabs>
      <div class="tool-container">
        <slot />
      </div>
    </el-main>
  </el-container>
</template>

<style scoped>
.toolbox-layout {
  height: 100%;
}

.sidebar {
  background: var(--sidebar-bg, #f7f8fa);
  border-right: 1px solid var(--border-color, #e5e5e5);
  padding: 8px 0;
  overflow-y: auto;
}

.cat-title {
  padding: 8px 14px 4px;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary, #999);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.tool-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  cursor: pointer;
  font-size: 13px;
  color: var(--text-primary, #333);
  transition: background 0.15s;
  border-left: 3px solid transparent;
}

.tool-item:hover {
  background: var(--hover-bg, #eef0f4);
}

.tool-item.active {
  background: var(--active-bg, #e8ecf8);
  color: #667eea;
  border-left-color: #667eea;
  font-weight: 500;
}

.tool-icon {
  font-size: 14px;
  flex-shrink: 0;
  width: 18px;
  text-align: center;
}

.tool-name {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.content {
  padding: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* 通过 Element Plus 的 CSS 变量把标签条配色对齐插件主题 */
.tool-tabs {
  flex-shrink: 0;
  /* 压缩标签高度：默认 40px → 26px（再小会影响关闭图标可点击性） */
  --el-tabs-header-height: 26px;
  --el-color-primary: #667eea;
  --el-bg-color-overlay: #fff;
  --el-text-color-primary: var(--text-primary, #333);
  --el-border-color-light: var(--border-color, #e5e5e5);
}

.tool-tabs :deep(.el-tabs__header) {
  margin: 0;
  padding: 4px 6px 0;
  background: var(--sidebar-bg, #f7f8fa);
  border-bottom: 1px solid var(--border-color, #e5e5e5);
}

/* 标签条只做导航，内容区由 slot 渲染，隐藏 pane 默认容器 */
.tool-tabs :deep(.el-tabs__content) {
  display: none;
}

.tool-tabs :deep(.el-tabs__item) {
  font-size: 12px;
  padding: 0 10px;
}

.tool-container {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

@media (max-width: 600px) {
  .toolbox-layout {
    flex-direction: column;
  }

  .sidebar {
    border-right: none;
    border-bottom: 1px solid var(--border-color, #e5e5e5);
    display: flex;
    flex-wrap: wrap;
    padding: 4px 8px;
    gap: 2px;
  }

  .cat-title {
    display: none;
  }

  .tool-item {
    padding: 5px 10px;
    border-left: none;
    border-radius: 4px;
    font-size: 12px;
  }

  .tool-item.active {
    border-left: none;
    background: #667eea;
    color: #fff;
  }
}

@media (prefers-color-scheme: dark) {
  .sidebar {
    background: #2c2c2c;
    border-color: #444;
  }

  .cat-title {
    color: #777;
  }

  .tool-item {
    color: #ccc;
  }

  .tool-item:hover {
    background: #363636;
  }

  .tool-item.active {
    background: #3a3a4a;
    color: #8ba4f7;
    border-left-color: #8ba4f7;
  }

  .tool-tabs {
    --el-color-primary: #8ba4f7;
    --el-bg-color-overlay: #3a3a4a;
    --el-text-color-primary: #ccc;
    --el-border-color-light: #444;
  }

  .tool-tabs :deep(.el-tabs__header) {
    background: #2c2c2c;
    border-bottom-color: #444;
  }
}
</style>
