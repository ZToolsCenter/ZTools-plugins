<script setup lang="ts">
import { ref, watch, computed, onMounted } from 'vue'
import type { ContainerSummary, ContainerDetail, TerminalInfo } from '../types'
import { stateLabel } from './labels'
import ContainerLogs from './ContainerLogs.vue'
import ContainerTerminal from './ContainerTerminal.vue'
import CSelect from './CSelect.vue'

const props = defineProps<{
  container: ContainerSummary
  confirm?: (title: string, message: string, danger?: boolean) => Promise<boolean>
}>()

const emit = defineEmits<{
  (e: 'action', action: 'start' | 'stop' | 'restart' | 'pause' | 'unpause' | 'remove' | 'removeFull'): void
  (e: 'toast', msg: string): void
}>()

const detail = ref<ContainerDetail | null>(null)
const inFlight = ref<string | null>(null)   // 当前进行中的操作，防双击
const runCommand = ref('')                   // 还原的 docker run 启动命令
const activeTab = ref<'overview' | 'logs' | 'terminal' | 'cmd'>('overview')   // 右侧分页

// 终端扫描与选择（自动优先：检测列表第一个即优先级最高）
const terminals = ref<TerminalInfo[]>([])
const selectedTerminalId = ref('')

const terminalOptions = computed(() => terminals.value.map((t) => ({ value: t.id, label: t.name })))

const restartOptions = [
  { value: 'no', label: 'no — 不自动重启' },
  { value: 'always', label: 'always — 总是重启' },
  { value: 'unless-stopped', label: 'unless-stopped — 手动停止除外' },
  { value: 'on-failure', label: 'on-failure — 异常退出时' }
]

onMounted(() => {
  terminals.value = window.services.terminals.detectTerminals()
  if (terminals.value.length) selectedTerminalId.value = terminals.value[0].id
})

async function onOpenTerminal() {
  if (!selectedTerminalId.value) return
  // 终端里执行的 docker 命令需带上当前连接参数，远程连接才能进入远程容器
  const conn = window.services.docker.getConnection()
  const prefix =
    conn.type === 'context' ? `--context ${conn.name} ` : conn.type === 'host' ? `--host ${conn.host} ` : ''
  const res = await window.services.terminals.openTerminal(
    selectedTerminalId.value,
    `docker ${prefix}exec -it ${props.container.id} sh`
  )
  emit('toast', res.ok ? (res.message || `已用 ${res.used} 打开终端`) : res.message)
}

// ===== 重启策略 =====
const restartUpdating = ref(false)
const restartPolicy = ref('no')

watch(detail, (d) => {
  if (d) restartPolicy.value = d.restartPolicy.name || 'no'
})

async function onRestartPolicyChange() {
  if (restartUpdating.value) return
  restartUpdating.value = true
  const res = await window.services.docker.updateRestartPolicy(props.container.id, restartPolicy.value)
  restartUpdating.value = false
  if (res.ok === true) emit('toast', '重启策略已更新')
  else emit('toast', res.error.message)
}

// ===== 还原 docker run 启动命令 =====

async function onShowRunCommand() {
  const res = await window.services.docker.getRunCommand(props.container.id)
  if (res.ok === true) {
    runCommand.value = res.command
  } else {
    emit('toast', res.error.message)
  }
}

function copyRunCommand() {
  if (!runCommand.value) return
  window.ztools.copyText(runCommand.value)
  emit('toast', '已复制启动命令')
}

// ===== 快速访问本地映射 =====

// 用系统文件管理器打开宿主机映射目录
// 类型声明为 void，但实际返回 boolean；断言拿到返回值，失败时给出可见提示
function openMount(source: string) {
  if (!source) return
  try {
    const ok = (window.ztools.shellOpenPath as (p: string) => boolean)(source)
    if (ok === false) emit('toast', '无法打开目录（路径可能不存在或不可访问）：' + source)
  } catch (e) {
    emit('toast', '无法打开目录：' + source)
  }
}

// 判断端口是否可通过 http 访问（TCP，排除 udp/sctp）
function isTcp(containerPort: string) {
  return !/\/(udp|sctp)$/i.test(containerPort || '')
}

// 用系统浏览器访问本地映射端口
function openPort(hostPort: string) {
  if (!hostPort) return
  try {
    window.ztools.shellOpenExternal(`http://localhost:${hostPort}`)
  } catch {
    emit('toast', '无法访问：http://localhost:' + hostPort)
  }
}

