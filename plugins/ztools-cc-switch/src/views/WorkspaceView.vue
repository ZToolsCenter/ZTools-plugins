<script setup>
import { computed, onMounted, ref } from 'vue'

const emit = defineEmits(['back', 'toast'])
const bridge = window.ccSwitch
const files = ref([])
const memories = ref([])
const trash = ref([])
const loading = ref(true)
const mode = ref('files')
const search = ref('')
const searching = ref(false)
const editor = ref(null)
const content = ref('')
const editorLoading = ref(false)
const saving = ref(false)

const metadata = {
  'AGENTS.md': ['AG', '代理行为、职责与协作约束'], 'SOUL.md': ['SO', '人格、语气与核心价值'],
  'USER.md': ['US', '用户偏好与长期上下文'], 'IDENTITY.md': ['ID', 'Agent 名称与身份定义'],
  'TOOLS.md': ['TL', '工具使用说明与环境约定'], 'MEMORY.md': ['ME', '长期记忆与重要事实'],
  'HEARTBEAT.md': ['HB', '周期任务与主动检查'], 'BOOTSTRAP.md': ['BS', '首次启动引导'], 'BOOT.md': ['BT', '每次启动时加载的指令']
}
const today = computed(() => {
  const date = new Date(); const y = date.getFullYear(); const m = String(date.getMonth() + 1).padStart(2, '0'); const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}.md`
})
const contentBytes = computed(() => new TextEncoder().encode(content.value).byteLength)

function formatSize(bytes) { if (!bytes) return '0 B'; if (bytes < 1024) return `${bytes} B`; return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB` }
function formatTime(value) { return value ? new Date(value).toLocaleString() : '尚未写入' }

async function load() {
  loading.value = true
  try { [files.value, memories.value, trash.value] = await Promise.all([bridge.listWorkspaceFiles(), bridge.listDailyMemoryFiles(), bridge.listDailyMemoryTrash()]) }
  catch (error) { emit('toast', error.message, 'error') }
  finally { loading.value = false }
}

async function runSearch() {
  if (!search.value.trim()) { memories.value = await bridge.listDailyMemoryFiles(); return }
  searching.value = true
  try { memories.value = await bridge.searchDailyMemoryFiles(search.value) }
  catch (error) { emit('toast', error.message, 'error') }
  finally { searching.value = false }
}

async function openEditor(type, filename) {
  editor.value = { type, filename }; content.value = ''; editorLoading.value = true
  try { content.value = (type === 'workspace' ? await bridge.readWorkspaceFile(filename) : await bridge.readDailyMemoryFile(filename)) || '' }
  catch (error) { editor.value = null; emit('toast', error.message, 'error') }
  finally { editorLoading.value = false }
}

async function save() {
  saving.value = true
  try {
    if (editor.value.type === 'workspace') await bridge.writeWorkspaceFile(editor.value.filename, content.value)
    else await bridge.writeDailyMemoryFile(editor.value.filename, content.value)
    emit('toast', `${editor.value.filename} 已保存，并保留上一版本 .bak`)
    editor.value = null; await load()
  } catch (error) { emit('toast', error.message, 'error') }
  finally { saving.value = false }
}

async function removeMemory(item) {
  if (!window.confirm(`将 ${item.filename} 移入回收站？`)) return
  try { await bridge.deleteDailyMemoryFile(item.filename); emit('toast', `${item.filename} 已移入可恢复回收站`); await load() }
  catch (error) { emit('toast', error.message, 'error') }
}

async function restore(item) {
  try { await bridge.restoreDailyMemoryTrash(item.trashId); emit('toast', `${item.filename} 已恢复`); await load() }
  catch (error) { emit('toast', error.message, 'error') }
}

onMounted(load)
</script>

