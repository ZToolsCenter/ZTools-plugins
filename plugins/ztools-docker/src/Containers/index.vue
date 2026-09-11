<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { ContainerSummary, DockerError, ComposeProject, DockerContext } from '../types'
import ContainerList from './ContainerList.vue'
import ContainerDetail from './ContainerDetail.vue'
import ComposeLogs from './ComposeLogs.vue'
import ImageMarket from './ImageMarket.vue'
import ManageResources from './ManageResources.vue'
import CSelect from './CSelect.vue'

const containers = ref<ContainerSummary[]>([])
const composeProjects = ref<ComposeProject[]>([])
const selectedId = ref('')
const selectedProject = ref<{ name: string; configFile: string } | null>(null)   // compose 项目聚合日志视图
const module = ref<'manage' | 'create'>('manage')   // 头部模块：管理 / 创建
const manageTab = ref<'container' | 'images' | 'volumes' | 'networks' | 'cleanup'>('container')   // 管理资源页签

// 设置：代理 + 加速器
const showSettings = ref(false)
const proxyValue = ref('')
const mirrors = ref<string[]>([])
const loadingMirrors = ref(false)
const mirrorsOffline = ref(false)
const daemonJson = ref('')
const daemonPath = ref<{ path: string; note: string } | null>(null)
const fatalError = ref<DockerError | null>(null)   // DOCKER_NOT_FOUND → 整页引导
const banner = ref('')                              // DAEMON_DOWN / 连续轮询失败
const toast = ref('')

// 远程/自定义 docker 连接
const contexts = ref<DockerContext[]>([])
const connSelect = ref('')            // select 值：'ctx:<name>' | 'custom'
const connMode = ref<'local' | 'context' | 'custom'>('context')
const selectedContext = ref('')
const customHost = ref('')

// 连接下拉选项（CSS 自定义下拉）
const connOptions = computed(() => [
  ...contexts.value.map((c) => ({
    value: 'ctx:' + c.name,
    label: 'context · ' + c.name + (c.current ? '（默认）' : '')
  })),
  { value: 'custom', label: '自定义连接…' }
])

// 自定义连接弹窗
const showConnModal = ref(false)
const modalHost = ref('')
const testing = ref(false)
const testResultOk = ref(false)
const testResultMsg = ref('')

// 插件 Logo（Docker 官方 logo），走 public/ 资源；BASE_URL='./' 保证 file:// 加载下相对解析正确
const dockerLogo = import.meta.env.BASE_URL + 'logo.png'

let pollTimer: ReturnType<typeof setInterval> | null = null
let pollFailCount = 0
let toastTimer: ReturnType<typeof setTimeout> | null = null
let polling = false

const selected = computed(() => containers.value.find((c) => c.id === selectedId.value) || null)

// 比较容器列表是否有实际变化（轮询时避免数组整体替换导致列表重渲染、输入卡顿）
function containersChanged(oldList: ContainerSummary[], newList: ContainerSummary[]) {
  if (oldList.length !== newList.length) return true
  for (let i = 0; i < newList.length; i++) {
    const o = oldList[i]
    const n = newList[i]
    if (!o || o.id !== n.id || o.state !== n.state || o.status !== n.status || o.ports !== n.ports || o.image !== n.image) {
      return true
    }
  }
  return false
}

function composeChanged(oldList: ComposeProject[], newList: ComposeProject[]) {
  if (oldList.length !== newList.length) return true
  for (let i = 0; i < newList.length; i++) {
    const o = oldList[i]
    const n = newList[i]
    if (!o || o.name !== n.name || o.status !== n.status || o.configFiles !== n.configFiles) return true
  }
  return false
}

// 当前选中的 compose 项目是否含运行中容器（决定聚合日志能否跟随）
const hasRunningInProject = computed(() => {
  if (!selectedProject.value) return false
  return containers.value.some((c) => c.project === selectedProject.value!.name && c.state === 'running')
})