// 加载 inspect 详情（所有状态都加载，以展示挂载与重启策略）；
// 用请求序号丢弃过期结果，防止快速切换容器时旧详情覆盖新详情。
// 注意：必须用多源 watch 形式（数组内逐个 getter），Vue 会逐项比较；
// 若写成返回新数组的单个 getter，Object.is 永远不等，轮询刷新会误触发回调。
let req = 0
watch(
  [() => props.container.id, () => props.container.state],
  async ([id]) => {
    const myReq = ++req
    detail.value = null
    runCommand.value = ''
    const res = await window.services.docker.inspectContainer(id)
    if (myReq === req && res.ok) detail.value = res.container
  },
  { immediate: true }
)

type ActionKey = 'start' | 'stop' | 'restart' | 'pause' | 'unpause' | 'remove' | 'removeFull'

const actions = computed<
  Array<{ key: ActionKey; label: string; icon: string; disabled: boolean; danger?: boolean }>
>(() => {
  const s = props.container.state
  return [
    { key: 'start', label: '启动', icon: 'play', disabled: s !== 'stopped' },
    { key: 'stop', label: '停止', icon: 'stop', disabled: s === 'stopped' },
    { key: 'restart', label: '重启', icon: 'restart', disabled: s === 'stopped' },
    { key: 'pause', label: '暂停', icon: 'pause', disabled: s !== 'running' },
    { key: 'unpause', label: '继续', icon: 'play', disabled: s !== 'paused' },
    { key: 'remove', label: '删除容器', icon: 'trash', disabled: false, danger: true },
    { key: 'removeFull', label: '完整删除', icon: 'trash', disabled: false, danger: true }
  ]
})

async function onAction(key: ActionKey) {
  if (inFlight.value) return
  if (key === 'remove') {
    const ok = props.confirm
      ? await props.confirm('删除容器', `确认删除容器 ${props.container.name}？此操作会强制终止容器。`, true)
      : window.confirm(`确认删除容器 ${props.container.name}？此操作会强制终止容器。`)
    if (!ok) return
  } else if (key === 'removeFull') {
    const ok = props.confirm
      ? await props.confirm(
          '完整删除',
          `确认完整删除容器 ${props.container.name}？将同时删除其数据卷和镜像，数据不可恢复！`,
          true
        )
      : window.confirm(`确认完整删除容器 ${props.container.name}？将同时删除其数据卷和镜像，数据不可恢复！`)
    if (!ok) return
  }
  inFlight.value = key
  emit('action', key)
  setTimeout(() => (inFlight.value = null), 1500)  // 简化防抖：操作后短暂禁用
}
</script>

