<script lang="ts">
import { defineAsyncComponent } from 'vue'
import type { HighlighterCore } from 'shiki'

const AsyncCodemirror = defineAsyncComponent(() =>
  import('vue-codemirror').then(m => m.Codemirror)
)

let shikiPromise: Promise<HighlighterCore> | null = null
async function getShiki() {
  if (!shikiPromise) {
    const { createHighlighterCore } = await import('shiki/core')
    const { createJavaScriptRegexEngine } = await import('@shikijs/engine-javascript')
    shikiPromise = createHighlighterCore({
      themes: [
        import('@shikijs/themes/github-dark'),
        import('@shikijs/themes/github-light'),
      ],
      langs: [
        import('@shikijs/langs/javascript'),
        import('@shikijs/langs/typescript'),
        import('@shikijs/langs/python'),
        import('@shikijs/langs/java'),
        import('@shikijs/langs/cpp'),
        import('@shikijs/langs/html'),
        import('@shikijs/langs/css'),
        import('@shikijs/langs/go'),
        import('@shikijs/langs/rust'),
        import('@shikijs/langs/sql'),
        import('@shikijs/langs/json'),
        import('@shikijs/langs/markdown'),
      ],
      engine: createJavaScriptRegexEngine(),
    })
  }
  return shikiPromise
}

if (import.meta.hot) {
  import.meta.hot.dispose(async () => {
    const h = await shikiPromise
    h?.dispose()
    shikiPromise = null
  })
}

const langLoaders: Record<string, () => Promise<{ [key: string]: any }>> = {
  javascript: () => import('@codemirror/lang-javascript'),
  typescript: () => import('@codemirror/lang-javascript'),
  python: () => import('@codemirror/lang-python'),
  java: () => import('@codemirror/lang-java'),
  cpp: () => import('@codemirror/lang-cpp'),
  html: () => import('@codemirror/lang-html'),
  css: () => import('@codemirror/lang-css'),
  go: () => import('@codemirror/lang-go'),
  rust: () => import('@codemirror/lang-rust'),
  sql: () => import('@codemirror/lang-sql'),
  json: () => import('@codemirror/lang-json'),
  markdown: () => import('@codemirror/lang-markdown'),
}

const langExportMap: Record<string, string> = {
  javascript: 'javascript',
  typescript: 'typescript',
  python: 'python',
  java: 'java',
  cpp: 'cpp',
  html: 'html',
  css: 'css',
  go: 'go',
  rust: 'rust',
  sql: 'sql',
  json: 'json',
  markdown: 'markdown',
}

const shikiLangMap: Record<string, string> = {
  javascript: 'javascript',
  typescript: 'typescript',
  python: 'python',
  java: 'java',
  cpp: 'cpp',
  html: 'html',
  css: 'css',
  go: 'go',
  rust: 'rust',
  sql: 'sql',
  json: 'json',
  markdown: 'markdown',
  plaintext: 'text',
}

interface Template {
  _id: string
  _rev?: string
  name: string
  description: string
  language: string
  tags: string[]
  code: string
  usageCount: number
  createdAt: string
  updatedAt: string
}

const languageOptions = [
  { value: 'javascript', label: 'JavaScript' },
  { value: 'typescript', label: 'TypeScript' },
  { value: 'python', label: 'Python' },
  { value: 'java', label: 'Java' },
  { value: 'cpp', label: 'C/C++' },
  { value: 'html', label: 'HTML' },
  { value: 'css', label: 'CSS' },
  { value: 'go', label: 'Go' },
  { value: 'rust', label: 'Rust' },
  { value: 'sql', label: 'SQL' },
  { value: 'json', label: 'JSON' },
  { value: 'markdown', label: 'Markdown' },
  { value: 'plaintext', label: '纯文本' }
]

const LOCAL_KEY = 'code_snippets_templates'
</script>

