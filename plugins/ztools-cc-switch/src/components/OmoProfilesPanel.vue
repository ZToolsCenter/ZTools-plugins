<script setup>
import { computed, onMounted, ref } from 'vue'

const emit = defineEmits(['toast'])
const bridge = window.ccSwitch
const loading = ref(true)
const busy = ref('')
const state = ref({ profiles: [], current: { standard: '', slim: '' }, local: {} })
const variant = ref('standard')
const modalOpen = ref(false)
const form = ref({ id: '', variant: 'standard', name: '', agents: '{}', categories: '{}', otherFields: '{}' })

const variantInfo = computed(() => variant.value === 'standard'
  ? { label: 'OMO', file: 'oh-my-openagent.jsonc', plugin: 'oh-my-openagent@latest', hasCategories: true }
  : { label: 'OMO Slim', file: 'oh-my-opencode-slim.jsonc', plugin: 'oh-my-opencode-slim@latest', hasCategories: false })
const profiles = computed(() => state.value.profiles.filter((item) => item.variant === variant.value))
const currentId = computed(() => state.value.current?.[variant.value] || '')
const local = computed(() => state.value.local?.[variant.value] || {})

function toast(message, tone = 'success') { emit('toast', message, tone) }
function pretty(value) { return JSON.stringify(value ?? {}, null, 2) }

async function load() {
  loading.value = true
  try { state.value = await bridge.listOmoProfiles() }
  catch (error) { toast(error.message || '加载 OMO Profile 失败', 'error') }
  finally { loading.value = false }
}

function openCreate() {
  form.value = { id: '', variant: variant.value, name: '', agents: '{}', categories: '{}', otherFields: '{}' }
  modalOpen.value = true
}

function openEdit(profile) {
  form.value = {
    id: profile.id, variant: profile.variant, name: profile.name,
    agents: pretty(profile.settingsConfig?.agents), categories: pretty(profile.settingsConfig?.categories),
    otherFields: pretty(profile.settingsConfig?.otherFields)
  }
  modalOpen.value = true
}

function parseObject(source, label) {
  const text = String(source || '').trim()
  if (!text) return undefined
  const value = JSON.parse(text)
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error(`${label} 必须是 JSON 对象`)
  return value
}

async function save() {
  busy.value = 'save'
  try {
    const settingsConfig = {}
    const agents = parseObject(form.value.agents, 'Agents')
    const categories = form.value.variant === 'standard' ? parseObject(form.value.categories, 'Categories') : undefined
    const otherFields = parseObject(form.value.otherFields, 'Other Fields')
    if (agents !== undefined) settingsConfig.agents = agents
    if (categories !== undefined) settingsConfig.categories = categories
    if (otherFields !== undefined) settingsConfig.otherFields = otherFields
    const saved = await bridge.saveOmoProfile({ id: form.value.id || undefined, variant: form.value.variant, name: form.value.name, settingsConfig })
    modalOpen.value = false
    toast(`${saved.name} 已保存${currentId.value === saved.id ? '并同步到 OpenCode' : ''}`)
    await load()
  } catch (error) { toast(error.message || '保存 OMO Profile 失败', 'error') }
  finally { busy.value = '' }
}

async function activate(profile) {
  busy.value = profile.id
  try { await bridge.activateOmoProfile(profile.id); toast(`${profile.name} 已启用`); await load() }
  catch (error) { toast(error.message || '启用失败', 'error') }
  finally { busy.value = '' }
}

async function disable() {
  if (!window.confirm(`停用 ${variantInfo.value.label}？配置文件会备份为 .bak，并从 OpenCode 插件列表移除。`)) return
  busy.value = 'disable'
  try { await bridge.disableOmo(variant.value); toast(`${variantInfo.value.label} 已停用`); await load() }
  catch (error) { toast(error.message || '停用失败', 'error') }
  finally { busy.value = '' }
}

async function importLocal() {
  busy.value = 'import'
  try { const profile = await bridge.importOmoLocal(variant.value); toast(`${profile.name} 已导入并启用`); await load() }
  catch (error) { toast(error.message || '导入失败', 'error') }
  finally { busy.value = '' }
}

async function remove(profile) {
  if (!window.confirm(`删除 ${profile.name}？${currentId.value === profile.id ? '当前配置也会停用。' : ''}`)) return
  busy.value = profile.id
  try { await bridge.deleteOmoProfile(profile.id); toast(`${profile.name} 已删除`); await load() }
  catch (error) { toast(error.message || '删除失败', 'error') }
  finally { busy.value = '' }
}

async function openDirectory() { try { await bridge.openOmoDirectory() } catch (error) { toast(error.message, 'error') } }
onMounted(load)
</script>

