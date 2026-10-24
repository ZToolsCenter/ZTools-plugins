<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import ServicesPanel from './panels/ServicesPanel.vue'
import NssmPanel from './panels/NssmPanel.vue'
import { pickPath, type NssmDetect } from './api'

const tab = ref('services')
const admin = ref(false)
const checking = ref(true)
const nssm = ref<NssmDetect>({ found: false, path: '', version: '' })

const servicesRef = ref<InstanceType<typeof ServicesPanel>>()
const nssmRef = ref<InstanceType<typeof NssmPanel>>()

// 环境检测：管理员身份 + nssm 可用性。进插件和每次刷新都重跑
async function refreshEnv() {
  checking.value = true
  try {
    admin.value = await window.services.isAdmin()
    nssm.value = await window.services.detectNssm()
  } catch (e: any) {
    ElMessage.error('环境检测失败：' + (e?.message || e))
  }
  checking.value = false
}

async function refreshAll() {
  await Promise.all([refreshEnv(), servicesRef.value?.refresh(), nssmRef.value?.refresh()])
}

// 服务列表里点「NSSM」标签 → 跳到 nssm 页并打开编辑
function gotoNssmEdit(name: string) {
  tab.value = 'nssm'
  nssmRef.value?.openEdit(name)
}

// ==================== nssm 路径配置（全局头部入口） ====================
const pathDialog = ref(false)
const nssmPathInput = ref('')
const savingPath = ref(false)

function openPathDialog() {
  nssmPathInput.value = nssm.value.path || window.services.getNssmPath() || ''
  pathDialog.value = true
}

function browseNssm() {
  const p = pickPath('file', '选择 nssm.exe', [{ name: 'nssm 程序', extensions: ['exe'] }])
  if (p) nssmPathInput.value = p
}

async function savePath() {
  if (!nssmPathInput.value.trim()) {
    ElMessage.warning('请填写 nssm.exe 完整路径')
    return
  }
  savingPath.value = true
  const r = await window.services.saveNssmPath(nssmPathInput.value.trim())
  savingPath.value = false
  if (r.ok) {
    ElMessage.success(r.message)
    pathDialog.value = false
    await refreshEnv()
  } else {
    ElMessage.error(r.message)
  }
}

function openDownload() {
  window.ztools.shellOpenExternal('https://nssm.cc/download')
}

let entered = false

// 窗口高度跟随内容：写死 640 会在内容不足时底部留白
// ResizeObserver 监听 .app 高度变化（切标签页/数据加载），防抖后同步 setExpendHeight
let fitTimer: ReturnType<typeof setTimeout> | undefined
function fitHeight() {
  if (typeof (window.ztools as any).setExpendHeight !== 'function') return
  const h = Math.ceil(document.documentElement.scrollHeight)
  if (h > 100) window.ztools.setExpendHeight(Math.min(h, 760))
}
function scheduleFit() {
  clearTimeout(fitTimer)
  fitTimer = setTimeout(fitHeight, 150)
}

onMounted(() => {
  // 列表/环境刷新只以 onPluginEnter 为单一入口，避免进插件时连刷两次
  window.ztools.onPluginEnter(() => {
    entered = true
    refreshAll()
  })
  // 兜底：个别宿主时序下进插件可能不触发 onPluginEnter，800ms 后自行刷一次
  setTimeout(() => {
    if (!entered) refreshAll()
  }, 800)
  scheduleFit()
  new ResizeObserver(scheduleFit).observe(document.querySelector('.app')!)
})
</script>

<template>
  <div class="app">
    <div class="header">
      <div class="header-left">
        <el-tag v-if="!checking" :type="admin ? 'success' : 'info'" size="small">
          {{ admin ? '管理员模式' : '普通权限' }}
        </el-tag>
        <el-tooltip v-if="nssm.found" :content="nssm.path" placement="bottom">
          <el-tag type="primary" size="small">{{ nssm.version }}</el-tag>
        </el-tooltip>
        <el-button size="small" @click="openPathDialog">nssm 路径</el-button>
      </div>
      <el-button size="small" :loading="checking" @click="refreshAll">刷新</el-button>
    </div>

    <el-tabs v-model="tab">
      <el-tab-pane label="系统服务" name="services">
        <ServicesPanel ref="servicesRef" @manage-nssm="gotoNssmEdit" />
      </el-tab-pane>
      <el-tab-pane label="NSSM 管理" name="nssm">
        <NssmPanel ref="nssmRef" :env="nssm" @open-path="openPathDialog" />
      </el-tab-pane>
    </el-tabs>

    <!-- 路径配置弹窗：无论是否已检测到，都允许重新选择/修改 nssm 路径 -->
    <el-dialog v-model="pathDialog" title="配置 nssm 路径" width="90%" :close-on-click-modal="false" :lock-scroll="false">
      <div style="display: flex; gap: 8px">
        <el-input v-model="nssmPathInput" placeholder="例如 C:\nssm\nssm.exe（win64 版本）" size="small">
          <template #append>
            <el-button @click="browseNssm">浏览</el-button>
          </template>
        </el-input>
        <el-button size="small" type="primary" :loading="savingPath" @click="savePath">验证并保存</el-button>
      </div>
      <p class="tip">
        当前生效：{{ nssm.found ? nssm.path : '未配置' }}
        。保存前会执行一次 nssm version 验证；已注册 nssm 服务的路径会参与自动探测，通常无需手动改。
        <el-link type="primary" style="vertical-align: baseline" @click="openDownload">没有 nssm？官网下载</el-link>
      </p>
    </el-dialog>
  </div>
</template>

<style scoped>
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 8px 0;
}

.header-left {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
</style>
