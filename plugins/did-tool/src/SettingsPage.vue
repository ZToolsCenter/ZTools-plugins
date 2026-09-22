<script setup lang="ts">
import {
  ArrowLeft,
  ChevronDown,
  Eye,
  EyeOff,
  FolderOpen,
  KeyRound,
  Network,
  Plus,
  RotateCcw,
  Save,
  Server,
  Square,
  SquareCheckBig,
  Trash2
} from 'lucide-vue-next'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { buildProxyUrl, cloneSettings, createDefaultSettings } from './settings'

const props = defineProps<{
  settings: AppSettings
  defaultDownloadPath: string
  runtimeAvailable: boolean
  saveError: string
}>()

const emit = defineEmits<{
  back: []
  save: [settings: AppSettings]
}>()

const draft = ref(cloneSettings(props.settings))
const currentSection = ref<'sources' | 'proxy' | 'download'>('sources')
const error = ref('')
const sourcePasswordVisible = ref(false)
const proxyPasswordVisible = ref(false)
const sourceAuthExpanded = ref(false)
const resetArmed = ref(false)
const resetCountdown = ref(0)
let resetTimer: ReturnType<typeof setInterval> | null = null
const activeSource = computed(
  () =>
    draft.value.sources.find((source) => source.id === draft.value.selectedSourceId) ||
    draft.value.sources[0] ||
    null
)

watch(
  () => props.settings,
  (settings) => {
    draft.value = cloneSettings(settings)
    error.value = ''
    syncAuthenticationState()
  }
)

watch(
  () => draft.value.selectedSourceId,
  () => {
    error.value = ''
    syncAuthenticationState()
  }
)

/** 根据当前镜像源同步认证区域状态。 */
function syncAuthenticationState(): void {
  sourcePasswordVisible.value = false
  sourceAuthExpanded.value = Boolean(activeSource.value?.username || activeSource.value?.password)
}

