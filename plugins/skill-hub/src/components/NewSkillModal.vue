<script setup lang="ts">
import { ref, inject } from 'vue'
import { storage } from '../utils/storage'
import { parseGitHubUrl, fetchGitHubRepoTree, fetchGitHubFile, detectSkillDirectories } from '../utils/github'
import { parseFrontmatter } from '../utils/frontmatter'
import type { Skill } from '../types'
import { getAvatarColor } from '../utils/color'

const emit = defineEmits(['close', 'imported', 'navigate'])
const refreshCounts = inject<() => void>('refreshCounts')

const step = ref<'choose' | 'git-input' | 'git-scan' | 'git-confirm'>('choose')
const gitUrl = ref('')
const scanning = ref(false)
const scanError = ref('')
const scannedSkills = ref<Skill[]>([])
const selectedIds = ref<Set<string>>(new Set())
const importing = ref(false)

const methods = [
  { id: 'git', icon: '📦', title: '从 Git 仓库', desc: '粘贴 GitHub、Gitea 或其他 Git 仓库 URL 进行安装', disabled: false },
]

function chooseMethod(id: string) { if (id === 'git') step.value = 'git-input' }

async function scanGit() {
  if (!gitUrl.value.trim()) return
  scanning.value = true; scanError.value = ''; scannedSkills.value = []; selectedIds.value = new Set()
  try {
    const info = parseGitHubUrl(gitUrl.value.trim())
    if (!info) { scanError.value = '请输入有效的 GitHub URL 或仓库名称（如 owner/repo）'; scanning.value = false; return }
    const token = storage.getSettings().githubToken || undefined
    const tree = await fetchGitHubRepoTree(info.owner, info.repo, info.defaultBranch, token)
    const skillDirs = detectSkillDirectories(tree)
    const skills: Skill[] = []
    for (const sd of skillDirs) {
      try {
        const content = await fetchGitHubFile(info.owner, info.repo, sd.manifestFile, info.defaultBranch)
        const fm = parseFrontmatter(content)
        const dirName = sd.dir === '.' ? info.repo : sd.dir.split('/').pop() || sd.dir
        const tags = fm.tags ? fm.tags.split(',').map((t) => t.trim()).filter(Boolean) : []
        skills.push({ id: `${info.owner}/${info.repo}/${sd.dir}`, name: fm.name || dirName, description: fm.description || '', author: fm.author || '', tags, format: 'generic', source: 'github', repo: `${info.owner}/${info.repo}`, path: sd.dir })
      } catch {}
    }
    if (!skills.length) { scanError.value = '未找到可安装的技能'; scanning.value = false; return }
    scannedSkills.value = skills; step.value = 'git-scan'
  } catch (err: any) { scanError.value = err.message }
  scanning.value = false
}



function toggleSelect(id: string) { if (selectedIds.value.has(id)) selectedIds.value.delete(id); else selectedIds.value.add(id) }
function selectAll() { selectedIds.value = selectedIds.value.size === scannedSkills.value.length ? new Set() : new Set(scannedSkills.value.map((s) => s.id)) }

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

async function importSelected() {
  if (!selectedIds.value.size) return
  importing.value = true
  const downloadedIds = storage.getDownloadedIds()
  for (const skill of scannedSkills.value) {
    if (selectedIds.value.has(skill.id) && !downloadedIds.includes(skill.id) && skill.repo) {
      try {
        const [owner, repo] = skill.repo.split('/')
        const buffer = await window.services.downloadFile(`https://api.github.com/repos/${owner}/${repo}/zipball/main`)
        const tempDir = window.services.pathJoin(window.services.homeDir(), '.cache/skill-hub/')
        window.services.mkdir(tempDir)
        const extractDir = window.services.pathJoin(tempDir, `extract-${skill.id.replace(/\//g, '-')}`)
        window.services.removeFile(extractDir)
        window.services.extractBufferZip(buffer as any, extractDir)
        const extractedItems = window.services.readDir(extractDir)
        const rootDir = extractedItems.find((d: any) => d.isDirectory)
        const sourceRoot = rootDir ? rootDir.path : extractDir
        let skillSourceDir = window.services.pathJoin(sourceRoot, skill.path || '')
        if (!window.services.pathExists(skillSourceDir)) {
          const pathCandidates = [skill.path, `skills/${skill.path}`, `agent-skills/${skill.path}`]
          for (const p of pathCandidates) {
            const c = window.services.pathJoin(sourceRoot, p)
            if (window.services.pathExists(c)) { skillSourceDir = c; break }
          }
        }
        if (!window.services.pathExists(skillSourceDir)) {
          const allSkillDirs = collectAllSkillDirs(sourceRoot)
          const matched = matchSkillDir(allSkillDirs, skill.name)
          if (matched) skillSourceDir = matched
        }
        if (!window.services.pathExists(skillSourceDir)) continue
        const targetDir = window.services.pathJoin(window.ztools.getPath('userData'), 'skills-repo', skill.id)
        window.services.removeFile(targetDir); window.services.mkdir(targetDir); window.services.copyFile(skillSourceDir, targetDir)
        window.services.removeFile(extractDir)
        const skillFile = ['SKILL.md', 'skill.md'].find((f) => window.services.pathExists(window.services.pathJoin(targetDir, f)))
        if (skillFile) {
          const parsed = window.services.parseSkillFile(window.services.pathJoin(targetDir, skillFile))
          if (parsed?.manifest?.description) {
            skill.description = parsed.manifest.description
          }
        }
        storage.saveCachedSkills([skill])
        storage.addDownloadedId(skill.id); refreshCounts?.()
      } catch {}
    }
  }
  importing.value = false; emit('imported'); emit('close')
}