<template>
  <section class="omo-console">
    <header class="omo-console-head">
      <div><span class="card-label">OPENCODE AGENT ORCHESTRATION</span><h2>OMO Profiles</h2><p>管理 Agent 模型分配，并同步 OpenCode 插件与本地 JSONC 配置。</p></div>
      <div class="segmented-tabs"><button :class="{ active: variant === 'standard' }" @click="variant = 'standard'">Standard</button><button :class="{ active: variant === 'slim' }" @click="variant = 'slim'">Slim</button></div>
    </header>

    <div class="omo-runtime-card">
      <div><i :class="{ online: currentId }" /><span>{{ variantInfo.label }}</span><strong>{{ currentId ? 'ACTIVE' : 'INACTIVE' }}</strong></div>
      <dl><div><dt>CONFIG</dt><dd>{{ local.filePath || variantInfo.file }}</dd></div><div><dt>PLUGIN</dt><dd>{{ variantInfo.plugin }}</dd></div></dl>
      <div class="omo-runtime-actions"><button class="secondary-button" @click="openDirectory">打开目录</button><button v-if="local.exists" class="secondary-button" :disabled="busy === 'import'" @click="importLocal">导入本地</button><button v-if="currentId" class="secondary-button danger" :disabled="busy === 'disable'" @click="disable">停用</button></div>
    </div>

    <div class="omo-toolbar"><div><strong>{{ profiles.length }}</strong><span> SAVED PROFILES</span></div><button class="primary-button" @click="openCreate">新建 {{ variantInfo.label }} Profile</button></div>
    <div v-if="loading" class="loading-grid"><div v-for="n in 2" :key="n" class="skeleton-card" /></div>
    <div v-else-if="profiles.length" class="omo-profile-grid">
      <article v-for="profile in profiles" :key="profile.id" class="omo-profile-card" :class="{ active: currentId === profile.id }">
        <header><span>{{ profile.variant === 'standard' ? 'OMO' : 'SLIM' }}</span><em v-if="currentId === profile.id">LIVE</em></header>
        <h3>{{ profile.name }}</h3>
        <div class="omo-profile-stats"><span><b>{{ Object.keys(profile.settingsConfig?.agents || {}).length }}</b> agents</span><span v-if="profile.variant === 'standard'"><b>{{ Object.keys(profile.settingsConfig?.categories || {}).length }}</b> categories</span><span><b>{{ Object.keys(profile.settingsConfig?.otherFields || {}).length }}</b> other</span></div>
        <footer><button class="secondary-button" :disabled="busy === profile.id" @click="activate(profile)">{{ currentId === profile.id ? '重新应用' : '启用' }}</button><button class="icon-button" title="编辑" @click="openEdit(profile)">✎</button><button class="icon-button danger" title="删除" :disabled="busy === profile.id" @click="remove(profile)">×</button></footer>
      </article>
    </div>
    <div v-else class="omo-empty"><span>Ø</span><h3>没有 {{ variantInfo.label }} Profile</h3><p v-if="local.exists">检测到本地配置，可以直接导入并纳管。</p><p v-else>创建 Profile 后即可将 Agent 模型映射同步到 OpenCode。</p></div>

    <div v-if="modalOpen" class="modal-backdrop omo-backdrop" @click.self="modalOpen = false">
      <section class="provider-modal omo-modal" role="dialog" aria-modal="true" aria-label="OMO Profile 编辑器">
        <header class="modal-header"><div><span class="eyebrow">{{ form.variant === 'standard' ? 'OMO STANDARD' : 'OMO SLIM' }}</span><h2>{{ form.id ? '编辑 Profile' : '新建 Profile' }}</h2></div><button class="icon-button" @click="modalOpen = false">×</button></header>
        <div class="omo-modal-body">
          <label class="omo-name-field">Profile Name<input v-model="form.name" maxlength="100" placeholder="例如：Claude Research Team" /></label>
          <div class="omo-editor-grid" :class="{ slim: form.variant === 'slim' }">
            <label><span>AGENTS <em>模型与参数映射</em></span><textarea v-model="form.agents" spellcheck="false" /></label>
            <label v-if="form.variant === 'standard'"><span>CATEGORIES <em>任务类别模型映射</em></span><textarea v-model="form.categories" spellcheck="false" /></label>
            <label><span>OTHER FIELDS <em>保留未知顶层字段</em></span><textarea v-model="form.otherFields" spellcheck="false" /></label>
          </div>
        </div>
        <footer class="modal-footer"><small>保存活动 Profile 会立即写入 OpenCode；写入前自动备份，插件同步失败会回滚。</small><button class="secondary-button" @click="modalOpen = false">取消</button><button class="primary-button" :disabled="busy === 'save'" @click="save">{{ busy === 'save' ? '保存中…' : '保存 Profile' }}</button></footer>
      </section>
    </div>
  </section>
</template>
