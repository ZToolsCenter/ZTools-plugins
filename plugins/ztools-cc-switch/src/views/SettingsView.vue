<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps({
  runtimeInfo: { type: Object, default: null },
  clientStatus: { type: Object, default: () => ({}) },
  themePreference: { type: String, default: 'light' },
  clients: { type: Array, default: () => [] },
  visibleClientIds: { type: Array, default: () => [] },
  initialTab: { type: String, default: 'appearance' }
})
const emit = defineEmits(['back', 'import-live', 'toast', 'reload', 'theme-change', 'client-visibility-change'])

const configuredCount = computed(() => Object.values(props.clientStatus).filter((item) => item.activeProviderId).length)
const clientCount = computed(() => Object.keys(props.clientStatus).length)
const sidecarReady = computed(() => props.runtimeInfo?.sidecar?.available === true)
const webdav = ref({ url: '', username: '', password: '', remotePath: 'ai-provider-switch/backup.json', autoSync: false, intervalMinutes: 30, conflictStrategy: 'ask', includeLogs: true })
const webdavStatus = ref({ state: 'idle', message: '尚未同步' })
let unsubscribeWebdav = null
const webdavBusy = computed(() => ['checking', 'uploading', 'downloading'].includes(webdavStatus.value.state))
const s3 = ref({ enabled: false, autoSync: false, intervalMinutes: 30, region: 'us-east-1', bucket: '', accessKeyId: '', secretAccessKey: '', endpoint: '', remoteRoot: 'cc-switch-sync', profile: 'default', includeLogs: true, conflictStrategy: 'ask', preset: 'aws' })
const s3Status = ref({ state: 'idle', message: '尚未同步' })
const s3RemoteInfo = ref(null)
let unsubscribeS3 = null
const s3Busy = computed(() => ['checking', 'uploading', 'downloading', 'testing'].includes(s3Status.value.state))
const outboundProxy = ref({ enabled: false, url: '', username: '', password: '', hasPassword: false, secureStorage: false, effectiveMode: 'direct', systemProxy: null })
const proxyDetected = ref([])
const proxyBusy = ref('')
const proxyTest = ref(null)
const claudeOnboarding = ref({ enabled: false, configured: false, path: '' })
const onboardingBusy = ref(false)
const claudePlugin = ref({ enabled: false, exists: false, path: '' })
const claudePluginBusy = ref(false)
const toolRows = ref([])
const toolBusy = ref('')
const appConfigDir = ref({ path: '', activePath: '', defaultPath: '', restartRequired: false })
const backupSettings = ref({ intervalHours: 24, retainCount: 10 })
const localBackups = ref([])
const backupBusy = ref('')
const lastExportPath = ref('')
const canStartDrag = typeof window.ztools?.startDrag === 'function'
const commonConfigClient = ref('claude')
const commonConfigText = ref('')
const commonConfigBusy = ref('')
const hostStartup = ref({ autoStartRouter: false, restoreOnPluginEnter: true })
const routerEngine = ref({ running: false, config: { routes: {} }, activeConnections: 0 })
const routerBusy = ref(false)
const codexHistory = ref({ enabled: false, migrateExisting: false, hasBackup: false, liveUnified: false, codexDir: '' })
const codexHistoryBusy = ref(false)
const logConfig = ref({ enabled: true, level: 'info', retentionDays: 30, maxFileSizeMb: 20, maxRequestEntries: 50000 })
const logFiles = ref([])
const logBusy = ref('')
const settingsTab = ref(props.initialTab)
const settingsTabs = [
  { id: 'appearance', label: '界面', hint: '主题与菜单' },
  { id: 'clients', label: '客户端', hint: '配置与工具' },
  { id: 'system', label: '高级', hint: '宿主与网络' },
  { id: 'data', label: '数据', hint: '日志与备份' },
  { id: 'sync', label: '同步', hint: 'WebDAV / S3' }
]
watch(() => props.initialTab, (value) => { if (settingsTabs.some((tab) => tab.id === value)) settingsTab.value = value })
const commonConfigPlaceholder = computed(() => commonConfigClient.value === 'codex' ? '# TOML shared preferences' : '{\n  "sharedPreference": true\n}')
const visibleClientSet = computed(() => new Set(props.visibleClientIds))
const activeRouteCount = computed(() => Object.values(routerEngine.value.config?.routes || {}).filter(Boolean).length)
function clientGlyph(client) { return ({ claude: 'C', 'claude-desktop': 'CD', codex: 'X', gemini: 'G', opencode: 'O', openclaw: 'W', hermes: 'H', grokbuild: 'K' })[client] || '?' }
function toggleClientVisibility(clientId) {
  const next = visibleClientSet.value.has(clientId)
    ? props.visibleClientIds.filter((id) => id !== clientId)
    : [...props.visibleClientIds, clientId]
  if (!next.length) { emit('toast', '请至少保留一个 AI 客户端菜单', 'warning'); return }
  emit('client-visibility-change', next)
}
function showOnlyClient(clientId) { emit('client-visibility-change', [clientId]) }
function showAllClients() { emit('client-visibility-change', props.clients.map((client) => client.id)) }
onMounted(async () => {
  if (!window.ccSwitch?.getWebdavConfig) return
  webdav.value = { ...webdav.value, ...(await window.ccSwitch.getWebdavConfig()), password: '' }
  webdavStatus.value = window.ccSwitch.getWebdavStatus()
  unsubscribeWebdav = window.ccSwitch.onWebdavStatus((value) => { webdavStatus.value = value })
  if (window.ccSwitch.getS3Config) {
    s3.value = { ...s3.value, ...(await window.ccSwitch.getS3Config()), secretAccessKey: '' }
    s3Status.value = window.ccSwitch.getS3Status()
    unsubscribeS3 = window.ccSwitch.onS3Status((value) => { s3Status.value = value })
  }
  if (window.ccSwitch.getOutboundProxyConfig) outboundProxy.value = { ...outboundProxy.value, ...(await window.ccSwitch.getOutboundProxyConfig()), password: '' }
  if (window.ccSwitch.getClaudeOnboardingStatus) claudeOnboarding.value = await window.ccSwitch.getClaudeOnboardingStatus()
  if (window.ccSwitch.getClaudePluginIntegrationStatus) claudePlugin.value = await window.ccSwitch.getClaudePluginIntegrationStatus()
  if (window.ccSwitch.getToolVersions) await loadTools()
  if (window.ccSwitch.getAppConfigDirOverride) appConfigDir.value = await window.ccSwitch.getAppConfigDirOverride()
  if (window.ccSwitch.getLocalBackupSettings) {
    backupSettings.value = await window.ccSwitch.getLocalBackupSettings()
    localBackups.value = await window.ccSwitch.listLocalBackups()
  }
  if (window.ccSwitch.getCommonConfigSnippet) await loadCommonConfig()
  if (window.ccSwitch.getHostStartupSettings) hostStartup.value = window.ccSwitch.getHostStartupSettings()
  if (window.ccSwitch.getRouterStatus) routerEngine.value = await window.ccSwitch.getRouterStatus()
  if (window.ccSwitch.getCodexHistoryUnifyStatus) codexHistory.value = await window.ccSwitch.getCodexHistoryUnifyStatus()
  if (window.ccSwitch.getLogConfig) { logConfig.value = await window.ccSwitch.getLogConfig(); logFiles.value = await window.ccSwitch.listLogFiles() }
})
onBeforeUnmount(() => { unsubscribeWebdav?.(); unsubscribeS3?.() })
async function saveWebdav() {
  try { const patch = { ...webdav.value }; if (!patch.password) delete patch.password; const saved = await window.ccSwitch.saveWebdavConfig(patch); webdav.value = { ...webdav.value, ...saved, password: '' }; emit('toast', 'WebDAV 设置已保存') } catch (error) { emit('toast', error.message, 'error') }
}
async function webdavAction(action, options = {}) {
  try { const result = await window.ccSwitch[action](options); if (result.state === 'conflict') emit('toast', result.message, 'warning'); else emit('toast', result.message); if (result.direction === 'download') emit('reload') } catch (error) { emit('toast', error.message, 'error') }
}
function applyS3Preset() {
  if (s3.value.preset === 'aws') { s3.value.endpoint = ''; if (!s3.value.region) s3.value.region = 'us-east-1' }
  if (s3.value.preset === 'r2') { s3.value.region = 'auto' }
  if (s3.value.preset === 'minio') { s3.value.region ||= 'us-east-1'; s3.value.endpoint ||= 'http://127.0.0.1:9000' }
}
async function saveS3() {
  try { const patch = { ...s3.value }; delete patch.preset; if (!patch.secretAccessKey) delete patch.secretAccessKey; const saved = await window.ccSwitch.saveS3Config(patch); s3.value = { ...s3.value, ...saved, secretAccessKey: '' }; emit('toast', 'S3 设置已保存') } catch (error) { emit('toast', error.message, 'error') }
}
async function testS3() {
  const previous = s3Status.value; s3Status.value = { state: 'testing', message: '正在测试 S3 连接…' }
  try { const result = await window.ccSwitch.testS3Connection({ ...s3.value }); emit('toast', result.message); s3Status.value = { state: 'idle', message: result.message } }
  catch (error) { s3Status.value = { state: 'error', message: error.message }; emit('toast', error.message, 'error') }
  finally { if (s3Status.value.state === 'testing') s3Status.value = previous }
}
async function previewS3(action) {
  try {
    s3RemoteInfo.value = await window.ccSwitch.getS3RemoteInfo()
    if (action === 'download' && !s3RemoteInfo.value) throw new Error('S3 远端尚无快照')
    const description = s3RemoteInfo.value ? `远端快照来自 ${s3RemoteInfo.value.deviceName}，时间 ${new Date(s3RemoteInfo.value.createdAt).toLocaleString()}。` : '远端还没有快照。'
    const verb = action === 'download' ? '下载会覆盖本地插件数据' : '上传会替换远端当前快照'
    if (!window.confirm(`${description}\n${verb}，继续？`)) return
    await s3Action(action === 'download' ? 'downloadS3' : 'uploadS3', { force: true })
  } catch (error) { emit('toast', error.message, 'error') }
}
async function s3Action(action, options = {}) {
  try { const result = await window.ccSwitch[action](options); if (result.state === 'conflict') emit('toast', result.message, 'warning'); else emit('toast', result.message); if (result.direction === 'download') emit('reload') } catch (error) { emit('toast', error.message, 'error') }
}
async function exportBackup() {
  try {
    const target = await window.ccSwitch.chooseBackupExportPath(); if (!target) return
    const result = await window.ccSwitch.exportBackup(target, { includeSecrets: true, includeLogs: true })
    lastExportPath.value = result.path || ''
    emit('toast', `已导出 ${result.fileCount} 项数据`)
  } catch (error) { emit('toast', error.message, 'error') }
}
async function dragExport(event) {
  event.preventDefault()
  if (!lastExportPath.value || !window.ccSwitch.startDrag) return
  const started = await window.ccSwitch.startDrag(lastExportPath.value)
  emit('toast', started ? '已开始拖出备份' : '拖出授权已失效，请重新导出', started ? 'success' : 'warning')
  if (started) lastExportPath.value = ''
}
async function importBackup() {
  try { const source = await window.ccSwitch.chooseBackupImportPath(); if (!source) return; if (!window.confirm('导入会覆盖插件数据，并为原文件保留备份。继续？')) return; const result = await window.ccSwitch.importBackup(source); emit('toast', `已导入 ${result.imported} 项数据`); emit('reload') } catch (error) { emit('toast', error.message, 'error') }
}
async function chooseAppConfigDir() {
  try {
    const selected = await window.ccSwitch.chooseAppConfigDirectory(); if (!selected) return
    appConfigDir.value = await window.ccSwitch.setAppConfigDirOverride(selected)
    emit('toast', '数据目录已保存，重新打开插件后生效', 'warning')
  } catch (error) { emit('toast', error.message, 'error') }
}
async function resetAppConfigDir() {
  try { appConfigDir.value = await window.ccSwitch.setAppConfigDirOverride(''); emit('toast', '已恢复默认数据目录，重新打开插件后生效', 'warning') }
  catch (error) { emit('toast', error.message, 'error') }
}
async function openClientConfigDirectory(client) {
  try { await window.ccSwitch.openClientConfigDirectory(client); emit('toast', `已打开 ${props.clientStatus[client]?.name || client} 配置目录`) }
  catch (error) { emit('toast', error.message, 'error') }
}
async function openAppDataDirectory() {
  try { await window.ccSwitch.openAppDataDirectory(); emit('toast', '已打开插件数据目录') }
  catch (error) { emit('toast', error.message, 'error') }
}
function formatBytes(bytes) { return bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1048576).toFixed(1)} MB` }
async function saveBackupPolicy() {
  try { backupSettings.value = await window.ccSwitch.saveLocalBackupSettings(backupSettings.value); emit('toast', '自动快照策略已保存') }
  catch (error) { emit('toast', error.message, 'error') }
}
async function createLocalSnapshot() {
  backupBusy.value = 'create'
  try { const result = await window.ccSwitch.createLocalBackup(); localBackups.value = await window.ccSwitch.listLocalBackups(); emit('toast', `已创建 ${result.filename}`) }
  catch (error) { emit('toast', error.message, 'error') } finally { backupBusy.value = '' }
}
async function restoreLocalSnapshot(item) {
  if (!window.confirm(`恢复「${item.filename}」会覆盖当前插件数据；系统会先创建安全快照。继续？`)) return
  backupBusy.value = item.filename
  try { const result = await window.ccSwitch.restoreLocalBackup(item.filename); emit('toast', `恢复完成；安全快照 ${result.safetyBackup}`); emit('reload'); localBackups.value = await window.ccSwitch.listLocalBackups() }
  catch (error) { emit('toast', error.message, 'error') } finally { backupBusy.value = '' }
}
async function renameLocalSnapshot(item) {
  const name = window.prompt('新的快照名称（字母、数字、点、下划线或短横线）', item.filename.replace(/\.snapshot\.json$/, '')); if (!name) return
  try { await window.ccSwitch.renameLocalBackup(item.filename, name); localBackups.value = await window.ccSwitch.listLocalBackups(); emit('toast', '快照已重命名') }
  catch (error) { emit('toast', error.message, 'error') }
}
async function deleteLocalSnapshot(item) {
  if (!window.confirm(`永久删除「${item.filename}」？`)) return
  try { await window.ccSwitch.deleteLocalBackup(item.filename); localBackups.value = await window.ccSwitch.listLocalBackups(); emit('toast', '快照已删除') }
  catch (error) { emit('toast', error.message, 'error') }
}
async function loadCommonConfig() {
  try { commonConfigText.value = await window.ccSwitch.getCommonConfigSnippet(commonConfigClient.value) }
  catch (error) { emit('toast', error.message, 'error') }
}
async function extractCommonConfig() {
  commonConfigBusy.value = 'extract'
  try { commonConfigText.value = await window.ccSwitch.extractCommonConfigSnippet(commonConfigClient.value); emit('toast', '已从当前配置提取并过滤 Provider 专属字段') }
  catch (error) { emit('toast', error.message, 'error') } finally { commonConfigBusy.value = '' }
}
async function saveCommonConfig() {
  commonConfigBusy.value = 'save'
  try { await window.ccSwitch.setCommonConfigSnippet(commonConfigClient.value, commonConfigText.value); emit('toast', commonConfigText.value.trim() ? '通用配置片段已保存并同步当前 Provider' : '通用配置片段已清空') }
  catch (error) { emit('toast', error.message, 'error') } finally { commonConfigBusy.value = '' }
}
async function saveHostStartup() {
  try { hostStartup.value = window.ccSwitch.saveHostStartupSettings(hostStartup.value); emit('toast', hostStartup.value.autoStartRouter ? '本地路由将随 ZTools 插件恢复' : '已关闭宿主启动路由恢复') }
  catch (error) { emit('toast', error.message, 'error') }
}
async function emergencyStopRouter() {
  const count = activeRouteCount.value
  if (!window.confirm(`停止共享路由引擎并恢复 ${count} 个客户端的接管前配置？\n\n正在进行的请求会中断；Provider 与故障转移配置不会删除。`)) return
  routerBusy.value = true
  try {
    routerEngine.value = await window.ccSwitch.stopRouter()
    emit('toast', '全部客户端已恢复直连，路由引擎已停止', 'warning')
    emit('reload')
  } catch (error) { emit('toast', error.message, 'error') }
  finally { routerBusy.value = false }
}
async function saveLogConfig() {
  logBusy.value = 'save'
  try { logConfig.value = await window.ccSwitch.saveLogConfig(logConfig.value); logFiles.value = await window.ccSwitch.listLogFiles(); emit('toast', '日志策略已保存并立即维护') }
  catch (error) { emit('toast', error.message, 'error') } finally { logBusy.value = '' }
}
async function maintainLogs() {
  logBusy.value = 'maintain'
  try { const result = await window.ccSwitch.maintainLogs(); logFiles.value = await window.ccSwitch.listLogFiles(); emit('toast', result.changed ? `请求日志已压缩，移除 ${result.removed} 条` : '日志已经符合保留策略') }
  catch (error) { emit('toast', error.message, 'error') } finally { logBusy.value = '' }
}
async function clearAllLogs() {
  if (!window.confirm('清理插件、请求与连通检测日志？原文件会重命名为可恢复备份。')) return
  logBusy.value = 'clear'
  try { const result = await window.ccSwitch.clearAllLogs(); logFiles.value = await window.ccSwitch.listLogFiles(); emit('toast', `已清理 ${result.cleared} 个日志文件并保留备份`) }
  catch (error) { emit('toast', error.message, 'error') } finally { logBusy.value = '' }
}
async function toggleCodexHistory() {
  codexHistoryBusy.value = true
  try {
    if (!codexHistory.value.enabled) {
      if (!window.confirm('开启后，官方 Codex 与第三方 Provider 的新会话将进入同一历史桶。继续？')) return
      const migrateExisting = window.confirm('是否同时迁移既有官方 Codex 会话？迁移前会备份 JSONL 与 state SQLite。')
      const result = await window.ccSwitch.enableCodexHistoryUnify({ migrateExisting })
      emit('toast', result.skippedReason === 'live_not_unified' ? '开关已启用，但当前 Codex 配置存在显式路由；存量迁移将在共享路由生效后重试' : `Codex 历史已统一 · JSONL ${result.migratedJsonlFiles} · SQLite ${result.migratedStateRows}`, result.skippedReason ? 'warning' : 'success')
    } else {
      if (!window.confirm('关闭统一历史后，新官方会话将恢复到 openai 历史桶。继续？')) return
      const restoreBackup = codexHistory.value.hasBackup && window.confirm('是否按迁移账本把既有官方会话精确恢复到 openai 桶？')
      const result = await window.ccSwitch.disableCodexHistoryUnify({ restoreBackup })
      emit('toast', restoreBackup ? `历史已关闭并恢复 · JSONL ${result.restoredJsonlFiles} · SQLite ${result.restoredStateRows}` : 'Codex 统一历史已关闭')
    }
    codexHistory.value = await window.ccSwitch.getCodexHistoryUnifyStatus()
  } catch (error) { emit('toast', error.message, 'error') }
  finally { codexHistoryBusy.value = false }
}
async function saveOutboundProxy() {
  proxyBusy.value = 'save'
  try {
    const patch = { enabled: outboundProxy.value.enabled, url: outboundProxy.value.url, username: outboundProxy.value.username }
    if (outboundProxy.value.password) patch.password = outboundProxy.value.password
    const saved = await window.ccSwitch.saveOutboundProxyConfig(patch)
    outboundProxy.value = { ...outboundProxy.value, ...saved, password: '' }
    emit('toast', saved.enabled ? '全局出站代理已启用' : '已保存为直连/系统代理模式')
  } catch (error) { emit('toast', error.message, 'error') }
  finally { proxyBusy.value = '' }
}
async function testOutboundProxy() {
  proxyBusy.value = 'test'; proxyTest.value = null
  try {
    proxyTest.value = await window.ccSwitch.testOutboundProxy({ url: outboundProxy.value.url, username: outboundProxy.value.username, password: outboundProxy.value.password })
    emit('toast', proxyTest.value.success ? `代理连接成功 · ${proxyTest.value.latencyMs} ms` : proxyTest.value.error, proxyTest.value.success ? 'success' : 'error')
  } catch (error) { emit('toast', error.message, 'error') }
  finally { proxyBusy.value = '' }
}
async function scanProxies() {
  proxyBusy.value = 'scan'
  try { proxyDetected.value = await window.ccSwitch.scanLocalProxies(); emit('toast', proxyDetected.value.length ? `发现 ${proxyDetected.value.length} 个本地代理入口` : '未发现常见端口上的本地代理', proxyDetected.value.length ? 'success' : 'warning') }
  catch (error) { emit('toast', error.message, 'error') }
  finally { proxyBusy.value = '' }
}
function selectProxy(item) { outboundProxy.value.url = item.url; outboundProxy.value.enabled = true; proxyDetected.value = []; proxyTest.value = null }
function clearProxy() { outboundProxy.value = { ...outboundProxy.value, enabled: false, url: '', username: '', password: '', hasPassword: false }; proxyDetected.value = []; proxyTest.value = null }
async function toggleClaudeOnboarding() {
  const next = !claudeOnboarding.value.enabled
  onboardingBusy.value = true
  try {
    const result = await window.ccSwitch.setClaudeOnboardingSkip(next)
    claudeOnboarding.value = { ...claudeOnboarding.value, ...result, configured: next }
    emit('toast', next ? 'Claude Code 初次运行确认已跳过' : 'Claude Code 初次运行确认已恢复')
  } catch (error) { emit('toast', error.message, 'error') }
  finally { onboardingBusy.value = false }
}
async function toggleClaudePlugin() {
  const next = !claudePlugin.value.enabled
  claudePluginBusy.value = true
  try {
    claudePlugin.value = { ...claudePlugin.value, ...(await window.ccSwitch.setClaudePluginIntegration(next)) }
    emit('toast', next ? 'Claude Code VS Code 插件联动已启用' : 'Claude Code VS Code 插件联动已关闭')
  } catch (error) { emit('toast', error.message, 'error') }
  finally { claudePluginBusy.value = false }
}
async function loadTools() {
  toolBusy.value = 'probe'
  try {
    const names = ['claude', 'codex', 'gemini', 'grok', 'opencode', 'openclaw', 'hermes']
    const [versions, reports] = await Promise.all([window.ccSwitch.getToolVersions(names), window.ccSwitch.probeToolInstallations(names)])
    const reportMap = Object.fromEntries(reports.map((item) => [item.tool, item]))
    toolRows.value = versions.map((item) => ({ ...item, report: reportMap[item.name] || null }))
  } catch (error) { emit('toast', error.message, 'error') }
  finally { toolBusy.value = '' }
}
async function runToolAction(tool, action) {
  const report = tool.report
  const verb = action === 'install' ? '安装' : '更新'
  const warning = report?.needsConfirmation ? `\n检测到 ${report.installs.length} 处安装，只会作用于 PATH 默认项。` : ''
  if (!window.confirm(`${verb} ${report?.label || tool.name}？${warning}\n\n后端计划：${report?.command || '官方安装命令'}`)) return
  toolBusy.value = tool.name
  try {
    const [outcome] = await window.ccSwitch.runToolLifecycleAction([tool.name], action)
    if (!outcome?.success) throw new Error(outcome?.error || `${verb}失败`)
    emit('toast', `${report?.label || tool.name} ${verb}完成`)
    await loadTools()
  } catch (error) { emit('toast', error.message, 'error') }
  finally { toolBusy.value = '' }
}
</script>

<template>
  <section class="settings-view">
    <header class="settings-heading">
      <button class="back-button" @click="$emit('back')">←</button>
      <div>
        <span class="eyebrow">SYSTEM / PREFERENCES</span>
        <h1>设置与诊断</h1>
        <p>按分类管理界面、客户端、数据同步与高级能力。</p>
      </div>
    </header>

    <nav class="settings-tabbar" role="tablist" aria-label="设置分类">
      <button v-for="tab in settingsTabs" :key="tab.id" :class="{ active: settingsTab === tab.id }" role="tab" :aria-selected="settingsTab === tab.id" @click="settingsTab = tab.id"><span>{{ tab.label }}</span><small>{{ tab.hint }}</small></button>
    </nav>

    <div class="settings-grid">
      <article v-show="settingsTab === 'appearance'" class="settings-card appearance-card">
        <div><span class="card-label">APPEARANCE</span><h2>界面主题</h2><p>默认使用浅色；也可以跟随系统或手动切换深色。</p></div>
        <div class="theme-options" role="radiogroup" aria-label="界面主题">
          <button v-for="option in [{id:'light',label:'浅色',hint:'默认'},{id:'system',label:'跟随系统',hint:'自动'},{id:'dark',label:'深色',hint:'夜间'}]" :key="option.id" :class="{ active: themePreference === option.id }" role="radio" :aria-checked="themePreference === option.id" @click="$emit('theme-change', option.id)"><i :class="option.id" /><span><strong>{{ option.label }}</strong><small>{{ option.hint }}</small></span></button>
        </div>
      </article>
      <article v-show="settingsTab === 'appearance'" class="settings-card client-visibility-card">
        <header>
          <div><span class="card-label">CLIENT MENU</span><h2>显示 AI 客户端</h2><p>只整理左侧菜单，不会删除 Provider、账号、Skills 或客户端配置。</p></div>
          <div class="visibility-summary"><strong>{{ visibleClientIds.length }}</strong><span>/ {{ clients.length }} 可见</span><button class="text-button" :disabled="visibleClientIds.length === clients.length" @click="showAllClients">全部显示</button></div>
        </header>
        <div class="client-visibility-grid" role="group" aria-label="AI 客户端菜单显隐">
          <article v-for="client in clients" :key="client.id" :class="{ visible: visibleClientSet.has(client.id) }" :style="{ '--client-accent': client.accent }">
            <button class="visibility-toggle" role="switch" :aria-checked="visibleClientSet.has(client.id)" @click="toggleClientVisibility(client.id)">
              <span class="visibility-glyph">{{ clientGlyph(client.id) }}</span>
              <span><strong>{{ client.name }}</strong><small>{{ visibleClientSet.has(client.id) ? '菜单可见' : '已隐藏' }}</small></span>
              <i><b /></i>
            </button>
            <button class="visibility-only" :aria-label="`只显示 ${client.name}`" @click="showOnlyClient(client.id)">仅显示</button>
          </article>
        </div>
      </article>
      <article v-show="settingsTab === 'clients'" class="settings-card runtime-card">
        <div class="settings-card-header">
          <div>
            <span class="card-label">LOCAL RUNTIME</span>
            <h2>本机配置</h2>
          </div>
          <span class="configured-count">{{ configuredCount }}/{{ clientCount }} active</span>
        </div>
        <dl class="path-list">
          <template v-for="(status, clientId) in clientStatus" :key="clientId">
            <div>
              <dt><i :class="{ on: status.activeProviderId }" />{{ status.name }}<button class="path-open-button" @click="openClientConfigDirectory(clientId)">打开目录</button></dt>
              <dd v-for="(entry, pathName) in status.paths" :key="pathName" class="path-entry">
                <span>{{ pathName }}</span>
                <code>{{ entry.path }}</code>
                <em :class="{ found: entry.exists }">{{ entry.exists ? 'found' : 'not found' }}</em>
              </dd>
            </div>
          </template>
        </dl>
        <button class="secondary-button full-width import-live-button" @click="$emit('import-live')">
          导入当前客户端配置
        </button>
        <p class="import-hint">读取现有 Claude、Codex、Gemini、OpenCode、OpenClaw 与 Hermes 配置，重复导入会更新同一条记录。</p>
      </article>

      <article v-show="settingsTab === 'data'" class="settings-card data-card">
        <span class="card-label">PLUGIN DATA</span>
        <h2>数据目录</h2>
        <code>{{ runtimeInfo?.dataDir || '加载中…' }}</code>
        <p>Provider 密钥、启用状态、热更新规则和版本信息均保存在此目录。</p>
        <div class="sidecar-state" :class="{ ready: sidecarReady }">
          <i />
          <span>{{ sidecarReady ? 'Rust sidecar 已连接' : 'Rust sidecar 不可用，使用 Node 降级路径' }}</span>
          <code v-if="runtimeInfo?.sidecar?.info">protocol v{{ runtimeInfo.sidecar.info.protocol }}</code>
        </div>
        <button class="secondary-button full-width" @click="openAppDataDirectory">在 ZTools 中打开数据目录</button>
      </article>

      <article v-show="settingsTab === 'system'" class="settings-card host-startup-card">
        <div class="settings-card-header"><div class="startup-glyph">Z</div><div><span class="card-label">ZTOOLS HOST LIFECYCLE</span><h2>宿主启动策略</h2></div><span class="secure-badge" :class="{ warning: !hostStartup.autoStartRouter }">{{ hostStartup.autoStartRouter ? '自动恢复' : '手动启动' }}</span></div>
        <p>ZTools 负责操作系统级登录启动；插件不重复创建 Login Item。启用后，Preload 建立或再次进入插件时恢复配置中已开启的本地路由。</p>
        <div class="onboarding-control"><div><strong>随 ZTools 插件启动恢复本地路由</strong><small>仅在至少一个应用路由已启用时启动，不会修改客户端配置。</small></div><button class="toggle-switch" :class="{ on: hostStartup.autoStartRouter }" role="switch" :aria-checked="hostStartup.autoStartRouter" @click="hostStartup.autoStartRouter = !hostStartup.autoStartRouter; saveHostStartup()"><i /></button></div>
        <div class="onboarding-control"><div><strong>每次进入插件检查恢复</strong><small>适用于 ZTools 回收后台 Webview 后重新进入的场景。</small></div><button class="toggle-switch" :class="{ on: hostStartup.restoreOnPluginEnter }" role="switch" :aria-checked="hostStartup.restoreOnPluginEnter" @click="hostStartup.restoreOnPluginEnter = !hostStartup.restoreOnPluginEnter; saveHostStartup()"><i /></button></div>
      </article>

      <article v-show="settingsTab === 'system'" class="settings-card router-emergency-card">
        <div class="settings-card-header"><div class="router-emergency-glyph">R</div><div><span class="card-label">SHARED ROUTER ENGINE</span><h2>路由引擎应急控制</h2></div><span class="secure-badge" :class="{ warning: !routerEngine.running }">{{ routerEngine.running ? '运行中' : '已停止' }}</span></div>
        <p>日常启停请使用各客户端的独立接管开关。这里只用于一次恢复全部客户端配置并停止共享引擎。</p>
        <div class="router-engine-summary"><div><span>ACTIVE ROUTES</span><strong>{{ activeRouteCount }}</strong></div><div><span>CONNECTIONS</span><strong>{{ routerEngine.activeConnections || 0 }}</strong></div><div><span>LISTEN</span><code>{{ routerEngine.url || `http://${routerEngine.config?.host || '127.0.0.1'}:${routerEngine.config?.port || 15721}` }}</code></div><button class="secondary-button danger-outline" :disabled="routerBusy || !routerEngine.running" @click="emergencyStopRouter">{{ routerBusy ? '正在恢复…' : '停止并恢复全部路由' }}</button></div>
      </article>

      <article v-show="settingsTab === 'system'" class="settings-card codex-history-card">
        <div class="settings-card-header"><div class="history-glyph">H</div><div><span class="card-label">CODEX SESSION BUCKET</span><h2>Codex History Unify</h2></div><span class="secure-badge" :class="{ warning: !codexHistory.liveUnified }">{{ codexHistory.liveUnified ? '共享桶生效' : codexHistory.enabled ? '等待路由' : '独立历史' }}</span></div>
        <p>对照上游把官方 <code>openai</code> 会话与第三方 <code>ztools_cc_switch</code> 会话归入共享 Resume 历史。存量迁移同时覆盖 JSONL 与 <code>state_5.sqlite</code>，并可按账本精确恢复。</p>
        <div class="history-status"><div><span>CODEX DIR</span><code>{{ codexHistory.codexDir || '~/.codex' }}</code></div><div><span>MIGRATION BACKUP</span><strong>{{ codexHistory.hasBackup ? 'AVAILABLE' : 'NONE' }}</strong></div><div><span>LAST MIGRATION</span><strong>{{ codexHistory.lastMigration ? `${codexHistory.lastMigration.migratedJsonlFiles} JSONL / ${codexHistory.lastMigration.migratedStateRows} DB` : 'NOT RUN' }}</strong></div></div>
        <div class="onboarding-control"><div><strong>{{ codexHistory.enabled ? '官方与第三方会话共享历史桶' : '保留 Codex 官方与第三方独立历史' }}</strong><small>启用时可选择迁移存量；关闭时可选择从备份账本恢复。</small></div><button class="toggle-switch" :class="{ on: codexHistory.enabled }" :disabled="codexHistoryBusy" role="switch" :aria-checked="codexHistory.enabled" @click="toggleCodexHistory"><i /></button></div>
      </article>

      <article v-show="settingsTab === 'data'" class="settings-card log-config-card">
        <div class="settings-card-header"><div class="log-glyph">L</div><div><span class="card-label">HOST LOG POLICY</span><h2>日志级别与保留</h2></div><span class="secure-badge" :class="{ warning: !logConfig.enabled }">{{ logConfig.enabled ? logConfig.level.toUpperCase() : 'OFF' }}</span></div>
        <p>对照上游控制 Preload 日志级别，并为 ZTools 长驻场景补充文件大小、请求条目与保留天数限制。所有清理均先生成可恢复备份。</p>
        <div class="log-policy-grid"><label><span>日志级别</span><select v-model="logConfig.level" :disabled="!logConfig.enabled"><option v-for="level in ['error','warn','info','debug','trace']" :key="level">{{ level }}</option></select></label><label><span>保留天数</span><input v-model.number="logConfig.retentionDays" type="number" min="1" max="365" /></label><label><span>单文件上限（MB）</span><input v-model.number="logConfig.maxFileSizeMb" type="number" min="1" max="500" /></label><label><span>请求日志条目上限</span><input v-model.number="logConfig.maxRequestEntries" type="number" min="1000" max="1000000" step="1000" /></label></div>
        <div class="onboarding-control"><div><strong>记录插件宿主日志</strong><small>仅持久化带 cc-switch 标识的 Preload 消息，并自动脱敏常见 Token。</small></div><button class="toggle-switch" :class="{ on: logConfig.enabled }" role="switch" :aria-checked="logConfig.enabled" @click="logConfig.enabled = !logConfig.enabled"><i /></button></div>
        <div class="log-file-strip"><span>{{ logFiles.length }} FILES</span><strong>{{ formatBytes(logFiles.reduce((total,item)=>total+item.sizeBytes,0)) }}</strong><small>{{ logFiles[0] ? `最近写入 ${new Date(logFiles[0].modifiedAt).toLocaleString()}` : '尚无日志文件' }}</small></div>
        <div class="inline-actions"><button class="secondary-button" @click="window.ccSwitch.openLogDirectory()">打开目录</button><button class="secondary-button" :disabled="logBusy" @click="maintainLogs">立即维护</button><button class="text-button danger" :disabled="logBusy" @click="clearAllLogs">清理并备份</button><button class="primary-button" :disabled="logBusy" @click="saveLogConfig">保存策略</button></div>
      </article>

      <article v-show="settingsTab === 'data'" class="settings-card config-dir-card">
        <div class="settings-card-header"><div><span class="card-label">APP CONFIG DIRECTORY</span><h2>插件数据目录覆盖</h2></div><span class="secure-badge" :class="{ warning: appConfigDir.restartRequired }">{{ appConfigDir.restartRequired ? '待重新打开' : '当前生效' }}</span></div>
        <p>适用于 WSL、外置盘或多环境共享。路径存入 ZTools 隔离存储，重新打开插件后所有管理器统一切换。</p>
        <div class="config-dir-path"><small>ACTIVE</small><code>{{ appConfigDir.activePath || runtimeInfo?.dataDir }}</code><small v-if="appConfigDir.path">NEXT</small><code v-if="appConfigDir.path">{{ appConfigDir.path }}</code></div>
        <div class="inline-actions"><button class="secondary-button" @click="chooseAppConfigDir">选择目录</button><button class="text-button" :disabled="!appConfigDir.path" @click="resetAppConfigDir">恢复默认</button></div>
      </article>

      <article v-show="settingsTab === 'data'" class="settings-card local-backup-card">
        <header><div><span class="card-label">DATABASE SNAPSHOTS</span><h2>本地数据快照</h2><p>恢复前自动创建安全快照；周期检查在插件启动时静默执行。</p></div><button class="primary-button" :disabled="backupBusy" @click="createLocalSnapshot"><span v-if="backupBusy === 'create'" class="spinner" />立即备份</button></header>
        <div class="backup-policy"><label>自动间隔<select v-model.number="backupSettings.intervalHours" @change="saveBackupPolicy"><option :value="0">关闭</option><option :value="6">6 小时</option><option :value="12">12 小时</option><option :value="24">24 小时</option><option :value="48">48 小时</option><option :value="168">7 天</option></select></label><label>保留数量<select v-model.number="backupSettings.retainCount" @change="saveBackupPolicy"><option v-for="n in [3,5,10,15,20,30,50]" :key="n" :value="n">{{ n }}</option></select></label></div>
        <div class="local-backup-list"><article v-for="item in localBackups" :key="item.filename"><div><strong>{{ item.filename.replace(/\.snapshot\.json$/, '') }}</strong><small>{{ new Date(item.createdAt).toLocaleString() }} · {{ formatBytes(item.sizeBytes) }}</small></div><button class="secondary-button" :disabled="backupBusy === item.filename" @click="restoreLocalSnapshot(item)">恢复</button><button class="icon-button" title="重命名" @click="renameLocalSnapshot(item)">✎</button><button class="icon-button danger" title="永久删除" @click="deleteLocalSnapshot(item)">×</button></article><p v-if="!localBackups.length">尚无本地快照</p></div>
      </article>

      <article v-show="settingsTab === 'clients'" class="settings-card common-config-card">
        <header><div><span class="card-label">COMMON CONFIG SNIPPET</span><h2>跨 Provider 通用配置</h2><p>提取时自动剥离密钥、端点、模型、MCP 与 cc-switch 注入字段。</p></div><div class="segmented-tabs"><button v-for="client in ['claude','codex','gemini']" :key="client" :class="{ active: commonConfigClient === client }" @click="commonConfigClient = client; loadCommonConfig()">{{ client }}</button></div></header>
        <textarea v-model="commonConfigText" spellcheck="false" :placeholder="commonConfigPlaceholder" />
        <footer><small>{{ commonConfigClient === 'codex' ? 'TOML · Rust toml_edit 保留注释与键序' : 'JSON · 深度合并' }}</small><button class="secondary-button" :disabled="commonConfigBusy" @click="extractCommonConfig">从当前配置提取</button><button class="primary-button" :disabled="commonConfigBusy" @click="saveCommonConfig">保存片段</button></footer>
      </article>

      <article v-show="settingsTab === 'data'" class="settings-card safety-card">
        <span class="card-label">WRITE SAFETY</span>
        <h2>可恢复写入</h2>
        <ul>
          <li><span>01</span>写入前生成同名 <code>.bak</code></li>
          <li><span>02</span>临时文件完成后原子替换</li>
          <li><span>03</span>保留不属于插件的配置字段</li>
        </ul>
      </article>
      <article v-show="settingsTab === 'clients'" class="settings-card tool-runtime-card">
        <header><div><span class="card-label">CLI TOOLCHAIN</span><h2>客户端版本与安装诊断</h2><p>探测 PATH 默认项与多处安装冲突；安装/更新命令由 Preload 白名单生成。</p></div><button class="secondary-button" :disabled="toolBusy === 'probe'" @click="loadTools"><span v-if="toolBusy === 'probe'" class="spinner" />重新探测</button></header>
        <div class="tool-runtime-table">
          <div class="tool-runtime-row tool-runtime-head"><span>工具</span><span>当前 / 最新</span><span>安装来源</span><span>状态</span><span /></div>
          <div v-for="tool in toolRows" :key="tool.name" class="tool-runtime-row">
            <span><i :class="{ installed: tool.version, broken: tool.installedButBroken }" /><strong>{{ tool.report?.label || tool.name }}</strong><small>{{ tool.executablePath || '未定位到可执行文件' }}</small></span>
            <code>{{ tool.version || '—' }} <em>/ {{ tool.latestVersion || '?' }}</em></code>
            <span class="tool-source"><b>{{ tool.source || 'none' }}</b><small v-if="tool.report?.installs?.length > 1">{{ tool.report.installs.length }} installs</small></span>
            <span class="tool-health" :class="{ warning: tool.report?.isConflict, bad: tool.installedButBroken }">{{ tool.installedButBroken ? '无法运行' : tool.report?.isConflict ? '版本冲突' : tool.version ? '正常' : '未安装' }}</span>
            <button class="secondary-button" :disabled="toolBusy === tool.name" @click="runToolAction(tool, tool.version ? 'update' : 'install')">{{ toolBusy === tool.name ? '执行中…' : tool.version ? '更新' : '安装' }}</button>
          </div>
        </div>
      </article>
      <article v-show="settingsTab === 'clients'" class="settings-card onboarding-card">
        <div class="settings-card-header"><div class="onboarding-glyph">C</div><div><span class="card-label">CLAUDE FIRST RUN</span><h2>跳过初次安装确认</h2></div><span class="secure-badge" :class="{ warning: !claudeOnboarding.enabled }">{{ claudeOnboarding.enabled ? '已跳过' : '默认流程' }}</span></div>
        <p>对照上游仅增量维护 <code>~/.claude.json</code> 根级 <code>hasCompletedOnboarding</code>，不会改写其他 Claude 状态。</p>
        <div class="onboarding-control"><div><strong>{{ claudeOnboarding.enabled ? 'Claude Code 将直接进入已完成引导状态' : '保留 Claude Code 官方首次运行确认' }}</strong><small>{{ claudeOnboarding.path || '~/.claude.json' }}</small></div><button class="toggle-switch" :class="{ on: claudeOnboarding.enabled }" :disabled="onboardingBusy" role="switch" :aria-checked="claudeOnboarding.enabled" @click="toggleClaudeOnboarding"><i /></button></div>
        <div class="onboarding-control"><div><strong>{{ claudePlugin.enabled ? 'VS Code Claude Code 插件将跟随 Provider 切换' : '不接管 VS Code Claude Code 插件' }}</strong><small>{{ claudePlugin.path || '~/.claude/config.json' }} · primaryApiKey</small></div><button class="toggle-switch claude-plugin-toggle" :class="{ on: claudePlugin.enabled }" :disabled="claudePluginBusy" role="switch" :aria-checked="claudePlugin.enabled" @click="toggleClaudePlugin"><i /></button></div>
      </article>
      <article v-show="settingsTab === 'system'" class="settings-card outbound-proxy-card">
        <div class="settings-card-header"><div class="proxy-glyph">P</div><div><span class="card-label">GLOBAL OUTBOUND</span><h2>全局出站代理</h2></div><span class="secure-badge" :class="{ warning: !outboundProxy.secureStorage }">{{ outboundProxy.effectiveMode === 'explicit' ? '显式代理' : outboundProxy.effectiveMode === 'system' ? '系统代理' : '直连' }}</span></div>
        <p>Provider 测试、OAuth、Skills、WebDAV/S3 与本地路由的上游请求共用此代理。支持 HTTP(S)、SOCKS5 与认证。</p>
        <div class="proxy-url-row"><input v-model="outboundProxy.url" placeholder="http://127.0.0.1:7890 / socks5://127.0.0.1:1080" /><button class="icon-button" title="扫描本地代理" :disabled="proxyBusy === 'scan'" @click="scanProxies">⌕</button><button class="secondary-button" :disabled="!outboundProxy.url || proxyBusy === 'test'" @click="testOutboundProxy">{{ proxyBusy === 'test' ? '测试中…' : '测试' }}</button><button class="icon-button danger" title="清除" @click="clearProxy">×</button></div>
        <div class="proxy-auth-row"><label><span>用户名（可选）</span><input v-model="outboundProxy.username" autocomplete="username" /></label><label><span>密码（可选）</span><input v-model="outboundProxy.password" type="password" autocomplete="new-password" :placeholder="outboundProxy.hasPassword ? '已安全保存，留空保持不变' : '代理认证密码'" /></label></div>
        <div v-if="proxyDetected.length" class="proxy-detected"><button v-for="item in proxyDetected" :key="item.url" @click="selectProxy(item)"><i />{{ item.url }}</button></div>
        <div class="proxy-status-line"><label><input v-model="outboundProxy.enabled" type="checkbox" :disabled="!outboundProxy.url" /> 启用显式代理</label><span v-if="outboundProxy.systemProxy && !outboundProxy.enabled">检测到系统代理 {{ outboundProxy.systemProxy }}</span><span v-if="proxyTest" :class="proxyTest.success ? 'ok' : 'bad'">{{ proxyTest.success ? `${proxyTest.latencyMs} ms · HTTP ${proxyTest.status}` : proxyTest.error }}</span><button class="primary-button" :disabled="proxyBusy === 'save'" @click="saveOutboundProxy">保存并应用</button></div>
      </article>
      <article v-show="settingsTab === 'data'" class="settings-card backup-card">
        <span class="card-label">PORTABLE BACKUP</span>
        <h2>导入与导出</h2>
        <p>打包 Provider、Skills、MCP、Prompts、路由配置与请求日志。导入前自动保留原文件。</p>
        <div class="backup-actions"><button class="secondary-button" @click="importBackup">导入备份</button><button v-if="lastExportPath && canStartDrag" class="secondary-button" draggable="true" title="按住并拖到外部应用" @dragstart="dragExport">拖出刚导出的备份</button><button class="primary-button" @click="exportBackup">导出完整备份</button></div>
      </article>
      <article v-show="settingsTab === 'sync'" class="settings-card webdav-card">
        <div class="settings-card-header"><div><span class="card-label">ZTOOLS SECURE SYNC</span><h2>WebDAV 云同步</h2></div><span class="secure-badge" :class="{ warning: !webdav.secureStorage }">{{ webdav.secureStorage ? '系统加密' : '降级存储' }}</span></div>
        <p>通过 ZTools 隔离存储保存连接信息；密码使用系统 safeStorage 加密，不进入普通备份文件。</p>
        <div class="webdav-form">
          <label class="wide"><span>WebDAV 地址</span><input v-model="webdav.url" placeholder="https://dav.example.com/remote.php/dav/files/user" /></label>
          <label><span>用户名</span><input v-model="webdav.username" autocomplete="username" /></label>
          <label><span>密码</span><input v-model="webdav.password" type="password" autocomplete="new-password" :placeholder="webdav.hasPassword ? '已安全保存，留空保持不变' : '输入密码'" /></label>
          <label class="wide"><span>远端路径</span><input v-model="webdav.remotePath" placeholder="ai-provider-switch/backup.json" /></label>
          <label><span>自动同步间隔</span><select v-model.number="webdav.intervalMinutes"><option :value="5">5 分钟</option><option :value="15">15 分钟</option><option :value="30">30 分钟</option><option :value="60">1 小时</option></select></label>
          <label><span>冲突策略</span><select v-model="webdav.conflictStrategy"><option value="ask">每次询问</option><option value="local">本地优先</option><option value="remote">远端优先</option></select></label>
        </div>
        <div class="webdav-options"><label><input v-model="webdav.autoSync" type="checkbox" /> 插件进入时及定时自动同步</label><label><input v-model="webdav.includeLogs" type="checkbox" /> 同步请求日志</label></div>
        <div class="webdav-state" :class="webdavStatus.state"><i /><div><strong>{{ webdavStatus.message }}</strong><small v-if="webdavStatus.lastSyncAt">{{ new Date(webdavStatus.lastSyncAt).toLocaleString() }}</small></div></div>
        <div v-if="webdavStatus.state === 'conflict'" class="conflict-actions"><button class="secondary-button" @click="webdavAction('syncWebdav', { strategy: 'remote' })">保留远端</button><button class="secondary-button" @click="webdavAction('syncWebdav', { strategy: 'local' })">保留本地</button></div>
        <div class="webdav-actions"><button class="secondary-button" :disabled="webdavBusy" @click="webdavAction('downloadWebdav')">下载并恢复</button><button class="secondary-button" :disabled="webdavBusy" @click="webdavAction('uploadWebdav', { force: true })">强制上传</button><button class="secondary-button" @click="saveWebdav">保存连接</button><button class="primary-button" :disabled="webdavBusy" @click="webdavAction('syncWebdav')">立即同步</button></div>
      </article>
      <article v-show="settingsTab === 'sync'" class="settings-card s3-card">
        <div class="settings-card-header"><div><span class="card-label">SIGNED OBJECT STORAGE</span><h2>S3 快照同步</h2></div><span class="secure-badge" :class="{ warning: !s3.secureStorage }">{{ s3.secureStorage ? 'SIGV4 · 系统加密' : 'SIGV4 · 降级存储' }}</span></div>
        <p>兼容 AWS S3、Cloudflare R2 与 MinIO。数据对象先上传，manifest 最后提交；下载前验证大小与 SHA-256。</p>
        <div class="s3-preset-row">
          <button v-for="item in [{id:'aws',label:'AWS S3'},{id:'r2',label:'Cloudflare R2'},{id:'minio',label:'MinIO / Custom'}]" :key="item.id" :class="{ active: s3.preset === item.id }" @click="s3.preset = item.id; applyS3Preset()">{{ item.label }}</button>
        </div>
        <div class="webdav-form s3-form">
          <label><span>Region</span><input v-model="s3.region" placeholder="us-east-1" /></label>
          <label><span>Bucket</span><input v-model="s3.bucket" placeholder="my-ai-config" /></label>
          <label><span>Access Key ID</span><input v-model="s3.accessKeyId" autocomplete="off" /></label>
          <label><span>Secret Access Key</span><input v-model="s3.secretAccessKey" type="password" autocomplete="new-password" :placeholder="s3.hasSecretAccessKey ? '已安全保存，留空保持不变' : '输入 Secret Key'" /></label>
          <label class="wide"><span>自定义 Endpoint</span><input v-model="s3.endpoint" :placeholder="s3.preset === 'r2' ? 'https://<account>.r2.cloudflarestorage.com' : s3.preset === 'minio' ? 'http://127.0.0.1:9000' : 'AWS S3 留空'" /></label>
          <label><span>远端根目录</span><input v-model="s3.remoteRoot" placeholder="cc-switch-sync" /></label>
          <label><span>配置档案</span><input v-model="s3.profile" placeholder="default" /></label>
          <label><span>自动同步间隔</span><select v-model.number="s3.intervalMinutes"><option :value="5">5 分钟</option><option :value="15">15 分钟</option><option :value="30">30 分钟</option><option :value="60">1 小时</option></select></label>
          <label><span>冲突策略</span><select v-model="s3.conflictStrategy"><option value="ask">每次询问</option><option value="local">本地优先</option><option value="remote">远端优先</option></select></label>
        </div>
        <div class="webdav-options"><label><input v-model="s3.enabled" type="checkbox" /> 启用 S3 同步</label><label><input v-model="s3.autoSync" type="checkbox" /> 插件进入时及定时同步</label><label><input v-model="s3.includeLogs" type="checkbox" /> 包含请求日志</label></div>
        <div class="webdav-state" :class="s3Status.state"><i /><div><strong>{{ s3Status.message }}</strong><small v-if="s3Status.lastSyncAt">{{ new Date(s3Status.lastSyncAt).toLocaleString() }}</small><small v-else-if="s3RemoteInfo">{{ s3RemoteInfo.remotePath }}</small></div></div>
        <div v-if="s3Status.state === 'conflict'" class="conflict-actions"><button class="secondary-button" @click="s3Action('syncS3', { strategy: 'remote' })">保留远端</button><button class="secondary-button" @click="s3Action('syncS3', { strategy: 'local' })">保留本地</button></div>
        <div class="webdav-actions"><button class="secondary-button" :disabled="s3Busy" @click="testS3">测试连接</button><button class="secondary-button" :disabled="s3Busy" @click="previewS3('download')">下载并恢复</button><button class="secondary-button" :disabled="s3Busy" @click="previewS3('upload')">上传快照</button><button class="secondary-button" @click="saveS3">保存连接</button><button class="primary-button" :disabled="s3Busy" @click="s3Action('syncS3')">立即同步</button></div>
      </article>
    </div>
  </section>
</template>