/** 添加并切换到一个空白自定义镜像源。 */
function addSource(): void {
  const id = `custom-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  draft.value.sources.push({
    id,
    name: `自定义镜像源 ${draft.value.sources.length + 1}`,
    url: '',
    username: '',
    password: '',
    proxyEnabled: false
  })
  draft.value.selectedSourceId = id
  sourceAuthExpanded.value = false
  cancelReset()
}

/** 删除当前镜像源并切换到相邻项。 */
function removeActiveSource(): void {
  const source = activeSource.value
  if (!source || draft.value.sources.length <= 1) return
  const index = draft.value.sources.findIndex((item) => item.id === source.id)
  draft.value.sources.splice(index, 1)
  draft.value.selectedSourceId = draft.value.sources[Math.min(index, draft.value.sources.length - 1)].id
}

/** 切换当前镜像源的代理状态。 */
function toggleActiveSourceProxy(): void {
  if (!activeSource.value) return
  activeSource.value.proxyEnabled = !activeSource.value.proxyEnabled
  error.value = ''
}

/** 唤起系统目录选择窗口。 */
function chooseDownloadPath(): void {
  if (!props.runtimeAvailable) return
  const selected = window.services.chooseOutputDirectory(draft.value.downloadPath)
  if (selected) draft.value.downloadPath = selected
}

/** 两次点击后恢复默认设置。 */
function resetSettings(): void {
  if (!resetArmed.value) {
    armReset()
    return
  }
  if (resetCountdown.value > 0) return
  draft.value = createDefaultSettings(props.defaultDownloadPath)
  currentSection.value = 'sources'
  sourcePasswordVisible.value = false
  proxyPasswordVisible.value = false
  sourceAuthExpanded.value = false
  cancelReset()
  error.value = ''
}

/** 停止恢复默认倒计时。 */
function stopResetCountdown(): void {
  if (!resetTimer) return
  clearInterval(resetTimer)
  resetTimer = null
}

/** 取消恢复默认操作并恢复初始按钮状态。 */
function cancelReset(): void {
  stopResetCountdown()
  resetArmed.value = false
  resetCountdown.value = 0
}

/** 开始恢复默认操作的三秒倒计时。 */
function armReset(): void {
  stopResetCountdown()
  resetArmed.value = true
  resetCountdown.value = 3
  resetTimer = setInterval(() => {
    if (resetCountdown.value <= 1) {
      resetCountdown.value = 0
      stopResetCountdown()
      return
    }
    resetCountdown.value -= 1
  }, 1000)
}

/** 校验并保存设置。 */
function saveSettings(): void {
  error.value = validateSettings(draft.value)
  if (error.value) return
  const settings = cloneSettings(draft.value)
  settings.sources = settings.sources.map((source) => ({
    ...source,
    name: source.name.trim(),
    url: source.url.trim(),
    username: source.username.trim()
  }))
  settings.proxy.address = settings.proxy.address.trim()
  settings.proxy.username = settings.proxy.username.trim()
  settings.downloadPath = settings.downloadPath.trim()
  emit('save', settings)
}

/** 校验镜像源、代理和下载路径。 */
function validateSettings(settings: AppSettings): string {
  if (settings.sources.length === 0) return '至少需要保留一个镜像源'
  const names = new Set<string>()
  for (const source of settings.sources) {
    const name = source.name.trim()
    const address = source.url.trim()
    if (!name) return '镜像源名称不能为空'
    if (names.has(name)) return `镜像源名称不能重复：${name}`
    names.add(name)
    if (!address) return `请填写“${name}”的镜像源地址`
    try {
      const url = new URL(/^https?:\/\//i.test(address) ? address : `https://${address}`)
      if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) throw new Error()
      if (url.username || url.password || url.search || url.hash) throw new Error()
    } catch {
      return `“${name}”的镜像源地址格式不正确`
    }
  }
  if (!settings.downloadPath.trim()) return '下载路径不能为空'
  const proxyAddress = settings.proxy.address.trim()
  if (settings.sources.some((source) => source.proxyEnabled) && !proxyAddress) {
    return '启用代理的镜像源需要填写代理地址'
  }
  if (proxyAddress) {
    try {
      const proxyUrl = new URL(buildProxyUrl(settings.proxy))
      if (!proxyUrl.hostname || proxyUrl.pathname !== '/' || proxyUrl.search || proxyUrl.hash) throw new Error()
    } catch {
      return '代理地址格式不正确'
    }
  }
  return ''
}
onBeforeUnmount(stopResetCountdown)
</script>

