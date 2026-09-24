<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { ImageSearchResult } from '../types'
import CSelect from './CSelect.vue'

const emit = defineEmits<{
  (e: 'toast', msg: string): void
  (e: 'task', evt: any): void
}>()

const sourceOptions = [
  { value: 'all', label: '全部源' },
  { value: 'dockerhub', label: 'Docker Hub 官方' },
  { value: 'xuanyuan', label: '轩辕' },
  { value: '1ms', label: '毫秒' }
]

const createRestartOptions = [
  { value: 'no', label: 'no' },
  { value: 'always', label: 'always' },
  { value: 'unless-stopped', label: 'unless-stopped' }
]

type SourceFilter = 'all' | 'dockerhub' | 'xuanyuan' | '1ms'

const source = ref<SourceFilter>('all')
const query = ref('')
const results = ref<ImageSearchResult[]>([])
const loading = ref(false)
const searched = ref(false)
const selected = ref<ImageSearchResult | null>(null)

// 创建表单
const createName = ref('')
const createTag = ref('latest')
const createPorts = ref('')
const createEnvs = ref('')
const createMounts = ref('')
const createRestart = ref('no')
const creating = ref(false)
const createTags = ref<string[]>([])   // 从源获取的可用版本列表
const pullVisible = ref(false)
const pullText = ref('')
const pullPercent = ref(0)

// 创建前预检：容器名重复 / 端口占用
const nameConflict = ref(false)
const portConflict = ref<string[]>([])
let nameCheckTimer: ReturnType<typeof setTimeout> | null = null
let portCheckTimer: ReturnType<typeof setTimeout> | null = null

async function checkName() {
  const n = createName.value.trim()
  if (!n) { nameConflict.value = false; return }
  const r = await window.services.docker.checkContainerName(n)
  nameConflict.value = r.ok === true ? !!r.used : false
}

async function checkPortsConflict() {
  const ports = createPorts.value.split(',').map((s) => s.trim()).filter(Boolean)
  if (!ports.length) { portConflict.value = []; return }
  const r = await window.services.docker.checkPorts(ports)
  portConflict.value = r.ok === true ? r.occupied || [] : []
}

watch(createName, () => {
  if (nameCheckTimer) clearTimeout(nameCheckTimer)
  nameCheckTimer = setTimeout(checkName, 400)
})
watch(createPorts, () => {
  if (portCheckTimer) clearTimeout(portCheckTimer)
  portCheckTimer = setTimeout(checkPortsConflict, 400)
})

// 选中镜像后从源获取可用版本列表（Docker Hub tags API），失败静默保留手动输入
async function loadTags() {
  createTags.value = []
  if (!selected.value) return
  const r = await window.services.registry.fetchImageTags(selected.value.source, selected.value.name)
  if (r.ok === true && r.tags) createTags.value = r.tags
}

function onPullData(data: string) {
  pullText.value = data.split('\r').pop()?.trim() || ''
  const done = (data.match(/Pull complete/g) || []).length + (data.match(/Extract complete/g) || []).length
  const total = (data.match(/Pulling fs layer/g) || []).length + (data.match(/Pulling layer/g) || []).length
  if (total > 0) pullPercent.value = Math.min(99, Math.round((done / total) * 100))
}

const SOURCE_LABEL: Record<string, string> = {
  dockerhub: '官方',
  xuanyuan: '轩辕',
  '1ms': '毫秒'
}

const selectedImage = computed(() => (selected.value ? selected.value.name : ''))

// 完整镜像名 = 名称 + 版本号（名称已带 tag 则直接用）
function fullImage() {
  const name = selected.value?.name || ''
  if (!name) return ''
  if (name.includes(':')) return name
  return name + ':' + (createTag.value.trim() || 'latest')
}

// 可搜索版本选择：输入筛选，点击选择
const tagQuery = ref('latest')
const showTagList = ref(false)
const filteredTags = computed(() => {
  const q = tagQuery.value.trim().toLowerCase()
  return q ? createTags.value.filter((t) => t.toLowerCase().includes(q)) : createTags.value
})
function selectTag(t: string) {
  createTag.value = t
  tagQuery.value = t
  showTagList.value = false
}
function hideTagList() {
  setTimeout(() => (showTagList.value = false), 150)
}

