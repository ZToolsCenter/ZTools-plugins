<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

const emit = defineEmits(['back', 'toast', 'changed'])
const bridge = window.ccSwitch
const providers = ref([])
const loading = ref(true)
const busy = ref('')
const login = ref(null)
const githubDomain = ref('github.com')
let pollTimer = null

const accountCount = computed(() => providers.value.reduce((sum, item) => sum + item.accounts.length, 0))

async function load() {
  try { providers.value = await bridge.listAuthProviders() }
  catch (error) { emit('toast', error.message || '认证状态加载失败', 'error') }
  finally { loading.value = false }
}
function schedulePoll(delay) {
  clearTimeout(pollTimer)
  pollTimer = window.setTimeout(poll, Math.max(Number(delay) || 1500, 800))
}
async function connect(provider) {
  busy.value = provider.id
  try {
    const flow = await bridge.startAuthLogin(provider.id, provider.id === 'github_copilot' ? { domain: githubDomain.value } : {})
    login.value = { ...flow, providerName: provider.name, state: 'pending', message: '等待你在浏览器完成授权…' }
    await bridge.openExternal(flow.verificationUri)
    schedulePoll(900)
  } catch (error) { emit('toast', error.message || '无法开始登录', 'error') }
  finally { busy.value = '' }
}
async function poll() {
  if (!login.value?.flowId) return
  try {
    const result = await bridge.pollAuthLogin(login.value.flowId)
    login.value = { ...login.value, ...result }
    if (result.state === 'pending') schedulePoll(result.retryAfterMs)
    else if (result.state === 'authenticated') {
      emit('toast', result.message || '账号已连接')
      await load(); emit('changed')
    }
  } catch (error) {
    login.value = { ...login.value, state: 'error', message: error.message || '授权轮询失败' }
  }
}
async function copyCode() {
  try { await bridge.copyText(login.value.userCode); emit('toast', '设备码已复制') }
  catch { emit('toast', '无法写入剪贴板，请手动复制', 'warning') }
}
async function setDefault(provider, account) {
  busy.value = `${provider.id}:${account.id}`
  try { await bridge.setDefaultAuthAccount(provider.id, account.id); await load(); emit('changed'); emit('toast', `${account.label} 已设为默认账号`) }
  catch (error) { emit('toast', error.message || '设置默认账号失败', 'error') }
  finally { busy.value = '' }
}
async function remove(provider, account) {
  if (!window.confirm(`移除 ${account.label}？关联此账号的 Provider 将无法路由，直到重新绑定。`)) return
  busy.value = `${provider.id}:${account.id}`
  try { await bridge.removeAuthAccount(provider.id, account.id); await load(); emit('changed'); emit('toast', `${account.label} 已移除`) }
  catch (error) { emit('toast', error.message || '移除账号失败', 'error') }
  finally { busy.value = '' }
}
function closeLogin() { clearTimeout(pollTimer); login.value = null }
onMounted(load)
onBeforeUnmount(() => clearTimeout(pollTimer))
</script>

<template>
  <section class="settings-view auth-view">
    <header class="settings-heading">
      <button class="back-button" @click="$emit('back')">← 返回</button>
      <div class="auth-heading-copy"><span class="eyebrow">IDENTITY SWITCHBOARD</span><h1>认证中心</h1><p>连接订阅账号，让本地路由按 Provider 绑定账号。Token 加密留在 Preload，网页层不可读取。</p></div>
      <div class="auth-tally"><strong>{{ accountCount }}</strong><span>CONNECTED<br />IDENTITIES</span></div>
    </header>

    <div v-if="loading" class="loading-grid"><div v-for="i in 3" :key="i" class="skeleton-card" /></div>
    <div v-else class="auth-provider-list">
      <article v-for="provider in providers" :key="provider.id" class="auth-provider-card settings-card">
        <header class="auth-provider-header">
          <div class="auth-sigil" :data-kind="provider.id"><span>{{ provider.id === 'codex_oauth' ? 'CX' : provider.id === 'xai_oauth' ? 'XA' : 'GH' }}</span></div>
          <div><span class="card-label">{{ provider.id.replace('_', ' ').toUpperCase() }}</span><h2>{{ provider.name }}</h2></div>
          <span class="secure-badge" :class="{ warning: !provider.secureStorage }">{{ provider.secureStorage ? 'SYSTEM ENCRYPTED' : 'FALLBACK STORAGE' }}</span>
        </header>

        <div v-if="provider.accounts.length" class="auth-account-list">
          <div v-for="account in provider.accounts" :key="account.id" class="auth-account" :class="{ default: account.isDefault, stale: account.requiresReauth }">
            <img v-if="account.avatarUrl" :src="account.avatarUrl" alt="" referrerpolicy="no-referrer" />
            <span v-else class="account-monogram">{{ account.label.slice(0, 2).toUpperCase() }}</span>
            <div><strong>{{ account.label }}</strong><small>{{ account.email || account.domain }} · {{ account.requiresReauth ? '需要重新登录' : account.isDefault ? '默认路由账号' : '可用' }}</small></div>
            <span v-if="account.isDefault" class="account-default">DEFAULT</span>
            <button v-else class="text-button" :disabled="busy !== ''" @click="setDefault(provider, account)">设为默认</button>
            <button class="icon-button danger" title="移除账号" :disabled="busy !== ''" @click="remove(provider, account)">×</button>
          </div>
        </div>
        <div v-else class="auth-empty"><i /><span>尚未连接账号</span><small>设备码登录不会要求插件接触你的密码。</small></div>

        <footer class="auth-provider-footer">
          <label v-if="provider.id === 'github_copilot'">GitHub 域名<input v-model="githubDomain" placeholder="github.com" /></label>
          <button class="primary-button" :disabled="busy !== ''" @click="connect(provider)">{{ busy === provider.id ? '正在请求…' : provider.accounts.length ? '连接另一个账号' : '连接账号' }}</button>
        </footer>
      </article>
    </div>

    <div v-if="login" class="modal-backdrop" @mousedown.self="closeLogin">
      <section class="provider-modal device-modal" role="dialog" aria-modal="true" aria-labelledby="device-title">
        <header class="modal-header"><div><span class="eyebrow">DEVICE AUTHORIZATION</span><h2 id="device-title">连接 {{ login.providerName }}</h2></div><button class="modal-close" aria-label="关闭" @click="closeLogin">×</button></header>
        <div class="device-body">
          <div class="device-sequence"><span class="active">1</span><i /><span :class="{ active: login.state === 'authenticated' }">2</span></div>
          <p>浏览器已打开授权页面。输入下面的设备码，然后回到这里等待连接完成。</p>
          <button class="device-code" title="复制设备码" @click="copyCode"><span>{{ login.userCode }}</span><small>点击复制</small></button>
          <div class="device-state" :class="login.state"><i /><div><strong>{{ login.state === 'authenticated' ? '账号已连接' : login.state === 'pending' ? '正在等待授权' : '授权未完成' }}</strong><small>{{ login.message }}</small></div></div>
          <footer class="modal-actions"><button class="secondary-button" @click="bridge.openExternal(login.verificationUri)">重新打开授权页</button><button class="primary-button" @click="closeLogin">{{ login.state === 'authenticated' ? '完成' : '稍后处理' }}</button></footer>
        </div>
      </section>
    </div>
  </section>
</template>