<template>
  <div class="settings-page">
    <header class="settings-toolbar">
      <button type="button" class="icon-button" title="返回下载页" aria-label="返回下载页" @click="emit('back')">
        <ArrowLeft :size="19" />
      </button>
      <div class="settings-title">
        <h1>设置</h1>
        <span>连接与存储</span>
      </div>
      <div class="settings-actions">
        <div class="reset-actions">
          <button v-if="resetArmed" type="button" class="reset-cancel" @click="cancelReset">取消</button>
          <button
            type="button"
            class="reset-button"
            :class="{ armed: resetArmed }"
            :disabled="resetArmed && resetCountdown > 0"
            @click="resetSettings"
          >
            <RotateCcw :size="15" />
            {{ resetArmed ? (resetCountdown > 0 ? `确认恢复（${resetCountdown}秒）` : '确认恢复') : '恢复默认' }}
          </button>
        </div>
        <button type="button" class="save-button" @click="saveSettings">
          <Save :size="16" />
          保存设置
        </button>
      </div>
    </header>

    <main class="settings-content">
      <div v-if="error || saveError" class="settings-error">{{ error || saveError }}</div>

      <nav class="settings-tabs" aria-label="设置分类">
        <button type="button" :class="{ active: currentSection === 'sources' }" @click="currentSection = 'sources'">
          <Server :size="16" />
          镜像源管理
        </button>
        <button type="button" :class="{ active: currentSection === 'proxy' }" @click="currentSection = 'proxy'">
          <Network :size="16" />
          代理设置
        </button>
        <button type="button" :class="{ active: currentSection === 'download' }" @click="currentSection = 'download'">
          <FolderOpen :size="16" />
          下载路径
        </button>
      </nav>

      <section v-if="currentSection === 'sources'" class="settings-panel">
        <div class="panel-heading">
          <div>
            <h2>镜像源管理</h2>
            <p>选择一个镜像源后编辑对应连接信息</p>
          </div>
          <span>{{ draft.sources.length }} 个可用地址</span>
        </div>

        <div class="source-toolbar">
          <div class="field source-select-field">
            <label for="source-selector">当前镜像源</label>
            <div class="select-wrap">
              <select id="source-selector" v-model="draft.selectedSourceId">
                <option v-for="source in draft.sources" :key="source.id" :value="source.id">
                  {{ source.name || '未命名镜像源' }}
                </option>
              </select>
              <ChevronDown :size="15" />
            </div>
          </div>
          <button
            type="button"
            class="secondary-button proxy-toggle-button"
            :class="{ active: activeSource?.proxyEnabled }"
            :disabled="!activeSource"
            :aria-pressed="activeSource?.proxyEnabled"
            :aria-label="activeSource?.proxyEnabled ? '关闭当前镜像源代理' : '启用当前镜像源代理'"
            :title="activeSource?.proxyEnabled ? '关闭当前镜像源代理' : '启用当前镜像源代理'"
            @click="toggleActiveSourceProxy"
          >
            <span>{{ activeSource?.proxyEnabled ? '已启用代理' : '未启用代理' }}</span>
            <SquareCheckBig v-if="activeSource?.proxyEnabled" :size="16" class="proxy-checkbox" />
            <Square v-else :size="16" class="proxy-checkbox" />
          </button>
          <button type="button" class="secondary-button" @click="addSource">
            <Plus :size="16" />
            添加
          </button>
          <button
            type="button"
            class="secondary-button delete-button"
            title="删除当前镜像源"
            aria-label="删除当前镜像源"
            :disabled="draft.sources.length <= 1"
            @click="removeActiveSource"
          >
            <Trash2 :size="17" />
            删除
          </button>
        </div>

        <div v-if="activeSource" class="source-editor">
          <div class="source-summary">
            <div class="source-mark"><Server :size="20" /></div>
            <div>
              <strong>{{ activeSource.name || '未命名镜像源' }}</strong>
              <span>{{ activeSource.url || '尚未填写镜像源地址' }}</span>
            </div>
          </div>

          <div class="source-core-fields">
            <div class="field">
              <label for="source-name">显示名称</label>
              <input id="source-name" v-model="activeSource.name" type="text" maxlength="40" />
            </div>
            <div class="field address-field">
              <label for="source-url">Registry 地址</label>
              <input
                id="source-url"
                v-model="activeSource.url"
                type="text"
                spellcheck="false"
                placeholder="https://registry.example.com"
              />
            </div>
          </div>

          <button
            type="button"
            class="authentication-toggle"
            :class="{ expanded: sourceAuthExpanded }"
            @click="sourceAuthExpanded = !sourceAuthExpanded"
          >
            <KeyRound :size="16" />
            <span>
              <strong>仓库认证</strong>
              <small>{{ activeSource.username ? `已配置用户 ${activeSource.username}` : '可选，用于私有镜像仓库' }}</small>
            </span>
            <ChevronDown :size="16" />
          </button>

          <div v-if="sourceAuthExpanded" class="authentication-fields">
            <div class="field">
              <label for="source-username">用户名</label>
              <input id="source-username" v-model="activeSource.username" type="text" autocomplete="off" />
            </div>
            <div class="field">
              <label for="source-password">密码</label>
              <div class="password-field">
                <input
                  id="source-password"
                  v-model="activeSource.password"
                  :type="sourcePasswordVisible ? 'text' : 'password'"
                  autocomplete="new-password"
                />
                <button
                  type="button"
                  title="显示或隐藏密码"
                  aria-label="显示或隐藏密码"
                  @click="sourcePasswordVisible = !sourcePasswordVisible"
                >
                  <EyeOff v-if="sourcePasswordVisible" :size="16" />
                  <Eye v-else :size="16" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section v-else-if="currentSection === 'proxy'" class="settings-panel compact-panel">
        <div class="panel-heading">
          <div>
            <h2>代理设置</h2>
            <p>填写代理地址后，为启用代理的镜像源提供网络代理</p>
          </div>
        </div>

        <div class="connection-preview">
          <div class="source-mark"><Network :size="20" /></div>
          <div>
            <strong>{{ activeSource?.proxyEnabled ? '通过代理连接' : '直接连接' }}</strong>
            <span>
              {{ activeSource?.proxyEnabled
                ? (draft.proxy.address ? `${draft.proxy.protocol}://${draft.proxy.address}` : '尚未填写代理地址')
                : '当前镜像源未启用网络代理' }}
            </span>
          </div>
        </div>

        <div class="proxy-core-fields">
          <div class="field protocol-field">
            <label for="proxy-protocol">协议</label>
            <div class="select-wrap">
              <select id="proxy-protocol" v-model="draft.proxy.protocol">
                <option value="http">HTTP</option>
                <option value="https">HTTPS</option>
              </select>
              <ChevronDown :size="15" />
            </div>
          </div>
          <div class="field proxy-address-field">
            <label for="proxy-address">代理地址</label>
            <input
              id="proxy-address"
              v-model="draft.proxy.address"
              type="text"
              spellcheck="false"
              placeholder="127.0.0.1:7890"
            />
          </div>
        </div>

        <div class="authentication-fields proxy-authentication">
          <div class="field">
            <label for="proxy-username">用户名</label>
            <input id="proxy-username" v-model="draft.proxy.username" type="text" autocomplete="off" />
          </div>
          <div class="field">
            <label for="proxy-password">密码</label>
            <div class="password-field">
              <input
                id="proxy-password"
                v-model="draft.proxy.password"
                :type="proxyPasswordVisible ? 'text' : 'password'"
                autocomplete="new-password"
              />
              <button
                type="button"
                title="显示或隐藏密码"
                aria-label="显示或隐藏密码"
                @click="proxyPasswordVisible = !proxyPasswordVisible"
              >
                <EyeOff v-if="proxyPasswordVisible" :size="16" />
                <Eye v-else :size="16" />
              </button>
            </div>
          </div>
        </div>
      </section>

      <section v-else class="settings-panel compact-panel">
        <div class="panel-heading">
          <div>
            <h2>下载路径</h2>
            <p>镜像包和断点缓存统一保存在此目录</p>
          </div>
        </div>

        <div class="connection-preview path-preview">
          <div class="source-mark"><FolderOpen :size="20" /></div>
          <div>
            <strong>镜像保存目录</strong>
            <span>{{ draft.downloadPath || '尚未设置下载路径' }}</span>
          </div>
        </div>

        <div class="field path-field">
          <label for="download-path">目录路径</label>
          <div class="path-input-row">
            <input id="download-path" v-model="draft.downloadPath" type="text" spellcheck="false" />
            <button
              type="button"
              class="icon-button browse-button"
              title="选择下载目录"
              aria-label="选择下载目录"
              :disabled="!runtimeAvailable"
              @click="chooseDownloadPath"
            >
              <FolderOpen :size="18" />
            </button>
          </div>
        </div>
      </section>
    </main>
  </div>
