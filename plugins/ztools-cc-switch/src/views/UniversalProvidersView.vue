<script setup>
import { onMounted, reactive, ref } from 'vue'

const emit = defineEmits(['back', 'toast', 'reload'])
const bridge = window.ccSwitch
const providers = ref([])
const loading = ref(true)
const modal = ref(false)
const editing = ref(false)
const busy = ref('')
const error = ref('')
const form = reactive({})

function defaults() {
  return {
    id: '', name: '', providerType: 'newapi', baseUrl: '', apiKey: '', hasApiKey: false,
    apps: { claude: true, codex: true, gemini: true }, iconColor: '#5EEAD4', notes: '',
    models: {
      claude: { model: 'claude-sonnet-5', haikuModel: 'claude-haiku-4-5-20251001', sonnetModel: 'claude-sonnet-5', opusModel: 'claude-opus-4-8' },
      codex: { model: 'gpt-5.5', reasoningEffort: 'high' }, gemini: { model: 'gemini-3.5-flash' }
    }
  }
}
function reset(value = defaults()) {
  Object.keys(form).forEach((key) => delete form[key])
  Object.assign(form, structuredClone(value))
}
async function load() {
  loading.value = true
  try { providers.value = await bridge.listUniversalProviders() }
  catch (e) { emit('toast', e.message, 'error') }
  finally { loading.value = false }
}
function create() { editing.value = false; error.value = ''; reset(); modal.value = true }
function edit(item) { editing.value = true; error.value = ''; reset(item); modal.value = true }
async function save(sync = false) {
  busy.value = sync ? 'save-sync' : 'save'; error.value = ''
  try {
    const saved = await bridge.saveUniversalProvider(structuredClone(form))
    if (sync) await bridge.syncUniversalProvider(saved.id)
    modal.value = false
    emit('toast', sync ? '统一 Provider 已保存并同步到三端' : '统一 Provider 已保存')
    await load(); if (sync) emit('reload')
  } catch (e) { error.value = e.message }
  finally { busy.value = '' }
}
async function sync(item) {
  if (!window.confirm(`同步「${item.name}」会更新已启用客户端中的关联 Provider，继续？`)) return
  busy.value = item.id
  try { await bridge.syncUniversalProvider(item.id); emit('toast', `${item.name} 已同步`); emit('reload') }
  catch (e) { emit('toast', e.message, 'error') }
  finally { busy.value = '' }
}
async function duplicate(item) {
  const copy = structuredClone(item); copy.id = crypto.randomUUID(); copy.name = `${copy.name} copy`; copy.apiKey = ''
  editing.value = false; reset(copy); modal.value = true
}
async function remove(item) {
  if (!window.confirm(`删除「${item.name}」及其三个关联子 Provider？`)) return
  try { await bridge.deleteUniversalProvider(item.id); emit('toast', `${item.name} 已删除`); await load(); emit('reload') }
  catch (e) { emit('toast', e.message, 'error') }
}
onMounted(load)
</script>

