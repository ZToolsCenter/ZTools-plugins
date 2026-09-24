# Jenkins Lite Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 Jenkins Lite 插件，提供 Jenkins 实例管理、Jobs 列表、构建触发和状态查询功能

**Architecture:** 采用 Vue 3 Composition API + TypeScript，通过 Jenkins REST API 与 Jenkins 通信，数据存储使用 ZTools db API

**Tech Stack:** Vue 3, TypeScript, Vite, ZTools API, Jenkins REST API

---

## 文件结构

```
src/
├── main.ts                     # 入口文件（保持不变）
├── App.vue                     # 根组件（重构路由逻辑）
├── main.css                    # 全局样式（扩展主题变量）
├── env.d.ts                    # 类型声明（扩展）
├── types/
│   └── index.ts               # 统一类型定义
├── composables/
│   ├── useJenkins.ts          # Jenkins API 客户端
│   ├── useInstances.ts        # 实例管理
│   ├── useFavorites.ts        # 收藏管理
│   └── useBuildPolling.ts     # 构建状态轮询
├── components/
│   ├── Sidebar.vue            # 侧边栏导航
│   ├── InstanceSelector.vue   # 实例选择器
│   ├── JobsList.vue          # Jobs 列表
│   ├── JobItem.vue           # 单个 Job 项
│   ├── BuildHistory.vue      # 构建历史
│   ├── SettingsModal.vue     # 设置弹窗
│   └── EmptyState.vue        # 空状态组件
├── utils/
│   ├── auth.ts               # 认证工具
│   └── jenkins.ts            # Jenkins API 封装
└── store/
    └── index.ts              # 响应式状态管理
```

---

## Chunk 1: 项目初始化与类型定义

### Task 1: 清理旧示例代码

**Files:**
- Delete: `src/Hello/`
- Delete: `src/Read/`
- Delete: `src/Write/`

- [ ] **Step 1: 删除示例目录**

```bash
rm -rf src/Hello src/Read src/Write
```

### Task 2: 创建类型定义

**Files:**
- Create: `src/types/index.ts`

- [ ] **Step 1: 创建类型定义文件**

```typescript
// Jenkins 实例配置
export interface JenkinsInstance {
  _id: string
  type: 'jenkins-instance'
  name: string
  url: string
  username: string
  apiToken: string
  group: string
  crumb?: string
  createdAt: number
  updatedAt: number
}

// Job 信息
export interface JobInfo {
  name: string
  url: string
  color: string
  lastBuild?: {
    number: number
    url: string
    result?: BuildResult
    timestamp: number
  }
  _class?: string
  jobs?: JobInfo[]
}

// 构建信息
export interface BuildInfo {
  id: string
  number: number
  url: string
  result: BuildResult
  building: boolean
  duration: number
  timestamp: number
  displayName: string
  fullDisplayName: string
}

// 构建结果
export type BuildResult = 'SUCCESS' | 'FAILURE' | 'ABORTED' | 'UNSTABLE' | null

// 收藏
export interface Favorite {
  _id: string
  type: 'favorite'
  instanceId: string
  instanceName: string
  jobName: string
  addedAt: number
}

// API 响应
export interface JenkinsResponse<T> {
  data: T | null
  error: string | null
}

// 搜索结果
export interface SearchResult {
  type: 'job' | 'instance' | 'build' | 'command'
  title: string
  subtitle?: string
  icon?: string
  action: {
    type: 'build' | 'view' | 'favorite' | 'navigate'
    payload: any
  }
}

// 视图类型
export type ViewType = 'jobs' | 'favorites' | 'settings'

// Job 状态颜色映射
export const JOB_COLOR_MAP: Record<string, { label: string; icon: string; color: string }> = {
  'blue': { label: '成功', icon: '●', color: '#52c41a' },
  'animeblue': { label: '运行中', icon: '◐', color: '#1890ff' },
  'red': { label: '失败', icon: '●', color: '#ff4d4f' },
  'animered': { label: '运行中', icon: '◐', color: '#ff4d4f' },
  'yellow': { label: '不稳定', icon: '⚠', color: '#faad14' },
  'animeyellow': { label: '运行中', icon: '◐', color: '#faad14' },
  'grey': { label: '禁用', icon: '○', color: '#d9d9d9' },
  'disabled': { label: '未执行', icon: '○', color: '#bfbfbf' },
  'notbuilt': { label: '未构建', icon: '○', color: '#d9d9d9' },
  'aborted': { label: '中止', icon: '○', color: '#8c8c8c' },
}
```

### Task 3: 更新 env.d.ts

**Files:**
- Modify: `src/env.d.ts`

- [ ] **Step 1: 扩展类型声明**

```typescript
/// <reference types="vite/client" />
/// <reference types="@ztools-center/ztools-api-types" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>
  export default component
}

// Preload services 类型声明
interface Services {
  readFile: (file: string) => string
  writeTextFile: (text: string) => string
  writeImageFile: (base64Url: string) => string | undefined
}

// 扩展 window.ztools 类型
interface ZToolsApi {
  // 已有API保持不变，添加自定义扩展
}

declare global {
  interface Window {
    services: Services
  }
}

export {}
```

---

## Chunk 2: Jenkins API 客户端

### Task 4: 创建认证工具

**Files:**
- Create: `src/utils/auth.ts`

- [ ] **Step 1: 创建认证工具**

```typescript
/**
 * 生成 Basic Auth 头
 */
export function generateBasicAuth(username: string, apiToken: string): string {
  const credentials = btoa(`${username}:${apiToken}`)
  return credentials
}

/**
 * 验证 URL 格式
 */
export function isValidJenkinsUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return ['http:', 'https:'].includes(parsed.protocol)
  } catch {
    return false
  }
}

/**
 * 格式化 Jenkins URL（确保尾部有斜杠）
 */
export function normalizeJenkinsUrl(url: string): string {
  return url.endsWith('/') ? url : `${url}/`
}
```

### Task 5: 创建 Jenkins API 封装

**Files:**
- Create: `src/utils/jenkins.ts`

- [ ] **Step 1: 创建 JenkinsClient 类**

