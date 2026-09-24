<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ContainerSummary, ComposeProject } from '../types'
import { stateLabel, composeStatusLabel } from './labels'
import { imageBadge, imageLogoDataUrl, isK8sContainer, K8S_LOGO, DOCKER_LOGO } from './imageBadge'

const props = defineProps<{
  containers: ContainerSummary[]
  composeProjects: ComposeProject[]
  selectedId: string
  highlightId?: string
}>()

const emit = defineEmits<{
  (e: 'select', id: string): void
  (e: 'view-project', project: { name: string; configFile: string }): void
}>()

interface ContainerGroup {
  key: string
  name: string
  status: string
  containers: ContainerSummary[]
  k8s?: boolean
}

// 列表筛选：状态 tab（全部/运行中）+ 名称关键词
const statusFilter = ref<'all' | 'running'>('all')
const filter = ref('')

const filteredContainers = computed(() => {
  let list = props.containers
  if (statusFilter.value === 'running') {
    list = list.filter((c) => c.state === 'running')
  }
  const kw = filter.value.trim().toLowerCase()
  if (kw) {
    list = list.filter((c) => c.name.toLowerCase().includes(kw))
  }
  return list
})

// 按 compose 项目分组；k8s 容器（k8s_ 前缀或 k8s 系统组件镜像）聚合为 kubernetes 组；
// 其余归入「独立容器」
const groups = computed<ContainerGroup[]>(() => {
  const byProject = new Map<string, ContainerSummary[]>()
  const k8s: ContainerSummary[] = []
  const standalone: ContainerSummary[] = []
  for (const c of filteredContainers.value) {
    if (isK8sContainer(c)) {
      k8s.push(c)
    } else if (c.project) {
      if (!byProject.has(c.project)) byProject.set(c.project, [])
      byProject.get(c.project)!.push(c)
    } else {
      standalone.push(c)
    }
  }
  const projectGroups: ContainerGroup[] = [...byProject.entries()].map(([name, list]) => ({
    key: name,
    name,
    status: props.composeProjects.find((p) => p.name === name)?.status || '',
    containers: list
  }))
  const k8sGroup: ContainerGroup[] = k8s.length
    ? [{ key: '__kubernetes__', name: 'kubernetes', status: '', containers: k8s, k8s: true }]
    : []
  const standaloneGroup: ContainerGroup[] = standalone.length
    ? [{ key: '__standalone__', name: '独立容器', status: '', containers: standalone }]
    : []
  // kubernetes 组置顶，其次 compose 项目组，最后独立容器
  return [...k8sGroup, ...projectGroups, ...standaloneGroup]
})

// 折叠状态（默认折叠 k8s 分组，其余展开）
const collapsed = ref<Record<string, boolean>>({ __kubernetes__: true })

function toggleGroup(key: string) {
  collapsed.value = { ...collapsed.value, [key]: !collapsed.value[key] }
}

// 通知父组件查看某 compose 项目的聚合日志（取第一个配置文件路径）
function emitViewProject(g: ContainerGroup) {
  const project = props.composeProjects.find((p) => p.name === g.key)
  const configFile = project?.configFiles?.split(',')[0]?.trim() || ''
  emit('view-project', { name: g.key, configFile })
}
</script>

