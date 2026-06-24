<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, inject, computed } from 'vue'
import { fetchSkillDetailFromSkill } from '../utils/skills-sh'
import { storage } from '../utils/storage'
import { parseFrontmatter } from '../utils/frontmatter'
import type { Skill } from '../types'
import SkillPickModal from './SkillPickModal.vue'
import { useSettings } from '../composables/useSettings'
import { translateContent, translateDescription } from '../utils/translate'
import type { TranslationMode } from '../utils/translate'
import { getAvatarColor } from '../utils/color'
import { SKILL_CATEGORIES, inferCategory, CATEGORY_ICONS } from '../data/skill-categories'
import { getSourceInfo } from '../utils/source-info'

const props = defineProps<{ skill: Skill }>()
const emit = defineEmits(['close', 'imported'])
const showToast = inject<(msg: string, type?: 'success' | 'error' | 'info' | 'warning') => void>('showToast', () => {})
const refreshCounts = inject<() => void>('refreshCounts')

const { settings } = useSettings()

const loading = ref(true)
const skillName = ref('')
const skillDesc = ref('')
const skillContent = ref('')
const importing = ref(false)

const isDownloaded = computed(() => storage.getDownloadedIds().includes(props.skill.id))

const showPickModal = ref(false)
const pickSkills = ref<{ name: string; description: string; dir: string }[]>([])
let pickSkillResolve: ((dir: string | null) => void) | null = null

const isTranslating = ref(false)
const showTranslation = ref(false)
const translatedContent = ref('')
const translationMode = ref<TranslationMode>('immersive')

const isTranslatingDesc = ref(false)
const descTranslationDone = ref(false)
const showDescTranslation = ref(false)
const translatedDesc = ref('')

const favorites = ref<string[]>([])
const isFavorited = computed(() => props.skill && favorites.value.includes(props.skill.id))
function loadFavorites() { favorites.value = storage.getFavoriteIds() }
function toggleFavorite() {
  if (!props.skill) return
  storage.toggleFavorite(props.skill.id)
  loadFavorites()
}

const copyStatus = ref<Record<string, boolean>>({})
let copyTimers: Record<string, ReturnType<typeof setTimeout>> = {}
function handleCopy(text: string, key: string) {
  navigator.clipboard.writeText(text).catch(() => {})
  copyStatus.value[key] = true
  if (copyTimers[key]) clearTimeout(copyTimers[key])
  copyTimers[key] = setTimeout(() => { copyStatus.value[key] = false }, 2000)
}

onUnmounted(() => { Object.values(copyTimers).forEach(clearTimeout) })



const sourceInfo = computed(() => getSourceInfo(props.skill))

const currentCategory = computed(() => {
  const cat = (props.skill.category as any) || inferCategory(props.skill.name, props.skill.description || '')
  return { id: cat, label: SKILL_CATEGORIES[cat as keyof typeof SKILL_CATEGORIES]?.label || '其他', icon: CATEGORY_ICONS[cat as keyof typeof CATEGORY_ICONS] || '📋' }
})

async function fetchContent() {
  loading.value = true
  try {
    // Use cached readme if available
    if (props.skill.readme) {
      const fm = parseFrontmatter(props.skill.readme)
      const normalized = props.skill.readme.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
      const bodyMatch = normalized.match(/^---\n[\s\S]*?\n---\n?([\s\S]*)$/)
      skillName.value = props.skill.name
      skillDesc.value = fm.description || props.skill.description || ''
      skillContent.value = bodyMatch ? bodyMatch[1].trim() : props.skill.readme
      loading.value = false
      return
    }
    if (props.skill.repo) {
      const result = await fetchSkillDetailFromSkill(props.skill)
      if (result) {
        skillName.value = props.skill.name
        skillDesc.value = result.description
        skillContent.value = result.content
        loading.value = false
        return
      }
    }
    skillName.value = props.skill.name
    skillDesc.value = props.skill.description || ''
    skillContent.value = ''
  } catch {}
  loading.value = false
}

