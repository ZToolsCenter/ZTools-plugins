<script setup lang="ts">
import { ref, computed, inject, onMounted, watch } from 'vue'
import type { Skill } from '../types'
import { useSettings } from '../composables/useSettings'
import SkillFileEditor from './SkillFileEditor.vue'
import { translateContent, translateDescription, stripFrontmatter, renderImmersiveSegments } from '../utils/translate'
import type { TranslationMode } from '../utils/translate'
import { storage } from '../utils/storage'
import { getAvatarColor } from '../utils/color'
import { SKILL_CATEGORIES, ALL_CATEGORIES, inferCategory, CATEGORY_ICONS, type SkillCategory } from '../data/skill-categories'
import { getSourceInfo } from '../utils/source-info'

const props = defineProps<{
  skill: Skill
  skillName: string
  skillDesc: string
  skillContent: string
  isFavorited: boolean
  isEditing: boolean
  editedContent: string
  copyStatus: Record<string, boolean>
  context?: 'my' | 'store' | 'project' | 'agent'
  skillDir?: string
}>()

const emit = defineEmits<{
  navigate: [code: string, params?: any]
  'toggle-favorite': []
  'copy-content': [text: string, key: string]
  'toggle-edit': []
  'save-content': []
  'update:editedContent': [value: string]
}>()

const activeTab = defineModel<'preview' | 'source' | 'files'>('activeTab', { default: 'preview' })

const sourceInfo = computed(() => getSourceInfo(props.skill))

const debugFields = computed(() => {
  const s = props.skill as any
  return [
    { key: 'id', label: 'ID', value: s.id },
    { key: 'name', label: '名称', value: s.name },
    { key: 'description', label: '描述', value: s.description || '—' },
    { key: 'author', label: '作者', value: s.author || '—' },
    { key: 'tags', label: '标签', value: s.tags?.length ? s.tags.join(', ') : '—' },
    { key: 'format', label: '格式', value: s.format || '—' },
    { key: 'source', label: '来源', value: s.source || '—' },
    { key: 'sourceUrl', label: '来源URL', value: s.sourceUrl || '—' },
    { key: 'repo', label: '仓库', value: s.repo || '—' },
    { key: 'path', label: '路径', value: s.path || '—' },
    { key: 'homepage', label: '主页', value: s.homepage || '—' },
    { key: 'category', label: '分类', value: s.category || '—' },
    { key: 'installCount', label: '安装数', value: s.installCount ?? '—' },
    { key: 'iconUrl', label: '图标URL', value: s.iconUrl || '—' },
    { key: 'userTags', label: '用户标签', value: s.userTags?.length ? s.userTags.join(', ') : '—' },
    { key: 'storeSourceId', label: '商店来源ID', value: s.storeSourceId || '—' },
    { key: 'canonicalId', label: '规范ID', value: s.canonicalId || '—' },
    { key: 'readme', label: 'Readme', value: s.readme ? s.readme.slice(0, 200) + (s.readme.length > 200 ? '...' : '') : '—' },
    { key: 'skillDir', label: 'Skill目录', value: s.skillDir || '—' },
  ]
})

function getProtocolLabel(): string {
  const map: Record<string, string> = { opencode: 'OpenCode', claude: 'Claude Code', codex: 'Codex', cline: 'CLINE' }
  return map[props.skill.format] || '通用'
}