<template>
  <div class="list">
    <div class="list-toolbar">
      <div class="tabs">
        <button class="tab" :class="{ active: statusFilter === 'all' }" @click="statusFilter = 'all'">全部</button>
        <button class="tab" :class="{ active: statusFilter === 'running' }" @click="statusFilter = 'running'">运行中</button>
      </div>
      <input v-model="filter" class="filter" placeholder="筛选容器名称…" />
    </div>
    <div v-if="!groups.length" class="list-empty">暂无容器</div>

    <div v-for="g in groups" :key="g.key" class="group">
      <div class="group-head" @click="toggleGroup(g.key)">
        <span class="group-toggle">{{ collapsed[g.key] ? '▸' : '▾' }}</span>
        <span v-if="g.k8s" class="group-icon-k8s"><img class="group-logo" :src="K8S_LOGO" alt="k8s" /></span>
        <span v-else-if="g.key === '__standalone__'" class="group-icon-k8s"><img class="group-logo" :src="DOCKER_LOGO" alt="docker" /></span>
        <span v-else class="group-icon-k8s"><span class="icon-compose"></span></span>
        <span class="group-name">{{ g.name }}</span>
        <span v-if="g.status" class="group-status">{{ composeStatusLabel(g.status) }}</span>
        <button
          v-if="g.key !== '__standalone__' && g.key !== '__kubernetes__'"
          class="group-logs"
          title="查看项目聚合日志"
          @click.stop="emitViewProject(g)"
        >
          <span class="group-icon icon-terminal"></span>
        </button>
      </div>

      <template v-if="!collapsed[g.key]">
        <div
          v-for="c in g.containers"
          :key="c.id"
          class="item"
          :class="{
            selected: c.id === selectedId,
            stopped: c.state !== 'running',
            flash: c.id === highlightId
          }"
          @click="$emit('select', c.id)"
        >
          <div class="item-head">
            <img v-if="imageLogoDataUrl(c.image)" class="item-logo" :src="imageLogoDataUrl(c.image)" alt="" />
            <span v-else class="badge" :style="{ background: imageBadge(c.image).bg }">{{ imageBadge(c.image).letter }}</span>
            <span class="dot" :class="c.state"></span>
            <span class="name">{{ c.name }}</span>
            <span class="state-tag" :class="c.state">{{ stateLabel(c.state) }}</span>
          </div>
          <div v-if="c.state === 'running' && c.ports" class="item-ports">{{ c.ports }}</div>
          <div v-else-if="c.state !== 'running'" class="item-status">{{ c.status }}</div>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.list {
  width: 260px;
  border-right: 1px solid var(--border-color);
  overflow-y: auto;
  min-height: 0;
}
.list-toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--border-color);
  position: sticky;
  top: 0;
  background: inherit;
  z-index: 1;
}
.tabs {
  display: flex;
  gap: 2px;
  padding: 2px;
  border-radius: var(--ctrl-radius);
  background: var(--panel-bg);
  flex-shrink: 0;
}
.tab {
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  padding: 0 10px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  border-radius: var(--ctrl-radius);
  cursor: pointer;
}
.tab.active { background: var(--blue); color: var(--light); }
.filter {
  flex: 1;
  min-width: 0;
  height: var(--ctrl-height);
  padding: 0 8px;
  border: 1px solid var(--border-color);
  border-radius: var(--ctrl-radius);
  background: var(--panel-bg);
  color: inherit;
}
.group { border-bottom: 1px solid var(--border-color); }
.group-head {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 10px;
  cursor: pointer;
  font-size: 12px;
  color: var(--text-secondary);
  background: var(--panel-bg);
  user-select: none;
}
.group-head:hover { opacity: 0.85; }
.group-toggle { flex-shrink: 0; }
.group-name {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.group-status {
  margin-left: auto;
  font-size: 11px;
}
.group-icon-k8s { display: inline-flex; align-items: center; flex-shrink: 0; }
.group-logo {
  width: 14px;
  height: 14px;
  border-radius: 3px;
  object-fit: contain;
}
.group-logs {
  border: none;
  background: transparent;
  color: inherit;
  padding: 0;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  opacity: 0.7;
  line-height: 1;
}
.group-logs:hover { opacity: 1; color: var(--blue); }
.group-icon { display: inline-block; transform: scale(0.8); }
.item {
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-color);
  cursor: pointer;
}
.item:last-child { border-bottom: none; }
.item:hover { background: var(--panel-bg); }
.item.selected { background: rgba(88, 164, 246, 0.12); }
.item.flash { animation: flash-highlight 1.6s ease; }
@keyframes flash-highlight {
  0%, 100% { background: transparent; }
  50% { background: rgba(88, 164, 246, 0.4); }
}
.item.stopped { opacity: 0.6; }
.item-head { display: flex; align-items: center; gap: 6px; }
.item-logo {
  width: 20px;
  height: 20px;
  border-radius: 4px;
  flex-shrink: 0;
  object-fit: contain;
  background: #fff;
  padding: 1px;
  box-sizing: border-box;
}
.badge {
  width: 20px;
  height: 20px;
  border-radius: 5px;
  color: #fff;
  font-size: 9px;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.dot {
  width: 8px; height: 8px; border-radius: 50%;
  flex-shrink: 0;
}
.dot.running { background: var(--ok); }
.dot.paused { background: var(--warn); }
.dot.stopped { background: var(--text-secondary); }
.name { font-weight: 500; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.state-tag { font-size: 11px; color: var(--text-secondary); }
.state-tag.running { color: var(--ok); }
.state-tag.paused { color: var(--warn); }
.state-tag.stopped { color: var(--text-secondary); }
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