onMounted(() => { fetchContent(); loadFavorites() })
watch(() => props.skill?.id, () => { fetchContent(); loadFavorites() })

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

async function handleTranslate() {
  if (!skillContent.value.trim()) return
  if (translatedContent.value) { showTranslation.value = !showTranslation.value; return }
  if (!translationModel.value) { showToast('AI 模型未配置', 'error'); return }
  isTranslating.value = true
  try {
    translatedContent.value = await translateContent(skillContent.value, translationModel.value, translationMode.value)
    showTranslation.value = true
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
  const desc = skillDesc.value || props.skill.description
  if (!desc) return
  if (descTranslationDone.value) { showDescTranslation.value = !showDescTranslation.value; return }
  if (!translationModel.value) { showToast('AI 模型未配置', 'error'); return }
  isTranslatingDesc.value = true
  try {
    translatedDesc.value = await translateDescription(desc, translationModel.value)
    descTranslationDone.value = true
    showDescTranslation.value = true
    showToast('描述翻译完成', 'success')
  } catch (err: any) {
    const msg = err.message === 'AI_NOT_CONFIGURED' ? 'AI 模型未配置' :
                err.message === 'AI_AUTH_ERROR' ? 'API 认证失败，请检查 API Key' :
                err.message || '翻译失败'
    showToast(msg, 'error')
  }
  isTranslatingDesc.value = false
}

async function handleReTranslateDesc() {
  const desc = skillDesc.value || props.skill.description
  if (!desc) return
  if (!translationModel.value) { showToast('AI 模型未配置', 'error'); return }
  isTranslatingDesc.value = true
  try {
    translatedDesc.value = await translateDescription(desc, translationModel.value)
    descTranslationDone.value = true
    showDescTranslation.value = true
    showToast('描述翻译完成', 'success')
  } catch (err: any) {
    const msg = err.message === 'AI_NOT_CONFIGURED' ? 'AI 模型未配置' :
                err.message === 'AI_AUTH_ERROR' ? 'API 认证失败，请检查 API Key' :
                err.message || '翻译失败'
    showToast(msg, 'error')
  }
  isTranslatingDesc.value = false
}

function collectAllSkillDirs(root: string): string[] {
  const results: string[] = []
  const items = window.services.readDir(root) || []
  for (const item of items) {
    if (!item.isDirectory) continue
    const skillPath = window.services.pathJoin(item.path, 'SKILL.md')
    const skillPathLower = window.services.pathJoin(item.path, 'skill.md')
    if (window.services.pathExists(skillPath) || window.services.pathExists(skillPathLower)) {
      results.push(item.path)
    }
    results.push(...collectAllSkillDirs(item.path))
  }
  return results
}

function readSkillDirMeta(dirPath: string): { name: string; description: string } {
  const skillFile = ['SKILL.md', 'skill.md']
    .map((f) => window.services.pathJoin(dirPath, f))
    .find((f) => window.services.pathExists(f))
  if (skillFile) {
    const content = window.services.readFile(skillFile)
    const fm = parseFrontmatter(content)
    return { name: fm.name || '', description: fm.description || '' }
  }
  return { name: '', description: '' }
}

function matchSkillDir(candidates: string[], targetName: string): string | null {
  if (candidates.length === 1) return candidates[0]
  if (!targetName) return candidates[0] || null
  const targetLower = targetName.toLowerCase()
  for (const dir of candidates) {
    const { name } = readSkillDirMeta(dir)
    if (name && name.toLowerCase() === targetLower) return dir
  }
  for (const dir of candidates) {
    const dirName = dir.split(/[\\/]/).pop()?.toLowerCase() || ''
    if (dirName === targetLower || dirName.includes(targetLower) || targetLower.includes(dirName)) return dir
  }
  return null
}

function pickSkillDir(candidates: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    pickSkills.value = candidates.map((dir) => {
      const { name, description } = readSkillDirMeta(dir)
      const dirName = dir.split(/[\\/]/).pop() || dir
      return { name: name || dirName, description, dir }
    })
    pickSkillResolve = resolve
    showPickModal.value = true
  })
}