async function fetchList() {
  if (polling) return   // 防止轮询与手动刷新重叠导致并发竞态
  polling = true
  try {
    const res = await window.services.docker.listContainers()
    if (res.ok === true) {
      pollFailCount = 0
      fatalError.value = null
      banner.value = ''
      // 保持选中项：若容器被删则清空选中
      if (selectedId.value && !res.containers.some((c) => c.id === selectedId.value)) {
        selectedId.value = res.containers[0]?.id || ''
      }
      if (!selectedId.value && res.containers.length) selectedId.value = res.containers[0].id
      // 仅内容变化才替换数组，避免轮询整体重渲染导致输入/下拉卡顿
      if (containersChanged(containers.value, res.containers)) {
        containers.value = res.containers
      }
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
  } catch (err: any) {
    banner.value = err?.message || '获取容器列表失败'
  } finally {
    polling = false
  }
}

function showToast(msg: string) {
  toast.value = msg
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = ''), 3000)
}

// 创建容器后台任务状态（跨模块显示进度，完成后跳转新容器）
// 创建容器后台任务列表（支持多个并行，跨模块显示进度，完成跳转新容器）
interface CreateTaskItem {
  taskId: string
  running: boolean
  image: string
  name: string
  log: string
  percent: number
}
const createTasks = ref<CreateTaskItem[]>([])
const highlightId = ref('')   // 创建完成后高亮闪烁的新容器
let highlightTimer: ReturnType<typeof setTimeout> | null = null

// 统一风格确认弹窗（替代系统 window.confirm）
const confirmState = ref<{
  visible: boolean
  title: string
  message: string
  danger: boolean
  resolve: ((v: boolean) => void) | null
}>({ visible: false, title: '', message: '', danger: false, resolve: null })

function confirmAction(title: string, message: string, danger = false): Promise<boolean> {
  return new Promise((resolve) => {
    confirmState.value = { visible: true, title, message, danger, resolve }
  })
}

function onConfirmResult(yes: boolean) {
  const r = confirmState.value.resolve
  confirmState.value.visible = false
  confirmState.value.resolve = null
  if (r) r(yes)
}

function onTaskUpdate(evt: any) {
  if (evt.type === 'start') {
    createTasks.value.push({
      taskId: evt.taskId,
      running: true,
      image: evt.image,
      name: evt.name,
      log: '开始创建…',
      percent: 0
    })
    // 自动跳转到管理界面，实时查看后台创建进度
    module.value = 'manage'
    manageTab.value = 'container'
  } else if (evt.type === 'progress') {
    const t = createTasks.value.find((x) => x.taskId === evt.taskId)
    if (t) {
      t.log = evt.log || t.log
      t.percent = evt.percent
    }
  } else if (evt.type === 'done') {
    createTasks.value = createTasks.value.filter((x) => x.taskId !== evt.taskId)
    module.value = 'manage'
    manageTab.value = 'container'
    if (evt.id) {
      selectedId.value = evt.id
      // 高亮闪烁新容器提示
      highlightId.value = evt.id
      if (highlightTimer) clearTimeout(highlightTimer)
      highlightTimer = setTimeout(() => (highlightId.value = ''), 2500)
    }
    refreshAll()
    showToast('容器创建成功：' + (evt.name || ''))
  } else if (evt.type === 'error') {
    createTasks.value = createTasks.value.filter((x) => x.taskId !== evt.taskId)
    showToast(evt.message || '创建失败')
  }
}

// compose 项目列表：随左侧 3s 轮询一起刷新（项目状态如 running(2) 会变化）
async function fetchComposeProjects() {
  const res = await window.services.docker.listComposeProjects()
  if (res.ok === true) {
    if (composeChanged(composeProjects.value, res.projects)) {
      composeProjects.value = res.projects
    }
  } else {
    // compose 插件不可用/失败：清空项目列表，UI 降级为扁平列表
    composeProjects.value = []
  }
}

// 左侧数据整体刷新：容器列表 + compose 项目分组
function refreshAll() {
  fetchList()
  fetchComposeProjects()
}

async function runAction(action: 'start' | 'stop' | 'restart' | 'pause' | 'unpause' | 'remove' | 'removeFull') {
  if (!selectedId.value) return
  const id = selectedId.value
  const res =
    action === 'removeFull'
      ? await window.services.docker.removeContainerFully(id)
      : await window.services.docker[`${action}Container`](id)
  if (res.ok === true) {
    showToast('操作成功')
    await fetchList()
  } else {
    showToast(res.error.message)
  }
}

function onSelect(id: string) {
  selectedId.value = id
  selectedProject.value = null   // 选择容器时退出项目聚合日志视图
}

function onViewProject(p: { name: string; configFile: string }) {
  selectedProject.value = p
}