async function search() {
  const q = query.value.trim()
  if (!q || loading.value) return
  loading.value = true
  searched.value = true
  results.value = []
  selected.value = null
  try {
    if (source.value === 'all') {
      const [d, x, m] = await Promise.all([
        window.services.registry.searchImages(q, 'dockerhub'),
        window.services.registry.searchImages(q, 'xuanyuan'),
        window.services.registry.searchImages(q, '1ms')
      ])
      const merged: ImageSearchResult[] = []
      for (const r of [d, x, m]) {
        if (r.ok && r.results) merged.push(...r.results)
      }
      results.value = merged
      if (results.value.length === 0) {
        const errs = [d, x, m].filter((r) => !r.ok && r.error).map((r) => r.error)
        if (errs.length) emit('toast', '搜索失败：' + errs.join('；'))
      }
    } else {
      const r = await window.services.registry.searchImages(q, source.value)
      if (r.ok && r.results) {
        results.value = r.results
      } else if (source.value === 'dockerhub') {
        // 官方源直连不可达（国内被墙）：自动用轩辕/毫秒聚合的 Docker Hub 镜像数据兜底
        const [x, m] = await Promise.all([
          window.services.registry.searchImages(q, 'xuanyuan'),
          window.services.registry.searchImages(q, '1ms')
        ])
        const merged: ImageSearchResult[] = []
        for (const rr of [x, m]) if (rr.ok && rr.results) merged.push(...rr.results)
        if (merged.length) {
          results.value = merged
          emit('toast', '官方源不可达，已用轩辕/毫秒镜像数据返回（结果标注来源）')
        } else {
          emit('toast', r.error || '搜索失败')
        }
      } else {
        emit('toast', r.error || '搜索失败')
      }
    }
  } finally {
    loading.value = false
  }
}

function pick(item: ImageSearchResult) {
  selected.value = item
  // 预填容器名
  const base = item.name.split('/').pop()?.split(':')[0] || ''
  createName.value = base
  createTag.value = 'latest'
  tagQuery.value = 'latest'
  createRestart.value = 'no'
  createPorts.value = ''
  createEnvs.value = ''
  createMounts.value = ''
  nameConflict.value = false
  portConflict.value = []
  loadTags()
}

async function create() {
  const image = fullImage()
  if (!image || creating.value) return
  if (nameConflict.value) { emit('toast', '容器名已存在，请更换'); return }
  if (portConflict.value.length) { emit('toast', '端口已被占用：' + portConflict.value.join('，')); return }
  const args: string[] = []
  if (createName.value.trim()) args.push('--name', createName.value.trim())
  if (createRestart.value !== 'no') args.push('--restart', createRestart.value)
  createPorts.value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .forEach((p) => args.push('-p', p))
  createEnvs.value
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .forEach((e) => args.push('-e', e))
  createMounts.value
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .forEach((m) => args.push('-v', m))
  args.push(image)
  creating.value = true
  const name = createName.value.trim() || 'unnamed'
  // 每次创建唯一 taskId，支持多任务并行
  const taskId = 'c' + Date.now() + Math.random().toString(36).slice(2, 6)
  emit('task', { type: 'start', taskId, image, name })
  try {
    // 镜像不存在则先拉取（流式显示下载进度，可切到管理界面后台查看）
    const exists = await window.services.docker.imageExists(image)
    if (!exists) {
      pullVisible.value = true
      pullText.value = ''
      pullPercent.value = 0
      emit('task', { type: 'progress', taskId, image, name, log: '拉取镜像 ' + image, percent: 0 })
      const pulled = await new Promise<boolean>((resolve) => {
        window.services.docker.pullImage(
          image,
          (d) => {
            if (d.includes('[PULL_DONE]')) {
              pullPercent.value = 100
              emit('task', { type: 'progress', taskId, image, name, log: '镜像就绪', percent: 100 })
              resolve(true)
            } else {
              onPullData(d)
              emit('task', { type: 'progress', taskId, image, name, log: pullText.value, percent: pullPercent.value })
            }
          },
          () => resolve(false)
        )
      })
      if (!pulled) {
        emit('task', { type: 'error', taskId, message: '镜像拉取失败' })
        return
      }
    }
    emit('task', { type: 'progress', taskId, image, name, log: '创建容器中…', percent: 100 })
    const res = await window.services.docker.createContainer(args)
    if (res.ok === true) {
      pullVisible.value = false
      selected.value = null
      emit('task', { type: 'done', taskId, name, id: res.id || '' })
    } else {
      emit('task', { type: 'error', taskId, message: '创建失败：' + res.error.message })
    }
  } finally {
    creating.value = false
  }
}