<script setup lang="ts">
import { ref, computed, onMounted, toRaw, onUnmounted, shallowRef, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { CopyDocument, Delete, Edit } from '@element-plus/icons-vue'
import type { Extension } from '@codemirror/state'

const templates = ref<Template[]>([])
const selected = ref<Template | null>(null)
const searchKeyword = ref('')
const isNew = ref(false)

// 'empty' | 'detail' | 'edit'
const viewMode = ref<'empty' | 'detail' | 'edit'>('empty')

const form = ref({
  name: '',
  description: '',
  language: 'plaintext',
  tags: [] as string[],
  code: ''
})

const isDark = ref(window.matchMedia('(prefers-color-scheme: dark)').matches)
const darkMedia = window.matchMedia('(prefers-color-scheme: dark)')
const onDarkChange = (e: MediaQueryListEvent) => { isDark.value = e.matches }

onMounted(() => {
  darkMedia.addEventListener('change', onDarkChange)
})
onUnmounted(() => darkMedia.removeEventListener('change', onDarkChange))

async function loadExtensions(lang: string): Promise<Extension[]> {
  const { oneDark } = await import('@codemirror/theme-one-dark')
  const exts: Extension[] = []
  const loader = langLoaders[lang]
  if (loader) {
    const mod = await loader()
    const exportName = langExportMap[lang]
    const extFn = mod[exportName]
    if (extFn) exts.push(extFn())
  }
  if (isDark.value) exts.push(oneDark)
  return exts
}

const cmExtensions = shallowRef<Extension[]>([])
watch([() => form.value.language, isDark] as const, async ([lang]) => {
  cmExtensions.value = await loadExtensions(lang)
}, { immediate: true })

const highlightedCode = ref('')

async function highlightDetailCode() {
  const sel = selected.value
  if (!sel || !sel.code) {
    highlightedCode.value = ''
    return
  }
  const highlighter = await getShiki()
  const lang = shikiLangMap[sel.language] || 'text'
  const theme = isDark.value ? 'github-dark' : 'github-light'
  highlightedCode.value = highlighter.codeToHtml(sel.code, { lang, theme })
}

watch([() => selected.value?.code, () => selected.value?.language, isDark], highlightDetailCode, { immediate: true })

const filteredTemplates = computed(() => {
  const keyword = searchKeyword.value.toLowerCase().trim()
  if (!keyword) return templates.value
  return templates.value.filter((t) => {
    return (
      t.name.toLowerCase().includes(keyword) ||
      (t.description || '').toLowerCase().includes(keyword) ||
      t.language.toLowerCase().includes(keyword) ||
      t.tags.some((tag) => tag.toLowerCase().includes(keyword)) ||
      t.code.toLowerCase().includes(keyword)
    )
  })
})

const localLoad = (): Template[] => {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]')
  } catch { return [] }
}
const localSave = (list: Template[]) => {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(list))
}

const loadTemplates = () => {
  if (window.ztools?.db) {
    const docs = window.ztools.db.allDocs('tpl_')
    templates.value = (docs || [])
      .map((doc: any) => doc as Template)
      .sort((a, b) => b.usageCount - a.usageCount)
  } else {
    templates.value = localLoad().sort((a, b) => b.usageCount - a.usageCount)
  }
}

const selectTemplate = (tpl: Template) => {
  selected.value = tpl
  isNew.value = false
  viewMode.value = 'detail'
}

const handleEdit = () => {
  if (!selected.value) return
  form.value = {
    name: selected.value.name,
    description: selected.value.description || '',
    language: selected.value.language || 'plaintext',
    tags: [...selected.value.tags],
    code: selected.value.code
  }
  viewMode.value = 'edit'
}

const handleCancel = () => {
  if (selected.value) {
    viewMode.value = 'detail'
  } else {
    viewMode.value = 'empty'
    isNew.value = false
  }
}

const handleNew = () => {
  selected.value = null
  isNew.value = true
  viewMode.value = 'edit'
  form.value = { name: '', description: '', language: 'plaintext', tags: [], code: '' }
}