<template>
  <section class="settings-view extension-view workspace-view">
    <header class="settings-heading">
      <button class="back-button" @click="$emit('back')">←</button>
      <div><span class="eyebrow">OPENCLAW / CONTEXT WORKSPACE</span><h1>Workspace</h1><p>管理 OpenClaw 的身份文件、长期记忆与每日记忆，所有写入均原子备份。</p></div>
      <button class="secondary-button heading-action" @click="bridge.openWorkspaceDirectory(mode === 'memory' ? 'memory' : 'workspace')">打开目录</button>
    </header>

    <nav class="segmented-tabs workspace-tabs" aria-label="Workspace 分类">
      <button :class="{ active: mode === 'files' }" @click="mode = 'files'">核心文件 <span>{{ files.filter(item => item.exists).length }}/9</span></button>
      <button :class="{ active: mode === 'memory' }" @click="mode = 'memory'">Daily Memory <span>{{ memories.length }}</span></button>
      <button :class="{ active: mode === 'trash' }" @click="mode = 'trash'">回收站 <span>{{ trash.length }}</span></button>
    </nav>

    <div v-if="loading" class="loading-grid"><div v-for="i in 6" :key="i" class="skeleton-card" /></div>
    <div v-else-if="mode === 'files'" class="workspace-file-grid">
      <button v-for="file in files" :key="file.filename" class="workspace-file-card" :class="{ exists: file.exists, unsafe: file.unsafe }" @click="openEditor('workspace', file.filename)">
        <span class="workspace-sigil">{{ metadata[file.filename]?.[0] }}</span>
        <span class="workspace-file-copy"><strong>{{ file.filename }}</strong><small>{{ metadata[file.filename]?.[1] }}</small><time>{{ file.exists ? `${formatSize(file.sizeBytes)} · ${formatTime(file.modifiedAt)}` : '尚未创建' }}</time></span>
        <i :title="file.exists ? '已存在' : '尚未创建'" />
      </button>
    </div>

    <template v-else-if="mode === 'memory'">
      <div class="memory-toolbar">
        <form @submit.prevent="runSearch"><input v-model="search" type="search" placeholder="全文搜索日期和 Markdown 内容" /><button class="secondary-button" :disabled="searching">{{ searching ? '搜索中…' : '搜索' }}</button></form>
        <button class="primary-button" @click="openEditor('memory', today)">+ 创建今天</button>
      </div>
      <div v-if="memories.length" class="memory-list">
        <article v-for="item in memories" :key="item.filename" class="memory-row">
          <span class="memory-date"><strong>{{ item.date.slice(8,10) }}</strong><small>{{ item.date.slice(0,7) }}</small></span>
          <button class="memory-copy" @click="openEditor('memory', item.filename)"><strong>{{ item.filename }}</strong><p>{{ item.snippet || item.preview || '空白 Daily Memory' }}</p><small>{{ formatSize(item.sizeBytes) }} · {{ formatTime(item.modifiedAt) }}<template v-if="item.matchCount"> · {{ item.matchCount }} 处匹配</template></small></button>
          <button class="icon-button danger" title="移入回收站" @click="removeMemory(item)">×</button>
        </article>
      </div>
      <div v-else class="empty-state"><div class="empty-orbit"><span /></div><h2>没有 Daily Memory</h2><p>创建今天的记忆，或换一个搜索词。</p></div>
    </template>

    <div v-else-if="trash.length" class="memory-list trash-list">
      <article v-for="item in trash" :key="item.trashId" class="memory-row"><span class="workspace-sigil">↺</span><div class="memory-copy"><strong>{{ item.filename }}</strong><p>删除于 {{ formatTime(item.deletedAt) }}</p></div><button class="secondary-button" @click="restore(item)">恢复</button></article>
    </div>
    <div v-else-if="mode === 'trash'" class="empty-state"><div class="empty-orbit"><span /></div><h2>回收站为空</h2><p>删除的 Daily Memory 会安全保存在这里。</p></div>

    <div v-if="editor" class="modal-backdrop" @mousedown.self="editor = null">
      <section class="provider-modal workspace-editor-modal" role="dialog" aria-modal="true" aria-labelledby="workspace-editor-title">
        <header class="modal-header"><div><span class="eyebrow">{{ editor.type === 'workspace' ? 'CORE CONTEXT' : 'DAILY MEMORY' }}</span><h2 id="workspace-editor-title">{{ editor.filename }}</h2></div><button class="modal-close" aria-label="关闭" @click="editor = null">×</button></header>
        <div v-if="editorLoading" class="log-empty">正在加载 Markdown…</div>
        <textarea v-else v-model="content" spellcheck="false" :placeholder="`# ${editor.filename}\n\n在这里写入 Markdown…`" />
        <footer><span>{{ contentBytes.toLocaleString() }} / 2,097,152 bytes</span><button class="secondary-button" @click="editor = null">取消</button><button class="primary-button" :disabled="saving || editorLoading" @click="save">{{ saving ? '保存中…' : '保存文件' }}</button></footer>
      </section>
    </div>
  </section>
</template>
