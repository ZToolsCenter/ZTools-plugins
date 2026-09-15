# Docker Lite 核心容器管理 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 Docker Lite 插件的核心容器管理：容器列表（启停状态）、端口/目录映射、启停操作、实时日志。

**Architecture:** 所有 Docker 操作收敛在 preload 的 `public/preload/docker.js`（child_process 调 docker CLI，解析 JSON），经 `services.js` 以 `window.services.docker.*` 暴露给渲染层。渲染层 Vue 双栏界面：左栏容器列表（3s 轮询），右栏详情/操作/实时日志。JSON 解析逻辑抽为纯函数供 vitest 单测。

**Tech Stack:** Vue 3 + Vite + TypeScript、Node.js child_process、vitest（唯一新增测试依赖）、ZTools `window.ztools` API。

**Design spec:** `docs/superpowers/specs/2026-08-14-ztools-docker-core-design.md`

---

## Chunk 1: 项目设置 + docker.js 纯函数解析 + 单测

### Task 1: 安装 vitest 并添加 test script

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 安装 vitest 为 devDependency**

```bash
cd "/Users/kangshaoqi/自研项目/ztools 插件/ztools-docker" && npm install -D vitest
```

- [ ] **Step 2: 在 package.json 的 scripts 中添加 test**

```json
"scripts": {
  "dev": "vite",
  "build": "vue-tsc && vite build",
  "test": "vitest run"
}
```

- [ ] **Step 3: 验证 vitest 可运行**

Run: `npx vitest run --passWithNoTests`
Expected: 输出 "No test files found" 且退出码 0

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add vitest for unit testing"
```

### Task 2: 写解析纯函数的失败测试（TDD）

**Files:**
- Create: `tests/docker.test.js`

- [ ] **Step 1: 编写测试**

```js
import { describe, it, expect } from 'vitest'
import {
  parseContainerList,
  parseInspect,
  classifyDockerError,
  classifyState
} from '../public/preload/docker.js'

describe('parseContainerList', () => {
  it('解析多行 docker ps --format json 输出', () => {
    const stdout = [
      '{"ID":"a1b2c3","Names":"nginx,/nginx","Image":"nginx:latest","Command":"nginx -g","CreatedAt":"2026-08-01 10:00:00","Ports":"0.0.0.0:80->80/tcp","Status":"Up 3 hours","State":"running"}',
      '{"ID":"d4e5f6","Names":"/mysql","Image":"mysql:8","Command":"docker-entrypoint.sh","CreatedAt":"2026-07-01 09:00:00","Ports":"","Status":"Exited (0) 2 days ago","State":"exited"}'
    ].join('\n')
    const list = parseContainerList(stdout)
    expect(list).toHaveLength(2)
    expect(list[0]).toMatchObject({ id: 'a1b2c3', name: 'nginx', state: 'running', status: 'Up 3 hours' })
    expect(list[1].name).toBe('mysql')
    expect(list[1].state).toBe('stopped')
  })

  it('空输出返回空数组', () => {
    expect(parseContainerList('')).toEqual([])
  })
})

describe('parseInspect', () => {
  const inspectJson = JSON.stringify([{
    Id: 'a1b2c3',
    Name: '/nginx',
    Config: { Image: 'nginx:latest' },
    Created: '2026-08-01T02:00:00Z',
    State: { Status: 'running' },
    NetworkSettings: { Ports: { '80/tcp': [{ HostIp: '0.0.0.0', HostPort: '80' }] } },
    Mounts: [{ Type: 'bind', Source: '/data', Destination: '/usr/share/nginx/html', Mode: '', RW: true }]
  }])
  it('解析端口与挂载', () => {
    const c = parseInspect(inspectJson)
    expect(c.name).toBe('nginx')
    expect(c.ports).toEqual([{ containerPort: '80/tcp', bindings: ['80'] }])
    expect(c.mounts).toEqual([{ type: 'bind', source: '/data', destination: '/usr/share/nginx/html', mode: '', rw: true }])
  })
  it('无端口/挂载时为空数组', () => {
    const bare = JSON.stringify([{ Name: '/x', Config: {}, State: { Status: 'exited' }, NetworkSettings: { Ports: {} }, Mounts: [] }])
    const c = parseInspect(bare)
    expect(c.ports).toEqual([])
    expect(c.mounts).toEqual([])
  })
})