</template>

<style scoped>
.settings-page {
  min-height: 100vh;
  color: var(--text-primary);
  background: var(--app-background);
}

.settings-toolbar {
  position: sticky;
  top: 0;
  z-index: 10;
  height: 58px;
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  padding: 0 22px;
  border-bottom: 1px solid var(--border-color);
  box-sizing: border-box;
  background: color-mix(in srgb, var(--surface-color) 95%, transparent);
  backdrop-filter: blur(12px);
}

.settings-title {
  min-width: 0;
}

.settings-title h1,
.settings-title span,
.panel-heading h2,
.panel-heading p,
.source-summary strong,
.source-summary span,
.connection-preview strong,
.connection-preview span {
  margin: 0;
}

.settings-title h1 {
  font-size: 15px;
  line-height: 19px;
  font-weight: 650;
  letter-spacing: 0;
}

.settings-title span {
  display: block;
  color: var(--text-muted);
  font-size: 11px;
  line-height: 14px;
}

.settings-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.icon-button,
.reset-button,
.reset-cancel,
.save-button,
.secondary-button,
.authentication-toggle,
.password-field button,
.settings-tabs button {
  border: 0;
  font: inherit;
  cursor: pointer;
}

.icon-button {
  width: 34px;
  height: 34px;
  flex: 0 0 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border-radius: 6px;
  color: var(--text-secondary);
  background: transparent;
}