<template>
  <div class="detail">
    <div class="detail-head">
      <h3>{{ container.name }}</h3>
      <span class="state-tag" :class="container.state">{{ stateLabel(container.state) }}</span>
    </div>

    <div class="detail-tabs">
      <button class="tab" :class="{ active: activeTab === 'overview' }" @click="activeTab = 'overview'">概览</button>
      <button class="tab" :class="{ active: activeTab === 'logs' }" @click="activeTab = 'logs'">日志</button>
      <button class="tab" :class="{ active: activeTab === 'terminal' }" @click="activeTab = 'terminal'">快速终端</button>
      <button class="tab" :class="{ active: activeTab === 'cmd' }" @click="activeTab = 'cmd'">启动命令还原</button>
    </div>

    <!-- 概览：元信息 / 操作 / 终端 / 重启策略 / 端口 / 挂载 -->
    <div v-show="activeTab === 'overview'" class="tab-pane">
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
          class="btn"
          :class="{ danger: a.danger, running: inFlight === a.key }"
          :disabled="a.disabled || !!inFlight"
          @click="onAction(a.key)"
        >
          <span class="btn-icon" :class="'icon-' + a.icon"></span>
          {{ a.label }}
        </button>
      </div>

      <div class="term-bar">
        <button class="btn" @click="activeTab = 'terminal'">
          <span class="btn-icon icon-terminal"></span>快速终端
        </button>
        <button class="btn" :disabled="!selectedTerminalId || !!inFlight" @click="onOpenTerminal">
          <span class="btn-icon icon-terminal"></span>进入终端
        </button>
        <CSelect v-model="selectedTerminalId" :options="terminalOptions" :disabled="!terminals.length" placeholder="选择终端" />
      </div>

      <div class="restart-bar">
        <span class="k">重启策略</span>
        <CSelect v-model="restartPolicy" :options="restartOptions" :disabled="restartUpdating" @change="onRestartPolicyChange" />
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
            <button
              v-if="isTcp(p.containerPort) && p.bindings.length"
              class="btn sm right"
              @click="openPort(p.bindings[0])"
            >
              访问
            </button>
          </div>
        </template>
        <div v-else class="muted">加载中…</div>
      </section>

      <section class="panel">
        <h4>目录挂载</h4>
        <template v-if="detail">
          <div v-if="!detail.mounts.length" class="muted">无目录挂载</div>
          <div v-for="(m, i) in detail.mounts" :key="i" class="map-row">
            <code class="m-source" :title="m.source">{{ m.source }}</code>
            <span class="arrow">↓</span>
            <code>{{ m.destination }}</code>
            <span class="rw">{{ m.rw ? 'rw' : 'ro' }}</span>
            <button class="btn sm right" @click="openMount(m.source)">打开目录</button>
          </div>
        </template>
        <div v-else class="muted">加载中…</div>
      </section>
    </div>

    <!-- 日志：实时日志（v-show 保持跟随不中断） -->
    <div v-show="activeTab === 'logs'" class="tab-pane logs-pane">
      <ContainerLogs :container-id="container.id" :running="container.state === 'running'" />
    </div>

    <!-- 终端：内嵌进容器 shell -->
    <div v-show="activeTab === 'terminal'" class="tab-pane term-pane">
      <ContainerTerminal
        :container-id="container.id"
        :running="container.state === 'running'"
        :image="container.image"
        @toast="emit('toast', $event)"
      />
    </div>

    <!-- 启动命令：还原 docker run -->
    <div v-show="activeTab === 'cmd'" class="tab-pane">
      <div class="cmd-intro">忘记了启动命令？这里可以尽可能帮你还原当时的启动命令，以供参考。</div>
      <div class="runcmd-bar">
        <button class="btn" @click="onShowRunCommand">
          <span class="btn-icon icon-terminal"></span>还原启动命令
        </button>
        <button v-if="runCommand" class="btn sm right" @click="copyRunCommand">复制</button>
      </div>
      <div v-if="runCommand" class="run-cmd-panel">
        <pre>{{ runCommand }}</pre>
      </div>
      <div v-else class="muted">点击「还原启动命令」，根据容器当前参数还原等效的 docker run 命令。</div>
    </div>
  </div>
</template>

<style scoped>
.detail {
  flex: 1;
  min-width: 0;
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.detail-head { display: flex; align-items: center; gap: 10px; }
.detail-head h3 { margin: 0; }
.detail-tabs {
  display: flex;
  gap: 2px;
  padding: 2px;
  border-radius: var(--ctrl-radius);
  background: var(--panel-bg);
  margin: 8px 0;
  align-self: flex-start;
}
.detail-tabs .tab {
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  padding: 0 14px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  border-radius: var(--ctrl-radius);
  cursor: pointer;
}
.detail-tabs .tab.active { background: var(--blue); color: var(--light); }
.tab-pane {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
.logs-pane {
  display: flex;
  overflow: hidden;
}
.term-pane {
  display: flex;
  overflow: hidden;
}
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
.term-bar { display: flex; align-items: center; gap: 6px; margin-bottom: 16px; }
.restart-bar { display: flex; align-items: center; gap: 6px; margin-bottom: 16px; font-size: 13px; }
.restart-bar .k { color: var(--text-secondary); }
.runcmd-bar { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; }
.cmd-intro {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.6;
  margin-bottom: 10px;
}
.run-cmd-panel {
  margin-bottom: 16px;
  border: 1px solid var(--border-color);
  border-radius: var(--ctrl-radius);
  background: var(--panel-bg);
  padding: 8px 10px;
}
.run-cmd-panel pre {
  margin: 0;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-all;
}

.m-source {
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.term-select {
  height: var(--ctrl-height);
  border: 1px solid var(--border-color);
  background: var(--panel-bg);
  color: inherit;
  padding: 0 6px;
  border-radius: var(--ctrl-radius);
  min-width: 110px;
}

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
.right { margin-left: auto; }
</style>
