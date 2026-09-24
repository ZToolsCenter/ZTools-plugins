<script setup>
import { computed, onMounted, ref } from 'vue'
const emit = defineEmits(['back', 'toast'])
const bridge = window.ccSwitch
const sessions = ref([])
const loading = ref(true)
const search = ref('')
const providerFilter = ref('')
const selected = ref([])
const detail = ref(null)
const messages = ref([])
const detailLoading = ref(false)
const busy = ref(false)
const mode = ref('sessions')
const trash = ref([])
const providerLabels = { claude: 'Claude Code', codex: 'Codex', gemini: 'Gemini CLI', opencode: 'OpenCode', openclaw: 'OpenClaw', hermes: 'Hermes', grokbuild: 'GrokBuild' }
const filtered = computed(() => sessions.value.filter((item) => {
  if (providerFilter.value && item.providerId !== providerFilter.value) return false
  const query = search.value.trim().toLowerCase(); if (!query) return true
  return [item.title, item.summary, item.projectDir, item.sessionId].some((value) => String(value || '').toLowerCase().includes(query))
}))
const groups = computed(() => {
  const map = new Map()
  for (const item of filtered.value) { const key = `${item.providerId}:${item.projectDir || 'unknown'}`; if (!map.has(key)) map.set(key, { key, providerId: item.providerId, projectDir: item.projectDir || '未知项目', items: [] }); map.get(key).items.push(item) }
  return [...map.values()]
})
const providers = computed(() => [...new Set(sessions.value.map((item) => item.providerId))])
function keyOf(item) { return `${item.providerId}:${item.sessionId}:${item.sourcePath}` }
function checked(item) { return selected.value.includes(keyOf(item)) }
function toggle(item) { const key = keyOf(item); selected.value = checked(item) ? selected.value.filter((value) => value !== key) : [...selected.value, key] }
function formatTime(value) { return value ? new Date(value).toLocaleString() : '未知时间' }
async function load() { loading.value = true; try { [sessions.value, trash.value] = await Promise.all([bridge.listSessions(), bridge.listSessionTrash ? bridge.listSessionTrash() : []]); selected.value = [] } catch (error) { emit('toast', error.message, 'error') } finally { loading.value = false } }
async function openDetail(item) { detail.value = item; messages.value = []; detailLoading.value = true; try { messages.value = await bridge.getSessionMessages(item.providerId, item.sourcePath) } catch (error) { emit('toast', error.message, 'error') } finally { detailLoading.value = false } }
async function resume(item) { try { const result = await bridge.launchSession(item.providerId, item.sessionId, item.sourcePath); emit('toast', `已在终端执行 ${result.command}`) } catch (error) { emit('toast', error.message, 'error') } }
async function removeItems(items) {
  if (!items.length || !window.confirm(`移除 ${items.length} 个会话？文件会先移动到插件回收站，SQLite 会先生成备份。`)) return
  busy.value = true
  try { const results = await bridge.deleteSessions(items.map((item) => ({ providerId: item.providerId, sessionId: item.sessionId, sourcePath: item.sourcePath }))); const failed = results.filter((item) => !item.success); emit('toast', failed.length ? `${results.length - failed.length} 个已移除，${failed.length} 个失败` : `${results.length} 个会话已移入回收站`, failed.length ? 'warning' : 'success'); detail.value = null; await load() } catch (error) { emit('toast', error.message, 'error') } finally { busy.value = false }
}
function removeSelected() { const keys = new Set(selected.value); return removeItems(sessions.value.filter((item) => keys.has(keyOf(item)))) }
async function restore(item) { busy.value = true; try { await bridge.restoreSessionTrash(item.trashId); emit('toast', `${item.title || item.sessionId} 已从回收站恢复`); await load() } catch (error) { emit('toast', error.message, 'error') } finally { busy.value = false } }
onMounted(load)
</script>