const handleSave = () => {
  if (!form.value.name.trim()) {
    ElMessage({ message: '请输入模板名称', type: 'warning', duration: 1000 })
    return
  }
  const now = new Date().toISOString()
  const tags = form.value.tags.filter(Boolean)

  if (isNew.value) {
    const doc: Template = {
      _id: 'tpl_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      name: form.value.name.trim(),
      description: form.value.description.trim(),
      language: form.value.language,
      tags,
      code: form.value.code,
      usageCount: 0,
      createdAt: now,
      updatedAt: now
    }
    if (window.ztools?.db) {
      const result = window.ztools.db.put(toRaw(doc))
      if (result) {
        loadTemplates()
        isNew.value = false
        selected.value = { ...doc, _rev: result.rev }
        viewMode.value = 'detail'
        ElMessage({ message: '模板已保存', type: 'success', duration: 1000 })
      }
    } else {
      const list = localLoad()
      list.push(doc)
      localSave(list)
      loadTemplates()
      isNew.value = false
      selected.value = doc
      viewMode.value = 'detail'
      ElMessage({ message: '模板已保存', type: 'success', duration: 1000 })
    }
  } else if (selected.value) {
    const doc: Template = {
      ...selected.value,
      name: form.value.name.trim(),
      description: form.value.description.trim(),
      language: form.value.language,
      tags,
      code: form.value.code,
      updatedAt: now
    }
    if (window.ztools?.db) {
      const result = window.ztools.db.put(toRaw(doc))
      if (result) {
        loadTemplates()
        selected.value = { ...doc, _rev: result.rev }
        viewMode.value = 'detail'
        ElMessage({ message: '模板已更新', type: 'success', duration: 1000 })
      }
    } else {
      const list = localLoad()
      const idx = list.findIndex((t) => t._id === doc._id)
      if (idx >= 0) list[idx] = doc
      localSave(list)
      loadTemplates()
      selected.value = doc
      viewMode.value = 'detail'
      ElMessage({ message: '模板已更新', type: 'success', duration: 1000 })
    }
  }
}

const doDelete = (tpl: Template) => {
  if (window.ztools?.db) {
    window.ztools.db.remove(tpl._id)
    if (selected.value?._id === tpl._id) {
      selected.value = null
      isNew.value = false
      viewMode.value = 'empty'
    }
    loadTemplates()
    ElMessage({ message: '模板已删除', type: 'success', duration: 1000 })
  } else {
    const list = localLoad().filter((t) => t._id !== tpl._id)
    localSave(list)
    if (selected.value?._id === tpl._id) {
      selected.value = null
      isNew.value = false
      viewMode.value = 'empty'
    }
    loadTemplates()
    ElMessage({ message: '模板已删除', type: 'success', duration: 1000 })
  }
}

const handleDelete = () => {
  if (!selected.value) return
  ElMessageBox.confirm('确定删除该模板？', '删除确认', {
    confirmButtonText: '删除',
    cancelButtonText: '取消',
    type: 'warning'
  }).then(() => {
    doDelete(selected.value!)
  }).catch(() => {})
}

const handleQuickDelete = (tpl: Template, event: Event) => {
  event.stopPropagation()
  ElMessageBox.confirm(`确定删除模板「${tpl.name}」？`, '删除确认', {
    confirmButtonText: '删除',
    cancelButtonText: '取消',
    type: 'warning'
  }).then(() => {
    doDelete(tpl)
  }).catch(() => {})
}

const handleCopy = (tpl: Template, event?: Event) => {
  event?.stopPropagation()
  if (window.ztools?.copyText) {
    window.ztools.copyText(tpl.code)
  } else {
    navigator.clipboard?.writeText(tpl.code)
  }
  const newCount = tpl.usageCount + 1
  const now = new Date().toISOString()
  const doc = { ...toRaw(tpl), usageCount: newCount, updatedAt: now }
  if (window.ztools?.db) {
    const result = window.ztools.db.put(doc)
    if (result) {
      tpl.usageCount = newCount
      tpl._rev = result.rev
      tpl.updatedAt = now
      if (selected.value?._id === tpl._id) {
        selected.value.usageCount = newCount
        selected.value._rev = result.rev
        selected.value.updatedAt = now
      }
      loadTemplates()
    }
  } else {
    const list = localLoad()
    const idx = list.findIndex((t) => t._id === doc._id)
    if (idx >= 0) list[idx] = doc
    localSave(list)
    tpl.usageCount = newCount
    tpl.updatedAt = now
    if (selected.value?._id === tpl._id) {
      selected.value.usageCount = newCount
      selected.value.updatedAt = now
    }
    loadTemplates()
  }
  ElMessage({ message: '已复制到剪贴板', type: 'success', duration: 1000 })
}