function handlePickSelect(dir: string) {
  pickSkillResolve?.(dir)
  showPickModal.value = false
  pickSkillResolve = null
}

function handlePickCancel() {
  pickSkillResolve?.(null)
  showPickModal.value = false
  pickSkillResolve = null
}

async function handleImport() {
  if (!props.skill.repo || isDownloaded.value) return
  importing.value = true
  try {
    const gh = props.skill.repo.split('/')
    const buffer = await window.services.downloadFile(`https://api.github.com/repos/${gh[0]}/${gh[1]}/zipball/${props.skill.branch || 'main'}`)
    const tempDir = window.services.pathJoin(window.services.homeDir(), '.cache/skill-hub/')
    window.services.mkdir(tempDir)
    const extractDir = window.services.pathJoin(tempDir, `extract-${props.skill.id.replace(/\//g, '-')}`)
    window.services.removeFile(extractDir)
    window.services.extractBufferZip(buffer as any, extractDir)
    const extractedItems = window.services.readDir(extractDir)
    const rootDir = extractedItems.find((d: any) => d.isDirectory)
    const sourceRoot = rootDir ? rootDir.path : extractDir
    const candidates = [props.skill.path, `skills/${props.skill.path}`, `agent-skills/${props.skill.path}`]
    let sourceDir = ''
    for (const p of candidates) {
      const candidate = window.services.pathJoin(sourceRoot, p)
      if (window.services.pathExists(candidate)) { sourceDir = candidate; break }
    }
    if (!sourceDir) {
      const allSkillDirs = collectAllSkillDirs(sourceRoot)
      if (allSkillDirs.length === 0) { showToast('未找到技能文件', 'error'); importing.value = false; return }
      sourceDir = matchSkillDir(allSkillDirs, props.skill.name) || await pickSkillDir(allSkillDirs)
    }
    if (!sourceDir) { showToast('未找到技能文件', 'error'); importing.value = false; return }
    const targetDir = window.services.pathJoin(window.ztools.getPath('userData'), 'skills-repo', props.skill.id)
    window.services.removeFile(targetDir); window.services.mkdir(targetDir); window.services.copyFile(sourceDir, targetDir)
    window.services.removeFile(extractDir)
    const skillFile = ['SKILL.md', 'skill.md'].find((f) => window.services.pathExists(window.services.pathJoin(targetDir, f)))
    if (skillFile) {
      const parsed = window.services.parseSkillFile(window.services.pathJoin(targetDir, skillFile))
      if (parsed?.manifest?.description) {
        // Update cached description if parsed from SKILL.md
        storage.saveCachedSkills([{ ...props.skill, description: parsed.manifest.description, storeSourceId: props.skill.storeSourceId }])
      }
    }
    storage.addDownloadedId(props.skill.id)
    refreshCounts?.()
    emit('imported')
    showToast(`已导入 ${props.skill.name}`, 'success')
  } catch (err: any) {
    showToast('导入失败: ' + (err.message || '未知错误'), 'error')
  }
  importing.value = false
}
</script>