function renderMarkdown(md: string): string {
  if (!md) return ''
  return md
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/^---$/gm, '<hr/>')
    .replace(/^\- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`)
    .split('\n').filter(l => l.trim()).join('\n')
}



const confirmUninstall = ref<{ platformId: string; platformName: string } | null>(null)
function cancelUninstall() { confirmUninstall.value = null }

// === Theme ===
const { settings, updateSettings } = useSettings()
const isDarkMode = computed(() => {
  if (settings.themeMode === 'auto') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  }
  return settings.themeMode === 'dark'
})
function toggleTheme() {
  updateSettings({ themeMode: isDarkMode.value ? 'light' : 'dark' })
}

// === Translation ===
const showToast = inject<(msg: string, type?: 'success' | 'error' | 'info' | 'warning') => void>('showToast', () => {})

const isTranslating = ref(false)
const showTranslation = ref(false)
const translatedContent = ref('')
const translationMode = ref<TranslationMode>('immersive')

const isTranslatingDesc = ref(false)
const descTranslationDone = ref(false)
const showDescTranslation = ref(false)
const translatedDesc = ref('')

const translationModel = computed(() => {
  if (!settings.translationModelId) {
    return settings.aiModels.find((m) => m.isDefault && m.enabled) || null
  }
  const byProvider = settings.aiModels.find((m) => m.id === settings.translationModelId)
  if (byProvider) return byProvider
  for (const provider of settings.aiModels) {
    const matchedModel = provider.models?.find(
      (m) => m.id === settings.translationModelId && m.enabled,
    )
    if (matchedModel) {
      return { ...provider, model: matchedModel.id }
    }
  }
  return null
})

function loadTranslationCache() {
  const cached = storage.getTranslation(props.skill.id)
  if (cached) {
    translatedContent.value = cached.translatedContent
    translationMode.value = cached.mode as TranslationMode
    showTranslation.value = true
  } else {
    translatedContent.value = ''
    showTranslation.value = false
  }
  const cachedDesc = storage.getTranslationDesc(props.skill.id)
  if (cachedDesc) {
    translatedDesc.value = cachedDesc
    descTranslationDone.value = true
    showDescTranslation.value = true
  } else {
    translatedDesc.value = ''
    descTranslationDone.value = false
    showDescTranslation.value = false
  }
}

function saveTranslationCache() {
  if (translatedContent.value) {
    storage.saveTranslation(props.skill.id, {
      sourceContent: props.skillContent,
      translatedContent: translatedContent.value,
      mode: translationMode.value,
    })
  }
}

function saveDescTranslationCache() {
  if (translatedDesc.value) {
    storage.saveTranslationDesc(props.skill.id, translatedDesc.value)
  }
}

// === User Tags (Category) ===
const userTags = ref<string[]>([])
const editingTags = ref(false)
const selectedCategory = ref<SkillCategory>('other')

const currentCategory = computed(() => {
  const cat = (userTags.value[0] as SkillCategory) || inferCategory(props.skill.name, props.skill.description || '')
  return { id: cat, label: SKILL_CATEGORIES[cat].label, icon: CATEGORY_ICONS[cat] }
})

function loadUserTags() {
  userTags.value = storage.getSkillUserTags(props.skill.id)
}

function saveUserTags() {
  storage.saveSkillUserTags(props.skill.id, userTags.value)
}

function startEditTags() {
  editingTags.value = true
  selectedCategory.value = (userTags.value[0] as SkillCategory) || inferCategory(props.skill.name, props.skill.description || '')
}

function cancelEditTags() {
  editingTags.value = false
}

function saveCategoryTag() {
  userTags.value = [selectedCategory.value]
  saveUserTags()
  editingTags.value = false
}

onMounted(() => {
  loadTranslationCache()
  loadUserTags()
})

watch(() => props.skill.id, () => {
  loadTranslationCache()
  loadUserTags()
})

function getVisibleContent(): string {
  if (showTranslation.value && translatedContent.value) {
    if (translationMode.value === 'immersive') {
      return translatedContent.value
    }
    return translatedContent.value
  }
  return props.skillContent
}

async function handleTranslate() {
  if (!props.skillContent.trim()) return
  if (translatedContent.value) {
    showTranslation.value = !showTranslation.value
    return
  }
  if (!translationModel.value) {
    showToast('请先在设置中配置 AI 模型', 'error')
    return
  }
  isTranslating.value = true
  try {
    const result = await translateContent(
      props.skillContent,
      translationModel.value,
      translationMode.value,
    )
    translatedContent.value = result
    showTranslation.value = true
    saveTranslationCache()
    showToast('翻译完成', 'success')
  } catch (err: any) {
    const msg = err.message === 'AI_NOT_CONFIGURED' ? 'AI 模型未配置' :
                err.message === 'AI_AUTH_ERROR' ? 'API 认证失败，请检查 API Key' :
                err.message || '翻译失败'
    showToast(msg, 'error')
  }
  isTranslating.value = false
}

async function handleTranslateDesc() {
  const desc = props.skillDesc || props.skill.description
  if (!desc) return

  if (descTranslationDone.value) {
    showDescTranslation.value = !showDescTranslation.value
    return
  }

  if (!translationModel.value) {
    showToast('请先在设置中配置 AI 模型', 'error')
    return
  }

  isTranslatingDesc.value = true
  try {
    const result = await translateDescription(desc, translationModel.value)
    translatedDesc.value = result
    descTranslationDone.value = true
    showDescTranslation.value = true
    saveDescTranslationCache()
    showToast('描述翻译完成', 'success')
  } catch (err: any) {
    const msg = err.message === 'AI_NOT_CONFIGURED' ? 'AI 模型未配置' :
                err.message === 'AI_AUTH_ERROR' ? 'API 认证失败，请检查 API Key' :
                err.message || '描述翻译失败'
    showToast(msg, 'error')
  }
  isTranslatingDesc.value = false
}

async function handleReTranslateDesc() {
  const desc = props.skillDesc || props.skill.description
  if (!desc) return

  if (!translationModel.value) {
    showToast('请先在设置中配置 AI 模型', 'error')
    return
  }

  isTranslatingDesc.value = true
  try {
    const result = await translateDescription(desc, translationModel.value)
    translatedDesc.value = result
    descTranslationDone.value = true
    showDescTranslation.value = true
    saveDescTranslationCache()
    showToast('描述翻译完成', 'success')
  } catch (err: any) {
    const msg = err.message === 'AI_NOT_CONFIGURED' ? 'AI 模型未配置' :
                err.message === 'AI_AUTH_ERROR' ? 'API 认证失败，请检查 API Key' :
                err.message || '描述翻译失败'
    showToast(msg, 'error')
  }
  isTranslatingDesc.value = false
}
</script>

<template>
  <div class="skill-detail">
    <!-- Header -->
    <div class="page-header">
      <div class="header-left">
        <div class="header-title-row">
          <button class="back-btn" @click="emit('navigate', context === 'project' ? 'project-skills' : context === 'store' ? 'store' : context === 'agent' ? 'agent-skills' : 'my')">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
          </button>
          <div class="header-icon" :style="{ background: getAvatarColor(skill.name) }">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>
          </div>
          <div class="header-title-info">
            <h2>{{ skillName || skill.name }}</h2>
            <div class="header-tags">
              <span class="header-tag source-tag" :style="{ background: sourceInfo.bg, color: sourceInfo.color }">
                <svg v-if="sourceInfo.icon === 'multi'" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="10"/>
                  <line x1="2" y1="12" x2="22" y2="12"/>
                  <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
                </svg>
                <img v-else-if="sourceInfo.icon.startsWith('http') || sourceInfo.icon.startsWith('/src')" :src="sourceInfo.icon" width="12" height="12" alt="" style="border-radius: 2px;" />
                <span v-else-if="sourceInfo.icon.startsWith('<')" v-html="sourceInfo.icon" class="tag-icon-svg"></span>
                <svg v-else-if="sourceInfo.icon === 'git'" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="18" cy="18" r="3"/>
                  <circle cx="6" cy="6" r="3"/>
                  <path d="M13 6h3a2 2 0 0 1 2 2v7"/>
                  <line x1="6" y1="9" x2="6" y2="21"/>
                </svg>
                <svg v-else width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                </svg>
                {{ sourceInfo.label }}
              </span>
              <span class="header-tag category-tag">{{ currentCategory.icon }} {{ currentCategory.label }}</span>
            </div>
          </div>
        </div>
      </div>
      <div class="header-toolbar">
        <slot name="header-toolbar-start" />
        <slot name="header-actions">
          <button class="toolbar-icon-btn" :class="{ favorited: isFavorited }" :title="isFavorited ? '取消收藏' : '收藏'" @click="emit('toggle-favorite')">
            <svg width="16" height="16" viewBox="0 0 24 24" :fill="isFavorited ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
          </button>
          <button class="toolbar-icon-btn close-btn" title="关闭" @click="emit('navigate', context === 'project' ? 'project-skills' : context === 'store' ? 'store' : context === 'agent' ? 'agent-skills' : 'my')">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </slot>
        <button class="toolbar-icon-btn" @click="toggleTheme" :title="isDarkMode ? '切换亮色模式' : '切换暗色模式'">
          <svg v-if="isDarkMode" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
          </svg>
          <svg v-else width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>
          </svg>
          </button>
          <slot name="header-toolbar-end" />
        </div>
    </div>

    <!-- Tab bar -->
    <div class="detail-tabs-row">
      <button :class="{ active: activeTab === 'preview' }" @click="activeTab = 'preview'">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
        预览
        <div v-if="activeTab === 'preview'" class="tab-indicator"></div>
      </button>
      <button :class="{ active: activeTab === 'source' }" @click="activeTab = 'source'">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
        源码/内容
        <div v-if="activeTab === 'source'" class="tab-indicator"></div>
      </button>
      <button :class="{ active: activeTab === 'files' }" @click="activeTab = 'files'">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
        文件
        <div v-if="activeTab === 'files'" class="tab-indicator"></div>
      </button>
    </div>

    <!-- Scrollable content -->
    <div class="detail-scroll">
      <!-- ═══════════ Preview Tab ═══════════ -->
      <template v-if="activeTab === 'preview'">
        <div class="preview-layout">
          <!-- Left column: shared -->
          <div class="preview-main space-y-8">
            <!-- Description -->
            <section class="space-y-4">
              <h3 class="section-heading">SKILL 描述</h3>
              <div class="panel-card desc-panel">
                <p class="desc-text">{{ descTranslationDone && showDescTranslation ? translatedDesc : (skillDesc || skill.description || '暂无描述') }}</p>
                <div class="desc-footer">
                  <div class="desc-badges">
                    <span class="variant-badge source" :style="{ background: sourceInfo.bg, color: sourceInfo.color }">{{ sourceInfo.label }}</span>
                    <span v-if="skill.author" class="variant-badge author">{{ skill.author }}</span>
                    <span v-for="tag in (skill.tags || []).slice(0, 5)" :key="tag" class="variant-badge tag">{{ tag }}</span>
                  </div>
                  <div class="desc-actions">
                    <button v-if="descTranslationDone" class="heading-btn" @click="handleReTranslateDesc" :disabled="isTranslatingDesc">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/><path d="M21 3v9h-9"/></svg>
                      重新翻译
                    </button>
                    <button class="heading-btn" :class="{ active: descTranslationDone && showDescTranslation }" @click="handleTranslateDesc" :disabled="isTranslatingDesc">
                      <svg v-if="isTranslatingDesc" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                      <svg v-else width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/></svg>
                      {{ isTranslatingDesc ? '翻译中...' : descTranslationDone ? (showDescTranslation ? '显示原文' : '显示译文') : '翻译描述' }}
                    </button>
                  </div>
                </div>
              </div>
            </section>

            <!-- User Tags (only for 'my' context) -->
            <section v-if="context === 'my'" class="space-y-4">
              <h3 class="section-heading">分类</h3>
              <div class="panel-card tags-panel">
                <div v-if="!editingTags" class="tags-display">
                  <div class="tags-list">
                    <span v-if="currentCategory" class="user-tag category-selected">
                      {{ currentCategory.icon }} {{ currentCategory.label }}
                    </span>
                    <span v-else class="tags-empty">未分类</span>
                  </div>
                  <button class="heading-btn" @click="startEditTags">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    修改
                  </button>
                </div>
                <div v-else class="tags-editing">
                  <div class="category-grid">
                    <button
                      v-for="cat in ALL_CATEGORIES"
                      :key="cat"
                      class="category-option"
                      :class="{ active: selectedCategory === cat }"
                      @click="selectedCategory = cat"
                    >
                      <span class="category-icon">{{ CATEGORY_ICONS[cat] }}</span>
                      <span class="category-label">{{ SKILL_CATEGORIES[cat].label }}</span>
                    </button>
                  </div>
                  <div class="tag-input-row">
                    <button class="heading-btn primary" @click="saveCategoryTag">保存</button>
                    <button class="heading-btn" @click="cancelEditTags">取消</button>
                  </div>
                </div>
              </div>
            </section>

            <!-- Content / Instructions -->
            <section class="content-section">
              <div class="section-header-row">
                <h3 class="section-heading mb-0">
                  SKILL 内容
                  <span class="section-hint">预览</span>
                </h3>
                <div class="section-actions">
                  <button class="heading-btn" :class="{ active: showTranslation && translatedContent }" @click="handleTranslate" :disabled="isTranslating">
                    <svg v-if="isTranslating" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                    <svg v-else width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/></svg>
                    {{ isTranslating ? '翻译中...' : showTranslation && translatedContent ? '显示原文' : translatedContent ? '显示译文' : '翻译内容' }}
                  </button>
                  <button class="heading-btn" @click="emit('copy-content', isEditing ? editedContent : skillContent, 'instr')">
                    <svg v-if="copyStatus['instr']" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                    <svg v-else width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                    {{ copyStatus['instr'] ? '已复制' : '复制 MD' }}
                  </button>
                </div>
              </div>
              <div class="panel-card content-panel">
                <template v-if="isEditing">
                  <textarea :value="editedContent" @input="emit('update:editedContent', ($event.target as HTMLTextAreaElement).value)" class="content-editor" />
                  <div class="editor-toolbar">
                    <button class="editor-toolbar-btn" @click="emit('toggle-edit')">取消</button>
                    <button class="editor-toolbar-btn primary" @click="emit('save-content')">保存</button>
                  </div>
                </template>
                <template v-else>
                  <div v-if="getVisibleContent()" class="skill-markdown-body p-6">
                    <template v-if="showTranslation && translatedContent && translationMode === 'immersive'">
                      <div v-for="(seg, i) in renderImmersiveSegments(stripFrontmatter(translatedContent))" :key="i">
                        <div v-if="seg.type === 'translation'" class="translation-segment" v-html="renderMarkdown(seg.text)"></div>
                        <div v-else v-html="renderMarkdown(seg.text)"></div>
                      </div>
                    </template>
                    <template v-else>
                      <div v-html="renderMarkdown(getVisibleContent())"></div>
                    </template>
                  </div>
                  <div v-else class="empty-content">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
                    <p>暂无内容</p>
                  </div>
                </template>
              </div>
            </section>
          </div>

          <!-- Right column: context-specific (slot) -->
          <div v-if="$slots['context-panel']" class="preview-side space-y-6">
            <slot name="context-panel" />
          </div>
        </div>
      </template>

      <!-- ═══════════ Source Tab ═══════════ -->
      <template v-else-if="activeTab === 'source'">
        <div class="source-tab-content space-y-8 animate-fade-in">
          <!-- Metadata -->
          <section class="space-y-4">
            <h3 class="section-heading">元数据</h3>
            <div class="meta-grid">
              <div class="meta-item">
                <span class="meta-label">ID</span>
                <span class="meta-value mono">{{ skill.id }}</span>
              </div>
              <div class="meta-item">
                <span class="meta-label">协议</span>
                <span class="meta-value protocol">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                  {{ getProtocolLabel() }}
                </span>
              </div>
              <div class="meta-item">
                <span class="meta-label">作者</span>
                <span class="meta-value">{{ skill.author || '未知' }}</span>
              </div>
            </div>
          </section>

          <!-- Debug: All Skill Fields (My Skills context only) -->
          <section v-if="context === 'my'" class="space-y-4">
            <h3 class="section-heading">调试信息 - Skill 全部字段</h3>
            <div class="debug-fields-grid">
              <div v-for="field in debugFields" :key="field.key" class="debug-field-item">
                <span class="debug-field-label">{{ field.label }}</span>
                <span class="debug-field-value" :class="{ 'is-empty': field.value === '—' }">{{ field.value }}</span>
              </div>
            </div>
          </section>

          <!-- Source link -->
          <section v-if="skill.repo" class="space-y-4">
            <a class="source-link-card" :href="`https://github.com/${skill.repo}`" target="_blank" rel="noopener noreferrer">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/></svg>
              <div class="source-link-info">
                <span class="source-link-name">访问技能仓库</span>
                <span class="source-link-path">{{ skill.repo }}</span>
              </div>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
            </a>
          </section>
          <section v-else class="space-y-4">
            <div class="source-link-card local">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
              <div class="source-link-info">
                <span class="source-link-name">本地技能</span>
                <span class="source-link-path">{{ (skill as any).path || '未知路径' }}</span>
              </div>
            </div>
          </section>

          <!-- SKILL.md raw content -->
          <section class="space-y-4">
            <div class="section-header-row">
              <h3 class="section-heading mb-0">SKILL.md 内容</h3>
              <button class="heading-btn" @click="emit('copy-content', skillContent, 'source-md')">
                <svg v-if="copyStatus['source-md']" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                <svg v-else width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                {{ copyStatus['source-md'] ? '已复制' : '复制 MD' }}
              </button>
            </div>
            <div class="source-code-card">
              <pre class="source-code-block">{{ skillContent }}</pre>
            </div>
          </section>
        </div>
      </template>

      <!-- ═══════════ Files Tab ═══════════ -->
      <template v-else-if="activeTab === 'files'">
        <div class="files-tab-content animate-fade-in">
          <slot name="files-panel">
            <SkillFileEditor
              v-if="skillDir"
              :skill-dir="skillDir"
              class="file-editor-container"
            />
            <div v-else class="empty-state">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
              <p>此技能暂无本地文件</p>
            </div>
          </slot>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.skill-detail { display: flex; flex-direction: column; height: 100%; overflow: hidden; }

/* ═══ Page Header (matches MySkills) ═══ */
.page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 22px 28px 16px;
  background: hsl(var(--card));
  border-bottom: 1px solid hsl(var(--border));
  flex-shrink: 0;
}

