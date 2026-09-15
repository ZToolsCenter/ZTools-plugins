<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import type { BookSource } from '../../../utils/onlineBook'
import { getSourceLoginUrl, parseLoginUi, sourceKey, sourceDisplayName } from '../../../utils/onlineBook'
import { useOnlineStore } from '../../../stores/online'
import { mergeCookies } from '../../../utils/cookieJar'
import { evalLoginCheck } from '../../../utils/loginCheck'

const props = defineProps<{
  source: BookSource
  groupId: string
  index: number
}>()

const emit = defineEmits<{ close: [] }>()

const onlineStore = useOnlineStore()

const loginUrl = computed(() => getSourceLoginUrl(props.source))
const loginUiFields = computed(() => parseLoginUi(props.source).filter(f => f.type !== 'button'))

/** 表单方式：POST / GET */
const method = ref<'POST' | 'GET'>('POST')

const formValues = ref<Record<string, string>>({})
onMounted(() => {
  const init: Record<string, string> = {}
  for (const f of loginUiFields.value) init[f.name] = f.default || ''
  formValues.value = init
})

/** 当前生效 cookie（手动 + jar 合并，登录过程中的实时状态源） */
const localCookie = ref('')

function refreshCookie() {
  localCookie.value = mergeCookies(
    props.source.cookie,
    loginUrl.value ? onlineStore.jarCookie(loginUrl.value) : ''
  )
}
onMounted(refreshCookie)

/** 登录状态：ok=已登录 / no=未登录 / unknown=无法判断 / null=未配置检测 */
const status = computed<'ok' | 'no' | 'unknown' | null>(() => {
  const check = props.source.loginCheckJs?.trim()
  if (!check) return null
  const r = evalLoginCheck(check, { cookie: localCookie.value, url: loginUrl.value })
  return r === true ? 'ok' : r === false ? 'no' : 'unknown'
})

const statusText = computed(() =>
  status.value === 'ok' ? '已登录'
  : status.value === 'no' ? '未登录'
  : status.value === 'unknown' ? '无法自动判断'
  : '未配置登录状态检测'
)

const busy = ref(false)
const errorMsg = ref('')
const infoMsg = ref('')

function openBrowser() {
  const url = loginUrl.value
  if (!url) return
  const ztools = (window as any).ztools
  if (ztools?.shellOpenExternal) {
    ztools.shellOpenExternal(url)
    infoMsg.value = '已在系统浏览器打开登录页，完成登录后回到这里点击「检测登录状态」'
    errorMsg.value = ''
  } else {
    window.open(url, '_blank')
    infoMsg.value = '已尝试打开登录页，完成登录后回到这里点击「检测登录状态」'
    errorMsg.value = ''
  }
}

async function submitForm() {
  const url = loginUrl.value
  if (!url) {
    errorMsg.value = '书源未配置可用的登录地址（loginUrl）'
    return
  }
  busy.value = true
  errorMsg.value = ''
  infoMsg.value = ''
  try {
    const services = window.services
    if (!services.httpPostResponse) {
      errorMsg.value = '当前环境不支持网络请求'
      return
    }
    const params = new URLSearchParams()
    for (const f of loginUiFields.value) {
      params.append(f.name, formValues.value[f.name] ?? '')
    }
    const headers: Record<string, string> = {
      Referer: url,
      Origin: (() => { try { return new URL(url).origin } catch { return '' } })()
    }
    let res: { status: number; text: string; headers: Record<string, string | string[]> }
    if (method.value === 'POST') {
      res = await services.httpPostResponse(url, params.toString(), { headers, timeout: 20000 })
    } else {
      const sep = url.includes('?') ? '&' : '?'
      res = await services.httpGetResponse(url + sep + params.toString(), { headers, timeout: 20000 })
    }
    // 保存 Set-Cookie 到 jar 并回写书源手动 cookie
    const setCookies = res.headers?.['set-cookie']
    if (setCookies) {
      const list = Array.isArray(setCookies) ? setCookies.map(String) : [String(setCookies)]
      onlineStore.saveJarCookies(url, list)
      onlineStore.updateSource(props.groupId, props.index, { cookie: mergeCookies(props.source.cookie, ...list) })
    }
    refreshCookie()
    if (status.value === 'ok') {
      infoMsg.value = '登录成功，已获取并保存 Cookie'
    } else if (status.value === 'no') {
      errorMsg.value = '请求已完成（状态码 ' + res.status + '），但登录状态检测未通过，请检查账号信息'
    } else {
      infoMsg.value = '请求已完成（状态码 ' + res.status + '），Cookie 已保存；请在搜索/阅读时验证是否生效'
    }
  } catch (e: any) {
    errorMsg.value = `登录请求失败：${e?.message || e}`
  } finally {
    busy.value = false
  }
}

