<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
const props = defineProps({ clients: { type: Array, required: true } })
const emit = defineEmits(['back', 'toast'])
const bridge = window.ccSwitch
const tab = ref('mcp'); const data = ref({ mcpServers: [], prompts: [] }); const modal = ref(false); const editing = ref(null); const error = ref('')
const promptClient = ref('claude'); const promptPreview = ref(null); const promptBusy = ref('')
const mcpStatus = ref({ userConfigExists: false, serverCount: 0, userConfigPath: '~/.claude.json' }); const mcpPreview = ref(null); const mcpBusy = ref(''); const commandCheck = ref(null)
const form = reactive({})
const items = computed(() => tab.value === 'mcp' ? data.value.mcpServers : data.value.prompts)
const promptClients = computed(() => props.clients.filter((v) => ['claude','codex','gemini','opencode','openclaw','hermes','grokbuild'].includes(v.id)))
const availableClients = computed(() => tab.value === 'mcp' ? props.clients.filter((v) => ['claude','codex','gemini','opencode','hermes'].includes(v.id)) : promptClients.value)
async function load() { try { [data.value, mcpStatus.value] = await Promise.all([bridge.listExtensions(), bridge.getClaudeMcpStatus()]) } catch (e) { emit('toast', e.message, 'error') } }
function openCreate() {
  editing.value = null; error.value = ''; commandCheck.value = null; Object.keys(form).forEach((key) => delete form[key])
  Object.assign(form, tab.value === 'mcp' ? { id: '', name: '', type: 'command', command: '', argsText: '', url: '', envText: '{}', headersText: '{}' } : { id: '', name: '', description: '', content: '' }); modal.value = true
}
function openEdit(item) {
  editing.value = item; error.value = ''; commandCheck.value = null; Object.keys(form).forEach((key) => delete form[key])
  Object.assign(form, tab.value === 'mcp' ? { ...item, argsText: (item.args || []).join('\n'), envText: JSON.stringify(item.env || {}, null, 2), headersText: JSON.stringify(item.headers || {}, null, 2) } : { ...item }); modal.value = true
}
async function save() {
  try {
    if (tab.value === 'mcp') await bridge.saveMcp({ ...form, args: form.argsText.split(/\n/).map(v => v.trim()).filter(Boolean), env: JSON.parse(form.envText || '{}'), headers: JSON.parse(form.headersText || '{}') })
    else await bridge.savePrompt({ ...form })
    modal.value = false; emit('toast', `${tab.value === 'mcp' ? 'MCP Server' : 'Prompt'} 已保存`); await load()
  } catch (e) { error.value = e.message }
}
async function toggle(item, client, enabled) {
  try { if (tab.value === 'mcp') await bridge.setMcpEnabled(item.id, client.id, enabled); else await bridge.setPromptEnabled(item.id, client.id, enabled); item.apps = { ...item.apps, [client.id]: enabled }; emit('toast', `${item.name} 已${enabled ? '同步到' : '移出'} ${client.name}`) } catch (e) { emit('toast', e.message, 'error') }
}
async function remove(item) {
  if (!window.confirm(`删除「${item.name}」并移除所有已同步配置？`)) return
  try { if (tab.value === 'mcp') await bridge.removeMcp(item.id); else await bridge.removePrompt(item.id); emit('toast', `${item.name} 已删除`); await load() } catch (e) { emit('toast', e.message, 'error') }
}
async function viewCurrentPrompt() {
  promptBusy.value = 'preview'
  try {
    const content = await bridge.getCurrentPromptFileContent(promptClient.value)
    if (content === null) return emit('toast', '当前客户端尚无全局 Prompt 文件', 'warning')
    promptPreview.value = content
  } catch (e) { emit('toast', e.message, 'error') }
  finally { promptBusy.value = '' }
}
async function importCurrentPrompt() {
  promptBusy.value = 'import'
  try {
    const item = await bridge.importPromptFromFile(promptClient.value)
    emit('toast', `Prompt「${item.name}」已从当前文件导入`)
    await load()
  } catch (e) { emit('toast', e.message, 'error') }
  finally { promptBusy.value = '' }
}
async function importExistingMcp() {
  mcpBusy.value = 'import'
  try {
    const result = await bridge.importMcpFromApps()
    const tone = result.errors.length ? 'warning' : 'success'
    emit('toast', `已新增 ${result.imported.length} 个 MCP，更新 ${result.updated.length} 个应用关联${result.errors.length ? `；${result.errors.length} 个来源失败` : ''}`, tone)
    await load()
  } catch (e) { emit('toast', e.message, 'error') }
  finally { mcpBusy.value = '' }
}
async function viewClaudeMcp() {
  mcpBusy.value = 'preview'
  try {
    const content = await bridge.readClaudeMcpConfig()
    if (content === null) return emit('toast', 'Claude MCP 配置文件不存在', 'warning')
    mcpPreview.value = content
  } catch (e) { emit('toast', e.message, 'error') }
  finally { mcpBusy.value = '' }
}
async function checkCommand() {
  commandCheck.value = null
  if (!form.command?.trim()) return
  commandCheck.value = await bridge.validateMcpCommand(form.command) ? 'ok' : 'missing'
}
onMounted(load)
</script>
<template>
  <section class="settings-view extension-view">
    <header class="settings-heading"><button class="back-button" @click="$emit('back')">←</button><div><span class="eyebrow">EXTENSION BUS</span><h1>MCP 与 Prompts</h1><p>保存一次，按客户端选择性分发。</p></div><button class="primary-button heading-action" @click="openCreate">添加{{ tab === 'mcp' ? ' MCP' : ' Prompt' }}</button></header>
    <div class="segmented-tabs"><button :class="{ active: tab === 'mcp' }" @click="tab = 'mcp'">MCP Servers <span>{{ data.mcpServers.length }}</span></button><button :class="{ active: tab === 'prompts' }" @click="tab = 'prompts'">Prompts <span>{{ data.prompts.length }}</span></button></div>
    <div v-if="tab === 'mcp'" class="mcp-import-toolbar">
      <div><span>CLAUDE MCP LIVE</span><strong>{{ mcpStatus.serverCount }} servers</strong><small>{{ mcpStatus.userConfigPath }}</small></div>
      <button class="secondary-button" :disabled="Boolean(mcpBusy) || !mcpStatus.userConfigExists" @click="viewClaudeMcp">{{ mcpBusy === 'preview' ? '读取中…' : '查看脱敏配置' }}</button>
      <button class="primary-button" :disabled="Boolean(mcpBusy)" @click="importExistingMcp">{{ mcpBusy === 'import' ? '导入中…' : '从客户端导入' }}</button>
    </div>
    <div v-if="tab === 'prompts'" class="prompt-live-toolbar">
      <div><span>当前全局文件</span><small>读取客户端固定配置路径，不接受任意网页路径</small></div>
      <select v-model="promptClient"><option v-for="client in promptClients" :key="client.id" :value="client.id">{{ client.name }}</option></select>
      <button class="secondary-button" :disabled="Boolean(promptBusy)" @click="viewCurrentPrompt">{{ promptBusy === 'preview' ? '读取中…' : '查看当前文件' }}</button>
      <button class="primary-button" :disabled="Boolean(promptBusy)" @click="importCurrentPrompt">{{ promptBusy === 'import' ? '导入中…' : '导入当前文件' }}</button>
    </div>
    <div v-if="items.length" class="extension-list">
      <article v-for="item in items" :key="item.id" class="settings-card extension-card"><div><span class="card-label">{{ item.id }} · {{ tab === 'mcp' ? item.type : 'prompt' }}</span><h2>{{ item.name }}</h2><p>{{ tab === 'mcp' ? (item.type === 'http' ? item.url : `${item.command} ${(item.args || []).join(' ')}`) : item.description || item.content.slice(0, 90) }}</p></div><div class="skill-apps"><button v-for="client in availableClients" :key="client.id" :class="{ enabled: item.apps?.[client.id] }" :style="{ '--client-accent': client.accent }" @click="toggle(item, client, !item.apps?.[client.id])"><i />{{ client.name }}</button></div><div class="extension-actions"><button class="icon-button" @click="openEdit(item)">✎</button><button class="icon-button danger" @click="remove(item)">×</button></div></article>
    </div><div v-else class="empty-state"><div class="empty-orbit"><span /></div><h2>还没有 {{ tab === 'mcp' ? 'MCP Server' : 'Prompt' }}</h2><p>添加后可同步到多个客户端。</p></div>

    <div v-if="modal" class="modal-backdrop" @mousedown.self="modal = false"><section class="provider-modal extension-modal"><header class="modal-header"><div><span class="eyebrow">{{ tab === 'mcp' ? 'MCP SERVER' : 'PROMPT' }}</span><h2>{{ editing ? '编辑' : '添加' }}{{ tab === 'mcp' ? ' MCP' : ' Prompt' }}</h2></div><button class="modal-close" @click="modal = false">×</button></header><form @submit.prevent="save">
      <div class="form-grid two-columns"><div class="form-field"><label><span>ID</span></label><input v-model="form.id" :disabled="Boolean(editing)" placeholder="filesystem" /></div><div class="form-field"><label><span>名称</span></label><input v-model="form.name" placeholder="Filesystem" /></div></div>
      <template v-if="tab === 'mcp'"><div class="form-field"><label><span>类型</span></label><select v-model="form.type"><option value="command">本地命令</option><option value="http">远程 HTTP</option></select></div><div v-if="form.type === 'command'" class="form-grid two-columns"><div class="form-field"><label><span>命令</span></label><div class="command-check-row"><input v-model="form.command" placeholder="npx" @input="commandCheck = null" /><button type="button" class="secondary-button" @click="checkCommand">校验</button></div><small v-if="commandCheck" :class="['command-check-result', commandCheck]">{{ commandCheck === 'ok' ? '命令可在 PATH 中执行' : '未在 PATH 中找到命令' }}</small></div><div class="form-field"><label><span>参数（每行一个）</span></label><textarea v-model="form.argsText" rows="4" /></div></div><div v-else class="form-field"><label><span>URL</span></label><input v-model="form.url" placeholder="https://example.com/mcp" /></div><div class="form-grid two-columns"><div class="form-field"><label><span>环境变量 JSON</span></label><textarea v-model="form.envText" rows="5" /></div><div class="form-field"><label><span>Headers JSON</span></label><textarea v-model="form.headersText" rows="5" /></div></div></template>
      <template v-else><div class="form-field"><label><span>描述</span></label><input v-model="form.description" /></div><div class="form-field"><label><span>Prompt 内容</span></label><textarea v-model="form.content" rows="12" /></div></template>
      <p v-if="error" class="form-error">{{ error }}</p><footer class="modal-actions"><button type="button" class="secondary-button" @click="modal = false">取消</button><button class="primary-button">保存</button></footer>
    </form></section></div>
    <div v-if="promptPreview !== null" class="modal-backdrop" @mousedown.self="promptPreview = null"><section class="provider-modal prompt-preview-modal"><header class="modal-header"><div><span class="eyebrow">LIVE PROMPT</span><h2>当前全局 Prompt</h2><p>{{ promptClients.find((item) => item.id === promptClient)?.name }}</p></div><button class="modal-close" @click="promptPreview = null">×</button></header><div class="prompt-preview-body"><textarea :value="promptPreview" readonly /></div></section></div>
    <div v-if="mcpPreview !== null" class="modal-backdrop" @mousedown.self="mcpPreview = null"><section class="provider-modal prompt-preview-modal mcp-preview-modal"><header class="modal-header"><div><span class="eyebrow">CLAUDE MCP</span><h2>脱敏 Live 配置</h2><p>API Key、Token、Secret 与 Authorization 已隐藏</p></div><button class="modal-close" @click="mcpPreview = null">×</button></header><div class="prompt-preview-body"><textarea :value="mcpPreview" readonly /></div></section></div>
  </section>
</template>
