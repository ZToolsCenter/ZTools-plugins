<script setup>
import { computed, onMounted, ref, watch } from 'vue'

const props = defineProps({ clients: { type: Array, required: true } })
const emit = defineEmits(['back', 'toast'])
const bridge = window.ccSwitch
const data = ref({ skills: [], storage: 'plugin', syncMode: 'symlink', storePath: '' })
const tab = ref('installed')
const loading = ref(true)
const busy = ref('')
const query = ref('')
const discovered = ref([])
const discoverErrors = ref([])
const backups = ref([])
const repos = ref([])
const unmanaged = ref([])
const updates = ref(new Map())
const repoModal = ref(false)
const repoUrl = ref('')
const repoBranch = ref('main')
const installClient = ref('claude')

const enabledCount = computed(() => data.value.skills.reduce((count, skill) =>
  count + Object.values(skill.apps || {}).filter(Boolean).length, 0))
const filteredInstalled = computed(() => {
  const needle = query.value.trim().toLowerCase()
  return needle ? data.value.skills.filter((item) => `${item.name} ${item.description} ${item.directory}`.toLowerCase().includes(needle)) : data.value.skills
})
const filteredDiscovered = computed(() => {
  const needle = query.value.trim().toLowerCase()
  return needle ? discovered.value.filter((item) => `${item.name} ${item.description} ${item.repoOwner}/${item.repoName}`.toLowerCase().includes(needle)) : discovered.value
})

function toast(message, type = 'success') { emit('toast', message, type) }
function formatTime(value) { return value ? new Date(value).toLocaleString() : '未知时间' }

async function loadInstalled() {
  data.value = await bridge.listSkills()
  unmanaged.value = await bridge.scanUnmanagedSkills()
}

async function load() {
  loading.value = true
  try {
    await loadInstalled()
    repos.value = await bridge.listSkillRepos()
    if (tab.value === 'backups') backups.value = await bridge.listSkillBackups()
  } catch (error) { toast(error.message, 'error') }
  finally { loading.value = false }
}

async function changeTab(next) {
  tab.value = next
  bridge.setSkillUiPreferences({ tab: next })
  if (next === 'backups') {
    loading.value = true
    try { backups.value = await bridge.listSkillBackups() } catch (error) { toast(error.message, 'error') }
    finally { loading.value = false }
  }
  if (next === 'discover' && !discovered.value.length) await discoverRepos()
}

async function importSkill() {
  try {
    const source = await bridge.selectSkillDirectory()
    if (!source) return
    busy.value = 'import'
    const result = await bridge.importSkill(source)
    toast(`Skill「${result.name}」已导入`)
    await loadInstalled()
  } catch (error) { toast(error.message, 'error') }
  finally { busy.value = '' }
}

async function importZip() {
  busy.value = 'zip'
  try {
    const installed = await bridge.installSkillsFromZip(installClient.value)
    if (installed === null) return
    if (!installed.length) toast('ZIP 中的 Skills 均已存在，未重复安装', 'warning')
    else toast(`已从 ZIP 安装 ${installed.length} 个 Skill，并同步到 ${props.clients.find((item) => item.id === installClient.value)?.name || installClient.value}`)
    await loadInstalled()
  } catch (error) { toast(error.message, 'error') }
  finally { busy.value = '' }
}

async function toggle(skill, client, enabled) {
  const key = `${skill.directory}:${client.id}`
  busy.value = key
  try {
    await bridge.setSkillEnabled(skill.directory, client.id, enabled)
    skill.apps = { ...skill.apps, [client.id]: enabled }
    toast(`${skill.name} 已${enabled ? '同步到' : '从'} ${client.name}${enabled ? '' : '移除'}`)
  } catch (error) { toast(error.message, 'error') }
  finally { busy.value = '' }
}

async function updateSettings(patch) {
  try {
    busy.value = 'settings'
    data.value = await bridge.updateSkillSettings(patch)
    toast('Skills 存储与同步设置已更新')
  } catch (error) { toast(error.message, 'error') }
  finally { busy.value = '' }
}

async function remove(skill) {
  if (!window.confirm(`移除 Skill「${skill.name}」？系统会先创建可恢复备份。`)) return
  try {
    busy.value = `remove:${skill.directory}`
    await bridge.removeSkill(skill.directory)
    toast(`${skill.name} 已移除并保留备份`)
    await loadInstalled()
  } catch (error) { toast(error.message, 'error') }
  finally { busy.value = '' }
}