</script>

<template>
  <div class="modal-overlay" @click.self="emit('close')">
    <div class="modal">
      <div class="modal-header">
        <h3>添加技能</h3>
        <button class="close-btn" @click="emit('close')">×</button>
      </div>
      <div class="modal-body">
        <template v-if="step === 'choose'">
          <p class="hint">选择添加技能的方式：</p>
          <div class="method-list">
            <button v-for="m in methods" :key="m.id" class="method-item" :class="{ disabled: m.disabled }" @click="chooseMethod(m.id)">
              <div class="method-icon">{{ m.icon }}</div>
              <div class="method-info">
                <div class="method-title">{{ m.title }}</div>
                <div class="method-desc">{{ m.desc }}</div>
              </div>
            </button>
          </div>
        </template>
        <template v-else-if="step === 'git-input'">
          <p class="hint">输入 GitHub 仓库 URL 或名称：</p>
          <div class="git-input-row">
            <input v-model="gitUrl" type="text" placeholder="https://github.com/user/repo 或 owner/repo" class="git-input" @keydown.enter="scanGit" />
            <button class="scan-btn" :disabled="scanning || !gitUrl.trim()" @click="scanGit">{{ scanning ? '扫描中...' : '扫描' }}</button>
          </div>
          <div v-if="scanError" class="scan-error">
            ⚠ {{ scanError }}<br>
            <button v-if="scanError.includes('速率限制')" class="error-settings-link" @click="emit('navigate', 'settings', { anchor: 'github-token-section' })">前往设置 →</button>
          </div>
          <button class="back-link" @click="step = 'choose'">← 返回</button>
        </template>
        <template v-else-if="step === 'git-scan'">
          <div class="scan-header">
            <p class="hint">找到 {{ scannedSkills.length }} 个技能。选择要安装的：</p>
            <button class="select-all-btn" @click="selectAll">{{ selectedIds.size === scannedSkills.length ? '取消全选' : '全选' }}</button>
          </div>
          <div class="skill-select-list">
            <label v-for="skill in scannedSkills" :key="skill.id" class="skill-select-item">
              <input type="checkbox" :checked="selectedIds.has(skill.id)" @change="toggleSelect(skill.id)" />
              <div class="skill-avatar" :style="{ background: getAvatarColor(skill.name) }">{{ skill.name.charAt(0).toUpperCase() }}</div>
              <div class="skill-info">
                <div class="skill-name">{{ skill.name }}</div>
                <div class="skill-desc">{{ skill.description || '暂无描述' }}</div>
              </div>
            </label>
          </div>
        </template>
      </div>

      <div v-if="step === 'git-scan'" class="modal-footer">
        <div class="scan-actions">
          <button class="back-link" @click="step = 'git-input'">← 返回</button>
          <button class="import-btn" :disabled="!selectedIds.size || importing" @click="importSelected">{{ importing ? '安装中...' : `安装 (${selectedIds.size})` }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-overlay { position: fixed; inset: 0; background: hsl(var(--background) / 0.6); backdrop-filter: blur(8px); display: flex; align-items: center; justify-content: center; z-index: 1000; }
.modal { background: hsl(var(--card)); border: 1px solid hsl(var(--border)); border-radius: 16px; width: 520px; max-height: 80vh; overflow: hidden; display: flex; flex-direction: column; box-shadow: var(--shadow-lg); }
.modal-header { display: flex; align-items: center; justify-content: space-between; padding: 20px 24px 0; }
.modal-header h3 { font-size: 18px; font-weight: 700; color: hsl(var(--foreground)); }
.close-btn { width: 32px; height: 32px; border-radius: 8px; border: none; background: hsl(var(--muted)); color: hsl(var(--muted-foreground)); font-size: 20px; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all var(--duration-base) var(--ease-standard); }
.close-btn:hover { background: hsl(var(--destructive)); color: hsl(var(--destructive-foreground)); }
.modal-body { padding: 20px 24px 24px; overflow-y: auto; }
.hint { font-size: 14px; color: hsl(var(--muted-foreground)); margin-bottom: 16px; }
.method-list { display: flex; flex-direction: column; gap: 10px; }
.method-item { display: flex; align-items: center; gap: 14px; padding: 16px; border: 1px solid hsl(var(--border)); border-radius: var(--radius); background: transparent; cursor: pointer; text-align: left; transition: all var(--duration-base) var(--ease-standard); }
.method-item:hover { border-color: hsl(var(--primary) / 0.4); box-shadow: 0 2px 8px hsl(var(--primary) / 0.1); }
.method-item.disabled { opacity: 0.5; cursor: default; }
.method-icon { width: 44px; height: 44px; border-radius: 12px; background: hsl(var(--primary)); color: hsl(var(--primary-foreground)); display: flex; align-items: center; justify-content: center; font-size: 20px; flex-shrink: 0; }
.method-info { flex: 1; min-width: 0; }
.method-title { font-size: 14px; font-weight: 600; color: hsl(var(--foreground)); }
.method-desc { font-size: 12px; color: hsl(var(--muted-foreground)); margin-top: 2px; }
.git-input-row { display: flex; gap: 8px; margin-bottom: 12px; }
.git-input { flex: 1; padding: 10px 14px; font-size: 14px; border: 1px solid hsl(var(--border)); border-radius: 10px; background: hsl(var(--muted)); color: hsl(var(--foreground)); outline: none; transition: all var(--duration-base) var(--ease-standard); }
.git-input:focus { border-color: hsl(var(--ring)); box-shadow: 0 0 0 3px hsl(var(--ring) / 0.12); background: hsl(var(--card)); }
.git-input::placeholder { color: hsl(var(--muted-foreground)); }
.scan-btn { padding: 10px 20px; font-size: 14px; font-weight: 600; border-radius: 10px; background: hsl(var(--primary)); color: hsl(var(--primary-foreground)); border: none; cursor: pointer; white-space: nowrap; transition: all var(--duration-base) var(--ease-standard); }
.scan-btn:disabled { opacity: 0.5; cursor: default; }
.scan-error { font-size: 13px; color: hsl(var(--destructive)); margin-bottom: 12px; }
.error-settings-link { display: inline-block; margin-top: 8px; padding: 6px 16px; font-size: 13px; font-weight: 500; color: #fff; background: hsl(var(--primary)); border: none; border-radius: 8px; cursor: pointer; transition: opacity var(--duration-base) var(--ease-standard); }
.error-settings-link:hover { opacity: 0.85; }
.back-link { background: none; border: none; color: hsl(var(--muted-foreground)); font-size: 13px; cursor: pointer; padding: 4px 0; transition: color var(--duration-base) var(--ease-standard); }
.back-link:hover { color: hsl(var(--primary)); }
.scan-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.scan-header .hint { margin-bottom: 0; }
.select-all-btn { background: none; border: none; color: hsl(var(--primary)); font-size: 13px; cursor: pointer; font-weight: 500; }
.skill-select-list { display: flex; flex-direction: column; gap: 8px; max-height: 320px; overflow-y: auto; margin-bottom: 16px; }
.skill-select-item { display: flex; align-items: center; gap: 12px; padding: 12px; border: 1px solid hsl(var(--border)); border-radius: 10px; cursor: pointer; transition: all var(--duration-base) var(--ease-standard); }
.skill-select-item:hover { border-color: hsl(var(--primary)); }
.skill-select-item input[type="checkbox"] { width: 16px; height: 16px; accent-color: hsl(var(--primary)); flex-shrink: 0; }
.skill-avatar { width: 36px; height: 36px; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 16px; font-weight: 600; color: #fff; flex-shrink: 0; }
.skill-info { flex: 1; min-width: 0; }
.skill-name { font-size: 13px; font-weight: 600; color: hsl(var(--foreground)); }
.skill-desc { font-size: 12px; color: hsl(var(--muted-foreground)); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.modal-footer { padding: 0 24px 20px; border-top: 1px solid hsl(var(--border)); flex-shrink: 0; }
.modal-footer .scan-actions { display: flex; align-items: center; justify-content: space-between; margin-top: 16px; }
.import-btn { padding: 10px 24px; font-size: 14px; font-weight: 600; border-radius: 10px; background: hsl(var(--primary)); color: hsl(var(--primary-foreground)); border: none; cursor: pointer; transition: all var(--duration-base) var(--ease-standard); }
.import-btn:disabled { opacity: 0.5; cursor: default; }
</style>
