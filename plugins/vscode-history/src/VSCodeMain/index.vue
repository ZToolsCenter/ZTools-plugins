<script setup lang="ts">
import { ref, watchEffect } from 'vue'
import VSCodeSearch from '../VSCodeSearch/index.vue'
import VSCodeIDE from '../VSCodeIDE/index.vue'

type TabKey = 'search' | 'ide'

const props = defineProps<{ enterAction?: any }>()

const activeTab = ref<TabKey>('search')
const hoveredTab = ref<TabKey | null>(null)

const tabs: { key: TabKey; label: string; icon: string }[] = [
  { key: 'search', label: '搜索历史', icon: '🔍' },
  { key: 'ide', label: 'IDE 管理', icon: '⚙️' },
]

// 根据入口 action 自动切换到对应 tab
watchEffect(() => {
  const code = props.enterAction?.code
  if (code === 'vscode-ide') {
    activeTab.value = 'ide'
  } else {
    activeTab.value = 'search'
  }
})
</script>

<template>
  <div class="app-layout">
    <!-- 顶部标题栏 -->
    <header class="app-header">
      <nav class="tab-bar">
        <button
          v-for="tab in tabs"
          :key="tab.key"
          :class="['tab-btn', { active: activeTab === tab.key, hovered: hoveredTab === tab.key && activeTab !== tab.key }]"
          @click="activeTab = tab.key"
          @mouseenter="hoveredTab = tab.key"
          @mouseleave="hoveredTab = null"
        >
          <span class="tab-icon">{{ tab.icon }}</span>
          <span class="tab-label">{{ tab.label }}</span>
          <!-- <span v-if="activeTab === tab.key" class="tab-indicator"></span> -->
        </button>
      </nav>
    </header>

    <!-- 主内容区 -->
    <main class="app-content">
      <div class="content-wrapper">
        <VSCodeSearch v-if="activeTab === 'search'" />
        <VSCodeIDE v-else />
      </div>
    </main>
  </div>
</template>

<style scoped>
.app-layout {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  margin: 0;
  padding: 0;
  background: var(--vscode-editor-bg, #ffffff);
}

/* ===== 标题栏 ===== */
.app-header {
  display: flex;
  align-items: center;
  padding: 0 5px;
  /* height: 42px; */
  background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
  border-bottom: 1px solid var(--border-color, #e2e8f0);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
  flex-shrink: 0;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-right: 32px;
}

.app-logo {
  font-size: 20px;
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.1));
}

.app-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--text-color, #1e293b);
  letter-spacing: -0.01em;
}

/* ===== 标签栏 ===== */
.tab-bar {
  display: flex;
  gap: 5px;
  height: 100%;
  align-items: center;
}

.tab-btn {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  /* padding: 8px 16px; */
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 13px;
  color: var(--text-secondary, #64748b);
  border-radius:  6px 6px 0 0 ;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  font-weight: 500;
}

.tab-btn:hover {
  background: rgba(0, 0, 0, 0.04);
  color: var(--text-color, #334155);
}

.tab-btn.hovered {
  background: rgba(74, 144, 217, 0.08);
  color: var(--primary-color, #4a90d9);
}

.tab-btn.active {
  background: rgba(74, 144, 217, 0.12);
  color: var(--primary-color, #4a90d9);
}

.tab-icon {
  font-size: 15px;
  line-height: 1;
}

.tab-indicator {
  position: absolute;
  bottom: -8px;
  left: 50%;
  transform: translateX(-50%);
  width: 60%;
  height: 2px;
  background: var(--primary-color, #4a90d9);
  border-radius: 1px;
}

/* ===== 内容区 ===== */
.app-content {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
}

.content-wrapper {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
</style>