.header-left {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.header-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.header-icon {
  width: 48px;
  height: 48px;
  border-radius: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  flex-shrink: 0;
  box-shadow: 0 4px 12px hsl(var(--primary) / 0.2);
}

.header-title-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.header-title-info h2 {
  font-size: 22px;
  font-weight: 600;
  color: hsl(var(--foreground));
  margin: 0;
}

.header-tags {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.header-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-weight: 500;
  padding: 2px 10px;
  border-radius: 6px;
  white-space: nowrap;
}

.header-tag.source-tag {
  background: transparent;
  color: transparent;
}

.header-tag.category-tag {
  background: hsl(var(--accent) / 0.6);
  color: hsl(var(--accent-foreground));
}

.header-tag svg {
  opacity: 0.7;
  flex-shrink: 0;
}

.tag-icon-svg {
  display: inline-flex;
  align-items: center;
}
.tag-icon-svg svg {
  width: 12px;
  height: 12px;
}

.back-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  border: 1px solid hsl(var(--border));
  background: hsl(var(--card));
  color: hsl(var(--muted-foreground));
  cursor: pointer;
  transition: all var(--duration-base) var(--ease-standard);
  flex-shrink: 0;
}
.back-btn:hover { background: hsl(var(--muted)); color: hsl(var(--foreground)); }