function onRefresh() {
  refreshAll()
}

// ===== 远程/自定义 docker 连接 =====

let hasSavedConnection = false

async function fetchContexts() {
  const res = await window.services.docker.listContexts()
  if (res.ok === true) {
    // 当前默认 context 排最前
    contexts.value = res.contexts.slice().sort((a, b) => Number(b.current) - Number(a.current))
    // 未保存过连接时，默认选中 docker 当前的默认 context
    if (!hasSavedConnection) {
      const cur = res.contexts.find((c) => c.current) || res.contexts[0]
      if (cur) {
        connMode.value = 'context'
        selectedContext.value = cur.name
        connSelect.value = 'ctx:' + cur.name
        window.services.docker.setConnection({ type: 'context', name: cur.name })
      }
    }
  }
}

// 当前连接对应的下拉值
function currentSelectValue(): string {
  if (connMode.value === 'context') return 'ctx:' + selectedContext.value
  if (connMode.value === 'custom') return 'custom'
  return ''
}

// 应用当前连接并持久化到 dbStorage
function applyConnection() {
  if (connMode.value === 'context') {
    window.services.docker.setConnection({ type: 'context', name: selectedContext.value })
  } else if (connMode.value === 'custom') {
    window.services.docker.setConnection({ type: 'host', host: customHost.value.trim() })
  }
  window.ztools.dbStorage.setItem('docker_connection', {
    mode: connMode.value,
    context: selectedContext.value,
    host: customHost.value.trim()
  })
  refreshAll()
}

function onConnChange() {
  const v = connSelect.value
  if (v === 'custom') {
    // 打开自定义连接弹窗，下拉恢复为当前实际连接
    connSelect.value = currentSelectValue()
    openConnModal()
    return
  }
  if (v.startsWith('ctx:')) {
    connMode.value = 'context'
    selectedContext.value = v.slice(4)
  }
  applyConnection()
}

// 恢复上次保存的连接（dbStorage）
function restoreConnection() {
  const saved: any = window.ztools.dbStorage.getItem('docker_connection')
  if (!saved || !saved.mode) return
  hasSavedConnection = true
  if (saved.mode === 'context' && saved.context) {
    connMode.value = 'context'
    selectedContext.value = saved.context
    connSelect.value = 'ctx:' + saved.context
    window.services.docker.setConnection({ type: 'context', name: saved.context })
  } else if (saved.mode === 'custom' && saved.host) {
    connMode.value = 'custom'
    customHost.value = saved.host
    connSelect.value = 'custom'
    window.services.docker.setConnection({ type: 'host', host: saved.host })
  }
}

// ===== 自定义连接弹窗 =====

function openConnModal() {
  modalHost.value = customHost.value || ''
  testResultOk.value = false
  testResultMsg.value = ''
  showConnModal.value = true
}

function closeConnModal() {
  showConnModal.value = false
  testing.value = false
}

// 测试连接：临时切换 host 拉容器，失败恢复原连接
async function testHost() {
  const host = modalHost.value.trim()
  if (!host || testing.value) return
  const prevConn = window.services.docker.getConnection()
  testing.value = true
  testResultOk.value = false
  testResultMsg.value = '正在测试连接…'
  window.services.docker.setConnection({ type: 'host', host })
  const res = await window.services.docker.listContainers()
  testing.value = false
  if (res.ok === true) {
    testResultOk.value = true
    testResultMsg.value = '连接成功：' + res.containers.length + ' 个容器'
  } else {
    testResultOk.value = false
    testResultMsg.value = '连接失败：' + res.error.message
    window.services.docker.setConnection(prevConn)   // 恢复原连接
  }
}

// 保存自定义连接到 dbStorage 并应用
function saveHost() {
  if (!testResultOk.value) return
  const host = modalHost.value.trim()
  customHost.value = host
  connMode.value = 'custom'
  connSelect.value = 'custom'
  window.services.docker.setConnection({ type: 'host', host })
  window.ztools.dbStorage.setItem('docker_connection', { mode: 'custom', host })
  showConnModal.value = false
  showToast('已保存自定义连接')
  refreshAll()
}

// ===== 设置：代理 + Docker 加速器 =====

function saveProxy() {
  const v = proxyValue.value.trim()
  window.services.registry.setProxy(v)
  window.ztools.dbStorage.setItem('docker_proxy', v)
  showToast(v ? '代理已保存' : '代理已清除')
}