describe('classifyDockerError', () => {
  it('ENOENT 识别为 DOCKER_NOT_FOUND', () => {
    const err = { code: 'ENOENT', message: 'spawn docker ENOENT' }
    expect(classifyDockerError(err).code).toBe('DOCKER_NOT_FOUND')
  })
  it('超时识别为操作超时', () => {
    const err = { killed: true, message: 'Command failed: docker start' }
    expect(classifyDockerError(err).message).toBe('操作超时')
  })
  it('daemon 未运行识别为 DAEMON_DOWN', () => {
    const err = { stderr: 'Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?' }
    expect(classifyDockerError(err).code).toBe('DAEMON_DOWN')
  })
  it('其他错误识别为 DOCKER_ERROR', () => {
    const err = { stderr: 'Error response from daemon: No such container' }
    expect(classifyDockerError(err).code).toBe('DOCKER_ERROR')
  })
})

describe('classifyState', () => {
  it('映射运行/暂停/停止', () => {
    expect(classifyState('running', 'Up')).toBe('running')
    expect(classifyState('paused', 'Up (Paused)')).toBe('paused')
    expect(classifyState('exited', 'Exited')).toBe('stopped')
    expect(classifyState('created', 'Created')).toBe('stopped')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test`
Expected: FAIL — 提示找不到模块 `../public/preload/docker.js`（文件尚未创建）

### Task 3: 实现解析纯函数

**Files:**
- Create: `public/preload/docker.js`（本期只含纯函数部分；命令执行层在 Chunk 2 追加）

- [ ] **Step 1: 创建 docker.js 纯函数部分**

```js
// public/preload/docker.js
// Docker 命令封装层：所有 Docker 操作收敛于此。
// 纯函数（parse*/classify*）从顶层导出，供 vitest 单测与 UI 层复用。

// ===== 纯函数解析 =====

// 逐行解析 `docker ps -a --format '{{json .}}'` 输出
function parseContainerList(stdout) {
  const lines = String(stdout || '').split('\n').filter((line) => line.trim())
  return lines.map((line) => {
    const raw = JSON.parse(line)
    return {
      id: raw.ID,
      names: raw.Names,
      name: (raw.Names || '').split(',')[0].replace(/^\//, ''),
      image: raw.Image,
      command: raw.Command,
      created: raw.CreatedAt,
      status: raw.Status,
      ports: raw.Ports,
      state: classifyState(raw.State, raw.Status)
    }
  })
}

// 将 docker State/Status 归一化为 running | paused | stopped
function classifyState(state, status) {
  if (state === 'paused') return 'paused'
  if (state === 'running') return 'running'
  if (/\(Paused\)/i.test(status || '')) return 'paused'
  return 'stopped'
}

// 解析 `docker inspect <id>` 输出，提取端口映射与目录挂载
function parseInspect(stdout) {
  const data = JSON.parse(stdout)[0]
  const ports = (data.NetworkSettings && data.NetworkSettings.Ports) || {}
  const mounts = data.Mounts || []
  return {
    id: data.Id,
    name: (data.Name || '').replace(/^\//, ''),
    image: data.Config && data.Config.Image,
    created: data.Created,
    state: data.State && data.State.Status,
    ports: Object.entries(ports).map(([containerPort, bindings]) => ({
      containerPort,
      bindings: (bindings || []).map((b) => b.HostPort)
    })),
    mounts: mounts.map((m) => ({
      type: m.Type,
      source: m.Source,
      destination: m.Destination,
      mode: m.Mode,
      rw: m.RW
    }))
  }
}

// 将 child_process 错误归一化为可展示的结构
function classifyDockerError(err) {
  const stderr = (err && (err.stderr || err.message || '')) || ''
  if (err && err.code === 'ENOENT') {
    return { code: 'DOCKER_NOT_FOUND', message: '未检测到 docker 命令' }
  }
  if (err && err.killed) {
    return { code: 'DOCKER_ERROR', message: '操作超时' }
  }
  if (/Cannot connect to the Docker daemon/.test(stderr)) {
    return { code: 'DAEMON_DOWN', message: stderr }
  }
  return { code: 'DOCKER_ERROR', message: stderr || err.message || 'docker 命令执行失败' }
}

module.exports = {
  parseContainerList,
  parseInspect,
  classifyDockerError,
  classifyState
}
```

- [ ] **Step 2: 运行测试确认通过**

Run: `npm test`
Expected: 4 个 describe 全部 PASS

- [ ] **Step 3: Commit**

```bash
git add tests/docker.test.js public/preload/docker.js
git commit -m "feat: docker ps/inspect 解析纯函数 + 单测"
```

## Chunk 2: 命令执行层 + services 桥接 + 类型 + 清理

### Task 4: 追加命令执行层到 docker.js

**Files:**
- Modify: `public/preload/docker.js`

- [ ] **Step 1: 在 docker.js 追加命令执行层（替换旧导出块）**

**将 Task 3 末尾的 `module.exports = {...}`（纯函数导出）整体删除，替换为以下内容**——追加命令执行层，并把 `...docker` 展开合并进导出。CJS 中最后一个赋值生效，若旧导出块残留，`require('./docker.js')` 将只返回纯函数，`window.services.docker.*` 全部为 undefined（静默故障，单测测不出来）。

```js
// ===== 命令执行层 =====
const { execFile, spawn } = require('node:child_process')

// 非流式：执行 docker 命令，15s 超时防挂死，统一返回 { ok, stdout } 或 { ok:false, error }
function run(args, { timeout = 15000 } = {}) {
  return new Promise((resolve) => {
    execFile('docker', args, { timeout, maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
      if (err) {
        resolve({ ok: false, error: classifyDockerError(err) })
      } else {
        resolve({ ok: true, stdout })
      }
    })
  })
}

// 清洗 ANSI 颜色码
function stripAnsi(text) {
  // eslint-disable-next-line no-control-regex
  return String(text).replace(/\x1b\[[0-9;]*m/g, '')
}

const docker = {
  async listContainers() {
    const res = await run(['ps', '-a', '--no-trunc', '--format', '{{json .}}'])
    if (!res.ok) return res
    return { ok: true, containers: parseContainerList(res.stdout) }
  },

  // 仅对运行中容器调用；停止容器在 UI 层跳过
  async inspectContainer(id) {
    const res = await run(['inspect', id])
    if (!res.ok) return res
    return { ok: true, container: parseInspect(res.stdout) }
  },

  async startContainer(id) {
    return run(['start', id])
  },

  async stopContainer(id) {
    return run(['stop', id])
  },

  async restartContainer(id) {
    return run(['restart', id])
  },

  async pauseContainer(id) {
    return run(['pause', id])
  },

  async unpauseContainer(id) {
    return run(['unpause', id])
  },

  async removeContainer(id) {
    return run(['rm', '-f', id])
  },

  // 流式：docker logs -f --tail 200，返回 { stop() } 句柄用于取消
  followLogs(id, onData, onError) {
    const child = spawn('docker', ['logs', '-f', '--tail', '200', id])
    let buffer = ''
    const flush = (chunk) => {
      buffer += chunk.toString()
      const lines = buffer.split('\n')
      buffer = lines.pop()
      lines.forEach((line) => onData && onData(stripAnsi(line)))
    }
    child.stdout.on('data', flush)
    child.stderr.on('data', flush)
    child.on('error', (err) => onError && onError(classifyDockerError(err)))
    child.on('close', (code) => onError && onError({ code: 'LOG_CLOSED', message: 'logs 进程已退出: ' + code }))
    return {
      stop() {
        try { child.kill() } catch (e) { /* 已退出则忽略 */ }
      }
    }
  }
}

module.exports = {
  ...docker,
  parseContainerList,
  parseInspect,
  classifyDockerError,
  classifyState,
  stripAnsi
}
```

- [ ] **Step 2: 运行测试确认纯函数仍通过（回归）**

Run: `npm test`
Expected: 全部 PASS

- [ ] **Step 3: Commit**

```bash
git add public/preload/docker.js
git commit -m "feat: docker 命令执行层（list/inspect/start/stop/restart/pause/unpause/rm/followLogs）"
```

### Task 5: services.js 桥接 + env.d.ts 类型 + 清理脚手架

**Files:**
- Modify: `public/preload/services.js`
- Modify: `src/env.d.ts`
- Modify: `src/App.vue`（本次先删旧组件引用，Chunk 3 再实现 containers 主页）
- Delete: `src/Hello/index.vue`, `src/Read/index.vue`, `src/Write/index.vue`
- Create: `src/types.ts`

- [ ] **Step 1: 重写 services.js 只暴露 docker**

```js
// public/preload/services.js
const docker = require('./docker.js')

window.services = { docker }
```

- [ ] **Step 2: 创建 src/types.ts**

```ts
// src/types.ts — docker 数据模型

export interface ContainerSummary {
  id: string
  names: string
  name: string
  image: string
  command: string
  created: string
  status: string
  ports: string
  state: 'running' | 'paused' | 'stopped'
}

export interface PortMapping {
  containerPort: string
  bindings: string[]
}

export interface MountMapping {
  type: string
  source: string
  destination: string
  mode: string
  rw: boolean
}

export interface ContainerDetail {
  id: string
  name: string
  image: string
  created: string
  state: string
  ports: PortMapping[]
  mounts: MountMapping[]
}

export type DockerErrorCode = 'DOCKER_NOT_FOUND' | 'DAEMON_DOWN' | 'DOCKER_ERROR' | 'LOG_CLOSED'

export interface DockerError {
  code: DockerErrorCode
  message: string
}

export type DockerResult<T> = ({ ok: true } & T) | { ok: false; error: DockerError }

export interface LogHandle {
  stop(): void
}
```

- [ ] **Step 3: 重写 env.d.ts**

```ts
/// <reference types="vite/client" />
/// <reference types="@ztools-center/ztools-api-types" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>
  export default component
}

import type { ContainerSummary, ContainerDetail, DockerResult, DockerError, LogHandle } from './types'

interface DockerService {
  listContainers(): Promise<DockerResult<{ containers: ContainerSummary[] }>>
  inspectContainer(id: string): Promise<DockerResult<{ container: ContainerDetail }>>
  startContainer(id: string): Promise<DockerResult<{}>>
  stopContainer(id: string): Promise<DockerResult<{}>>
  restartContainer(id: string): Promise<DockerResult<{}>>
  pauseContainer(id: string): Promise<DockerResult<{}>>
  unpauseContainer(id: string): Promise<DockerResult<{}>>
  removeContainer(id: string): Promise<DockerResult<{}>>
  followLogs(id: string, onData: (line: string) => void, onError: (err: DockerError) => void): LogHandle
}

interface Services {
  docker: DockerService
}

declare global {
  interface Window {
    services: Services
  }
}

export {}
```

- [ ] **Step 4: 删除脚手架组件**

```bash
rm -rf src/Hello src/Read src/Write
```

- [ ] **Step 5: 更新 App.vue（临时最小化占位，Chunk 3 再接 Containers）**

```vue
<script setup lang="ts">
import { ref } from 'vue'

const route = ref('containers')
</script>

<template>
  <div v-if="route === 'containers'" class="placeholder">Docker Lite 加载中…</div>
</template>
```

（保持本提交可编译运行：不 import 尚未创建的 Containers；Chunk 3 的 Task 8 会替换为最终路由逻辑。）

- [ ] **Step 6: 更新 public/plugin.json features**

```json
{
  "features": [
    {
      "code": "containers",
      "explain": "容器管理",
      "icon": "logo.png",
      "cmds": ["docker", "容器", "容器管理"]
    }
  ]
}
```

（其余字段 name/title/description/main/preload/logo/development 保持不变。）

- [ ] **Step 7: 更新 src/main.css 追加插件通用变量**

在 `:root` 中追加：

```css
:root {
  /* ...现有变量... */
  --panel-bg: rgba(0, 0, 0, 0.03);
  --border-color: rgba(0, 0, 0, 0.1);
  --text-secondary: rgba(0, 0, 0, 0.55);
  --ok: #34c759;
  --warn: #ff9500;
  --danger: #ff3b30;
}
@media (prefers-color-scheme: dark) {
  :root {
    --panel-bg: rgba(255, 255, 255, 0.06);
    --border-color: rgba(255, 255, 255, 0.12);
    --text-secondary: rgba(255, 255, 255, 0.55);
  }
}
```

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor: 清理脚手架，docker 服务桥接 + 类型定义 + containers 入口"
```

## Chunk 3: 双栏 UI（列表 + 详情 + 日志 + 错误处理）

### Task 6: 双栏主页 containers/index.vue

**Files:**
- Create: `src/Containers/index.vue`

- [ ] **Step 1: 实现双栏主页（轮询 + 选中管理 + 错误分类）**

```vue
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { ContainerSummary, DockerError } from '../types'
import ContainerList from './ContainerList.vue'
import ContainerDetail from './ContainerDetail.vue'

const containers = ref<ContainerSummary[]>([])
const selectedId = ref('')
const filter = ref('')
const fatalError = ref<DockerError | null>(null)   // DOCKER_NOT_FOUND / DAEMON_DOWN
const banner = ref('')                              // 轮询失败连续提示
const toast = ref('')

let pollTimer: ReturnType<typeof setInterval> | null = null
let pollFailCount = 0
let toastTimer: ReturnType<typeof setTimeout> | null = null

const filtered = computed(() => {
  const kw = filter.value.trim().toLowerCase()
  if (!kw) return containers.value
  return containers.value.filter((c) => c.name.toLowerCase().includes(kw))
})

const selected = computed(() => containers.value.find((c) => c.id === selectedId.value) || null)

async function fetchList() {
  const res = await window.services.docker.listContainers()
  if (res.ok) {
    pollFailCount = 0
    fatalError.value = null
    banner.value = ''
    // 保持选中项：若容器被删则清空选中
    if (selectedId.value && !res.containers.some((c) => c.id === selectedId.value)) {
      selectedId.value = res.containers[0]?.id || ''
    }
    if (!selectedId.value && res.containers.length) selectedId.value = res.containers[0].id
    containers.value = res.containers
  } else {
    if (res.error.code === 'DOCKER_NOT_FOUND') {
      fatalError.value = res.error
      containers.value = []
      selectedId.value = ''
    } else if (res.error.code === 'DAEMON_DOWN') {
      // spec §5：daemon 未运行 → 顶部横幅 + 空列表（非整页）
      banner.value = res.error.message
      containers.value = []
      selectedId.value = ''
    } else {
      pollFailCount += 1
      if (pollFailCount >= 3) {
        banner.value = res.error.message
      }
    }
  }
}

function showToast(msg: string) {
  toast.value = msg
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = ''), 3000)
}

async function runAction(action: 'start' | 'stop' | 'restart' | 'pause' | 'unpause' | 'remove') {
  if (!selectedId.value) return
  const id = selectedId.value
  const res = await window.services.docker[`${action}Container`](id)
  if (res.ok) {
    showToast('操作成功')
    await fetchList()
  } else {
    showToast(res.error.message)
  }
}

function onSelect(id: string) {
  selectedId.value = id
}

function onRefresh() {
  fetchList()
}

onMounted(() => {
  fetchList()
  pollTimer = setInterval(fetchList, 3000)
})

onBeforeUnmount(() => {
  if (pollTimer) clearInterval(pollTimer)
  if (toastTimer) clearTimeout(toastTimer)
})
</script>

<template>
  <div class="containers">
    <!-- 致命错误：仅 docker 命令不存在时整页引导 -->
    <div v-if="fatalError" class="fatal">
      <div class="fatal-icon">🐳</div>
      <h2>未检测到 Docker</h2>
      <p>{{ fatalError.message }}</p>
      <a href="https://www.docker.com/products/docker-desktop/" target="_blank" rel="noopener">安装 Docker Desktop</a>
    </div>

    <template v-else>
      <div class="toolbar">
        <span class="title">Docker Lite</span>
        <input v-model="filter" class="filter" placeholder="筛选容器名称…" />
        <button class="btn" @click="onRefresh">🔄 刷新</button>
      </div>

      <div v-if="banner" class="banner">{{ banner }}</div>

      <div class="split">
        <ContainerList
          :containers="filtered"
          :selected-id="selectedId"
          @select="onSelect"
        />
        <ContainerDetail
          v-if="selected"
          :container="selected"
          @action="runAction"
        />
        <div v-else class="empty-pane">选择左侧容器查看详情</div>
      </div>
    </template>

    <transition name="toast">
      <div v-if="toast" class="toast">{{ toast }}</div>
    </transition>
  </div>
</template>

<style scoped>
.containers {
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-color);
}
.title { font-weight: 600; margin-right: auto; }
.filter {
  width: 180px;
  padding: 4px 8px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--panel-bg);
  color: inherit;
}
.btn {
  border: 1px solid var(--border-color);
  background: var(--panel-bg);
  color: inherit;
  padding: 4px 10px;
  border-radius: 6px;
  cursor: pointer;
}
.btn:disabled { opacity: 0.4; cursor: not-allowed; }
.banner {
  background: rgba(255, 149, 0, 0.15);
  color: var(--warn);
  padding: 6px 12px;
  font-size: 12px;
}
.split {
  flex: 1;
  display: flex;
  min-height: 0;
}
.fatal {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--text-secondary);
}
.fatal-icon { font-size: 48px; }
.fatal a { color: var(--blue); }
.empty-pane {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary);
}
.toast {
  position: fixed;
  right: 16px;
  bottom: 16px;
  background: rgba(0, 0, 0, 0.8);
  color: #fff;
  padding: 8px 14px;
  border-radius: 8px;
  font-size: 13px;
  z-index: 10;
}
.toast-enter-active, .toast-leave-active { transition: opacity 0.2s; }
.toast-enter-from, .toast-leave-to { opacity: 0; }
</style>
```

- [ ] **Step 2: Commit（与 Task 8 合并提交）**

（因 ContainerList/ContainerDetail 尚未创建，本任务与 Task 7、Task 8 一起实现后统一提交。）

### Task 7: 左栏容器列表 ContainerList.vue

**Files:**
- Create: `src/Containers/ContainerList.vue`

- [ ] **Step 1: 实现左栏列表**

```vue
<script setup lang="ts">
import type { ContainerSummary } from '../types'

defineProps<{
  containers: ContainerSummary[]
  selectedId: string
}>()

defineEmits<{
  (e: 'select', id: string): void
}>()
</script>

<template>
  <div class="list">
    <div v-if="!containers.length" class="list-empty">暂无容器</div>
    <div
      v-for="c in containers"
      :key="c.id"
      class="item"
      :class="{ selected: c.id === selectedId, stopped: c.state !== 'running' }"
      @click="$emit('select', c.id)"
    >
      <div class="item-head">
        <span class="dot" :class="c.state"></span>
        <span class="name">{{ c.name }}</span>
        <span class="state-tag">{{ stateLabel(c.state) }}</span>
      </div>
      <div v-if="c.state === 'running' && c.ports" class="item-ports">{{ c.ports }}</div>
      <div v-else-if="c.state !== 'running'" class="item-status">{{ c.status }}</div>
    </div>
  </div>
</template>

<script lang="ts">
export function stateLabel(s: ContainerSummary['state']) {
  return s === 'running' ? '运行中' : s === 'paused' ? '已暂停' : '已停止'
}
</script>

<style scoped>
.list {
  width: 260px;
  border-right: 1px solid var(--border-color);
  overflow-y: auto;
  min-height: 0;
}
.item {
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-color);
  cursor: pointer;
}
.item:hover { background: var(--panel-bg); }
.item.selected { background: rgba(88, 164, 246, 0.12); }
.item.stopped { opacity: 0.6; }
.item-head { display: flex; align-items: center; gap: 6px; }
.dot {
  width: 8px; height: 8px; border-radius: 50%;
  flex-shrink: 0;
}
.dot.running { background: var(--ok); }
.dot.paused { background: var(--warn); }
.dot.stopped { background: var(--text-secondary); }
.name { font-weight: 500; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.state-tag { font-size: 11px; color: var(--text-secondary); }
.item-ports {
  font-size: 11px;
  color: var(--text-secondary);
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.item-status { font-size: 11px; color: var(--text-secondary); margin-top: 2px; }
.list-empty {
  padding: 24px;
  text-align: center;
  color: var(--text-secondary);
}
</style>
```

### Task 8: 右栏详情 ContainerDetail.vue（含 inspect 自管缓存 + 操作确认）

**Files:**
- Create: `src/Containers/ContainerDetail.vue`

- [ ] **Step 1: 实现右栏详情**

```vue
<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import type { ContainerSummary, ContainerDetail } from '../types'

const props = defineProps<{
  container: ContainerSummary
}>()

const emit = defineEmits<{
  (e: 'action', action: 'start' | 'stop' | 'restart' | 'pause' | 'unpause' | 'remove'): void
}>()

const detail = ref<ContainerDetail | null>(null)
const inFlight = ref<string | null>(null)   // 当前进行中的操作，防双击

// 仅对运行中容器加载 inspect 详情
watch(
  () => props.container.id,
  async (id) => {
    detail.value = null
    if (props.container.state === 'running') {
      const res = await window.services.docker.inspectContainer(id)
      if (res.ok) detail.value = res.container
    }
  },
  { immediate: true }
)

const actions = computed(() => {
  const s = props.container.state
  return [
    { key: 'start', label: '▶ 启动', disabled: s !== 'stopped' },
    { key: 'stop', label: '⏹ 停止', disabled: s === 'stopped' },
    { key: 'restart', label: '⟳ 重启', disabled: s === 'stopped' },
    { key: 'pause', label: '⏸ 暂停', disabled: s !== 'running' },
    { key: 'unpause', label: '⏵ 继续', disabled: s !== 'paused' },
    { key: 'remove', label: '🗑 删除', disabled: false, danger: true }
  ]
})

function onAction(key: string) {
  if (inFlight.value) return
  if (key === 'remove') {
    const ok = window.confirm(`确认删除容器 ${props.container.name}？此操作会强制终止容器。`)
    if (!ok) return
  }
  inFlight.value = key
  emit('action', key as any)
  setTimeout(() => (inFlight.value = null), 1500)  // 简化防抖：操作后短暂禁用
}
</script>

<template>
  <div class="detail">
    <div class="detail-head">
      <h3>{{ container.name }}</h3>
      <span class="state-tag" :class="container.state">{{ stateLabel(container.state) }}</span>
    </div>

    <div class="meta">
      <div><span class="k">镜像</span>{{ container.image }}</div>
      <div><span class="k">ID</span>{{ container.id.slice(0, 12) }}</div>
      <div><span class="k">状态</span>{{ container.status }}</div>
      <div><span class="k">创建</span>{{ container.created }}</div>
    </div>

    <div class="actions">
      <button
        v-for="a in actions"
        :key="a.key"
        class="act"
        :class="{ danger: a.danger, running: inFlight === a.key }"
        :disabled="a.disabled || !!inFlight"
        @click="onAction(a.key)"
      >
        {{ a.label }}
      </button>
    </div>

    <section class="panel">
      <h4>端口映射</h4>
      <template v-if="container.state !== 'running'">
        <div class="muted">未运行，无端口信息</div>
      </template>
      <template v-else-if="detail">
        <div v-if="!detail.ports.length" class="muted">无端口映射</div>
        <div v-for="p in detail.ports" :key="p.containerPort" class="map-row">
          <code>{{ p.containerPort }}</code>
          <span class="arrow">→</span>
          <code>{{ p.bindings.join(', ') || '未绑定' }}</code>
        </div>
      </template>
      <div v-else class="muted">加载中…</div>
    </section>

    <section class="panel">
      <h4>目录挂载</h4>
      <template v-if="container.state !== 'running'">
        <div class="muted">未运行，无挂载信息</div>
      </template>
      <template v-else-if="detail">
        <div v-if="!detail.mounts.length" class="muted">无目录挂载</div>
        <div v-for="(m, i) in detail.mounts" :key="i" class="map-row col">
          <code>{{ m.source }}</code>
          <span class="arrow">↓</span>
          <code>{{ m.destination }}</code>
          <span class="rw">{{ m.rw ? 'rw' : 'ro' }}</span>
        </div>
      </template>
      <div v-else class="muted">加载中…</div>
    </section>
  </div>
</template>

<script lang="ts">
export function stateLabel(s: string) {
  return s === 'running' ? '运行中' : s === 'paused' ? '已暂停' : '已停止'
}
</script>

<style scoped>
.detail {
  flex: 1;
  min-width: 0;
  padding: 16px 20px;
  overflow-y: auto;
}
.detail-head { display: flex; align-items: center; gap: 10px; }
.detail-head h3 { margin: 0; }
.state-tag {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 10px;
}
.state-tag.running { background: rgba(52, 199, 89, 0.15); color: var(--ok); }
.state-tag.paused { background: rgba(255, 149, 0, 0.15); color: var(--warn); }
.state-tag.stopped { background: var(--panel-bg); color: var(--text-secondary); }
.meta {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px 16px;
  margin: 12px 0;
  font-size: 13px;
}
.meta .k { color: var(--text-secondary); margin-right: 6px; }
.actions { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 16px; }
.act {
  border: 1px solid var(--border-color);
  background: var(--panel-bg);
  color: inherit;
  padding: 4px 10px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
}
.act.danger { border-color: var(--danger); color: var(--danger); }
.act:disabled { opacity: 0.4; cursor: not-allowed; }
.act.running { opacity: 0.6; }
.panel { margin-bottom: 16px; }
.panel h4 {
  margin: 0 0 6px;
  font-size: 12px;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.map-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  padding: 4px 0;
}
.map-row code {
  background: var(--panel-bg);
  padding: 2px 6px;
  border-radius: 4px;
}
.map-row.col { flex-direction: column; align-items: flex-start; }
.arrow { color: var(--text-secondary); }
.rw { font-size: 11px; color: var(--text-secondary); }
.muted { color: var(--text-secondary); font-size: 13px; }
</style>
```

- [ ] **Step 2: 完成 App.vue 路由逻辑（含 onPluginEnter/onPluginOut）**

```vue
<script setup lang="ts">
import { onMounted, ref } from 'vue'
import Containers from './Containers/index.vue'

const route = ref('containers')

onMounted(() => {
  window.ztools.onPluginEnter((action: any) => {
    // 本期唯一注册功能为 containers；直接点开插件时 code 为空，默认进主页
    if (action.code && action.code !== 'containers') return
    route.value = 'containers'
  })
  window.ztools.onPluginOut(() => {
    route.value = 'containers'
  })
})
</script>

<template>
  <Containers v-if="route === 'containers'" />
</template>
```

- [ ] **Step 3: 构建验证**

Run: `npm run build`
Expected: `vue-tsc` 与 `vite build` 均成功，`dist/` 生成

- [ ] **Step 4: 运行测试（回归）**

Run: `npm test`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: 双栏容器管理界面（列表/详情/操作/错误处理）"
```

### Task 9: 实时日志 ContainerLogs.vue + 接入详情页

**Files:**
- Create: `src/Containers/ContainerLogs.vue`
- Modify: `src/Containers/ContainerDetail.vue`（详情页底部内嵌日志面板）

- [ ] **Step 1: 实现实时日志组件**

```vue
<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps<{
  containerId: string
  running: boolean
}>()

const lines = ref<string[]>([])
const following = ref(true)
const containerRef = ref<HTMLDivElement | null>(null)
let handle: { stop(): void } | null = null
let rafId = 0

function flush() {
  rafId = 0
  if (!containerRef.value) return
  containerRef.value.scrollTop = containerRef.value.scrollHeight
}

function stopFollow() {
  if (handle) { handle.stop(); handle = null }
}

function startFollow() {
  if (!props.running) return
  lines.value = []
  handle = window.services.docker.followLogs(props.containerId, (line) => {
    lines.value.push(line)
    if (lines.value.length > 5000) lines.value.splice(0, lines.value.length - 5000)
    if (following.value && !rafId) {
      rafId = requestAnimationFrame(flush)
    }
  }, (err) => {
    // LOG_CLOSED（正常退出/容器停止）静默；其他错误提示
    if (err.code !== 'LOG_CLOSED') {
      lines.value.push(`[docker] ${err.message}`)
    }
  })
}

function toggleFollow() {
  following.value = !following.value
  if (following.value) {
    startFollow()
  } else {
    stopFollow()
  }
}

function scrollToBottom() {
  if (containerRef.value) containerRef.value.scrollTop = containerRef.value.scrollHeight
}

watch(() => props.containerId, () => {
  stopFollow()
  startFollow()
})
watch(() => props.running, (running) => {
  if (running) startFollow()
  else { stopFollow(); lines.value = [] }
})

onMounted(startFollow)
onBeforeUnmount(() => {
  stopFollow()
  if (rafId) cancelAnimationFrame(rafId)
})
</script>

<template>
  <div class="logs">
    <div class="logs-head">
      <span>实时日志</span>
      <button class="btn" @click="toggleFollow">
        {{ following ? '⏸ 暂停跟随' : '▶ 继续跟随' }}
      </button>
      <button class="btn" @click="scrollToBottom">⬇ 到底部</button>
    </div>
    <div v-if="!running" class="logs-empty">容器未运行，无日志</div>
    <div v-else ref="containerRef" class="logs-body">
      <div v-for="(line, i) in lines" :key="i" class="log-line">{{ line }}</div>
    </div>
  </div>
</template>

<style scoped>
.logs { margin-top: 16px; display: flex; flex-direction: column; }
.logs-head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.logs-head span {
  font-size: 12px;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-right: auto;
}
.btn {
  border: 1px solid var(--border-color);
  background: var(--panel-bg);
  color: inherit;
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 6px;
  cursor: pointer;
}
.logs-body {
  height: 220px;
  overflow-y: auto;
  background: rgba(0, 0, 0, 0.85);
  border-radius: 8px;
  padding: 8px 10px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  line-height: 1.5;
}
@media (prefers-color-scheme: light) {
  .logs-body { color: #d4d4d4; }
}
.log-line { white-space: pre-wrap; word-break: break-all; }
.logs-empty {
  color: var(--text-secondary);
  font-size: 13px;
  padding: 12px 0;
}
</style>
```

- [ ] **Step 2: 在 ContainerDetail.vue 中内嵌日志面板**

在 `<section class="panel">`（目录挂载）之后、`</div>` 之前追加：

```vue
<ContainerLogs :container-id="container.id" :running="container.state === 'running'" />
```

并在 `<script setup>` 顶部引入：

```ts
import ContainerLogs from './ContainerLogs.vue'
```

- [ ] **Step 3: 构建验证**

Run: `npm run build`
Expected: 成功，无 TS 错误

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: 实时日志面板（follow/暂停/滚底/切容器清理）"
```

## Chunk 4: 构建验证 + 手动验收

### Task 10: 全量构建与测试 + 手动验收清单

**Files:**
- None（只验证）

- [ ] **Step 1: 全量构建**

Run: `npm run build`
Expected: `vue-tsc` 无类型错误，`vite build` 成功，`dist/` 生成 `index.html`、`assets/` 等

- [ ] **Step 2: 全量单测**

Run: `npm test`
Expected: 全部 PASS

- [ ] **Step 3: 手动验收（本机需有 Docker）**

在 ZTools 中加载插件（开发模式指向 `http://localhost:5173`，`npm run dev`），逐一验证：

| # | 验收项 | 预期 |
|---|--------|------|
| 1 | 打开插件 | 双栏布局，左栏列出本机全部容器（含已停止） |
| 2 | 容器状态圆点 | 运行中绿 / 暂停橙 / 停止灰 |
| 3 | 选中运行容器 | 右栏显示镜像/ID/状态/创建、端口映射、目录挂载 |
| 4 | 停止操作 | 弹确认？——不弹（仅删除弹确认）→ 容器转已停止，列表置灰 |
| 5 | 启动操作 | 容器恢复运行，3s 内列表更新 |
| 6 | 实时日志 | 自动滚动跟随新日志；点「暂停跟随」停止滚动，点「继续」重新跟随 |
| 7 | 删除操作 | 弹确认框；确认后容器从列表消失 |
| 8 | 关闭 docker daemon | 出现黄色横幅提示 + 空列表，不白屏 |
| 9 | 命令不存在场景 | fatal 页显示「未检测到 Docker」+ 安装链接 |

- [ ] **Step 4: 更新 README 功能列表**

修改 `README.md`，将「已包含的示例功能」替换为「核心容器管理」能力说明（列表/启停/端口挂载/实时日志），保留构建与开发指南章节。

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "docs: README 更新为核心容器管理功能说明"
```

- [ ] **Step 6: 最终提交收尾**

```bash
git status --short
git log --oneline
```

Expected: 工作区干净，提交历史清晰分步（chore → feat → refactor → feat → feat → docs）