.header-toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.toolbar-icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: 1px solid hsl(var(--border));
  border-radius: 8px;
  background: hsl(var(--card));
  color: hsl(var(--muted-foreground));
  cursor: pointer;
  transition: all var(--duration-base) var(--ease-standard);
}
.toolbar-icon-btn:hover { background: hsl(var(--accent)); color: hsl(var(--foreground)); }
.toolbar-icon-btn:disabled { opacity: 0.35; cursor: default; }
.toolbar-icon-btn.favorited { color: #f59e0b; border-color: hsl(48 96% 50% / 0.4); }
.toolbar-icon-btn.close-btn:hover { color: hsl(var(--destructive)); border-color: hsl(var(--destructive) / 0.3); background: hsl(var(--destructive) / 0.06); }

/* ═══ Tab bar ═══ */
.detail-tabs-row { display: flex; gap: 8px; padding: 0 28px; border-bottom: 1px solid hsl(var(--border)); background: hsl(var(--accent) / 0.2); flex-shrink: 0; }
.detail-tabs-row button { display: flex; align-items: center; gap: 6px; padding: 12px 8px; font-size: 13px; font-weight: 600; border: none; background: none; color: hsl(var(--muted-foreground)); cursor: pointer; position: relative; transition: color var(--duration-base) var(--ease-standard); }
.detail-tabs-row button:hover { color: hsl(var(--foreground)); }
.detail-tabs-row button.active { color: hsl(var(--primary)); }
.tab-indicator { position: absolute; bottom: 0; left: 0; right: 0; height: 2px; background: hsl(var(--primary)); border-radius: 1px 1px 0 0; }

/* ═══ Scroll ═══ */
.detail-scroll { flex: 1; overflow-y: auto; overscroll-behavior: contain; padding: 20px 28px 48px; }
.space-y-4 > * + * { margin-top: 16px; }
.space-y-6 > * + * { margin-top: 24px; }
.space-y-8 > * + * { margin-top: 32px; }
.mb-0 { margin-bottom: 0; }

/* ═══ Section heading ═══ */
.section-heading { font-size: 11px; font-weight: 700; color: hsl(var(--muted-foreground)); text-transform: uppercase; letter-spacing: 0.2em; white-space: nowrap; }
.section-hint { font-size: 10px; font-weight: 400; text-transform: none; letter-spacing: 0; opacity: 0.5; margin-left: 6px; }
.section-header-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.section-actions { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }

/* ═══ Preview two-column ═══ */
.preview-layout { display: grid; grid-template-columns: 1fr 280px; gap: 20px; align-items: start; }
.preview-main { min-width: 0; }
.preview-side { min-width: 0; }
@media (max-width: 640px) {
  .preview-layout { grid-template-columns: 1fr; }
}

/* ═══ Panel cards (element block feel) ═══ */
.panel-card { border-radius: 16px; border: 1px solid hsl(var(--border)); padding: 20px; }
.desc-panel { background: hsl(var(--card)); }
.content-panel { background: hsl(var(--card)); box-shadow: 0 1px 3px hsl(0 0% 0% / 0.04); overflow: hidden; min-height: 200px; display: flex; flex-direction: column; }
.content-section { display: flex; flex-direction: column; gap: 16px; }

/* Description */
.desc-text { font-size: 14px; line-height: 1.7; color: hsl(var(--foreground) / 0.9); white-space: pre-line; margin-bottom: 14px; }
.desc-footer { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.desc-badges { display: flex; flex-wrap: wrap; gap: 6px; }
.desc-actions { display: flex; gap: 6px; }

/* Variant badges */
.variant-badge { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 500; padding: 3px 10px; border-radius: 6px; }
.variant-badge.source { background: transparent; color: transparent; }
.variant-badge.author { background: hsl(var(--accent)); color: hsl(var(--accent-foreground)); }
.variant-badge.tag { background: hsl(var(--primary) / 0.1); color: hsl(var(--primary)); }

/* User Tags */
.tags-panel { padding: 14px 16px; }
.tags-display { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.tags-list { display: flex; flex-wrap: wrap; gap: 6px; flex: 1; min-width: 0; }
.user-tag { display: inline-flex; align-items: center; gap: 4px; padding: 4px 10px; font-size: 12px; font-weight: 500; border-radius: 8px; background: hsl(var(--primary) / 0.1); color: hsl(var(--primary)); transition: all var(--duration-base) var(--ease-standard); }
.user-tag:hover { background: hsl(var(--primary) / 0.15); }
.user-tag.category-selected { background: hsl(var(--primary) / 0.15); font-size: 13px; padding: 6px 14px; }
.tags-empty { font-size: 12px; color: hsl(var(--muted-foreground)); font-style: italic; }
.tags-editing { display: flex; flex-direction: column; gap: 12px; }
.tag-input-row { display: flex; align-items: center; gap: 6px; }
.heading-btn.primary { background: hsl(var(--primary)); color: hsl(var(--primary-foreground)); }
.heading-btn.primary:hover { opacity: 0.9; }

.category-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.category-option { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 12px 8px; border-radius: 10px; border: 1px solid hsl(var(--border)); background: hsl(var(--card)); cursor: pointer; transition: all var(--duration-base) var(--ease-standard); }
.category-option:hover { border-color: hsl(var(--primary) / 0.3); background: hsl(var(--primary) / 0.03); }
.category-option.active { border-color: hsl(var(--primary)); background: hsl(var(--primary) / 0.08); }
.category-icon { font-size: 20px; }
.category-label { font-size: 11px; font-weight: 500; color: hsl(var(--muted-foreground)); }
.category-option.active .category-label { color: hsl(var(--primary)); font-weight: 600; }

/* Heading buttons (action buttons like PromptHub) */
.heading-btn { display: inline-flex; align-items: center; gap: 5px; padding: 4px 12px; font-size: 12px; font-weight: 500; border-radius: 8px; border: none; background: hsl(var(--accent) / 0.6); color: hsl(var(--muted-foreground)); cursor: pointer; transition: all var(--duration-base) var(--ease-standard); white-space: nowrap; flex-shrink: 0; }
.heading-btn:hover { background: hsl(var(--accent)); color: hsl(var(--foreground)); }
.heading-btn.editing { background: hsl(var(--primary)); color: hsl(var(--primary-foreground)); }

/* Content / Markdown */
.skill-markdown-body { flex: 1; }
.skill-markdown-body :deep(h1) { font-size: 20px; font-weight: 700; margin: 20px 0 10px; color: hsl(var(--foreground)); }
.skill-markdown-body :deep(h2) { font-size: 17px; font-weight: 700; margin: 16px 0 8px; color: hsl(var(--foreground)); }
.skill-markdown-body :deep(h3) { font-size: 15px; font-weight: 600; margin: 14px 0 6px; color: hsl(var(--foreground)); }
.skill-markdown-body :deep(p) { font-size: 14px; line-height: 1.7; margin: 10px 0; color: hsl(var(--foreground) / 0.9); }
.skill-markdown-body :deep(ul), .skill-markdown-body :deep(ol) { padding-left: 22px; margin: 10px 0; }
.skill-markdown-body :deep(li) { font-size: 14px; line-height: 1.7; margin: 4px 0; color: hsl(var(--foreground) / 0.9); }
.skill-markdown-body :deep(code) { background: hsl(var(--muted)); padding: 2px 6px; border-radius: 5px; font-size: 13px; font-family: 'SF Mono', Consolas, monospace; }
.skill-markdown-body :deep(pre) { background: hsl(var(--muted)); border: 1px solid hsl(var(--border)); border-radius: 10px; padding: 16px; overflow-x: auto; margin: 12px 0; }
.skill-markdown-body :deep(pre code) { background: none; padding: 0; font-size: 13px; line-height: 1.6; }
.skill-markdown-body :deep(hr) { border: none; border-top: 1px solid hsl(var(--border)); margin: 16px 0; }
.skill-markdown-body :deep(strong) { font-weight: 600; color: hsl(var(--foreground)); }
.skill-markdown-body :deep(blockquote) { border-left: 3px solid hsl(var(--primary)); padding-left: 16px; margin: 12px 0; color: hsl(var(--muted-foreground)); }

.content-editor { width: 100%; min-height: 300px; padding: 20px; background: transparent; border: none; font-family: 'SF Mono', Consolas, monospace; font-size: 13px; line-height: 1.6; color: hsl(var(--foreground)); resize: vertical; outline: none; flex: 1; }
.editor-toolbar { display: flex; justify-content: flex-end; gap: 8px; padding: 10px 16px; border-top: 1px solid hsl(var(--border)); background: hsl(var(--accent) / 0.3); }
.editor-toolbar-btn { padding: 6px 16px; font-size: 12px; font-weight: 500; border-radius: 8px; border: 1px solid hsl(var(--border)); background: hsl(var(--card)); color: hsl(var(--muted-foreground)); cursor: pointer; transition: all var(--duration-base) var(--ease-standard); }
.editor-toolbar-btn:hover { background: hsl(var(--muted)); }
.editor-toolbar-btn.primary { background: hsl(var(--primary)); color: hsl(var(--primary-foreground)); border-color: hsl(var(--primary)); }

.empty-content { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 48px 0; color: hsl(var(--muted-foreground)); opacity: 0.35; flex: 1; }
.empty-content p { margin-top: 10px; font-size: 13px; }

/* Translation */
.translation-segment {
  border-left: 2px solid hsl(var(--primary) / 0.4);
  padding-left: 12px;
  margin: 8px 0;
  color: hsl(var(--primary) / 0.7);
  font-style: italic;
  font-size: 12px;
}

@keyframes spin { to { transform: rotate(360deg); } }
.spin { animation: spin 0.7s linear infinite; }

.heading-btn.active {
  background: hsl(var(--primary) / 0.12);
  color: hsl(var(--primary));
}

/* ═══ Source tab ═══ */
.animate-fade-in { animation: fadeIn var(--duration-base) var(--ease-standard) both; }
@keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }

.meta-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
@media (max-width: 640px) { .meta-grid { grid-template-columns: repeat(2, 1fr); } }
.meta-item { display: flex; flex-direction: column; gap: 4px; padding: 12px 14px; background: hsl(var(--accent) / 0.3); border: 1px solid hsl(var(--border) / 0.5); border-radius: 12px; }
.meta-label { font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.1em; color: hsl(var(--muted-foreground)); }
.meta-value { font-size: 13px; font-weight: 500; color: hsl(var(--foreground)); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.meta-value.mono { font-family: 'SF Mono', Consolas, monospace; font-size: 11px; background: hsl(var(--muted)); padding: 2px 8px; border-radius: 6px; display: inline-block; width: fit-content; }
.meta-value.protocol { display: flex; align-items: center; gap: 4px; font-weight: 700; text-transform: uppercase; color: hsl(var(--primary)); letter-spacing: 0.02em; }

.source-link-card { display: flex; align-items: center; gap: 14px; padding: 16px 18px; border-radius: 16px; border: 1px solid hsl(var(--border)); background: hsl(var(--primary)); color: hsl(var(--primary-foreground)); text-decoration: none; font-weight: 700; box-shadow: 0 4px 12px hsl(var(--primary) / 0.2); transition: opacity var(--duration-base) var(--ease-standard); }
.source-link-card:hover { opacity: 0.92; }
.source-link-card.local { background: hsl(var(--accent) / 0.7); color: hsl(var(--foreground)); cursor: default; box-shadow: none; border: 1px solid hsl(var(--border)); }
.source-link-info { flex: 1; min-width: 0; text-align: left; }
.source-link-name { display: block; font-size: 13px; font-weight: 700; }
.source-link-path { display: block; font-size: 11px; font-weight: 400; opacity: 0.7; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.source-code-card { border-radius: 16px; border: 1px solid hsl(var(--border)); overflow: hidden; background: hsl(var(--card)); }
.source-code-block { display: block; padding: 20px; font-family: 'SF Mono', Consolas, monospace; font-size: 13px; line-height: 1.6; overflow-x: auto; white-space: pre-wrap; word-break: break-word; color: hsl(var(--foreground) / 0.85); max-height: 68vh; overflow-y: auto; margin: 0; }

/* ═══ Debug fields ═══ */
.debug-fields-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
@media (max-width: 800px) { .debug-fields-grid { grid-template-columns: repeat(2, 1fr); } }
.debug-field-item { display: flex; flex-direction: column; gap: 3px; padding: 10px 12px; background: hsl(var(--accent) / 0.3); border: 1px solid hsl(var(--border) / 0.5); border-radius: 10px; }
.debug-field-label { font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: hsl(var(--muted-foreground)); }
.debug-field-value { font-size: 12px; font-weight: 500; color: hsl(var(--foreground)); word-break: break-all; line-height: 1.4; max-height: 3.6em; overflow: hidden; }
.debug-field-value.is-empty { color: hsl(var(--muted-foreground) / 0.5); font-style: italic; }

/* ═══ Files tab ═══ */
.empty-state { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 64px 0; color: hsl(var(--muted-foreground)); opacity: 0.35; text-align: center; }
.empty-state p { margin-top: 12px; font-size: 14px; }
.file-editor-container { height: calc(100vh - 180px); min-height: 500px; }
</style>
