<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { defaultPlatforms } from '../../data/platforms'
import { storage } from '../../utils/storage'
import type { PlatformInfo } from '../../types'

const platforms = ref<PlatformInfo[]>([])

onMounted(() => {
  const saved = storage.getPlatformConfigs()
  platforms.value = defaultPlatforms.map((p) => {
    const savedConfig = saved.find((c) => c.id === p.id)
    return {
      ...p,
      customPath: savedConfig?.customPath || p.customPath,
      customProjectPath: savedConfig?.customProjectPath || p.customProjectPath,
      enabled: savedConfig ? savedConfig.enabled : p.enabled,
    }
  })
})

function toggleEnabled(platform: PlatformInfo) {
  platform.enabled = !platform.enabled
  saveAll()
}

function detectDir(platform: PlatformInfo) {
  if (platform.rootDir) {
    const osKey = window.services.isWindows() ? 'win32' : window.services.isMacOS() ? 'darwin' : 'linux'
    const root = (platform.rootDir[osKey as keyof typeof platform.rootDir] || platform.rootDir.linux).replace(/^~/, window.services.homeDir())
    return window.services.pathExists(root)
  }
  const p = platform.defaultPath || platform.projectPath || ''
  if (!p) return false
  const expanded = p.replace(/^~/, window.services.homeDir())
  return window.services.pathExists(expanded)
}

function saveAll() {
  storage.savePlatformConfigs(platforms.value)
}

function detectAll() {
  for (const p of platforms.value) {
    detectDir(p)
  }
}
</script>

<template>
  <div class="platforms">
    <div class="platforms-header">
      <h3>Agent 配置</h3>
      <div class="header-actions">
        <button class="detect-btn" @click="detectAll">检测已安装 Agent</button>
        <button class="save-btn" @click="saveAll">保存配置</button>
      </div>
    </div>
    <p class="platforms-desc">管理已识别的 AI Agent 平台，支持自定义 Skills 目录路径。</p>

    <div class="platform-table">
      <div class="table-header">
        <span class="col-enabled">启用</span>
        <span class="col-name">平台</span>
        <span class="col-path">全局路径</span>
        <span class="col-project">项目路径</span>
        <span class="col-status">状态</span>
      </div>
      <div v-for="p in platforms" :key="p.id" class="table-row">
        <span class="col-enabled">
          <input type="checkbox" :checked="p.enabled" @change="toggleEnabled(p)" />
        </span>
        <span class="col-name">{{ p.name }}</span>
        <span class="col-path">
          <input v-model="p.customPath" :placeholder="p.defaultPath || '无全局路径'" class="path-input" />
        </span>
        <span class="col-project">
          <input v-model="p.customProjectPath" :placeholder="p.projectPath || '—'" class="path-input" />
        </span>
        <span class="col-status">
          <span v-if="detectDir(p)" class="status-detected">已检测</span>
          <span v-else class="status-missing">未检测</span>
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.platforms {
  max-width: 900px;
  margin: 0 auto;
}

.platforms-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}

.platforms-header h3 {
  margin: 0;
  font-size: 16px;
}

.header-actions {
  display: flex;
  gap: 8px;
}

.detect-btn, .save-btn {
  padding: 6px 16px;
  font-size: 13px;
  border-radius: 4px;
}

.detect-btn {
  background: none;
  border: 1px solid var(--border-color, #ddd);
  color: inherit;
}

.save-btn {
  background: var(--blue);
  color: #fff;
}

.platforms-desc {
  font-size: 13px;
  color: #888;
  margin: 0 0 16px;
}

.platform-table {
  border: 1px solid var(--border-color, #e8e8e8);
  border-radius: 8px;
  overflow: hidden;
}

.table-header {
  display: grid;
  grid-template-columns: 50px 1fr 1.5fr 1.5fr 80px;
  gap: 8px;
  padding: 10px 14px;
  background: #f8f8f8;
  font-size: 12px;
  font-weight: 600;
  color: #666;
}

.table-row {
  display: grid;
  grid-template-columns: 50px 1fr 1.5fr 1.5fr 80px;
  gap: 8px;
  padding: 8px 14px;
  align-items: center;
  font-size: 13px;
}

.table-row + .table-row {
  border-top: 1px solid #f0f0f0;
}

.col-enabled {
  text-align: center;
}

.path-input {
  width: 100%;
  padding: 4px 8px;
  font-size: 12px;
  font-family: monospace;
  border: 1px solid var(--border-color, #ddd);
  border-radius: 4px;
  background: var(--card-bg, #fff);
  color: inherit;
  box-sizing: border-box;
}

.status-detected {
  font-size: 11px;
  color: #2e7d32;
  font-weight: 500;
}

.status-missing {
  font-size: 11px;
  color: #999;
}

@media (prefers-color-scheme: dark) {
  .table-header { background: #333; color: #ccc; }
  .table-row + .table-row { border-top-color: #444; }
  .path-input { --card-bg: #3a3b3c; --border-color: #555; }
  .detect-btn { --border-color: #555; }
  .status-detected { color: #81c784; }
}
</style>