<template>
  <div class="modal-overlay" @click.self="emit('close')">
    <div class="modal-card">
      <!-- Header (aligned with SkillDetailBase) -->
      <div class="modal-header">
        <div class="header-left">
          <div class="header-title-row">
            <div class="header-icon" :style="{ background: getAvatarColor(skillName || skill.name) }">
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
          <button class="toolbar-icon-btn" :class="{ favorited: isFavorited }" :title="isFavorited ? '取消收藏' : '收藏'" @click="toggleFavorite">
            <svg width="16" height="16" viewBox="0 0 24 24" :fill="isFavorited ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
          </button>
          <button class="toolbar-icon-btn close-btn" title="关闭" @click="emit('close')">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </div>

      <!-- Content (aligned with SkillDetailBase preview tab) -->
      <div class="modal-body">
        <div v-if="loading" class="loading">
          <div class="spinner"></div>
          <span>加载中...</span>
        </div>
        <template v-else>
          <div class="preview-content">
            <!-- SKILL 描述 -->
            <section class="space-y-4">
              <h3 class="section-heading">SKILL 描述</h3>
              <div class="panel-card desc-panel">
                <p class="desc-text">{{ descTranslationDone && showDescTranslation ? translatedDesc : (skillDesc || skill.description || '暂无描述') }}</p>
                <div class="desc-footer">
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

            <!-- SKILL 内容 -->
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
                  <button class="heading-btn" @click="handleCopy(skillContent, 'instr')">
                    <svg v-if="copyStatus['instr']" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                    <svg v-else width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                    {{ copyStatus['instr'] ? '已复制' : '复制 MD' }}
                  </button>
                </div>
              </div>
              <div class="panel-card content-panel">
                <div v-if="skillContent" class="skill-markdown-body p-6">
                  <div v-html="renderMarkdown(showTranslation && translatedContent ? translatedContent : skillContent)"></div>
                </div>
                <div v-else class="empty-content">
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
                  <p>暂无内容</p>
                </div>
              </div>
            </section>
          </div>
        </template>
      </div>

      <!-- Footer -->
      <div class="modal-footer">
        <div v-if="isDownloaded" class="import-btn imported">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          已在我的 Skill 中
        </div>
        <button v-else class="import-btn" :disabled="importing || loading" @click="handleImport">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          {{ importing ? '导入中...' : '导入到我的 Skill' }}
        </button>
      </div>
    </div>
  </div>
  <SkillPickModal v-if="showPickModal" :skills="pickSkills" @select="handlePickSelect" @close="handlePickCancel" />
</template>

<style scoped>
.modal-overlay { position: fixed; inset: 0; background: hsl(0 0% 0% / 0.45); backdrop-filter: blur(6px); display: flex; align-items: center; justify-content: center; z-index: 1000; padding: 20px; }
.modal-card { background: hsl(var(--card)); border: 1px solid hsl(var(--border)); border-radius: 20px; width: 640px; max-width: 100%; max-height: 85vh; display: flex; flex-direction: column; box-shadow: 0 24px 64px hsl(0 0% 0% / 0.25); overflow: hidden; }