async function loadMirrors() {
  loadingMirrors.value = true
  const r = await window.services.registry.fetchMirrors()
  loadingMirrors.value = false
  if (r.ok === true && r.mirrors) {
    mirrors.value = r.mirrors
    mirrorsOffline.value = !!r.offline
    daemonJson.value = window.services.registry.generateDaemonJson(r.mirrors)
    daemonPath.value = window.services.registry.daemonConfigPath()
  } else {
    showToast(r.error || '加速器列表获取失败')
  }
}

function copyDaemonJson() {
  if (!daemonJson.value) return
  window.ztools.copyText(daemonJson.value)
  showToast('daemon.json 已复制')
}

onMounted(() => {
  restoreConnection()
  fetchContexts()
  refreshAll()
  // 恢复代理配置
  const savedProxy: any = window.ztools.dbStorage.getItem('docker_proxy')
  if (savedProxy) {
    proxyValue.value = savedProxy
    window.services.registry.setProxy(savedProxy)
  }
  pollTimer = setInterval(refreshAll, 3000)
})

onBeforeUnmount(() => {
  if (pollTimer) clearInterval(pollTimer)
  if (toastTimer) clearTimeout(toastTimer)
  if (highlightTimer) clearTimeout(highlightTimer)
})
</script>

<template>
  <div class="containers">
    <!-- 致命错误：仅 docker 命令不存在时整页引导 -->
    <div v-if="fatalError" class="fatal">
      <img class="fatal-icon" :src="dockerLogo" alt="Docker" />
      <h2>未检测到 Docker</h2>
      <p>{{ fatalError.message }}</p>
      <a href="https://www.docker.com/products/docker-desktop/" target="_blank" rel="noopener">安装 Docker Desktop</a>
    </div>

    <template v-else>
      <div class="toolbar">
        <div class="module-tabs">
          <button class="tab" :class="{ active: module === 'manage' }" @click="module = 'manage'">管理</button>
          <button class="tab" :class="{ active: module === 'create' }" @click="module = 'create'">创建</button>
        </div>
        <span class="title"><img class="title-logo" :src="dockerLogo" alt="Docker" />Docker Lite</span>
        <CSelect
          v-model="connSelect"
          :options="connOptions"
          placeholder="选择连接"
          @change="onConnChange"
        />
        <button class="btn" @click="onRefresh"><span class="btn-icon icon-refresh"></span>刷新</button>
        <button class="btn" @click="showSettings = true">设置</button>
      </div>

      <div v-show="module === 'manage'" class="manage-wrap">
        <div class="res-tabs">
          <button class="tab" :class="{ active: manageTab === 'container' }" @click="manageTab = 'container'">容器</button>
          <button class="tab" :class="{ active: manageTab === 'images' }" @click="manageTab = 'images'">镜像</button>
          <button class="tab" :class="{ active: manageTab === 'volumes' }" @click="manageTab = 'volumes'">卷</button>
          <button class="tab" :class="{ active: manageTab === 'networks' }" @click="manageTab = 'networks'">网络</button>
          <button class="tab" :class="{ active: manageTab === 'cleanup' }" @click="manageTab = 'cleanup'">清理</button>
        </div>

        <div v-show="manageTab === 'container'" class="container-view">
          <div v-if="createTasks.length" class="create-tasks">
            <div v-for="t in createTasks" :key="t.taskId" class="create-task">
              <div class="ct-head">
                <span class="ct-title">创建容器：{{ t.name }}</span>
                <span class="ct-percent">{{ t.percent }}%</span>
              </div>
              <div class="ct-bar"><div class="ct-fill" :style="{ width: t.percent + '%' }"></div></div>
              <div class="ct-log">{{ t.log }}</div>
            </div>
          </div>
          <div v-if="banner" class="banner">{{ banner }}</div>

          <div class="split">
            <ContainerList
              :containers="containers"
              :compose-projects="composeProjects"
              :selected-id="selectedId"
              :highlight-id="highlightId"
              @select="onSelect"
              @view-project="onViewProject"
            />
            <ComposeLogs
              v-if="selectedProject"
              :project-name="selectedProject.name"
              :config-file="selectedProject.configFile"
              :running="hasRunningInProject"
            />
            <ContainerDetail
              v-else-if="selected"
              :container="selected"
              :confirm="confirmAction"
              @action="runAction"
              @toast="showToast"
            />
            <div v-else class="empty-pane">选择左侧容器查看详情</div>
          </div>
        </div>

        <ManageResources
          v-if="manageTab !== 'container'"
          :type="manageTab as 'images' | 'volumes' | 'networks' | 'cleanup'"
          :confirm="confirmAction"
          @toast="showToast"
        />
      </div>

      <KeepAlive>
        <ImageMarket v-if="module === 'create'" @toast="showToast" @task="onTaskUpdate" />
      </KeepAlive>
    </template>

    <div v-if="showConnModal" class="modal-mask" @click.self="closeConnModal">
      <div class="modal">
        <h3>自定义 Docker 连接</h3>
        <p class="modal-hint">填写远程 Docker daemon 地址</p>
        <input
          v-model="modalHost"
          class="modal-input"
          placeholder="tcp://192.168.1.10:2375 / ssh://user@host"
          @keyup.enter="testHost"
        />
        <div class="modal-actions">
          <button class="btn" :disabled="testing" @click="testHost">测试连接</button>
          <button class="btn primary" :disabled="!testResultOk" @click="saveHost">保存并连接</button>
          <button class="btn" @click="closeConnModal">取消</button>
        </div>
        <div v-if="testResultMsg" class="test-result" :class="{ ok: testResultOk }">{{ testResultMsg }}</div>
      </div>
    </div>

    <div v-if="confirmState.visible" class="modal-mask" @click.self="onConfirmResult(false)">
      <div class="modal confirm-modal">
        <h3>{{ confirmState.title }}</h3>
        <p class="confirm-msg">{{ confirmState.message }}</p>
        <div class="modal-actions">
          <button class="btn" @click="onConfirmResult(false)">取消</button>
          <button class="btn" :class="confirmState.danger ? 'danger' : 'primary'" @click="onConfirmResult(true)">确认</button>
        </div>
      </div>
    </div>

    <div v-if="showSettings" class="modal-mask" @click.self="showSettings = false">
      <div class="modal settings-modal">
        <div class="modal-head">
          <h3>设置</h3>
          <button class="modal-close" title="关闭" @click="showSettings = false">×</button>
        </div>

        <section class="setting-sec">
          <div class="sec-title">代理配置</div>
          <p class="hint">用于搜索被墙镜像源（如 Docker Hub 官方）</p>
          <div class="row">
            <input v-model="proxyValue" class="sec-input" placeholder="http://127.0.0.1:7890" />
            <button class="btn primary" @click="saveProxy">保存</button>
          </div>
        </section>

        <section class="setting-sec">
          <div class="sec-title">Docker 加速器</div>
          <p class="hint">解析可用镜像加速器，生成各平台 daemon.json 配置</p>
          <button class="btn" :disabled="loadingMirrors" @click="loadMirrors">
            {{ loadingMirrors ? '获取中…' : '获取加速器列表' }}
          </button>
          <template v-if="mirrors.length">
            <p v-if="mirrorsOffline" class="hint warn-hint">在线加速器列表获取失败，已使用内置常用加速器</p>
            <div class="mirror-list">
              <span v-for="m in mirrors" :key="m" class="mirror-chip">{{ m }}</span>
            </div>
            <pre class="daemon-preview">{{ daemonJson }}</pre>
            <div class="row">
              <button class="btn primary" @click="copyDaemonJson">复制 daemon.json</button>
              <span class="path-hint">{{ daemonPath?.path }}</span>
            </div>
            <p class="hint">{{ daemonPath?.note }}</p>
          </template>
        </section>

        <div class="modal-actions">
          <button class="btn" @click="showSettings = false">关闭</button>
        </div>
      </div>
    </div>

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
.module-tabs {
  display: flex;
  gap: 2px;
  padding: 2px;
  border-radius: var(--ctrl-radius);
  background: var(--panel-bg);
  flex-shrink: 0;
}
.module-tabs .tab {
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  padding: 0 12px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  border-radius: var(--ctrl-radius);
  cursor: pointer;
}
.module-tabs .tab.active { background: var(--blue); color: var(--light); }
.res-tabs {
  display: flex;
  gap: 2px;
  padding: 4px 12px;
  border-bottom: 1px solid var(--border-color);
  background: var(--panel-bg);
}
.res-tabs .tab {
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  padding: 0 12px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  border-radius: var(--ctrl-radius);
  cursor: pointer;
}
.res-tabs .tab.active { background: var(--blue); color: var(--light); }
.manage-wrap { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.container-view { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.create-tasks { display: flex; flex-direction: column; gap: 6px; }
.create-task {
  margin: 8px 12px 0;
  border: 1px solid var(--border-color);
  border-radius: var(--ctrl-radius);
  background: var(--panel-bg);
  padding: 8px 12px;
}
.create-tasks .create-task { margin: 0; }
.ct-head { display: flex; align-items: center; justify-content: space-between; font-size: 12px; margin-bottom: 6px; }
.ct-title { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ct-percent { color: var(--blue); font-weight: 600; flex-shrink: 0; margin-left: 8px; }
.ct-bar { height: 5px; background: rgba(0, 0, 0, 0.08); border-radius: 3px; overflow: hidden; }
.ct-fill { height: 100%; background: var(--blue); transition: width 0.2s; }
.ct-log { font-size: 11px; color: var(--text-secondary); margin-top: 5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.title { font-weight: 600; margin-right: auto; display: flex; align-items: center; gap: 6px; }
.title-logo { width: 20px; height: 20px; }
.conn-select {
  height: var(--ctrl-height);
  border: 1px solid var(--border-color);
  background: var(--panel-bg);
  color: inherit;
  padding: 0 6px;
  border-radius: var(--ctrl-radius);
  min-width: 140px;
}
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
.fatal-icon { width: 80px; height: 80px; }
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
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 20;
}
.modal {
  width: 420px;
  background: #fff;
  color: inherit;
  border: 1px solid var(--border-color);
  border-radius: 10px;
  padding: 16px 20px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
}
@media (prefers-color-scheme: dark) {
  .modal { background: #2b2b2b; }
}
.modal h3 { margin: 0 0 4px; }
.modal-hint { margin: 0 0 12px; font-size: 12px; color: var(--text-secondary); }
.modal-input {
  width: 100%;
  height: var(--ctrl-height);
  padding: 0 10px;
  border: 1px solid var(--border-color);
  border-radius: var(--ctrl-radius);
  background: var(--panel-bg);
  color: inherit;
  box-sizing: border-box;
}
.modal-actions { display: flex; justify-content: flex-end; gap: 6px; margin-top: 14px; }
.confirm-modal { width: 360px; }
.confirm-msg { font-size: 13px; line-height: 1.6; color: inherit; margin: 10px 0 0; word-break: break-all; }
.test-result { margin-top: 10px; font-size: 12px; color: var(--danger); word-break: break-all; }
.test-result.ok { color: var(--ok); }
.settings-modal { width: 520px; max-height: 80vh; overflow-y: auto; }
.modal-head { display: flex; align-items: center; justify-content: space-between; }
.modal-head h3 { margin: 0; }
.modal-close {
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
}
.modal-close:hover { color: var(--danger); background: var(--panel-bg); }
.setting-sec { margin: 14px 0 0; padding-top: 14px; border-top: 1px solid var(--border-color); }
.setting-sec:first-of-type { border-top: none; margin-top: 10px; padding-top: 0; }
.sec-title { font-size: 13px; font-weight: 600; margin-bottom: 4px; }
.hint { font-size: 12px; color: var(--text-secondary); margin: 4px 0; line-height: 1.5; }
.warn-hint { color: var(--warn); }
.row { display: flex; gap: 6px; align-items: center; }
.sec-input {
  flex: 1;
  min-width: 0;
  height: var(--ctrl-height);
  padding: 0 10px;
  border: 1px solid var(--border-color);
  border-radius: var(--ctrl-radius);
  background: var(--panel-bg);
  color: inherit;
  box-sizing: border-box;
}
.mirror-list { display: flex; flex-wrap: wrap; gap: 4px; margin: 8px 0; }
.mirror-chip {
  font-size: 11px;
  color: var(--text-secondary);
  border: 1px solid var(--border-color);
  border-radius: 10px;
  padding: 1px 8px;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.path-hint { font-size: 11px; color: var(--text-secondary); }
.daemon-preview {
  margin: 8px 0;
  background: rgba(0, 0, 0, 0.08);
  border-radius: var(--ctrl-radius);
  padding: 8px;
  font-size: 11px;
  font-family: ui-monospace, Menlo, monospace;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