const handleExport = () => {
  const doExport = (data: any[]) => {
    const clean = data.map(({ _rev, ...rest }: any) => rest)
    const json = JSON.stringify(clean, null, 2)
    if (window.services?.exportToFile) {
      const ok = window.services.exportToFile(json)
      if (ok) ElMessage({ message: '导出成功', type: 'success', duration: 1000 })
    } else {
      const blob = new Blob([json], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'code-snippets.json'
      a.click()
      URL.revokeObjectURL(url)
      ElMessage({ message: '导出成功', type: 'success', duration: 1000 })
    }
  }
  if (window.ztools?.db) {
    doExport(window.ztools.db.allDocs('tpl_') || [])
  } else {
    doExport(localLoad())
  }
}

const handleImport = () => {
  const doImport = (json: string) => {
    try {
      const data = JSON.parse(json) as any[]
      if (!Array.isArray(data)) {
        ElMessage({ message: 'JSON 格式不正确', type: 'warning', duration: 1000 })
        return
      }
      const existingIds = new Set(templates.value.map((t) => t._id))
      const newDocs = data
        .filter((d) => d._id && !existingIds.has(d._id))
        .map((d) => ({
          ...d,
          description: d.description || '',
          usageCount: d.usageCount || 0,
          tags: d.tags || [],
          createdAt: d.createdAt || new Date().toISOString(),
          updatedAt: d.updatedAt || new Date().toISOString()
        }))
      if (newDocs.length === 0) {
        ElMessage({ message: '没有可导入的新模板', type: 'warning', duration: 1000 })
        return
      }
      if (window.ztools?.db) {
        window.ztools.db.bulkDocs(newDocs)
        loadTemplates()
        ElMessage({ message: `成功导入 ${newDocs.length} 个模板`, type: 'success', duration: 1000 })
      } else {
        const list = localLoad()
        list.push(...newDocs)
        localSave(list)
        loadTemplates()
        ElMessage({ message: `成功导入 ${newDocs.length} 个模板`, type: 'success', duration: 1000 })
      }
    } catch {
      ElMessage({ message: 'JSON 解析失败', type: 'error', duration: 1000 })
    }
  }

  if (window.services?.importFromFile) {
    const json = window.services.importFromFile()
    if (json) doImport(json)
  } else {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    input.onchange = () => {
      const file = input.files?.[0]
      if (!file) return
      const reader = new FileReader()
      reader.onload = () => doImport(reader.result as string)
      reader.readAsText(file)
    }
    input.click()
  }
}

const tagInputValue = ref('')

const handleTagInputConfirm = () => {
  const val = tagInputValue.value.trim()
  if (val && !form.value.tags.includes(val)) {
    form.value.tags.push(val)
  }
  tagInputValue.value = ''
}

const handleRemoveTag = (tag: string) => {
  form.value.tags = form.value.tags.filter((t) => t !== tag)
}

const handleDeleteAll = () => {
  ElMessageBox.confirm('确定删除所有模板？此操作不可撤销！', '删除全部确认', {
    confirmButtonText: '全部删除',
    cancelButtonText: '取消',
    type: 'warning'
  }).then(() => {
    if (window.ztools?.db) {
      const docs = window.ztools.db.allDocs('tpl_') || []
      docs.forEach((doc: any) => window.ztools.db.remove(doc._id))
    } else {
      localSave([])
    }
    selected.value = null
    isNew.value = false
    viewMode.value = 'empty'
    loadTemplates()
    ElMessage({ message: '已删除全部模板', type: 'success', duration: 1000 })
  }).catch(() => {})
}

onMounted(() => {
  loadTemplates()
  window.ztools?.setSubInput?.(({ text }: { text: string }) => {
    searchKeyword.value = text
  }, '搜索模板名称、语言、标签...')
})
</script>

<template>
  <div class="snippets">
    <!-- 左侧列表 -->
    <div class="sidebar">
      <div class="toolbar">
        <el-button type="primary" size="small" @click="handleNew">+ 新建</el-button>
        <el-button size="small" @click="handleImport">导入</el-button>
        <el-button size="small" @click="handleExport">导出</el-button>
        <el-button size="small" type="danger" circle :icon="Delete" @click="handleDeleteAll" />
      </div>
      <div class="sidebar-search">
        <el-input
          v-model="searchKeyword"
          size="small"
          placeholder="搜索模板名称、语言、标签..."
          clearable
        />
      </div>
      <div class="template-list">
        <div
          v-for="tpl in filteredTemplates"
          :key="tpl._id"
          class="template-item"
          :class="{ active: selected?._id === tpl._id }"
          @click="selectTemplate(tpl)"
        >
          <div class="template-info">
            <div class="template-title">
              <span class="template-name">{{ tpl.name }}</span>
              <span class="template-lang" v-if="tpl.language">- {{ tpl.language }}</span>
              <span class="usage-count" v-if="tpl.usageCount">已复制 {{ tpl.usageCount }}</span>
            </div>
            <div class="template-desc" v-if="tpl.description">{{ tpl.description }}</div>
            <div class="template-tags" v-if="tpl.tags.length">
              <el-tag v-for="tag in tpl.tags" :key="tag" size="small" type="primary" effect="plain" class="list-tag">{{ tag }}</el-tag>
            </div>
          </div>
          <div class="template-actions">
            <el-button
              :icon="CopyDocument"
              size="small"
              circle
              @click="handleCopy(tpl, $event)"
            />
            <el-button
              :icon="Delete"
              size="small"
              circle
              type="danger"
              @click="handleQuickDelete(tpl, $event)"
            />
          </div>
        </div>
        <el-empty
          v-if="filteredTemplates.length === 0"
          :description="searchKeyword ? '未找到匹配模板' : '暂无模板，点击新建添加'"
          :image-size="60"
        />
      </div>
    </div>

    <!-- 右侧区域 -->
    <div class="editor">

      <!-- 详情视图 -->
      <template v-if="viewMode === 'detail' && selected">
        <div class="detail-header">
          <div class="detail-title">
            <span class="detail-name">{{ selected.name }}</span>
            <el-tag v-if="selected.language" size="small" type="info" effect="plain">{{ selected.language }}</el-tag>
          </div>
          <div class="detail-desc" v-if="selected.description">{{ selected.description }}</div>
          <div class="detail-tags" v-if="selected.tags.length">
            <el-tag v-for="tag in selected.tags" :key="tag" size="small" type="primary" effect="plain">{{ tag }}</el-tag>
          </div>
          <div class="detail-actions">
            <el-button size="small" type="primary" :icon="CopyDocument" @click="handleCopy(selected)">复制代码</el-button>
            <el-button size="small" :icon="Edit" @click="handleEdit">编辑</el-button>
            <el-button size="small" type="danger" :icon="Delete" @click="handleDelete">删除</el-button>
            <span class="detail-usage" v-if="selected.usageCount">已复制 {{ selected.usageCount }} 次</span>
          </div>
        </div>
        <div class="detail-code">
          <div class="shiki-code" v-html="highlightedCode"></div>
        </div>
      </template>

      <!-- 编辑视图 -->
      <template v-if="viewMode === 'edit'">
        <el-form label-width="50px" size="small">
          <el-form-item label="名称">
            <el-input v-model="form.name" placeholder="如：C++ 主函数" />
          </el-form-item>
          <el-form-item label="描述">
            <el-input v-model="form.description" placeholder="简要描述模板用途" />
          </el-form-item>
          <el-form-item label="语言">
            <el-select v-model="form.language" placeholder="选择语言" style="width: 100%">
              <el-option
                v-for="opt in languageOptions"
                :key="opt.value"
                :label="opt.label"
                :value="opt.value"
              />
            </el-select>
          </el-form-item>
          <el-form-item label="标签">
            <div class="tag-input-wrapper">
              <el-tag
                v-for="tag in form.tags"
                :key="tag"
                closable
                size="small"
                effect="plain"
                type="warning"
                @close="handleRemoveTag(tag)"
              >{{ tag }}</el-tag>
              <el-input
                v-model="tagInputValue"
                size="small"
                class="tag-input"
                placeholder="输入标签后回车"
                @keyup.enter="handleTagInputConfirm"
                @blur="handleTagInputConfirm"
              />
            </div>
          </el-form-item>
          <el-form-item label="代码" class="code-form-item">
            <AsyncCodemirror
              v-model="form.code"
              :extensions="cmExtensions"
              :style="{ height: '360px', width: '100%' }"
              placeholder="在此输入代码模板..."
              :tab-size="4"
              autofocus
            />
          </el-form-item>
          <el-form-item>
            <el-button type="primary" size="small" @click="handleSave">保存</el-button>
            <el-button size="small" @click="handleCancel">取消</el-button>
          </el-form-item>
        </el-form>
      </template>

      <!-- 空状态 -->
      <el-empty v-if="viewMode === 'empty'" description="选择左侧模板进行查看，或点击新建创建模板" />
    </div>
  </div>
</template>

<style scoped>
.snippets {
  display: flex;
  height: 100vh;
  overflow: hidden;
}

.sidebar {
  width: 260px;
  min-width: 260px;
  border-right: 1px solid rgba(128, 128, 128, 0.2);
  display: flex;
  flex-direction: column;
}

.toolbar {
  display: flex;
  gap: 6px;
  padding: 12px;
  border-bottom: 1px solid rgba(128, 128, 128, 0.2);
}

.sidebar-search {
  padding: 8px 12px;
  border-bottom: 1px solid rgba(128, 128, 128, 0.2);
}

.template-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.template-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.15s;
  margin-bottom: 4px;
}