```typescript
import type { JobInfo, BuildInfo, JenkinsResponse } from '../types'
import { generateBasicAuth, normalizeJenkinsUrl } from './auth'

export class JenkinsClient {
  private baseUrl: string
  private auth: string
  private crumb: string | null = null

  constructor(baseUrl: string, username: string, apiToken: string) {
    this.baseUrl = normalizeJenkinsUrl(baseUrl)
    this.auth = generateBasicAuth(username, apiToken)
  }

  /**
   * 设置 CSRF Crumb
   */
  setCrumb(crumb: string) {
    this.crumb = crumb
  }

  /**
   * 获取 CSRF Crumb
   */
  async fetchCrumb(): Promise<JenkinsResponse<string>> {
    try {
      const response = await fetch(`${this.baseUrl}crumbIssuer/api/json`, {
        headers: {
          'Authorization': `Basic ${this.auth}`,
          'Accept': 'application/json'
        }
      })

      if (!response.ok) {
        // 403 可能是因为没有启用 Crumb，这是正常的
        if (response.status === 403) {
          return { data: null, error: null }
        }
        return { data: null, error: `HTTP ${response.status}` }
      }

      const data = await response.json()
      return { data: data.crumbRequestField === 'Jenkins-Crumb' ? data.crumb : null, error: null }
    } catch (e: any) {
      return { data: null, error: e.message }
    }
  }

  /**
   * 通用请求方法
   */
  private async request<T>(path: string, options: RequestInit = {}): Promise<JenkinsResponse<T>> {
    const headers: Record<string, string> = {
      'Authorization': `Basic ${this.auth}`,
      'Accept': 'application/json',
      ...(options.headers as Record<string, string> || {})
    }

    // 如果有 crumb 且是 POST 请求，添加 crumb 头
    if (this.crumb && options.method === 'POST') {
      headers['Jenkins-Crumb'] = this.crumb
    }

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        ...options,
        headers
      })

      if (response.status === 403) {
        // 尝试获取新的 crumb 并重试
        const crumbResult = await this.fetchCrumb()
        if (crumbResult.data) {
          this.crumb = crumbResult.data
          headers['Jenkins-Crumb'] = this.crumb
          const retryResponse = await fetch(`${this.baseUrl}${path}`, {
            ...options,
            headers
          })
          if (!retryResponse.ok) {
            return { data: null, error: `HTTP ${retryResponse.status}` }
          }
          const data = await retryResponse.json()
          return { data, error: null }
        }
      }

      if (!response.ok) {
        return { data: null, error: `HTTP ${response.status}` }
      }

      const data = await response.json()
      return { data, error: null }
    } catch (e: any) {
      return { data: null, error: e.message }
    }
  }

  /**
   * 测试连接
   */
  async testConnection(): Promise<JenkinsResponse<{ version: string }>> {
    return this.request<{ version: string }>('api/json')
  }

  /**
   * 获取 Jobs 列表
   */
  async getJobs(): Promise<JenkinsResponse<JobInfo[]>> {
    const result = await this.request<{ jobs: JobInfo[] }>(
      'api/json?tree=jobs[name,url,color,lastBuild[number,url,result,timestamp],_class,jobs[name,url,color,lastBuild[number,url,result,timestamp],_class,jobs[name,url,color,lastBuild[number,url,result,timestamp]]]'
    )

    if (result.error || !result.data) {
      return { data: null, error: result.error }
    }

    return { data: result.data.jobs || [], error: null }
  }

  /**
   * 获取指定 Job 的构建历史
   */
  async getBuilds(jobName: string): Promise<JenkinsResponse<BuildInfo[]>> {
    const encodedName = encodeURIComponent(jobName)
    const result = await this.request<{ builds: BuildInfo[] }>(
      `job/${encodedName}/api/json?tree=builds[number,url,result,building,duration,timestamp,displayName,fullDisplayName]{0,20}`
    )

    if (result.error || !result.data) {
      return { data: null, error: result.error }
    }

    return { data: result.data.builds || [], error: null }
  }

  /**
   * 触发构建
   */
  async triggerBuild(jobName: string): Promise<JenkinsResponse<void>> {
    const encodedName = encodeURIComponent(jobName)
    return this.request<void>(`job/${encodedName}/build`, {
      method: 'POST'
    })
  }

  /**
   * 获取队列状态
   */
  async getQueue(): Promise<JenkinsResponse<{ items: any[] }>> {
    return this.request<{ items: any[] }>('queue/api/json')
  }
}
```

---

## Chunk 3: Composables

### Task 6: 创建实例管理 Composable

**Files:**
- Create: `src/composables/useInstances.ts`

- [ ] **Step 1: 创建 useInstances.ts**

```typescript
import { ref, computed } from 'vue'
import type { JenkinsInstance } from '../types'
import { JenkinsClient } from '../utils/jenkins'
import { generateBasicAuth } from '../utils/auth'

// 内存缓存
const instances = ref<JenkinsInstance[]>([])
const currentInstanceId = ref<string | null>(null)
const clients = new Map<string, JenkinsClient>()

export function useInstances() {
  /**
   * 加载所有实例
   */
  const loadInstances = async () => {
    const docs = window.ztools.db.allDocs<JenkinsInstance>('instance_')
    instances.value = docs.map(doc => ({
      ...doc,
      ...doc._id ? { _id: doc._id } : {},
      ...doc.type ? { type: doc.type } : {}
    }))

    // 加载上次使用的实例
    const lastId = window.ztools.dbStorage.getItem<string>('lastInstanceId')
    if (lastId && instances.value.some(i => i._id === lastId)) {
      currentInstanceId.value = lastId
    } else if (instances.value.length > 0) {
      currentInstanceId.value = instances.value[0]._id
    }
  }

  /**
   * 获取当前实例
   */
  const currentInstance = computed(() => {
    return instances.value.find(i => i._id === currentInstanceId.value) || null
  })

  /**
   * 获取当前 JenkinsClient
   */
  const currentClient = computed(() => {
    if (!currentInstance.value) return null
    return getClient(currentInstance.value)
  })

  /**
   * 获取或创建 JenkinsClient
   */
  const getClient = (instance: JenkinsInstance): JenkinsClient => {
    if (!clients.has(instance._id)) {
      clients.set(instance._id, new JenkinsClient(instance.url, instance.username, instance.apiToken))
    }
    return clients.get(instance._id)!
  }

  /**
   * 切换当前实例
   */
  const switchInstance = (instanceId: string) => {
    currentInstanceId.value = instanceId
    window.ztools.dbStorage.setItem('lastInstanceId', instanceId)
  }

  /**
   * 添加实例
   */
  const addInstance = async (data: Omit<JenkinsInstance, '_id' | 'type' | 'createdAt' | 'updatedAt'>): Promise<{ success: boolean; error?: string }> => {
    // 验证连接
    const client = new JenkinsClient(data.url, data.username, data.apiToken)
    const testResult = await client.testConnection()

    if (testResult.error) {
      return { success: false, error: `连接失败: ${testResult.error}` }
    }

    const instance: JenkinsInstance = {
      _id: `instance_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type: 'jenkins-instance',
      ...data,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }

    window.ztools.db.put(instance)
    instances.value.push(instance)

    if (!currentInstanceId.value) {
      switchInstance(instance._id)
    }

    return { success: true }
  }

  /**
   * 更新实例
   */
  const updateInstance = async (id: string, data: Partial<JenkinsInstance>): Promise<{ success: boolean; error?: string }> => {
    const instance = instances.value.find(i => i._id === id)
    if (!instance) {
      return { success: false, error: '实例不存在' }
    }

    // 如果 URL/用户名/Token 变化，验证新连接
    if (data.url || data.username || data.apiToken) {
      const client = new JenkinsClient(
        data.url || instance.url,
        data.username || instance.username,
        data.apiToken || instance.apiToken
      )
      const testResult = await client.testConnection()

      if (testResult.error) {
        return { success: false, error: `连接失败: ${testResult.error}` }
      }

      // 清除缓存的 client
      clients.delete(id)
    }

    const updated: JenkinsInstance = {
      ...instance,
      ...data,
      updatedAt: Date.now()
    }

    window.ztools.db.put(updated)
    const index = instances.value.findIndex(i => i._id === id)
    if (index !== -1) {
      instances.value[index] = updated
    }

    return { success: true }
  }

  /**
   * 删除实例
   */
  const deleteInstance = (id: string) => {
    window.ztools.db.remove(id)
    instances.value = instances.value.filter(i => i._id !== id)
    clients.delete(id)

    if (currentInstanceId.value === id) {
      currentInstanceId.value = instances.value.length > 0 ? instances.value[0]._id : null
      if (currentInstanceId.value) {
        window.ztools.dbStorage.setItem('lastInstanceId', currentInstanceId.value)
      } else {
        window.ztools.dbStorage.removeItem('lastInstanceId')
      }
    }
  }

  /**
   * 获取分组列表
   */
  const groups = computed(() => {
    const groupSet = new Set<string>()
    instances.value.forEach(i => {
      if (i.group) groupSet.add(i.group)
    })
    return Array.from(groupSet)
  })

  /**
   * 按分组获取实例
   */
  const instancesByGroup = computed(() => {
    const map = new Map<string, JenkinsInstance[]>()
    instances.value.forEach(i => {
      const group = i.group || '默认'
      if (!map.has(group)) map.set(group, [])
      map.get(group)!.push(i)
    })
    return map
  })

  return {
    instances,
    currentInstance,
    currentClient,
    groups,
    instancesByGroup,
    loadInstances,
    switchInstance,
    addInstance,
    updateInstance,
    deleteInstance,
    getClient
  }
}
```

### Task 7: 创建收藏管理 Composable

**Files:**
- Create: `src/composables/useFavorites.ts`

- [ ] **Step 1: 创建 useFavorites.ts**

```typescript
import { ref, computed } from 'vue'
import type { Favorite } from '../types'