<template>
  <section class="settings-view universal-view">
    <header class="settings-heading"><button class="back-button" @click="$emit('back')">←</button><div><span class="eyebrow">SHARED GATEWAY</span><h1>统一 Provider</h1><p>一份网关配置，生成并同步 Claude、Codex 与 Gemini 三端 Provider。</p></div><button class="primary-button heading-action" @click="create">添加统一 Provider</button></header>
    <div class="universal-summary"><span>SECURE MOTHER CONFIG</span><strong>{{ providers.length }}</strong><p>API Key 经系统安全存储加密，不会返回 Web UI 或写入母配置 JSON。</p></div>
    <div v-if="loading" class="loading-grid"><div v-for="i in 3" :key="i" class="skeleton-card" /></div>
    <div v-else-if="providers.length" class="universal-grid">
      <article v-for="item in providers" :key="item.id" class="settings-card universal-card" :style="{ '--provider-color': item.iconColor }">
        <header><span class="provider-monogram">{{ item.name.slice(0,1).toUpperCase() }}</span><div><span class="card-label">{{ item.providerType }}</span><h2>{{ item.name }}</h2></div><span class="secure-badge" :class="{ warning: !item.hasApiKey }">{{ item.hasApiKey ? 'KEY STORED' : 'NO KEY' }}</span></header>
        <code>{{ item.baseUrl }}</code><div class="universal-apps"><span v-for="app in ['claude','codex','gemini']" :key="app" :class="{ on: item.apps[app] }">{{ app }}</span></div>
        <footer><button class="secondary-button" :disabled="busy === item.id" @click="sync(item)"><span v-if="busy === item.id" class="spinner" />同步</button><button class="icon-button" title="复制" @click="duplicate(item)">⧉</button><button class="icon-button" title="编辑" @click="edit(item)">✎</button><button class="icon-button danger" title="删除" @click="remove(item)">×</button></footer>
      </article>
    </div>
    <div v-else class="empty-state"><div class="empty-orbit"><span /></div><h2>还没有统一 Provider</h2><p>适合 NewAPI 或同时兼容三种协议的自建网关。</p><button class="primary-button" @click="create">创建母配置</button></div>

    <div v-if="modal" class="modal-backdrop" @mousedown.self="modal = false"><section class="provider-modal universal-modal"><header class="modal-header"><div><span class="eyebrow">UNIVERSAL PROVIDER</span><h2>{{ editing ? '编辑' : '添加' }}统一 Provider</h2><p>弹窗随 ZTools 宿主窗口按百分比缩放。</p></div><button class="modal-close" @click="modal = false">×</button></header><form @submit.prevent="save(false)">
      <div class="form-grid two-columns"><div class="form-field"><label>ID</label><input v-model="form.id" :disabled="editing" required placeholder="my-gateway" /></div><div class="form-field"><label>名称</label><input v-model="form.name" required placeholder="NewAPI" /></div></div>
      <div class="form-grid two-columns"><div class="form-field"><label>Base URL</label><input v-model="form.baseUrl" required placeholder="https://gateway.example.com" /></div><div class="form-field"><label>API Key</label><input v-model="form.apiKey" type="password" autocomplete="new-password" :placeholder="form.hasApiKey ? '留空保留已保存密钥' : 'sk-…'" /></div></div>
      <fieldset><legend>同步应用</legend><div class="client-options"><button v-for="app in ['claude','codex','gemini']" :key="app" type="button" :class="{ selected: form.apps[app] }" :style="{ '--client-accent': '#5EEAD4' }" @click="form.apps[app] = !form.apps[app]"><i />{{ app }}</button></div></fieldset>
      <div class="universal-model-section"><span class="card-label">CLAUDE MODELS</span><div class="form-grid two-columns"><div class="form-field"><label>主模型</label><input v-model="form.models.claude.model" /></div><div class="form-field"><label>Haiku</label><input v-model="form.models.claude.haikuModel" /></div><div class="form-field"><label>Sonnet</label><input v-model="form.models.claude.sonnetModel" /></div><div class="form-field"><label>Opus</label><input v-model="form.models.claude.opusModel" /></div></div></div>
      <div class="form-grid two-columns"><div class="universal-model-section"><span class="card-label">CODEX</span><div class="form-field"><label>模型</label><input v-model="form.models.codex.model" /></div><div class="form-field"><label>Reasoning Effort</label><select v-model="form.models.codex.reasoningEffort"><option value="low">low</option><option value="medium">medium</option><option value="high">high</option><option value="xhigh">xhigh</option></select></div></div><div class="universal-model-section"><span class="card-label">GEMINI</span><div class="form-field"><label>模型</label><input v-model="form.models.gemini.model" /></div><div class="form-field"><label>备注</label><input v-model="form.notes" /></div></div></div>
      <p v-if="error" class="form-error">{{ error }}</p><footer class="modal-actions"><button type="button" class="secondary-button" @click="modal = false">取消</button><button type="button" class="secondary-button" :disabled="busy" @click="save(true)">保存并同步</button><button class="primary-button" :disabled="busy">仅保存</button></footer>
    </form></section></div>
  </section>
</template>