const manualCookie = ref('')
const showManual = ref(false)

function saveManualCookie() {
  const cookieStr = manualCookie.value.trim()
  if (!cookieStr) {
    errorMsg.value = '请先粘贴 Cookie'
    return
  }
  const url = loginUrl.value || sourceKey(props.source)
  onlineStore.saveJarCookieString(url, cookieStr)
  const next = mergeCookies(props.source.cookie, cookieStr)
  onlineStore.updateSource(props.groupId, props.index, { cookie: next })
  refreshCookie()
  manualCookie.value = ''
  showManual.value = false
  errorMsg.value = ''
  infoMsg.value = status.value === 'ok' ? 'Cookie 已保存，登录状态：已登录' : 'Cookie 已保存，请验证登录状态'
}

function clearLogin() {
  onlineStore.clearSourceLogin(props.source)
  onlineStore.updateSource(props.groupId, props.index, { cookie: undefined })
  localCookie.value = ''
  infoMsg.value = '已清除该书源的登录状态'
  errorMsg.value = ''
}

function checkStatus() {
  refreshCookie()
  infoMsg.value = `当前登录状态：${statusText.value}`
  errorMsg.value = ''
}
</script>

<template>
  <div class="login-overlay" @click.self="emit('close')">
    <div class="login-box">
      <div class="login-header">
        <div>
          <h3 class="login-title">书源登录</h3>
          <p class="login-sub">{{ sourceDisplayName(source) }}</p>
        </div>
        <button class="login-close" @click="emit('close')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <div class="login-body">
        <!-- 登录状态 -->
        <div class="status-bar">
          <span class="status-label">登录状态</span>
          <span class="status-badge" :class="status || 'none'">{{ statusText }}</span>
          <button class="mini-btn" @click="checkStatus">检测登录状态</button>
        </div>
        <p class="login-url" :title="loginUrl">{{ loginUrl || '未配置 loginUrl' }}</p>

        <div v-if="errorMsg" class="login-error">{{ errorMsg }}</div>
        <div v-if="infoMsg" class="login-info">{{ infoMsg }}</div>

        <!-- 方式一：表单登录 -->
        <div v-if="loginUiFields.length" class="login-section">
          <div class="section-title">表单登录</div>
          <div class="form-fields">
            <label v-for="f in loginUiFields" :key="f.name" class="form-field">
              <span class="form-label">{{ f.viewName || f.name }}</span>
              <input
                v-model="formValues[f.name]"
                class="text-input"
                :type="f.type === 'password' ? 'password' : 'text'"
                :placeholder="f.name"
              />
            </label>
          </div>
          <div class="form-actions">
            <label class="method-select">
              方式
              <select v-model="method" class="select">
                <option value="POST">POST</option>
                <option value="GET">GET</option>
              </select>
            </label>
            <button class="btn-primary" :disabled="busy" @click="submitForm">
              <span v-if="busy" class="spinner" style="width:13px;height:13px;border-width:1.5px;margin-right:4px"></span>
              {{ busy ? '登录中…' : '登录' }}
            </button>
          </div>
        </div>

        <!-- 方式二：浏览器登录 -->
        <div class="login-section">
          <div class="section-title">浏览器登录</div>
          <p class="section-hint">适合需要验证码 / 扫码等交互的站点。在系统浏览器登录后，Cookie 会自动随请求携带；无法自动回填时请用下方「手动粘贴 Cookie」。</p>
          <button class="btn-secondary" :disabled="!loginUrl" @click="openBrowser">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
            在系统浏览器打开登录页
          </button>
        </div>

        <!-- 方式三：手动 Cookie -->
        <div class="login-section">
          <div class="section-title">
            手动粘贴 Cookie
            <button class="mini-btn" @click="showManual = !showManual; manualCookie = ''">{{ showManual ? '收起' : '展开' }}</button>
          </div>
          <div v-if="showManual" class="manual-box">
            <textarea v-model="manualCookie" class="text-area mono" rows="3"
              placeholder="name=value; name2=value2"></textarea>
            <div class="manual-actions">
              <button class="btn-primary" @click="saveManualCookie">保存 Cookie</button>
            </div>
          </div>
        </div>

        <div class="login-actions">
          <button class="btn-secondary btn-danger" @click="clearLogin">清除登录状态</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.login-overlay {
  position: fixed;
  inset: 0;
  background: var(--c-overlay-bg);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 8000;
  animation: fade-in 0.15s var(--ease-out);
}