const favorites = ref<Favorite[]>([])

export function useFavorites() {
  /**
   * 加载所有收藏
   */
  const loadFavorites = () => {
    const docs = window.ztools.db.allDocs<Favorite>('fav_')
    favorites.value = docs.map(doc => ({
      ...doc,
      type: 'favorite' as const
    }))
  }

  /**
   * 检查是否已收藏
   */
  const isFavorited = (instanceId: string, jobName: string): boolean => {
    return favorites.value.some(
      f => f.instanceId === instanceId && f.jobName === jobName
    )
  }

  /**
   * 添加收藏
   */
  const addFavorite = (instanceId: string, instanceName: string, jobName: string): boolean => {
    if (isFavorited(instanceId, jobName)) {
      return false
    }

    const favorite: Favorite = {
      _id: `fav_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type: 'favorite',
      instanceId,
      instanceName,
      jobName,
      addedAt: Date.now()
    }

    window.ztools.db.put(favorite)
    favorites.value.push(favorite)
    return true
  }

  /**
   * 移除收藏
   */
  const removeFavorite = (instanceId: string, jobName: string): boolean => {
    const index = favorites.value.findIndex(
      f => f.instanceId === instanceId && f.jobName === jobName
    )

    if (index === -1) return false

    const favorite = favorites.value[index]
    window.ztools.db.remove(favorite)
    favorites.value.splice(index, 1)
    return true
  }

  /**
   * 切换收藏状态
   */
  const toggleFavorite = (instanceId: string, instanceName: string, jobName: string): boolean => {
    if (isFavorited(instanceId, jobName)) {
      removeFavorite(instanceId, jobName)
      return false
    } else {
      addFavorite(instanceId, instanceName, jobName)
      return true
    }
  }

  /**
   * 按实例筛选收藏
   */
  const favoritesByInstance = computed(() => {
    return (instanceId: string) => favorites.value.filter(f => f.instanceId === instanceId)
  })

  /**
   * 获取收藏总数
   */
  const totalCount = computed(() => favorites.value.length)

  return {
    favorites,
    loadFavorites,
    isFavorited,
    addFavorite,
    removeFavorite,
    toggleFavorite,
    favoritesByInstance,
    totalCount
  }
}
```

### Task 8: 创建构建轮询 Composable

**Files:**
- Create: `src/composables/useBuildPolling.ts`

- [ ] **Step 1: 创建 useBuildPolling.ts**

```typescript
import { ref, onUnmounted } from 'vue'
import type { BuildInfo } from '../types'
import { useInstances } from './useInstances'

let pollingInterval: ReturnType<typeof setInterval> | null = null
let currentPollingJob: string | null = null
let currentBuilds = ref<BuildInfo[]>([])

export function useBuildPolling() {
  const { currentClient, currentInstance } = useInstances()

  /**
   * 开始轮询指定 Job 的构建状态
   */
  const startPolling = (jobName: string, intervalMs = 10000) => {
    stopPolling()
    currentPollingJob = jobName

    // 立即获取一次
    fetchBuilds()

    // 设置轮询
    pollingInterval = setInterval(fetchBuilds, intervalMs)
  }

  /**
   * 停止轮询
   */
  const stopPolling = () => {
    if (pollingInterval) {
      clearInterval(pollingInterval)
      pollingInterval = null
    }
    currentPollingJob = null
  }

  /**
   * 获取构建列表
   */
  const fetchBuilds = async () => {
    if (!currentPollingJob || !currentClient.value) return

    const result = await currentClient.value.getBuilds(currentPollingJob)
    if (result.data) {
      currentBuilds.value = result.data
    }
  }

  /**
   * 检查是否有正在运行中的构建
   */
  const hasBuilding = () => {
    return currentBuilds.value.some(b => b.building)
  }

  /**
   * 获取最后完成的构建（状态不再是 building）
   */
  const getLastCompletedBuild = (): BuildInfo | null => {
    const completed = currentBuilds.value.filter(b => !b.building)
    return completed.length > 0 ? completed[0] : null
  }

  /**
   * 清理
   */
  onUnmounted(() => {
    stopPolling()
  })

  return {
    currentBuilds,
    startPolling,
    stopPolling,
    hasBuilding,
    getLastCompletedBuild,
    fetchBuilds
  }
}
```

---

## Chunk 4: UI 组件

### Task 9: 创建侧边栏组件

**Files:**
- Create: `src/components/Sidebar.vue`

- [ ] **Step 1: 创建 Sidebar.vue**

```vue
<template>
  <aside class="sidebar">
    <div class="sidebar-header">
      <h1 class="logo">Jenkins Lite</h1>
    </div>

    <nav class="sidebar-nav">
      <!-- 实例列表 -->
      <div class="nav-section">
        <div class="nav-section-title">实例</div>
        <div
          v-for="(insts, group) in instancesByGroup"
          :key="group"
          class="nav-group"
        >
          <div v-if="instancesByGroup.size > 1" class="nav-group-title">{{ group }}</div>
          <div
            v-for="instance in insts"
            :key="instance._id"
            class="nav-item"
            :class="{ active: currentInstance?._id === instance._id }"
            @click="switchInstance(instance._id)"
          >
            <span class="nav-icon">🖥️</span>
            <span class="nav-label">{{ instance.name }}</span>
          </div>
        </div>
        <div v-if="instances.length === 0" class="nav-empty">
          暂无实例，请点击右上角添加
        </div>
      </div>

      <!-- 收藏列表 -->
      <div class="nav-section">
        <div class="nav-section-title">收藏</div>
        <div
          v-for="fav in favorites"
          :key="fav._id"
          class="nav-item"
          :class="{ active: isActiveFavorite(fav) }"
          @click="handleFavoriteClick(fav)"
        >
          <span class="nav-icon">⭐</span>
          <span class="nav-label">{{ fav.jobName }}</span>
        </div>
        <div v-if="favorites.length === 0" class="nav-empty">
          暂无收藏
        </div>
      </div>
    </nav>

    <div class="sidebar-footer">
      <div class="version">v1.0.0</div>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { useInstances } from '../composables/useInstances'
import { useFavorites } from '../composables/useFavorites'
import type { Favorite } from '../types'

const emit = defineEmits<{
  (e: 'favorite-click', fav: Favorite): void
}>()

const { instances, currentInstance, instancesByGroup, switchInstance } = useInstances()
const { favorites } = useFavorites()

const isActiveFavorite = (fav: Favorite) => {
  return currentInstance.value?._id === fav.instanceId
}

const handleFavoriteClick = (fav: Favorite) => {
  // 如果不在当前实例，切换实例
  if (currentInstance.value?._id !== fav.instanceId) {
    switchInstance(fav.instanceId)
  }
  emit('favorite-click', fav)
}
</script>

<style scoped>
.sidebar {
  width: 200px;
  height: 100%;
  background: var(--bg-secondary, #f5f5f5);
  border-right: 1px solid var(--border-color, #e0e0e0);
  display: flex;
  flex-direction: column;
}

.sidebar-header {
  padding: 16px;
  border-bottom: 1px solid var(--border-color, #e0e0e0);
}

.logo {
  font-size: 16px;
  font-weight: 600;
  margin: 0;
}

.sidebar-nav {
  flex: 1;
  overflow-y: auto;
  padding: 8px 0;
}

.nav-section {
  margin-bottom: 16px;
}

.nav-section-title {
  padding: 8px 16px 4px;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary, #666);
  text-transform: uppercase;
}

.nav-group-title {
  padding: 4px 16px;
  font-size: 12px;
  color: var(--text-secondary, #888);
}

.nav-item {
  display: flex;
  align-items: center;
  padding: 8px 16px;
  cursor: pointer;
  transition: background 0.2s;
}

.nav-item:hover {
  background: var(--bg-hover, rgba(0,0,0,0.05));
}

.nav-item.active {
  background: var(--primary-bg, rgba(0,120,212,0.1));
  color: var(--primary-color, #0078d4);
}

.nav-icon {
  width: 20px;
  margin-right: 8px;
  text-align: center;
}

.nav-label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
}

.nav-empty {
  padding: 8px 16px;
  font-size: 12px;
  color: var(--text-secondary, #999);
}

.sidebar-footer {
  padding: 12px 16px;
  border-top: 1px solid var(--border-color, #e0e0e0);
}

.version {
  font-size: 11px;
  color: var(--text-secondary, #999);
}
</style>
```

### Task 10: 创建 Jobs 列表组件

**Files:**
- Create: `src/components/JobsList.vue`

- [ ] **Step 1: 创建 JobsList.vue**

```vue
<template>
  <div class="jobs-list">
    <div class="jobs-header">
      <input
        v-model="searchQuery"
        type="text"
        class="search-input"
        placeholder="搜索 Jobs..."
      />
      <button class="refresh-btn" @click="refreshJobs" :disabled="loading">
        🔄
      </button>
    </div>

    <div class="jobs-content">
      <div v-if="loading" class="loading">
        加载中...
      </div>

      <div v-else-if="error" class="error">
        {{ error }}
      </div>

      <div v-else-if="filteredJobs.length === 0" class="empty">
        没有找到 Jobs
      </div>

      <div v-else class="jobs">
        <JobItem
          v-for="job in filteredJobs"
          :key="job.url"
          :job="job"
          :favorited="isFavorited(job.name)"
          @toggle-favorite="handleToggleFavorite(job)"
          @build="handleBuild(job)"
          @click="handleJobClick(job)"
        />
      </div>
    </div>

    <!-- 构建确认弹窗 -->
    <div v-if="buildConfirmJob" class="modal-overlay" @click.self="cancelBuild">
      <div class="modal">
        <div class="modal-header">确认构建</div>
        <div class="modal-body">
          确定要触发 <strong>{{ buildConfirmJob.name }}</strong> 的构建吗？
        </div>
        <div class="modal-footer">
          <button class="btn btn-default" @click="cancelBuild">取消</button>
          <button class="btn btn-primary" @click="confirmBuild" :disabled="building">
            {{ building ? '构建中...' : '确认构建' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import JobItem from './JobItem.vue'
import { useInstances } from '../composables/useInstances'
import { useFavorites } from '../composables/useFavorites'
import type { JobInfo } from '../types'

const props = defineProps<{
  selectedJob?: string
}>()

const emit = defineEmits<{
  (e: 'job-click', job: JobInfo): void
  (e: 'build-complete', result: { jobName: string; success: boolean }): void
}>()

const { currentInstance, currentClient, loadInstances } = useInstances()
const { isFavorited, toggleFavorite, loadFavorites } = useFavorites()

const jobs = ref<JobInfo[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const searchQuery = ref('')
const buildConfirmJob = ref<JobInfo | null>(null)
const building = ref(false)

/**
 * 加载 Jobs
 */
const loadJobs = async () => {
  if (!currentClient.value) {
    jobs.value = []
    return
  }

  loading.value = true
  error.value = null

  const result = await currentClient.value.getJobs()

  if (result.error) {
    error.value = result.error
    jobs.value = []
  } else {
    jobs.value = result.data || []
  }

  loading.value = false
}

/**
 * 刷新 Jobs
 */
const refreshJobs = () => {
  loadJobs()
}

/**
 * 过滤 Jobs
 */
const filteredJobs = computed(() => {
  if (!searchQuery.value) return jobs.value

  const query = searchQuery.value.toLowerCase()
  return filterJobsRecursive(jobs.value, query)
})

/**
 * 递归过滤 Jobs（包括 Folder 内的 Jobs）
 */
const filterJobsRecursive = (jobList: JobInfo[], query: string): JobInfo[] => {
  const result: JobInfo[] = []

  for (const job of jobList) {
    if (job.name.toLowerCase().includes(query)) {
      result.push(job)
    } else if (job.jobs && job.jobs.length > 0) {
      const filtered = filterJobsRecursive(job.jobs, query)
      if (filtered.length > 0) {
        result.push({
          ...job,
          jobs: filtered
        })
      }
    }
  }

  return result
}

/**
 * 处理收藏切换
 */
const handleToggleFavorite = (job: JobInfo) => {
  if (!currentInstance.value) return

  const instanceName = currentInstance.value.name
  const instanceId = currentInstance.value._id

  toggleFavorite(instanceId, instanceName, job.name)
}

/**
 * 处理构建
 */
const handleBuild = (job: JobInfo) => {
  buildConfirmJob.value = job
}

const cancelBuild = () => {
  buildConfirmJob.value = null
}

const confirmBuild = async () => {
  if (!buildConfirmJob.value || !currentClient.value) return

  building.value = true

  const result = await currentClient.value.triggerBuild(buildConfirmJob.value.name)

  building.value = false
  buildConfirmJob.value = null

  if (result.error) {
    window.ztools.showNotification(`构建触发失败: ${result.error}`, 'Jenkins Lite')
  } else {
    window.ztools.showNotification(`${buildConfirmJob.value?.name} 构建已触发`, 'Jenkins Lite')
    // 刷新 Jobs 列表以更新状态
    setTimeout(() => loadJobs(), 2000)
  }
}

/**
 * 处理 Job 点击
 */
const handleJobClick = (job: JobInfo) => {
  emit('job-click', job)
}

// 监听实例变化
watch(currentInstance, () => {
  loadJobs()
})

// 监听选中的 Job
watch(() => props.selectedJob, (newJob) => {
  if (newJob) {
    const job = findJob(jobs.value, newJob)
    if (job) {
      handleJobClick(job)
    }
  }
})

const findJob = (jobList: JobInfo[], name: string): JobInfo | null => {
  for (const job of jobList) {
    if (job.name === name) return job
    if (job.jobs) {
      const found = findJob(job.jobs, name)
      if (found) return found
    }
  }
  return null
}

onMounted(async () => {
  await loadInstances()
  loadFavorites()
  loadJobs()
})
</script>

<style scoped>
.jobs-list {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.jobs-header {
  display: flex;
  gap: 8px;
  padding: 12px;
  border-bottom: 1px solid var(--border-color, #e0e0e0);
}

.search-input {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 4px;
  font-size: 13px;
  background: var(--bg-color, #fff);
  color: var(--text-color, #333);
}

.search-input:focus {
  outline: none;
  border-color: var(--primary-color, #0078d4);
}

.refresh-btn {
  padding: 8px 12px;
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 4px;
  background: var(--bg-color, #fff);
  cursor: pointer;
  transition: background 0.2s;
}

.refresh-btn:hover:not(:disabled) {
  background: var(--bg-hover, #f0f0f0);
}

.refresh-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.jobs-content {
  flex: 1;
  overflow-y: auto;
}

.loading, .error, .empty {
  padding: 24px;
  text-align: center;
  color: var(--text-secondary, #666);
}

.error {
  color: #ff4d4f;
}

.jobs {
  padding: 8px;
}

.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal {
  background: var(--bg-color, #fff);
  border-radius: 8px;
  width: 320px;
  overflow: hidden;
}

.modal-header {
  padding: 16px;
  font-weight: 600;
  border-bottom: 1px solid var(--border-color, #e0e0e0);
}

.modal-body {
  padding: 24px 16px;
}

.modal-footer {
  padding: 12px 16px;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  border-top: 1px solid var(--border-color, #e0e0e0);
}

.btn {
  padding: 8px 16px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
}

.btn-default {
  background: var(--bg-color, #fff);
  border: 1px solid var(--border-color, #e0e0e0);
  color: var(--text-color, #333);
}

.btn-primary {
  background: var(--primary-color, #0078d4);
  border: 1px solid var(--primary-color, #0078d4);
  color: #fff;
}

.btn-primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
```

### Task 11: 创建 JobItem 组件

**Files:**
- Create: `src/components/JobItem.vue`

- [ ] **Step 1: 创建 JobItem.vue**

```vue
<template>
  <div class="job-item" @click="$emit('click')">
    <div class="job-info">
      <span
        class="job-status"
        :style="{ color: statusInfo.color }"
      >
        {{ statusInfo.icon }}
      </span>
      <span class="job-name">{{ job.name }}</span>
    </div>

    <div class="job-actions">
      <button
        class="action-btn favorite-btn"
        :class="{ active: favorited }"
        @click.stop="$emit('toggle-favorite')"
        :title="favorited ? '取消收藏' : '添加收藏'"
      >
        {{ favorited ? '⭐' : '☆' }}
      </button>
      <button
        class="action-btn build-btn"
        @click.stop="$emit('build')"
        title="触发构建"
      >
        ▶
      </button>
    </div>

    <!-- 子 Jobs（Folder 展开） -->
    <div v-if="job.jobs && job.jobs.length > 0 && expanded" class="job-children">
      <JobItem
        v-for="child in job.jobs"
        :key="child.url"
        :job="child"
        :favorited="isChildFavorited(child.name)"
        @toggle-favorite="$emit('toggle-favorite', child)"
        @build="$emit('build', child)"
        @click="$emit('click', child)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type { JobInfo } from '../types'
import { JOB_COLOR_MAP } from '../types'

const props = defineProps<{
  job: JobInfo
  favorited: boolean
}>()

defineEmits<{
  (e: 'toggle-favorite'): void
  (e: 'build'): void
  (e: 'click'): void
}>()

const expanded = ref(false)

/**
 * 获取状态信息
 */
const statusInfo = computed(() => {
  const colorKey = props.job.color?.replace('anime', '') || 'notbuilt'
  return JOB_COLOR_MAP[colorKey] || JOB_COLOR_MAP['notbuilt']
})

/**
 * 检查子 Job 是否已收藏
 */
const isChildFavorited = (name: string) => {
  // 这里需要从父组件传递，但为了简化暂时返回 false
  return false
}
</script>

<style scoped>
.job-item {
  display: flex;
  align-items: center;
  padding: 10px 12px;
  margin-bottom: 4px;
  background: var(--bg-color, #fff);
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.2s;
}

.job-item:hover {
  background: var(--bg-hover, #f5f5f5);
}

.job-info {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  overflow: hidden;
}

.job-status {
  font-size: 12px;
  width: 16px;
  text-align: center;
}

.job-name {
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.job-actions {
  display: flex;
  gap: 4px;
  opacity: 0;
  transition: opacity 0.2s;
}

.job-item:hover .job-actions {
  opacity: 1;
}

.action-btn {
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 4px;
  background: transparent;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  transition: background 0.2s;
}

.action-btn:hover {
  background: var(--bg-secondary, #f0f0f0);
}

.favorite-btn.active {
  color: #faad14;
}

.build-btn {
  color: var(--primary-color, #0078d4);
}

.job-children {
  margin-left: 16px;
  margin-top: 4px;
}
</style>
```

### Task 12: 创建构建历史组件

**Files:**
- Create: `src/components/BuildHistory.vue`

- [ ] **Step 1: 创建 BuildHistory.vue**

```vue
<template>
  <div class="build-history">
    <div class="history-header">
      <h3>构建历史</h3>
      <button class="refresh-btn" @click="refresh" :disabled="loading">
        🔄
      </button>
    </div>

    <div v-if="!selectedJob" class="empty">
      选择一个 Job 查看构建历史
    </div>

    <div v-else-if="loading" class="loading">
      加载中...
    </div>

    <div v-else-if="error" class="error">
      {{ error }}
    </div>

    <div v-else-if="builds.length === 0" class="empty">
      暂无构建记录
    </div>

    <div v-else class="builds">
      <div
        v-for="build in builds"
        :key="build.number"
        class="build-item"
        @click="openBuild(build.url)"
      >
        <div class="build-info">
          <span
            class="build-status"
            :class="getBuildClass(build)"
          >
            {{ getBuildIcon(build) }}
          </span>
          <span class="build-number">#{{ build.number }}</span>
          <span class="build-result">{{ getBuildResultText(build) }}</span>
        </div>
        <div class="build-meta">
          <span class="build-time">{{ formatTime(build.timestamp) }}</span>
          <span class="build-link">→</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue'
import type { BuildInfo } from '../types'
import { useInstances } from '../composables/useInstances'
import { useBuildPolling } from '../composables/useBuildPolling'

const props = defineProps<{
  selectedJob?: string
}>()

const { currentClient } = useInstances()
const { currentBuilds, startPolling, stopPolling } = useBuildPolling()

const builds = ref<BuildInfo[]>([])
const loading = ref(false)
const error = ref<string | null>(null)

/**
 * 加载构建历史
 */
const loadBuilds = async () => {
  if (!props.selectedJob || !currentClient.value) {
    builds.value = []
    return
  }

  loading.value = true
  error.value = null

  const result = await currentClient.value.getBuilds(props.selectedJob)

  if (result.error) {
    error.value = result.error
    builds.value = []
  } else {
    builds.value = result.data || []
  }

  loading.value = false
}

/**
 * 刷新
 */
const refresh = () => {
  loadBuilds()
}

/**
 * 获取构建样式类
 */
const getBuildClass = (build: BuildInfo): string => {
  if (build.building) return 'building'
  if (build.result === 'SUCCESS') return 'success'
  if (build.result === 'FAILURE') return 'failure'
  if (build.result === 'UNSTABLE') return 'unstable'
  if (build.result === 'ABORTED') return 'aborted'
  return ''
}

/**
 * 获取构建图标
 */
const getBuildIcon = (build: BuildInfo): string => {
  if (build.building) return '⏳'
  if (build.result === 'SUCCESS') return '✅'
  if (build.result === 'FAILURE') return '❌'
  if (build.result === 'UNSTABLE') return '⚠️'
  if (build.result === 'ABORTED') return '⏹️'
  return '⚪'
}

/**
 * 获取构建结果文本
 */
const getBuildResultText = (build: BuildInfo): string => {
  if (build.building) return '运行中'
  if (build.result === 'SUCCESS') return '成功'
  if (build.result === 'FAILURE') return '失败'
  if (build.result === 'UNSTABLE') return '不稳定'
  if (build.result === 'ABORTED') return '中止'
  return ''
}

/**
 * 格式化时间
 */
const formatTime = (timestamp: number): string => {
  const diff = Date.now() - timestamp
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)

  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes}分钟前`
  if (hours < 24) return `${hours}小时前`
  return `${days}天前`
}

/**
 * 打开构建页面
 */
const openBuild = (url: string) => {
  window.ztools.shellOpenExternal(url)
}

// 监听选中 Job 变化
watch(() => props.selectedJob, (job) => {
  if (job) {
    loadBuilds()
    startPolling(job)
  } else {
    stopPolling()
    builds.value = []
  }
})

// 监听轮询结果变化
watch(currentBuilds, (newBuilds) => {
  if (newBuilds.length > 0) {
    builds.value = newBuilds
  }
})

onUnmounted(() => {
  stopPolling()
})
</script>

<style scoped>
.build-history {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.history-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px;
  border-bottom: 1px solid var(--border-color, #e0e0e0);
}

.history-header h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}

.refresh-btn {
  padding: 4px 8px;
  border: none;
  background: transparent;
  cursor: pointer;
  border-radius: 4px;
}

.refresh-btn:hover:not(:disabled) {
  background: var(--bg-hover, #f0f0f0);
}

.refresh-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.empty, .loading, .error {
  padding: 24px;
  text-align: center;
  color: var(--text-secondary, #666);
  font-size: 13px;
}

.error {
  color: #ff4d4f;
}

.builds {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.build-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  margin-bottom: 4px;
  background: var(--bg-color, #fff);
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.2s;
}

.build-item:hover {
  background: var(--bg-hover, #f5f5f5);
}

.build-info {
  display: flex;
  align-items: center;
  gap: 8px;
}

.build-status {
  font-size: 12px;
}

.build-status.success { color: #52c41a; }
.build-status.failure { color: #ff4d4f; }
.build-status.unstable { color: #faad14; }
.build-status.aborted { color: #8c8c8c; }
.build-status.building { color: #1890ff; }

.build-number {
  font-weight: 500;
  font-size: 13px;
}

.build-result {
  font-size: 12px;
  color: var(--text-secondary, #666);
}

.build-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text-secondary, #999);
  font-size: 12px;
}

.build-link {
  opacity: 0;
  transition: opacity 0.2s;
}

.build-item:hover .build-link {
  opacity: 1;
}
</style>
```

### Task 13: 构建设置弹窗组件

**Files:**
- Create: `src/components/SettingsModal.vue`

- [ ] **Step 1: 创建 SettingsModal.vue**

```vue
<template>
  <div v-if="show" class="modal-overlay" @click.self="$emit('close')">
    <div class="modal settings-modal">
      <div class="modal-header">
        <h2>设置</h2>
        <button class="close-btn" @click="$emit('close')">×</button>
      </div>

      <div class="modal-body">
        <!-- 添加实例 -->
        <div class="settings-section">
          <h3>添加 Jenkins 实例</h3>
          <form @submit.prevent="handleAddInstance">
            <div class="form-group">
              <label>显示名称</label>
              <input
                v-model="form.name"
                type="text"
                placeholder="例如：测试环境-Jenkins"
                required
              />
            </div>

            <div class="form-group">
              <label>实例分组</label>
              <input
                v-model="form.group"
                type="text"
                placeholder="例如：测试环境"
              />
            </div>

            <div class="form-group">
              <label>Jenkins URL</label>
              <input
                v-model="form.url"
                type="url"
                placeholder="https://jenkins.example.com"
                required
              />
            </div>

            <div class="form-group">
              <label>用户名</label>
              <input
                v-model="form.username"
                type="text"
                placeholder="Jenkins 用户名"
                required
              />
            </div>

            <div class="form-group">
              <label>API Token</label>
              <input
                v-model="form.apiToken"
                type="password"
                placeholder="Jenkins API Token"
                required
              />
              <span class="help-text">
                获取方式：登录 Jenkins → 用户 → Configure → API Token
              </span>
            </div>

            <div v-if="formError" class="error-text">{{ formError }}</div>

            <button type="submit" class="btn btn-primary" :disabled="formLoading">
              {{ formLoading ? '验证中...' : '添加并测试连接' }}
            </button>
          </form>
        </div>

        <!-- 实例列表 -->
        <div class="settings-section">
          <h3>已配置的实例</h3>
          <div v-if="instances.length === 0" class="empty-text">
            暂无已配置的实例
          </div>
          <div v-else class="instance-list">
            <div
              v-for="instance in instances"
              :key="instance._id"
              class="instance-item"
            >
              <div class="instance-info">
                <span class="instance-name">{{ instance.name }}</span>
                <span class="instance-url">{{ instance.url }}</span>
              </div>
              <button
                class="btn btn-danger btn-sm"
                @click="handleDeleteInstance(instance._id)"
              >
                删除
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive } from 'vue'
import { useInstances } from '../composables/useInstances'
import type { JenkinsInstance } from '../types'

defineProps<{
  show: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

const { instances, addInstance, deleteInstance, loadInstances } = useInstances()

const form = reactive({
  name: '',
  group: '',
  url: '',
  username: '',
  apiToken: ''
})

const formLoading = ref(false)
const formError = ref<string | null>(null)

/**
 * 添加实例
 */
const handleAddInstance = async () => {
  formLoading.value = true
  formError.value = null

  const result = await addInstance({
    name: form.name,
    group: form.group,
    url: form.url,
    username: form.username,
    apiToken: form.apiToken
  })

  formLoading.value = false

  if (result.success) {
    // 清空表单
    form.name = ''
    form.group = ''
    form.url = ''
    form.username = ''
    form.apiToken = ''
    window.ztools.showNotification('实例添加成功', 'Jenkins Lite')
  } else {
    formError.value = result.error || '添加失败'
  }
}

/**
 * 删除实例
 */
const handleDeleteInstance = (id: string) => {
  if (confirm('确定要删除这个实例吗？')) {
    deleteInstance(id)
    window.ztools.showNotification('实例已删除', 'Jenkins Lite')
  }
}
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.settings-modal {
  background: var(--bg-color, #fff);
  border-radius: 8px;
  width: 480px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-color, #e0e0e0);
}

.modal-header h2 {
  margin: 0;
  font-size: 18px;
}

.close-btn {
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  font-size: 20px;
  cursor: pointer;
  border-radius: 4px;
}

.close-btn:hover {
  background: var(--bg-hover, #f0f0f0);
}

.modal-body {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
}

.settings-section {
  margin-bottom: 24px;
}

.settings-section:last-child {
  margin-bottom: 0;
}

.settings-section h3 {
  margin: 0 0 12px;
  font-size: 14px;
  font-weight: 600;
}

.form-group {
  margin-bottom: 16px;
}

.form-group label {
  display: block;
  margin-bottom: 6px;
  font-size: 13px;
  font-weight: 500;
}

.form-group input {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 4px;
  font-size: 13px;
  box-sizing: border-box;
}

.form-group input:focus {
  outline: none;
  border-color: var(--primary-color, #0078d4);
}

.help-text {
  display: block;
  margin-top: 4px;
  font-size: 11px;
  color: var(--text-secondary, #888);
}

.error-text {
  margin-bottom: 12px;
  padding: 8px 12px;
  background: #fff2f0;
  border: 1px solid #ffccc7;
  border-radius: 4px;
  color: #ff4d4f;
  font-size: 13px;
}

.btn {
  padding: 8px 16px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
}

.btn-primary {
  background: var(--primary-color, #0078d4);
  border: 1px solid var(--primary-color, #0078d4);
  color: #fff;
}

.btn-primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-danger {
  background: #fff;
  border: 1px solid #ff4d4f;
  color: #ff4d4f;
}

.btn-danger:hover {
  background: #fff2f0;
}

.btn-sm {
  padding: 4px 12px;
  font-size: 12px;
}

.empty-text {
  padding: 16px;
  text-align: center;
  color: var(--text-secondary, #888);
  font-size: 13px;
}

.instance-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.instance-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px;
  background: var(--bg-secondary, #f5f5f5);
  border-radius: 6px;
}

.instance-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.instance-name {
  font-weight: 500;
  font-size: 13px;
}

.instance-url {
  font-size: 11px;
  color: var(--text-secondary, #888);
}
</style>
```

---

## Chunk 5: 主组件整合

### Task 14: 更新 App.vue

**Files:**
- Modify: `src/App.vue`

- [ ] **Step 1: 重写 App.vue**

```vue
<script setup lang="ts">
import { ref, onMounted } from 'vue'
import Sidebar from './components/Sidebar.vue'
import JobsList from './components/JobsList.vue'
import BuildHistory from './components/BuildHistory.vue'
import SettingsModal from './components/SettingsModal.vue'
import { useInstances } from './composables/useInstances'
import { useFavorites } from './composables/useFavorites'
import type { JobInfo, Favorite } from './types'

const { loadInstances, currentInstance } = useInstances()
const { loadFavorites } = useFavorites()

const selectedJob = ref<string | undefined>(undefined)
const showSettings = ref(false)

/**
 * 处理收藏点击
 */
const handleFavoriteClick = (fav: Favorite) => {
  selectedJob.value = fav.jobName
}

/**
 * 处理 Job 点击
 */
const handleJobClick = (job: JobInfo) => {
  selectedJob.value = job.name
}

/**
 * 处理构建完成
 */
const handleBuildComplete = (result: { jobName: string; success: boolean }) => {
  // 构建完成通知由 JobsList 组件处理
}

onMounted(async () => {
  await loadInstances()
  loadFavorites()
})
</script>

<template>
  <div class="app">
    <Sidebar @favorite-click="handleFavoriteClick" />

    <main class="main-content">
      <header class="content-header">
        <div class="header-left">
          <h2 v-if="currentInstance">{{ currentInstance.name }}</h2>
          <h2 v-else>Jenkins Lite</h2>
        </div>
        <div class="header-right">
          <button class="header-btn" @click="showSettings = true" title="设置">
            ⚙️
          </button>
        </div>
      </header>

      <div class="content-body">
        <div class="jobs-panel">
          <JobsList
            :selected-job="selectedJob"
            @job-click="handleJobClick"
            @build-complete="handleBuildComplete"
          />
        </div>

        <div class="history-panel">
          <BuildHistory :selected-job="selectedJob" />
        </div>
      </div>
    </main>

    <SettingsModal :show="showSettings" @close="showSettings = false" />
  </div>
</template>

<style>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html, body, #app {
  height: 100%;
  width: 100%;
  overflow: hidden;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
  font-size: 14px;
  line-height: 1.5;
  color: var(--text-color, #333);
  background: var(--bg-color, #fff);
}

@media (prefers-color-scheme: dark) {
  body {
    --bg-color: #1e1e1e;
    --bg-secondary: #252526;
    --bg-hover: rgba(255,255,255,0.05);
    --text-color: #cccccc;
    --text-secondary: #888888;
    --border-color: #404040;
    --primary-color: #0078d4;
    --primary-bg: rgba(0,120,212,0.15);
  }
}
</style>

<style scoped>
.app {
  display: flex;
  height: 100%;
  width: 100%;
}

.main-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.content-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-color, #e0e0e0);
}

.header-left h2 {
  font-size: 16px;
  font-weight: 600;
}

.header-right {
  display: flex;
  gap: 8px;
}

.header-btn {
  width: 32px;
  height: 32px;
  border: none;
  background: transparent;
  border-radius: 4px;
  cursor: pointer;
  font-size: 16px;
  transition: background 0.2s;
}

.header-btn:hover {
  background: var(--bg-hover, #f0f0f0);
}

.content-body {
  flex: 1;
  display: flex;
  overflow: hidden;
}

.jobs-panel {
  flex: 1;
  overflow: hidden;
  border-right: 1px solid var(--border-color, #e0e0e0);
}

.history-panel {
  width: 300px;
  overflow: hidden;
}
</style>
```

### Task 15: 更新 main.css

**Files:**
- Modify: `src/main.css`

- [ ] **Step 1: 更新全局样式**

```css
:root {
  --bg-color: #ffffff;
  --bg-secondary: #f5f5f5;
  --bg-hover: rgba(0, 0, 0, 0.05);
  --text-color: #333333;
  --text-secondary: #666666;
  --border-color: #e0e0e0;
  --primary-color: #0078d4;
  --primary-bg: rgba(0, 120, 212, 0.1);
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg-color: #1e1e1e;
    --bg-secondary: #252526;
    --bg-hover: rgba(255, 255, 255, 0.05);
    --text-color: #cccccc;
    --text-secondary: #888888;
    --border-color: #404040;
  }
}

body {
  margin: 0;
  padding: 0;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  font-size: 14px;
  line-height: 1.5;
  color: var(--text-color);
  background: var(--bg-color);
}

/* 滚动条样式 */
::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

::-webkit-scrollbar-track {
  background: transparent;
}

::-webkit-scrollbar-thumb {
  background: var(--border-color);
  border-radius: 4px;
}

::-webkit-scrollbar-thumb:hover {
  background: var(--text-secondary);
}

/* 选中文字样式 */
::selection {
  background: var(--primary-bg);
  color: var(--primary-color);
}
```

---

## Chunk 6: 插件配置更新

### Task 16: 更新 plugin.json

**Files:**
- Modify: `public/plugin.json`

- [ ] **Step 1: 更新插件配置**

```json
{
  "$schema": "node_modules/@ztools-center/ztools-api-types/resource/ztools.schema.json",
  "name": "ztools-jenkins",
  "title": "Jenkins Lite",
  "description": "Jenkins Lite 一款轻量级的 Jenkins 辅助工具。告别繁琐的网页操作，插件提供实时查询与一键构建功能，帮助开发者快速检索任务状态、监控构建进度并秒级触发构建，显著提升 CI/CD 工作效率。",
  "author": "KangKang",
  "version": "1.0.0",
  "main": "index.html",
  "preload": "preload/services.js",
  "logo": "logo.png",
  "development": {
    "main": "http://localhost:5173"
  },
  "features": [
    {
      "code": "jenkins",
      "explain": "Jenkins 快速触发构建与状态查询",
      "icon": "logo.png",
      "cmds": ["jenkins", "Jenkins"]
    },
    {
      "code": "jenkins-build",
      "explain": "触发 Jenkins 构建",
      "icon": "logo.png",
      "cmds": ["构建", "build"]
    },
    {
      "code": "jenkins-favorite",
      "explain": "收藏的 Jenkins Jobs",
      "icon": "logo.png",
      "cmds": ["jenkins收藏", "jenkins-fav"]
    }
  ]
}
```

---

## Chunk 7: 测试与验证

### Task 17: 本地测试

- [ ] **Step 1: 安装依赖**

```bash
cd "/Users/kangshaoqi/自研项目/ztools 插件/ztools-jenkins"
npm install
```

- [ ] **Step 2: 启动开发服务器**

```bash
npm run dev
```

- [ ] **Step 3: 在 ZTools 中测试**
- 打开 ZTools 开发者工具
- 输入 `jenkins` 触发插件
- 添加 Jenkins 实例进行测试

### Task 18: 构建生产版本

- [ ] **Step 1: 构建**

```bash
npm run build
```

- [ ] **Step 2: 复制到 ZTools 插件目录**

将 `dist/` 目录内容复制到 ZTools 插件目录进行测试

---

## 执行顺序

1. **Chunk 1**: 项目初始化与类型定义
2. **Chunk 2**: Jenkins API 客户端
3. **Chunk 3**: Composables
4. **Chunk 4**: UI 组件
5. **Chunk 5**: 主组件整合
6. **Chunk 6**: 插件配置更新
7. **Chunk 7**: 测试与验证