.icon-button:hover:not(:disabled) {
  color: var(--accent-color);
  background: var(--accent-soft);
}

.icon-button:disabled {
  cursor: not-allowed;
  opacity: 0.35;
}

.reset-button,
.reset-cancel,
.save-button,
.secondary-button {
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 0 11px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}

.reset-button {
  color: var(--text-secondary);
  background: var(--subtle-background-strong);
}

.reset-button:disabled {
  cursor: not-allowed;
  opacity: 0.62;
}

.reset-cancel {
  color: var(--text-secondary);
  border: 1px solid var(--control-border);
  background: var(--control-background);
}

.reset-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.reset-button.armed {
  color: var(--danger-color);
  background: var(--danger-soft);
}

.save-button {
  color: #fff;
  background: var(--accent-color);
}

.secondary-button {
  color: var(--accent-color);
  border: 1px solid var(--accent-border);
  background: var(--accent-soft);
}

.settings-content {
  width: min(800px, calc(100% - 36px));
  margin: 0 auto;
  padding: 20px 0 32px;
  box-sizing: border-box;
}

.settings-error {
  margin-bottom: 14px;
  padding: 10px 12px;
  border: 1px solid var(--danger-border);
  border-radius: 6px;
  color: var(--danger-color);
  background: var(--danger-soft);
  font-size: 12px;
}

.settings-tabs {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 3px;
  padding: 3px;
  border: 1px solid var(--border-color);
  border-radius: 7px;
  background: var(--subtle-background);
}

.settings-tabs button {
  height: 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  border-radius: 5px;
  color: var(--text-secondary);
  background: transparent;
  font-size: 12px;
  font-weight: 550;
}

.settings-tabs button.active {
  color: var(--accent-color);
  background: var(--surface-color);
  box-shadow: 0 1px 3px rgb(17 24 39 / 9%);
}

.settings-panel {
  padding-top: 22px;
}

.compact-panel {
  width: 100%;
}

.panel-heading {
  min-height: 38px;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--border-color);
}

.panel-heading h2 {
  font-size: 15px;
  line-height: 20px;
  font-weight: 650;
  letter-spacing: 0;
}

.panel-heading p,
.panel-heading > span {
  color: var(--text-muted);
  font-size: 11px;
  line-height: 16px;
}

.source-toolbar {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto auto;
  align-items: end;
  gap: 8px;
  margin: 18px 0;
}

.source-toolbar .secondary-button {
  height: 35px;
}

.source-select-field {
  width: 100%;
}

.proxy-toggle-button {
  color: var(--text-secondary);
  border-color: var(--control-border);
  background: var(--subtle-background-strong);
}

.proxy-toggle-button:hover:not(:disabled):not(.active) {
  color: var(--text-primary);
  background: var(--subtle-background);
}

.proxy-toggle-button.active {
  color: var(--accent-color);
  border-color: var(--accent-border);
  background: var(--accent-soft);
}

.proxy-checkbox {
  flex: 0 0 auto;
}

.proxy-toggle-button:disabled {
  cursor: not-allowed;
  opacity: 0.35;
}

.delete-button {
  color: var(--danger-color);
  border: 1px solid var(--control-border);
  background: var(--control-background);
}

.delete-button:hover:not(:disabled) {
  color: var(--danger-color);
  background: var(--danger-soft);
}

.delete-button:disabled {
  cursor: not-allowed;
  opacity: 0.35;
}

.source-editor {
  border: 1px solid var(--border-color);
  border-radius: 7px;
  background: var(--surface-color);
  overflow: hidden;
}

.source-summary,
.connection-preview {
  min-height: 61px;
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 11px 14px;
  box-sizing: border-box;
  background: var(--subtle-background);
}

.source-summary > div:last-child,
.connection-preview > div:nth-child(2) {
  min-width: 0;
}

.connection-preview > div:nth-child(2) {
  flex: 1;
}