async function discoverRepos() {
  busy.value = 'discover'
  try {
    const result = await bridge.discoverSkills()
    discovered.value = result.skills
    discoverErrors.value = result.errors || []
    if (result.errors?.length) toast(`已完成发现，${result.errors.length} 个仓库连接失败`, 'warning')
    else toast(`发现 ${result.skills.length} 个可用 Skill`)
  } catch (error) { toast(error.message, 'error') }
  finally { busy.value = '' }
}

async function searchPublic() {
  if (!query.value.trim()) return discoverRepos()
  busy.value = 'discover'
  try {
    const result = await bridge.searchSkillsSh(query.value, 50, 0)
    const installed = new Set(data.value.skills.map((item) => item.directory.toLowerCase()))
    discovered.value = result.skills.map((item) => ({ ...item, installed: installed.has(item.installDirectory.toLowerCase()) }))
    discoverErrors.value = []
    toast(`skills.sh 返回 ${result.totalCount} 条结果`)
  } catch (error) { toast(error.message, 'error') }
  finally { busy.value = '' }
}

async function install(skill) {
  busy.value = `install:${skill.key}`
  try {
    const result = await bridge.installDiscoveredSkill(skill, installClient.value)
    skill.installed = true
    toast(`${result.name} 已安装并同步到 ${props.clients.find((item) => item.id === installClient.value)?.name || installClient.value}`)
    await loadInstalled()
  } catch (error) { toast(error.message, 'error') }
  finally { busy.value = '' }
}

async function checkUpdates() {
  busy.value = 'updates'
  try {
    const list = await bridge.checkSkillUpdates()
    updates.value = new Map(list.map((item) => [item.directory, item]))
    toast(list.length ? `发现 ${list.length} 个 Skill 更新` : '所有远程 Skill 均为最新')
  } catch (error) { toast(error.message, 'error') }
  finally { busy.value = '' }
}

async function update(skill) {
  busy.value = `update:${skill.directory}`
  try {
    await bridge.updateSkill(skill.directory)
    updates.value.delete(skill.directory)
    updates.value = new Map(updates.value)
    await loadInstalled()
    toast(`${skill.name} 已更新，旧版本已备份`)
  } catch (error) { toast(error.message, 'error') }
  finally { busy.value = '' }
}

function parseRepo(value) {
  const cleaned = String(value || '').trim().replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/$/, '')
  const parts = cleaned.split('/')
  return parts.length === 2 && parts.every(Boolean) ? { owner: parts[0], name: parts[1] } : null
}

async function addRepo() {
  const parsed = parseRepo(repoUrl.value)
  if (!parsed) return toast('请输入 GitHub 仓库 URL 或 owner/repo', 'error')
  busy.value = 'repo-add'
  try {
    repos.value = await bridge.addSkillRepo({ ...parsed, branch: repoBranch.value || 'main', enabled: true })
    repoUrl.value = ''; repoBranch.value = 'main'
    toast('Skill 仓库已保存')
  } catch (error) { toast(error.message, 'error') }
  finally { busy.value = '' }
}

async function removeRepo(repo) {
  if (!window.confirm(`移除仓库 ${repo.owner}/${repo.name}？已安装 Skill 不受影响。`)) return
  try { repos.value = await bridge.removeSkillRepo(repo.owner, repo.name); toast('仓库已移除') }
  catch (error) { toast(error.message, 'error') }
}

async function restoreBackup(item) {
  busy.value = `restore:${item.backupId}`
  try {
    const result = await bridge.restoreSkillBackup(item.backupId, installClient.value)
    toast(`${result.name} 已恢复`)
    await Promise.all([loadInstalled(), bridge.listSkillBackups().then((items) => { backups.value = items })])
  } catch (error) { toast(error.message, 'error') }
  finally { busy.value = '' }
}

async function deleteBackup(item) {
  if (!window.confirm(`永久删除 ${item.skill?.directory || '此 Skill'} 的备份？`)) return
  try { await bridge.deleteSkillBackup(item.backupId); backups.value = await bridge.listSkillBackups(); toast('备份已删除') }
  catch (error) { toast(error.message, 'error') }
}

async function importUnmanaged() {
  if (!unmanaged.value.length || !window.confirm(`将扫描到的 ${unmanaged.value.length} 个 Skill 纳入统一管理？`)) return
  busy.value = 'unmanaged'
  try {
    const result = await bridge.importUnmanagedSkills(unmanaged.value.map((item) => ({ directory: item.directory, apps: item.apps })))
    toast(`已纳管 ${result.length} 个 Skill`)
    await loadInstalled()
  } catch (error) { toast(error.message, 'error') }
  finally { busy.value = '' }
}

watch(query, (value) => bridge.setSkillUiPreferences({ query: value }))