<template>
  <section class="settings-view extension-view sessions-view">
    <header class="settings-heading"><button class="back-button" @click="$emit('back')">←</button><div><span class="eyebrow">RESUME / TRANSCRIPT INDEX</span><h1>Sessions</h1><p>统一检索七个客户端的会话，预览消息并从原项目目录恢复。</p></div><button class="secondary-button heading-action" :disabled="loading" @click="load">重新扫描</button></header>
    <div class="segmented-tabs session-tabs"><button :class="{ active: mode === 'sessions' }" @click="mode = 'sessions'">会话索引 <span>{{ sessions.length }}</span></button><button :class="{ active: mode === 'trash' }" @click="mode = 'trash'">回收站 <span>{{ trash.length }}</span></button></div>
    <div v-if="mode === 'sessions'" class="session-toolbar">
      <input v-model="search" type="search" placeholder="搜索标题、摘要、项目或 Session ID" />
      <select v-model="providerFilter"><option value="">全部客户端</option><option v-for="provider in providers" :key="provider" :value="provider">{{ providerLabels[provider] || provider }}</option></select>
      <span>{{ filtered.length }} / {{ sessions.length }}</span>
      <button class="secondary-button" :disabled="!selected.length || busy" @click="removeSelected">移除所选 {{ selected.length || '' }}</button>
    </div>
    <div v-if="loading" class="loading-grid"><div v-for="i in 4" :key="i" class="skeleton-card" /></div>
    <div v-else-if="mode === 'trash' && trash.length" class="session-trash-list">
      <article v-for="item in trash" :key="item.trashId"><span class="session-provider" :data-provider="item.providerId">{{ (providerLabels[item.providerId] || item.providerId).slice(0,2).toUpperCase() }}</span><div><strong>{{ item.title || item.sessionId }}</strong><small>{{ providerLabels[item.providerId] || item.providerId }} · {{ item.storageType === 'sqlite' ? 'SQLite 行级快照' : '文件快照' }} · 删除于 {{ formatTime(item.deletedAt) }}</small></div><button class="secondary-button" :disabled="busy" @click="restore(item)">恢复</button></article>
    </div>
    <div v-else-if="mode === 'sessions' && groups.length" class="session-groups">
      <section v-for="group in groups" :key="group.key" class="session-group">
        <header><span class="session-provider" :data-provider="group.providerId">{{ (providerLabels[group.providerId] || group.providerId).slice(0,2).toUpperCase() }}</span><div><strong>{{ providerLabels[group.providerId] || group.providerId }}</strong><code>{{ group.projectDir }}</code></div><em>{{ group.items.length }} sessions</em></header>
        <article v-for="item in group.items" :key="keyOf(item)" class="session-row" :class="{ selected: checked(item) }">
          <button class="session-check" :aria-label="checked(item) ? '取消选择' : '选择会话'" @click="toggle(item)"><i /></button>
          <button class="session-copy" @click="openDetail(item)"><strong>{{ item.title || item.sessionId }}</strong><p>{{ item.summary || '暂无消息摘要' }}</p><small>{{ formatTime(item.lastActiveAt || item.createdAt) }} · {{ item.storageType === 'sqlite' ? 'SQLite' : 'File' }}</small></button>
          <div class="session-actions"><button v-if="item.resumeCommand" class="text-button" @click="resume(item)">终端恢复</button><button class="icon-button danger" title="移除会话" @click="removeItems([item])">×</button></div>
        </article>
      </section>
    </div>
    <div v-else class="empty-state"><div class="empty-orbit"><span /></div><h2>{{ mode === 'trash' ? 'Session 回收站为空' : '没有匹配的 Sessions' }}</h2><p>{{ mode === 'trash' ? '文件会话与 SQLite 行级快照会保存在这里。' : '完成一次 CLI 会话后重新扫描，或清除当前筛选条件。' }}</p></div>

    <div v-if="detail" class="modal-backdrop" @mousedown.self="detail = null">
      <section class="provider-modal session-modal" role="dialog" aria-modal="true" aria-labelledby="session-detail-title">
        <header class="modal-header"><div><span class="eyebrow">{{ providerLabels[detail.providerId] }} / {{ detail.sessionId }}</span><h2 id="session-detail-title">{{ detail.title || 'Session transcript' }}</h2></div><button class="modal-close" aria-label="关闭" @click="detail = null">×</button></header>
        <div class="session-detail-body">
          <div class="session-detail-meta"><span>{{ detail.projectDir || '未知项目目录' }}</span><time>{{ formatTime(detail.lastActiveAt) }}</time></div>
          <div v-if="detailLoading" class="log-empty">正在读取会话消息…</div>
          <div v-else-if="messages.length" class="message-stream"><article v-for="(message,index) in messages" :key="index" :class="message.role"><header><span>{{ message.role }}</span><time>{{ formatTime(message.ts) }}</time></header><pre>{{ message.content }}</pre></article></div>
          <div v-else class="log-empty">此会话没有可显示的文本消息</div>
        </div>
        <footer class="session-detail-actions"><button class="secondary-button" @click="removeItems([detail])">移除会话</button><button v-if="detail.resumeCommand" class="primary-button" @click="resume(detail)">在终端恢复</button></footer>
      </section>
    </div>
  </section>
</template>