/* ═══ Header (aligned with SkillDetailBase) ═══ */
.modal-header { display: flex; align-items: flex-start; justify-content: space-between; padding: 22px 24px 16px; flex-shrink: 0; }
.header-left { display: flex; flex-direction: column; gap: 6px; }
.header-title-row { display: flex; align-items: center; gap: 10px; }
.header-icon { width: 48px; height: 48px; border-radius: 14px; display: flex; align-items: center; justify-content: center; color: #fff; flex-shrink: 0; box-shadow: 0 4px 12px hsl(var(--primary) / 0.2); }
.header-title-info { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.header-title-info h2 { font-size: 22px; font-weight: 600; color: hsl(var(--foreground)); margin: 0; }
.header-tags { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.header-tag { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 500; padding: 2px 10px; border-radius: 6px; white-space: nowrap; }
.header-tag.source-tag { background: transparent; color: transparent; }
.header-tag.category-tag { background: hsl(var(--accent) / 0.6); color: hsl(var(--accent-foreground)); }
.header-tag svg { opacity: 0.7; flex-shrink: 0; }
.tag-icon-svg { display: inline-flex; align-items: center; }
.tag-icon-svg svg { width: 12px; height: 12px; }

.header-toolbar { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
.toolbar-icon-btn { display: flex; align-items: center; justify-content: center; width: 32px; height: 32px; border: 1px solid hsl(var(--border)); border-radius: 8px; background: hsl(var(--card)); color: hsl(var(--muted-foreground)); cursor: pointer; transition: all var(--duration-base) var(--ease-standard); }
.toolbar-icon-btn:hover { background: hsl(var(--accent)); color: hsl(var(--foreground)); }
.toolbar-icon-btn.favorited { color: #f59e0b; border-color: hsl(48 96% 50% / 0.4); }
.toolbar-icon-btn.close-btn:hover { color: hsl(var(--destructive)); border-color: hsl(var(--destructive) / 0.3); background: hsl(var(--destructive) / 0.06); }

/* ═══ Body ═══ */
.modal-body { flex: 1; overflow-y: auto; overscroll-behavior: contain; padding: 0 24px 20px; min-height: 0; }
.loading { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; padding: 48px; color: hsl(var(--muted-foreground)); font-size: 13px; }
.spinner { width: 20px; height: 20px; border: 2px solid hsl(var(--border)); border-top-color: hsl(var(--primary)); border-radius: 50%; animation: spin 0.7s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.spin { animation: spin 0.7s linear infinite; }

.preview-content { padding: 20px 0; }

/* ═══ Section heading ═══ */
.section-heading { font-size: 11px; font-weight: 700; color: hsl(var(--muted-foreground)); text-transform: uppercase; letter-spacing: 0.2em; white-space: nowrap; }
.section-hint { font-size: 10px; font-weight: 400; text-transform: none; letter-spacing: 0; opacity: 0.5; margin-left: 6px; }
.section-header-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.section-actions { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
.mb-0 { margin-bottom: 0; }

/* ═══ Panel cards ═══ */
.panel-card { border-radius: 16px; border: 1px solid hsl(var(--border)); padding: 20px; }
.desc-panel { background: hsl(var(--card)); }
.desc-text { font-size: 14px; line-height: 1.7; color: hsl(var(--foreground) / 0.9); white-space: pre-line; margin-bottom: 14px; }
.desc-footer { display: flex; align-items: center; justify-content: flex-end; gap: 8px; }
.desc-badges { display: flex; flex-wrap: wrap; gap: 6px; }
.desc-actions { display: flex; gap: 6px; }

.variant-badge { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 500; padding: 3px 10px; border-radius: 6px; }
.variant-badge.source { background: transparent; color: transparent; }
.variant-badge.author { background: hsl(var(--accent)); color: hsl(var(--accent-foreground)); }
.variant-badge.tag { background: hsl(var(--primary) / 0.1); color: hsl(var(--primary)); }

.heading-btn { display: inline-flex; align-items: center; gap: 5px; padding: 4px 12px; font-size: 12px; font-weight: 500; border-radius: 8px; border: none; background: hsl(var(--accent) / 0.6); color: hsl(var(--muted-foreground)); cursor: pointer; transition: all var(--duration-base) var(--ease-standard); white-space: nowrap; flex-shrink: 0; }
.heading-btn:hover { background: hsl(var(--accent)); color: hsl(var(--foreground)); }
.heading-btn.active { background: hsl(var(--primary) / 0.12); color: hsl(var(--primary)); }

/* ═══ Content section ═══ */
.content-section { display: flex; flex-direction: column; gap: 16px; }
.content-panel { background: hsl(var(--card)); box-shadow: 0 1px 3px hsl(0 0% 0% / 0.04); overflow: hidden; min-height: 200px; display: flex; flex-direction: column; }

.skill-markdown-body { flex: 1; padding: 20px; }
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

.empty-content { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 48px 0; color: hsl(var(--muted-foreground)); opacity: 0.35; }
.empty-content p { margin-top: 10px; font-size: 13px; }

.space-y-4 > * + * { margin-top: 16px; }

/* ═══ Footer ═══ */
.modal-footer { padding: 16px 24px 20px; border-top: 1px solid hsl(var(--border)); display: flex; justify-content: flex-end; flex-shrink: 0; }
.import-btn { display: inline-flex; align-items: center; gap: 8px; padding: 12px 28px; font-size: 14px; font-weight: 600; border-radius: 12px; border: none; background: hsl(var(--primary)); color: hsl(var(--primary-foreground)); cursor: pointer; box-shadow: 0 4px 16px hsl(var(--primary) / 0.25); transition: all var(--duration-base) var(--ease-standard); }
.import-btn:hover:not(:disabled) { box-shadow: 0 6px 24px hsl(var(--primary) / 0.35); transform: translateY(-1px); }
.import-btn:disabled { opacity: 0.5; cursor: default; }
.import-btn.imported { background: rgb(222, 242, 231); color: #166534; box-shadow: none; cursor: default; }
</style>