function srcColor(s: string) {
  return { dockerhub: '#2496ed', xuanyuan: '#f59e0b', '1ms': '#10b981' }[s] || '#888'
}
</script>

<template>
  <div class="market">
    <div class="search-bar">
      <CSelect v-model="source" :options="sourceOptions" placeholder="选择源" />
      <input
        v-model="query"
        class="src-input"
        placeholder="搜索镜像，如 nginx / mysql / redis"
        @keyup.enter="search"
      />
      <button class="btn" :disabled="loading" @click="search">{{ loading ? '搜索中…' : '搜索' }}</button>
    </div>

    <div class="market-body">
      <!-- 搜索结果 -->
      <div class="result-pane">
        <div v-if="!searched" class="placeholder">输入关键词搜索镜像</div>
        <div v-else-if="!results.length && !loading" class="placeholder">无匹配结果</div>
        <div
          v-for="item in results"
          :key="item.source + ':' + item.name"
          class="item"
          :class="{ selected: selected && selected.name === item.name && selected.source === item.source }"
          @click="pick(item)"
        >
          <img v-if="item.logo" class="item-logo" :src="item.logo" alt="" />
          <span v-else class="item-logo item-logo-fallback">{{ (item.name[0] || '?').toUpperCase() }}</span>
          <div class="item-info">
            <div class="item-name">
              {{ item.name }}
              <span v-if="item.official" class="official">官方</span>
              <span class="src-badge" :style="{ background: srcColor(item.source) }">{{ SOURCE_LABEL[item.source] }}</span>
            </div>
            <div v-if="item.description" class="item-desc">{{ item.description }}</div>
            <div class="item-meta">⭐ {{ item.stars }} · 拉取 {{ item.pulls }}</div>
          </div>
        </div>
      </div>

      <!-- 创建表单 -->
      <div class="create-pane">
        <div v-if="!selected" class="placeholder">从左侧选择一个镜像开始创建</div>
        <div v-else class="create-form">
          <h3>创建容器</h3>
          <label>来源镜像（来自搜索结果，不可修改）</label>
          <div class="img-field">
            <input :value="fullImage()" class="f" disabled placeholder="镜像" />
            <span class="img-lock" title="镜像来自搜索结果，不可修改"><span class="icon-lock"></span></span>
          </div>
          <label>版本号（Tag）<span v-if="createTags.length" class="tag-hint">（{{ createTags.length }} 个版本，输入可搜索）</span></label>
          <div v-if="createTags.length" class="tag-select">
            <input v-model="tagQuery" class="f" placeholder="输入筛选版本，如 1.25…" @focus="showTagList = true" @blur="hideTagList" />
            <div v-if="showTagList" class="tag-list">
              <div
                v-for="t in filteredTags"
                :key="t"
                class="tag-item"
                :class="{ active: t === createTag }"
                @mousedown.prevent="selectTag(t)"
              >
                {{ t }}
              </div>
              <div v-if="!filteredTags.length" class="tag-empty">无匹配版本</div>
            </div>
          </div>
          <input v-else v-model="createTag" class="f" placeholder="latest / 1.25 / 8.0.31" />
          <label>容器名</label>
          <input v-model="createName" class="f" placeholder="容器名称" />
          <div v-if="nameConflict" class="conflict">⚠ 容器名已存在，请更换</div>
          <label>端口映射（逗号分隔，如 8080:80）</label>
          <input v-model="createPorts" class="f" placeholder="8080:80, 3306:3306" />
          <div v-if="portConflict.length" class="conflict">⚠ 端口已被占用：{{ portConflict.join('，') }}</div>
          <label>环境变量（每行一个，如 MYSQL_ROOT_PASSWORD=123）</label>
          <textarea v-model="createEnvs" class="f" rows="2" placeholder="KEY=VALUE"></textarea>
          <label>目录挂载（每行一个，如 /data:/var/lib/mysql）</label>
          <textarea v-model="createMounts" class="f" rows="2" placeholder="/data:/var/lib/mysql"></textarea>
          <label>重启策略</label>
          <CSelect v-model="createRestart" :options="createRestartOptions" placeholder="重启策略" />
          <div class="create-actions">
            <button class="btn primary" :disabled="creating" @click="create">
              {{ creating ? '创建中…' : '创建容器' }}
            </button>
          </div>
          <div v-if="pullVisible" class="pull-panel">
            <div class="pull-bar"><div class="pull-fill" :style="{ width: pullPercent + '%' }"></div></div>
            <div class="pull-text">{{ pullPercent }}% · {{ pullText || '拉取镜像中…' }}</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.market { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; padding: 12px 16px; }