.login-box {
  background: var(--c-surface-overlay);
  border: 1px solid var(--c-border);
  border-radius: var(--radius-xl);
  width: min(480px, 94vw);
  max-height: 86vh;
  display: flex;
  flex-direction: column;
  box-shadow: var(--shadow-xl);
  animation: slide-up 0.2s var(--ease-out);
}

.login-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 16px 20px 12px;
  border-bottom: 1px solid var(--c-border);
  flex-shrink: 0;
}

.login-title {
  font-size: 15px;
  font-weight: 700;
}

.login-sub {
  font-size: 12px;
  color: var(--c-ink-tertiary);
  margin-top: 2px;
}

.login-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: var(--radius-sm);
  color: var(--c-ink-tertiary);
  transition: background 0.12s var(--ease-out), color 0.12s var(--ease-out);
}

.login-close:hover {
  background: var(--c-surface-sunken);
  color: var(--c-ink);
}

.login-body {
  padding: 14px 20px 18px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.status-bar {
  display: flex;
  align-items: center;
  gap: 8px;
}

.status-label {
  font-size: 12px;
  color: var(--c-ink-secondary);
}

.status-badge {
  font-size: 11px;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: var(--radius-full);
}

.status-badge.ok { background: var(--c-success-soft); color: var(--c-success); }
.status-badge.no { background: var(--c-danger-soft); color: var(--c-danger); }
.status-badge.unknown { background: var(--c-warning-soft, var(--c-accent-soft)); color: var(--c-warning, var(--c-accent)); }
.status-badge.none { background: var(--c-surface-sunken); color: var(--c-ink-tertiary); }

.login-url {
  font-size: 11px;
  color: var(--c-ink-tertiary);
  font-family: var(--font-mono);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.login-error {
  padding: 8px 12px;
  border-radius: var(--radius-sm);
  background: var(--c-danger-soft);
  color: var(--c-danger);
  font-size: 12px;
}

.login-info {
  padding: 8px 12px;
  border-radius: var(--radius-sm);
  background: var(--c-success-soft);
  color: var(--c-success);
  font-size: 12px;
}

.login-section {
  border: 1px solid var(--c-border);
  border-radius: var(--radius-md);
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.section-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  font-weight: 700;
  color: var(--c-ink);
}

.section-hint {
  font-size: 11px;
  line-height: 1.6;
  color: var(--c-ink-tertiary);
  margin: 0;
}

.form-fields {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.form-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.form-label {
  font-size: 11px;
  color: var(--c-ink-secondary);
}

.form-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.method-select {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--c-ink-secondary);
}

.text-input,
.select,
.text-area {
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  color: var(--c-ink);
  border-radius: var(--radius-sm);
  padding: 7px 10px;
  font-size: 12px;
  width: 100%;
}

.text-input:focus,
.select:focus,
.text-area:focus {
  border-color: var(--c-accent);
  box-shadow: 0 0 0 3px var(--c-accent-soft);
  outline: none;
}

.mono {
  font-family: var(--font-mono);
}

.text-area {
  resize: vertical;
  min-height: 60px;
}

.manual-box {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.manual-actions {
  display: flex;
  justify-content: flex-end;
}

.login-actions {
  display: flex;
  justify-content: flex-start;
}

.mini-btn {
  padding: 3px 10px;
  font-size: 11px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--c-border);
  background: var(--c-surface-sunken);
  color: var(--c-ink-secondary);
  transition: all 0.12s var(--ease-out);
}

.mini-btn:hover {
  color: var(--c-ink);
  border-color: var(--c-border-strong);
}

.btn-primary,
.btn-secondary {
  padding: 7px 16px;
  border-radius: var(--radius-sm);
  font-size: 12px;
  font-weight: 500;
  transition: all 0.15s var(--ease-out);
}

.btn-primary {
  background: var(--c-accent);
  color: var(--c-ink-inverse);
}

.btn-primary:hover {
  background: var(--c-accent-hover);
}

.btn-primary:disabled {
  opacity: 0.5;
}

.btn-secondary {
  background: var(--c-surface-sunken);
  color: var(--c-ink);
  border: 1px solid var(--c-border);
}

.btn-secondary:hover:not(:disabled) {
  border-color: var(--c-border-strong);
}

.btn-secondary:disabled {
  opacity: 0.5;
}

.btn-danger {
  color: var(--c-danger);
  border-color: var(--c-danger-soft);
}

.btn-danger:hover {
  background: var(--c-danger-soft);
}
</style>