.source-mark {
  width: 34px;
  height: 34px;
  flex: 0 0 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  color: var(--accent-color);
  background: var(--accent-soft);
}

.source-summary strong,
.source-summary span,
.connection-preview strong,
.connection-preview span {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.source-summary strong,
.connection-preview strong {
  font-size: 12px;
  line-height: 17px;
  font-weight: 650;
}

.source-summary span,
.connection-preview span {
  color: var(--text-muted);
  font-size: 11px;
  line-height: 15px;
}

.source-core-fields,
.proxy-core-fields,
.authentication-fields {
  display: grid;
  grid-template-columns: minmax(150px, 0.45fr) minmax(260px, 1fr);
  gap: 12px;
}

.source-core-fields {
  padding: 16px 14px;
}

.authentication-toggle {
  width: 100%;
  min-height: 50px;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 9px;
  padding: 8px 14px;
  border-top: 1px solid var(--border-color);
  color: var(--text-secondary);
  background: transparent;
  text-align: left;
}

.authentication-toggle:hover {
  background: var(--subtle-background);
}

.authentication-toggle > svg:first-child {
  color: var(--text-muted);
}

.authentication-toggle > svg:last-child {
  transition: transform 0.18s;
}

.authentication-toggle.expanded > svg:last-child {
  transform: rotate(180deg);
}

.authentication-toggle strong,
.authentication-toggle small {
  display: block;
}

.authentication-toggle strong {
  font-size: 12px;
  line-height: 16px;
}

.authentication-toggle small {
  color: var(--text-muted);
  font-size: 11px;
  line-height: 14px;
}

.authentication-fields {
  padding: 14px;
  border-top: 1px solid var(--border-color);
  background: var(--subtle-background);
}

.field {
  min-width: 0;
}

.field label {
  display: block;
  margin-bottom: 6px;
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 550;
}

input,
select {
  width: 100%;
  height: 35px;
  min-width: 0;
  padding: 0 10px;
  border: 1px solid var(--control-border);
  border-radius: 6px;
  outline: none;
  box-sizing: border-box;
  color: var(--text-primary);
  background: var(--control-background);
  font: inherit;
  font-size: 12px;
  letter-spacing: 0;
}

input::placeholder {
  color: var(--placeholder-color);
}

input:focus,
select:focus {
  border-color: var(--accent-color);
  box-shadow: 0 0 0 3px var(--accent-soft);
}

.select-wrap,
.password-field,
.path-input-row {
  position: relative;
  display: flex;
  align-items: center;
}

.select-wrap svg {
  position: absolute;
  right: 9px;
  color: var(--text-muted);
  pointer-events: none;
}

select {
  appearance: none;
  padding-right: 29px;
  cursor: pointer;
}

.password-field button {
  position: absolute;
  right: 1px;
  width: 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  color: var(--text-muted);
  background: transparent;
}

.password-field input {
  padding-right: 35px;
}

.connection-preview {
  margin: 18px 0;
  border: 1px solid var(--border-color);
  border-radius: 7px;
}

.proxy-core-fields {
  grid-template-columns: 130px minmax(260px, 1fr);
}

.proxy-authentication {
  margin-top: 13px;
  padding: 0;
  border: 0;
  background: transparent;
}

.path-field {
  width: 100%;
}

.path-input-row {
  gap: 8px;
}

.browse-button {
  border: 1px solid var(--control-border);
  background: var(--control-background);
}

@media (max-width: 620px) {
  .settings-toolbar {
    height: auto;
    min-height: 58px;
    grid-template-columns: 34px minmax(0, 1fr);
    padding: 9px 14px;
  }

  .settings-actions {
    grid-column: 1 / -1;
    justify-content: flex-end;
    padding-top: 4px;
  }

  .settings-content {
    width: calc(100% - 28px);
    padding-top: 15px;
  }

  .settings-tabs button {
    gap: 5px;
    font-size: 11px;
  }

  .source-toolbar {
    grid-template-columns: minmax(0, 1fr) auto auto auto;
  }

  .source-core-fields,
  .proxy-core-fields,
  .authentication-fields {
    grid-template-columns: 1fr;
  }

  .source-select-field {
    max-width: none;
  }
}
</style>
