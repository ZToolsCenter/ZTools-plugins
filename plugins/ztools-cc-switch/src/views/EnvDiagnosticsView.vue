<script setup>
import { computed, onMounted, ref } from 'vue'

const emit = defineEmits(['back', 'toast'])
const bridge = window.ccSwitch
const apps = [{ id: 'claude', name: 'Claude Code' }, { id: 'codex', name: 'Codex' }, { id: 'gemini', name: 'Gemini CLI' }, { id: 'opencode', name: 'OpenCode' }, { id: 'openclaw', name: 'OpenClaw' }, { id: 'hermes', name: 'Hermes' }, { id: 'grokbuild', name: 'GrokBuild' }]
const selectedApp = ref('claude')
const conflicts = ref([])
const selected = ref([])
const backups = ref([])
const loading = ref(false)
const fixing = ref(false)
const fixableSelected = computed(() => conflicts.value.filter((item) => selected.value.includes(item.id) && item.fixable))

async function scan() {
  loading.value = true; selected.value = []
  try { conflicts.value = await bridge.scanEnvConflicts(selectedApp.value) }
  catch (error) { emit('toast', error.message, 'error') }
  finally { loading.value = false }
}
async function loadBackups() { try { backups.value = await bridge.listEnvBackups() } catch (error) { emit('toast', error.message, 'error') } }
function toggle(item) { if (!item.fixable) return; selected.value = selected.value.includes(item.id) ? selected.value.filter(id => id !== item.id) : [...selected.value, item.id] }
async function fixSelected() {
  if (!fixableSelected.value.length || !window.confirm(`移除 ${fixableSelected.value.length} 条 Shell 环境变量？插件会先保存完整备份。`)) return
  fixing.value = true
  try { const result = await bridge.fixEnvConflicts(selectedApp.value, fixableSelected.value.map(item => item.id)); emit('toast', `已修复 ${result.fixed} 条冲突，备份 ${result.backupId}`); await Promise.all([scan(), loadBackups()]) }
  catch (error) { emit('toast', error.message, 'error') }
  finally { fixing.value = false }
}
async function restore(backup) {
  if (!window.confirm(`恢复 ${new Date(backup.createdAt).toLocaleString()} 的环境配置备份？当前文件会另存 .bak。`)) return
  try { const result = await bridge.restoreEnvBackup(backup.id); emit('toast', `已恢复 ${result.restored} 个配置来源`); await scan() }
  catch (error) { emit('toast', error.message, 'error') }
}
onMounted(() => Promise.all([scan(), loadBackups()]))
</script>

<template>
  <section class="settings-view extension-view env-view">
    <header class="settings-heading"><button class="back-button" @click="$emit('back')">←</button><div><span class="eyebrow">ENVIRONMENT / CONFLICT GUARD</span><h1>环境诊断</h1><p>检查覆盖客户端 Provider 的环境变量，密钥只在 preload 内处理，界面始终脱敏。</p></div><button class="secondary-button heading-action" :disabled="loading" @click="scan">重新扫描</button></header>
    <div class="env-apps" role="tablist"><button v-for="app in apps" :key="app.id" :class="{ active: selectedApp === app.id }" @click="selectedApp = app.id; scan()"><i />{{ app.name }}</button></div>
    <section class="env-summary" :class="{ clear: !conflicts.length && !loading }"><span class="env-radar"><i /></span><div><strong>{{ loading ? '正在扫描…' : conflicts.length ? `发现 ${conflicts.length} 个潜在覆盖项` : '没有发现环境冲突' }}</strong><p>{{ conflicts.some(item => !item.fixable) ? '进程环境变量需要在系统或启动 ZTools 的终端中手动移除。' : '只会修改用户 Home 下已识别的 Shell 配置文件。' }}</p></div><button class="primary-button" :disabled="!fixableSelected.length || fixing" @click="fixSelected">{{ fixing ? '修复中…' : `安全修复 ${fixableSelected.length || ''}` }}</button></section>
    <div v-if="conflicts.length" class="env-conflicts">
      <article v-for="item in conflicts" :key="item.id" :class="{ selected: selected.includes(item.id), locked: !item.fixable }" @click="toggle(item)">
        <button class="session-check" :disabled="!item.fixable" :aria-label="item.fixable ? '选择冲突' : '不能自动修复'"><i /></button>
        <div><header><strong>{{ item.varName }}</strong><code>{{ item.maskedValue }}</code><span>{{ item.sourceType }}</span></header><p>{{ item.sourcePath }}<template v-if="item.lineNumber">:{{ item.lineNumber }}</template></p></div>
        <em>{{ item.fixable ? '可备份修复' : '手动处理' }}</em>
      </article>
    </div>
    <div v-else-if="!loading" class="empty-state compact-empty"><div class="empty-orbit"><span /></div><h2>环境干净</h2><p>{{ apps.find(item => item.id === selectedApp)?.name }} 会使用插件写入的 Provider 配置。</p></div>
    <section class="env-backups"><header><div><span class="card-label">RECOVERY POINTS</span><h2>环境备份</h2></div><strong>{{ backups.length }} snapshots</strong></header><div v-if="backups.length"><article v-for="backup in backups" :key="backup.id"><span>{{ apps.find(item => item.id === backup.app)?.name || backup.app }}</span><time>{{ new Date(backup.createdAt).toLocaleString() }}</time><small>{{ backup.itemCount }} 个来源</small><button class="text-button" @click="restore(backup)">恢复</button></article></div><p v-else>执行安全修复后，完整的原文件快照会保存在插件数据目录。</p></section>
  </section>
</template>