onMounted(async () => {
  try {
    const preferences = await bridge.getSkillUiPreferences()
    if (['installed', 'discover', 'backups'].includes(preferences.tab)) tab.value = preferences.tab
    query.value = preferences.query || ''
  } catch {}
  await load()
  if (tab.value === 'discover') await discoverRepos()
})
</script>

<template>
  <section class="settings-view extension-view skills-command-center">
    <header class="settings-heading">
      <button class="back-button" @click="$emit('back')">←</button>
      <div>
        <span class="eyebrow">EXTENSIONS / SKILLS</span>
        <h1>Skills 控制台</h1>
        <p>一个事实源，跨八个 AI 客户端同步、发现、更新与恢复。</p>
      </div>
      <div class="skills-heading-actions"><button class="secondary-button" @click="repoModal = true">仓库管理</button><button class="secondary-button" :disabled="busy === 'zip'" @click="importZip">从 ZIP 安装</button><button class="primary-button" :disabled="busy === 'import'" @click="importSkill">导入本地</button></div>
    </header>

    <div class="skills-metrics">
      <article><span>INSTALLED</span><strong>{{ data.skills.length }}</strong><small>统一管理</small></article>
      <article><span>APP LINKS</span><strong>{{ enabledCount }}</strong><small>同步端点</small></article>
      <article><span>REPOSITORIES</span><strong>{{ repos.length }}</strong><small>发现来源</small></article>
      <article :class="{ alert: updates.size }"><span>UPDATES</span><strong>{{ updates.size }}</strong><small>待处理</small></article>
    </div>

    <div class="skills-control-strip">
      <div class="segmented-tabs skills-tabs">
        <button :class="{ active: tab === 'installed' }" @click="changeTab('installed')">已安装 <span>{{ data.skills.length }}</span></button>
        <button :class="{ active: tab === 'discover' }" @click="changeTab('discover')">发现</button>
        <button :class="{ active: tab === 'backups' }" @click="changeTab('backups')">备份 <span>{{ backups.length }}</span></button>
      </div>
      <form class="skills-search" @submit.prevent="tab === 'discover' ? searchPublic() : null">
        <span>⌕</span><input v-model="query" :placeholder="tab === 'discover' ? '搜索本页；回车搜索 skills.sh' : '筛选 Skill'" />
      </form>
      <select v-model="installClient" title="安装或恢复后默认启用的客户端">
        <option v-for="client in clients" :key="client.id" :value="client.id">目标 · {{ client.name }}</option>
      </select>
      <button v-if="tab === 'installed'" class="secondary-button" :disabled="busy === 'updates'" @click="checkUpdates">{{ busy === 'updates' ? '检查中…' : '检查更新' }}</button>
      <button v-else-if="tab === 'discover'" class="secondary-button" :disabled="busy === 'discover'" @click="discoverRepos">{{ busy === 'discover' ? '扫描中…' : '刷新仓库' }}</button>
    </div>

    <div v-if="tab === 'installed'" class="management-toolbar skills-storage-bar">
      <div><span>单一事实源</span><code>{{ data.storePath }}</code></div>
      <label>位置<select :value="data.storage" @change="updateSettings({ storage: $event.target.value })"><option value="plugin">插件数据目录</option><option value="agents">~/.agents/skills</option></select></label>
      <label>同步<select :value="data.syncMode" @change="updateSettings({ syncMode: $event.target.value })"><option value="symlink">软链接</option><option value="copy">复制</option></select></label>
    </div>

    <div v-if="tab === 'installed' && unmanaged.length" class="unmanaged-banner">
      <i>!</i><div><strong>发现 {{ unmanaged.length }} 个未纳管 Skill</strong><small>它们存在于客户端目录，可安全导入统一事实源并保留原启用关系。</small></div>
      <button class="secondary-button" :disabled="busy === 'unmanaged'" @click="importUnmanaged">{{ busy === 'unmanaged' ? '纳管中…' : '全部纳管' }}</button>
    </div>

    <div v-if="loading" class="loading-grid"><div v-for="n in 3" :key="n" class="skeleton-card" /></div>

    <template v-else-if="tab === 'installed'">
      <div v-if="filteredInstalled.length" class="skill-list">
        <article v-for="skill in filteredInstalled" :key="skill.id" class="settings-card skill-card signal-card">
          <div class="skill-copy">
            <div class="skill-origin"><span class="card-label">{{ skill.directory }}</span><em v-if="skill.repoOwner">{{ skill.repoOwner }}/{{ skill.repoName }}</em><em v-else>LOCAL</em></div>
            <h2>{{ skill.name }}</h2><p>{{ skill.description || '无描述' }}</p>
          </div>
          <div class="skill-apps">
            <button v-for="client in clients" :key="client.id" :class="{ enabled: skill.apps?.[client.id] }" :style="{ '--client-accent': client.accent }"
              :disabled="busy === `${skill.directory}:${client.id}`" @click="toggle(skill, client, !skill.apps?.[client.id])"><i />{{ client.name }}</button>
          </div>
          <div class="skill-actions">
            <button v-if="updates.has(skill.directory)" class="update-signal" :disabled="busy === `update:${skill.directory}`" @click="update(skill)">↑ 更新</button>
            <button v-if="skill.readmeUrl" class="icon-button" title="查看源文档" @click="bridge.openExternal(skill.readmeUrl)">↗</button>
            <button class="icon-button danger" title="移除" :disabled="busy === `remove:${skill.directory}`" @click="remove(skill)">×</button>
          </div>
        </article>
      </div>
      <div v-else class="empty-state"><div class="empty-orbit"><span /></div><h2>{{ query ? '没有匹配的 Skill' : '还没有 Skill' }}</h2><p>导入本地目录，或前往“发现”从仓库安装。</p></div>
    </template>

    <template v-else-if="tab === 'discover'">
      <div v-if="discoverErrors.length" class="discover-warning"><strong>部分仓库不可用</strong><span v-for="item in discoverErrors" :key="item">{{ item }}</span></div>
      <div v-if="filteredDiscovered.length" class="discover-grid">
        <article v-for="skill in filteredDiscovered" :key="skill.key" class="settings-card discover-card">
          <div class="discover-card-head"><span>{{ skill.repoOwner }}/{{ skill.repoName }}</span><em v-if="skill.installs">{{ skill.installs.toLocaleString() }} installs</em></div>
          <h2>{{ skill.name }}</h2><p>{{ skill.description || `来自 ${skill.directory}` }}</p>
          <footer><code>{{ skill.installDirectory }}</code><button v-if="skill.installed" class="secondary-button" disabled>已安装</button><button v-else class="primary-button" :disabled="busy === `install:${skill.key}`" @click="install(skill)">{{ busy === `install:${skill.key}` ? '安装中…' : '安装' }}</button></footer>
        </article>
      </div>
      <div v-else class="empty-state"><div class="empty-orbit"><span /></div><h2>没有发现 Skill</h2><p>检查仓库连接，或输入关键词后回车搜索 skills.sh。</p></div>
    </template>

    <template v-else>
      <div v-if="backups.length" class="backup-list">
        <article v-for="item in backups" :key="item.backupId" class="settings-card backup-row">
          <div class="backup-mark">B</div><div><span class="card-label">{{ item.reason }}</span><h2>{{ item.skill?.name || item.skill?.directory }}</h2><p>{{ formatTime(item.createdAt) }} · {{ item.skill?.repoOwner ? `${item.skill.repoOwner}/${item.skill.repoName}` : '本地来源' }}</p></div>
          <code>{{ item.backupId }}</code><button class="secondary-button" :disabled="busy === `restore:${item.backupId}`" @click="restoreBackup(item)">恢复</button><button class="icon-button danger" @click="deleteBackup(item)">×</button>
        </article>
      </div>
      <div v-else class="empty-state"><div class="empty-orbit"><span /></div><h2>暂无 Skill 备份</h2><p>移除、更新或覆盖 Skill 前会自动生成备份，最多保留 20 个。</p></div>
    </template>

    <div v-if="repoModal" class="modal-backdrop" @click.self="repoModal = false">
      <section class="provider-modal skill-repo-modal">
        <header class="modal-header"><div><span class="eyebrow">SKILL SOURCES</span><h2>仓库管理</h2><p>配置用于发现 Skills 的 GitHub 仓库与分支。</p></div><button class="icon-button" @click="repoModal = false">×</button></header>
        <div class="repo-modal-body">
          <form class="repo-add-form" @submit.prevent="addRepo"><label>GitHub 仓库<input v-model="repoUrl" placeholder="owner/repo 或 https://github.com/owner/repo" /></label><label>分支<input v-model="repoBranch" placeholder="main" /></label><button class="primary-button" :disabled="busy === 'repo-add'">添加仓库</button></form>
          <div class="repo-list">
            <article v-for="repo in repos" :key="`${repo.owner}/${repo.name}`"><div class="repo-signal"><i /></div><div><strong>{{ repo.owner }}/{{ repo.name }}</strong><small>{{ repo.branch }} · {{ discovered.filter((item) => item.repoOwner === repo.owner && item.repoName === repo.name).length }} skills</small></div><button class="icon-button" @click="bridge.openExternal(`https://github.com/${repo.owner}/${repo.name}`)">↗</button><button class="icon-button danger" @click="removeRepo(repo)">×</button></article>
          </div>
        </div>
      </section>
    </div>
  </section>
</template>