.search-bar { display: flex; gap: 8px; margin-bottom: 10px; }
.src-select, .src-input {
  height: var(--ctrl-height);
  border: 1px solid var(--border-color);
  background: var(--panel-bg);
  color: inherit;
  padding: 0 8px;
  border-radius: var(--ctrl-radius);
}
.src-input { flex: 1; min-width: 0; }
.market-body { flex: 1; min-height: 0; display: flex; gap: 12px; }
.result-pane { flex: 1; min-width: 0; overflow-y: auto; border: 1px solid var(--border-color); border-radius: var(--ctrl-radius); padding: 6px; }
.create-pane { width: 300px; flex-shrink: 0; border: 1px solid var(--border-color); border-radius: var(--ctrl-radius); padding: 12px; overflow-y: auto; }
.placeholder { color: var(--text-secondary); font-size: 13px; text-align: center; padding: 40px 0; }
.item { display: flex; gap: 10px; padding: 8px; border-radius: 8px; cursor: pointer; }
.item:hover { background: var(--panel-bg); }
.item.selected { background: rgba(88, 164, 246, 0.12); }
.item-logo { width: 36px; height: 36px; border-radius: 8px; flex-shrink: 0; object-fit: contain; background: #fff; padding: 3px; box-sizing: border-box; }
.item-logo-fallback { display: flex; align-items: center; justify-content: center; background: var(--blue); color: #fff; font-weight: 600; }
.item-info { min-width: 0; }
.item-name { font-weight: 600; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.official { font-size: 10px; color: var(--ok); border: 1px solid var(--ok); border-radius: 4px; padding: 0 4px; }
.src-badge { font-size: 10px; color: #fff; border-radius: 4px; padding: 0 4px; }
.item-desc { font-size: 12px; color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.item-meta { font-size: 11px; color: var(--text-secondary); margin-top: 2px; }
.create-form { display: flex; flex-direction: column; gap: 4px; }
.create-form h3 { margin: 0 0 8px; }
.create-form label { font-size: 12px; color: var(--text-secondary); margin-top: 6px; }
.tag-hint { color: var(--ok); font-size: 11px; }
.conflict { color: var(--danger); font-size: 11px; margin-top: 2px; }
.tag-select { position: relative; }
.tag-list {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  max-height: 180px;
  overflow-y: auto;
  background: #fff;
  border: 1px solid var(--border-color);
  border-radius: var(--ctrl-radius);
  z-index: 5;
  margin-top: 2px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}
@media (prefers-color-scheme: dark) {
  .tag-list { background: #2b2b2b; }
}
.tag-item { padding: 5px 10px; font-size: 12px; cursor: pointer; }
.tag-item:hover { background: var(--panel-bg); }
.tag-item.active { background: rgba(88, 164, 246, 0.15); color: var(--blue); }
.tag-empty { padding: 8px; font-size: 12px; color: var(--text-secondary); }
.img-field { display: flex; align-items: center; gap: 6px; }
.img-field .f { flex: 1; }
.img-field input:disabled { opacity: 0.7; }
.img-lock { display: inline-flex; align-items: center; color: var(--text-secondary); flex-shrink: 0; }
.icon-lock {
  width: 10px;
  height: 8px;
  border: 1.5px solid currentColor;
  border-top: none;
  border-radius: 0 0 2px 2px;
  position: relative;
  box-sizing: border-box;
}
.icon-lock::before {
  content: '';
  position: absolute;
  top: -6px;
  left: 1.5px;
  width: 4px;
  height: 5px;
  border: 1.5px solid currentColor;
  border-radius: 3px 3px 0 0;
  box-sizing: border-box;
}
.f {
  border: 1px solid var(--border-color);
  background: var(--panel-bg);
  color: inherit;
  border-radius: var(--ctrl-radius);
  padding: 6px 8px;
  font-size: 13px;
  box-sizing: border-box;
  width: 100%;
}
.create-actions { margin-top: 12px; }
.pull-panel { margin-top: 10px; }
.pull-bar { height: 6px; background: var(--panel-bg); border-radius: 3px; overflow: hidden; }
.pull-fill { height: 100%; background: var(--blue); transition: width 0.2s; }
.pull-text { font-size: 11px; color: var(--text-secondary); margin-top: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
</style>