.template-item:hover {
  background: rgba(88, 164, 246, 0.1);
}

.template-item.active {
  background: rgba(88, 164, 246, 0.2);
}

.template-info {
  flex: 1;
  min-width: 0;
}

.template-title {
  display: flex;
  align-items: center;
  gap: 6px;
}

.template-name {
  font-size: 14px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.template-lang {
  font-size: 12px;
  opacity: 0.5;
  white-space: nowrap;
}

.usage-count {
  font-size: 11px;
  opacity: 0.45;
  white-space: nowrap;
  margin-left: auto;
}

.detail-usage {
  font-size: 12px;
  opacity: 0.5;
  margin-left: 8px;
}

.template-desc {
  font-size: 12px;
  opacity: 0.5;
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.template-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 4px;
}

.list-tag {
  --el-tag-font-size: 10px;
  height: 16px;
  padding: 0 4px;
}

.tag-input-wrapper {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  width: 100%;
}

.tag-input {
  width: 120px;
  flex-shrink: 0;
}

.template-actions {
  display: flex;
  gap: 4px;
  margin-left: 8px;
  opacity: 0;
  transition: opacity 0.15s;
}

.template-item:hover .template-actions {
  opacity: 1;
}

.editor {
  flex: 1;
  padding: 16px 20px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

/* 详情视图 */
.detail-header {
  margin-bottom: 12px;
}

.detail-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.detail-name {
  font-size: 18px;
  font-weight: 600;
}

.detail-desc {
  font-size: 13px;
  opacity: 0.6;
  margin-bottom: 8px;
}

.detail-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 12px;
}

.detail-actions {
  display: flex;
  gap: 8px;
}

.detail-code {
  flex: 1;
  min-height: 0;
  overflow: auto;
  border: 1px solid rgba(128, 128, 128, 0.3);
  border-radius: 4px;
}

.shiki-code {
  padding: 0;
  margin: 0;
}

.shiki-code :deep(pre) {
  margin: 0;
  padding: 12px;
  overflow-x: auto;
  font-size: 14px;
  font-family: Consolas, Monaco, 'Courier New', monospace;
  line-height: 1.5;
  background: transparent !important;
}

.code-form-item :deep(.el-form-item__content) {
  overflow: hidden;
}

:deep(.cm-editor) {
  border: 1px solid rgba(128, 128, 128, 0.3);
  border-radius: 4px;
  font-size: 14px;
}

:deep(.cm-focused) {
  border-color: var(--el-color-primary);
  outline: none;
}
</style>
