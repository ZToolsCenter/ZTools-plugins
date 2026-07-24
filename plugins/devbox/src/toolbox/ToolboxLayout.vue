<script lang="ts" setup>
import { categories, type Tool } from './tools'

const props = defineProps<{
  activeCode: string
}>()

const emit = defineEmits<{
  select: [code: string]
}>()

function isActive(tool: Tool): boolean {
  return tool.code === props.activeCode
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
      <slot />
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
}
</style>
