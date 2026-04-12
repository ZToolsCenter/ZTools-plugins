<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'

interface Skill { id: string; name: string; localPath: string; sourceUrl: string; installedAt: string; updatedAt: string }
interface PreviewSkillItem { name: string; path: string }
interface PreviewData { tempDir: string; cloneDir: string; skills: PreviewSkillItem[]; gitUrl: string }

declare global {
  interface Window {
    preloadAPI: {
      getSkillsList: () => Skill[]
      getSupportedAgents: () => Promise<any[]>
      previewSkills: (url: string, onProgress?: (msg: any) => void) => Promise<PreviewData>
      installFromPreview: (data: PreviewData, skills: string[], paths: string[], url: string, onProgress?: (msg: any) => void) => boolean
      distributeSkill: (id: string, agents: string[]) => boolean
      cancelPreview: (tempDir: string) => void
      openLocalPath: (localPath: string) => void
      openUrl: (url: string) => void
      uninstallSkill: (id: string) => boolean
      updateSkill: (id: string, onProgress?: (msg: any) => void) => Promise<boolean>
      batchUpdateSkills: (ids: string[], onProgress?: (msg: any) => void) => Promise<{ success: string[]; failed: { id: string; error: string }[] }>
      batchDeleteSkills: (ids: string[]) => { success: string[]; failed: { id: string; error: string }[] }
      exportSkillsConfig: () => string
      importSkillsConfig: (configJson: string, onProgress?: (msg: any) => void) => Promise<{ success: any[]; failed: any[]; skipped: any[] }>
      saveFileDialog: (content: string, defaultName: string) => string
      selectSavePath: (defaultName?: string) => string | null
      refreshRegistry: () => Promise<Skill[]>
    }
    ztools: any
  }
}

const skills = ref<Skill[]>([])
const loading = ref(false)
const progressLogs = ref<string[]>([])
const installUrl = ref('')
const searchKeyword = ref('')
const localSearch = ref('')
const isDark = ref(false)
const viewMode = ref<'grid' | 'list' | 'grouped'>('grid')
const selectedAgent = ref('all')
const supportedAgents = ref<any[]>([])
const agentOptions = computed(() => ['all', ...supportedAgents.value.map(a => a.id)])

// 分组的折叠状态
const collapsedGroups = ref<Set<string>>(new Set())

// 批量操作状态
const batchMode = ref(false)
const batchSelected = ref<string[]>([])
const batchProcessing = ref(false)
const batchResults = ref<{ success: string[]; failed: { id: string; error: string }[] } | null>(null)

const showInstallPrompt = ref(false)
const selectedPaths = ref<string[]>(['antigravity'])
const enableCustomPath = ref(false)
const customPathVal = ref('')

const previewData = ref<PreviewData | null>(null)
const availableSkills = ref<PreviewSkillItem[]>([])
const selectedSkillNames = ref<string[]>([])
const previewLoading = ref(false)
const isAgentsExpanded = ref(false)

const loadSkills = () => {
  if (window.preloadAPI) { skills.value = window.preloadAPI.getSkillsList() }
  else { skills.value = [{ id: 'mock', name: 'Mock Skill', sourceUrl: 'https://github.com/mock/skill', localPath: '', installedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }] }
}

onMounted(async () => {
  if (window.preloadAPI) {
    supportedAgents.value = await window.preloadAPI.getSupportedAgents()
    skills.value = await window.preloadAPI.refreshRegistry()
  } else {
    loadSkills()
  }
  if (window.ztools) {
    isDark.value = window.ztools.isDarkColors()
    window.ztools.setSubInput((text: string) => { 
      searchKeyword.value = text 
    }, '输入 GitHub 仓库地址进行安装...', true)
    
    window.ztools.onPluginEnter((param: any) => { 
      refreshAll()
      if (param.type === 'regex' && param.code === 'quick-install') { 
        installUrl.value = param.payload
        handleInstall() 
      } 
    })
  } else { isDark.value = false }
})

const filteredSkills = () => {
  let list = skills.value
  
  // 1. Agent 维度过滤
  if (selectedAgent.value !== 'all') {
    list = list.filter(s => getAgentIdByPath(s.localPath) === selectedAgent.value)
  }
  
  // 2. 关键词检索 (组合 ZTools 关键词与 UI 本地关键词)
  const kw = searchKeyword.value.trim().toLowerCase()
  const lkw = localSearch.value.trim().toLowerCase()
  
  if (kw) {
    list = list.filter(s => 
      (s.name || '').toLowerCase().includes(kw) || 
      (s.sourceUrl || '').toLowerCase().includes(kw)
    )
  }
  
  if (lkw) {
    list = list.filter(s => 
      (s.name || '').toLowerCase().includes(lkw) || 
      (s.sourceUrl || '').toLowerCase().includes(lkw) ||
      getPathAlias(s.localPath).toLowerCase().includes(lkw)
    )
  }

  // 3. 优先级排序：名字匹配 > 仓库/平台匹配
  const searchStr = lkw || kw
  if (searchStr) {
    list = [...list].sort((a, b) => {
      const getScore = (s: Skill) => {
        let score = 0
        const name = (s.name || '').toLowerCase()
        const source = (s.sourceUrl || '').toLowerCase()
        const agent = getPathAlias(s.localPath).toLowerCase()
        
        if (name === searchStr) score += 100 // 精确匹配最高
        else if (name.startsWith(searchStr)) score += 50 // 前缀匹配
        else if (name.includes(searchStr)) score += 30 // 名字包含次之
        
        if (source.includes(searchStr)) score += 10 // 仓库匹配
        if (agent.includes(searchStr)) score += 5 // 平台匹配
        return score
      }
      return getScore(b) - getScore(a)
    })
  }
  
  return list
}

const handleInstall = async () => {
  if (!installUrl.value) return
  previewLoading.value = true
  progressLogs.value = []
  previewData.value = null
  availableSkills.value = []
  selectedSkillNames.value = []
  try {
    if (window.preloadAPI) {
      const data = await window.preloadAPI.previewSkills(installUrl.value, (msg: any) => {
        const clean = msg.text.replace(/[\u001b\x1b]\[[0-9;?]*[A-Za-z]/gi, '').trim()
        if (clean) progressLogs.value.push(clean)
      })
      previewData.value = data
      availableSkills.value = data.skills
      selectedSkillNames.value = data.skills.map(s => s.name)
      showInstallPrompt.value = true
    }
  } catch (e: any) { alert("预览失败：" + e.message) }
  finally { previewLoading.value = false }
}

const getAgentIdByPath = (pathStr?: string) => {
  if (!pathStr) return ''
  // 统一转为小写且使用正斜杠进行比对
  const lp = pathStr.toLowerCase().replace(/\\/g, '/')
  for (const agent of supportedAgents.value) {
    const agentPath = agent.path.toLowerCase().replace(/\\/g, '/')
    if (lp.includes(agentPath)) return agent.id
  }
  return ''
}

const getPathAlias = (pathStr?: string) => {
  if (!pathStr) return '未知'
  const id = getAgentIdByPath(pathStr)
  if (id) return getAgentNameById(id)
  
  const folders = pathStr.split(/[\\/]/)
  return folders.length > 1 ? folders[folders.length - 2] : '本地'
}

const openSourceUrl = (url: string) => {
  if (!url || url === '未注册') return
  const finalUrl = url.startsWith('http') ? url : `https://github.com/${url}`
  if (window.preloadAPI) { window.preloadAPI.openUrl(finalUrl) }
  else { window.open(finalUrl, '_blank') }
}

const openLocalPath = (localPath: string) => {
  if (!localPath || !window.preloadAPI) return
  window.preloadAPI.openLocalPath(localPath)
}

const shortUrl = (url: string) => {
  if (!url || url === '未注册') return url
  const m = url.match(/github\.com\/([^/]+\/[^/]+)/)
  return m ? m[1] : url.replace(/^https?:\/\//, '').substring(0, 30)
}

// 提取仓库的分组标识（user/repo）
const getRepoKey = (url: string) => {
  if (!url || url === '未注册') return '未注册'
  const m = url.match(/github\.com\/([^/]+\/[^/]+)/)
  return m ? m[1] : url
}

interface SkillGroup { repoKey: string; repoUrl: string; skills: Skill[] }

const groupedSkills = (): SkillGroup[] => {
  const list = filteredSkills()
  const map = new Map<string, SkillGroup>()
  for (const s of list) {
    const key = getRepoKey(s.sourceUrl)
    if (!map.has(key)) {
      // 从 sourceUrl 还原仓库地址（去掉 /tree/xxx 子路径）
      let repoUrl = ''
      if (key !== '未注册') {
        const rm = s.sourceUrl.match(/(https:\/\/github\.com\/[^/]+\/[^/]+)/)
        repoUrl = rm ? rm[1] : s.sourceUrl
      }
      map.set(key, { repoKey: key, repoUrl, skills: [] })
    }
    map.get(key)!.skills.push(s)
  }
  // 有源地址的仓库排前，未注册排后
  const arr = Array.from(map.values())
  arr.sort((a, b) => {
    if (a.repoKey === '未注册') return 1
    if (b.repoKey === '未注册') return -1
    return b.skills.length - a.skills.length
  })
  return arr
}

const toggleGroupCollapse = (key: string) => {
  const s = new Set(collapsedGroups.value)
  if (s.has(key)) s.delete(key); else s.add(key)
  collapsedGroups.value = s
}

const batchUpdateGroup = async (group: SkillGroup) => {
  const updatableIds = group.skills.filter(s => s.sourceUrl !== '未注册').map(s => s.id)
  if (updatableIds.length === 0) return
  batchProcessing.value = true
  loading.value = true
  progressLogs.value = []
  try {
    if (window.preloadAPI) {
      const results = await window.preloadAPI.batchUpdateSkills(updatableIds, (msg: any) => {
        const c = msg.text.replace(/[\u001b\x1b]\[[0-9;?]*[A-Za-z]/gi, '').trim()
        if (c) progressLogs.value.push(c)
      })
      const summary = `仓库 ${group.repoKey} 更新: ${results.success.length} 成功, ${results.failed.length} 失败`
      if (window.ztools) window.ztools.showNotification(summary)
      else alert(summary)
      loadSkills()
    }
  } catch (e: any) { alert('更新异常: ' + e.message) }
  finally { loading.value = false; batchProcessing.value = false }
}

const confirmInstall = async () => {
  if (!previewData.value || selectedSkillNames.value.length === 0) return
  showInstallPrompt.value = false
  loading.value = true
  progressLogs.value = []
  const targets = [...selectedPaths.value]
  if (enableCustomPath.value && customPathVal.value.trim()) targets.push(customPathVal.value.trim())
  try {
    if (window.preloadAPI) {
      window.preloadAPI.installFromPreview(previewData.value, selectedSkillNames.value, targets, installUrl.value, (msg: any) => {
        const clean = msg.text.replace(/[\u001b\x1b]\[[0-9;?]*[A-Za-z]/gi, '').trim()
        if (clean) progressLogs.value.push(clean)
      })
      if (window.ztools) window.ztools.showNotification('安装与分发成功')
      loadSkills()
    }
  } catch (e: any) { alert("安装失败：" + e.message) }
  finally { loading.value = false; installUrl.value = ''; previewData.value = null }
}

const showDistributeModal = ref(false)
const distributionTargets = ref<Skill[]>([])
const distributionPaths = ref<string[]>([])

const openDistribute = (skill: Skill) => {
  distributionTargets.value = [skill]
  distributionPaths.value = [getAgentIdByPath(skill.localPath)]
  showDistributeModal.value = true
}

const batchDistribute = () => {
  const selected = skills.value.filter(s => batchSelected.value.includes(s.id))
  distributionTargets.value = selected
  distributionPaths.value = []
  showDistributeModal.value = true
}

const confirmDistribute = async () => {
  if (distributionTargets.value.length === 0 || distributionPaths.value.length === 0) return
  loading.value = true
  progressLogs.value = []
  try {
    if (window.preloadAPI) {
      for (const target of distributionTargets.value) {
        progressLogs.value.push(`正在同步 [${target.name}]...`)
        await window.preloadAPI.distributeSkill(target.id, distributionPaths.value)
      }
      if (window.ztools) window.ztools.showNotification(`同步完成：已分发 ${distributionTargets.value.length} 个技能`)
      showDistributeModal.value = false
      batchMode.value = false
      batchSelected.value = []
      loadSkills()
    }
  } catch (e: any) { alert('同步失败: ' + e.message) }
  finally { loading.value = false }
}

const refreshAll = async () => {
  if (window.preloadAPI) {
    loading.value = true
    try {
      skills.value = await window.preloadAPI.refreshRegistry()
    } finally {
      loading.value = false
    }
  } else {
    loadSkills()
  }
}

const getAgentNameById = (id: string) => {
  return supportedAgents.value.find(a => a.id === id)?.name || id
}

const cancelInstall = () => {
  showInstallPrompt.value = false
  if (previewData.value && window.preloadAPI) window.preloadAPI.cancelPreview(previewData.value.tempDir)
  previewData.value = null
}

const handleUpdate = async (id: string) => {
  loading.value = true; progressLogs.value = []
  try {
    if (window.preloadAPI) {
      await window.preloadAPI.updateSkill(id, (msg: any) => { const c = msg.text.replace(/[\u001b\x1b]\[[0-9;?]*[A-Za-z]/gi, '').trim(); if (c) progressLogs.value.push(c) })
      if (window.ztools) window.ztools.showNotification('更新成功')
      loadSkills()
    }
  } catch (e: any) { alert("更新失败: " + e.message) }
  finally { loading.value = false }
}

const handleDelete = async (id: string) => {
  if (confirm("是否确认删除该技能？")) {
    loading.value = true
    try { if (window.preloadAPI) { window.preloadAPI.uninstallSkill(id); if (window.ztools) window.ztools.showNotification('删除成功'); loadSkills() } }
    catch (e: any) { alert("删除失败：" + e.message) }
    finally { loading.value = false }
  }
}

const toggleSelectAll = () => {
  if (selectedSkillNames.value.length === availableSkills.value.length) selectedSkillNames.value = []
  else selectedSkillNames.value = availableSkills.value.map(s => s.name)
}

// === 批量操作 ===
const toggleBatchMode = () => {
  batchMode.value = !batchMode.value
  batchSelected.value = []
  batchResults.value = null
}

const toggleBatchItem = (id: string) => {
  const idx = batchSelected.value.indexOf(id)
  if (idx >= 0) batchSelected.value.splice(idx, 1)
  else batchSelected.value.push(id)
}

const toggleBatchAll = () => {
  const visible = filteredSkills()
  if (batchSelected.value.length === visible.length) batchSelected.value = []
  else batchSelected.value = visible.map(s => s.id)
}

const batchUpdate = async () => {
  if (batchSelected.value.length === 0) return
  batchProcessing.value = true
  loading.value = true
  progressLogs.value = []
  batchResults.value = null
  try {
    if (window.preloadAPI) {
      const results = await window.preloadAPI.batchUpdateSkills(batchSelected.value, (msg: any) => {
        const c = msg.text.replace(/[\u001b\x1b]\[[0-9;?]*[A-Za-z]/gi, '').trim()
        if (c) progressLogs.value.push(c)
      })
      batchResults.value = results
      const summary = `更新完成: ${results.success.length} 成功, ${results.failed.length} 失败`
      if (window.ztools) window.ztools.showNotification(summary)
      else alert(summary)
      loadSkills()
    }
  } catch (e: any) { alert('批量更新异常: ' + e.message) }
  finally { loading.value = false; batchProcessing.value = false }
}

const batchDelete = async () => {
  if (batchSelected.value.length === 0) return
  if (!confirm(`确认批量卸载 ${batchSelected.value.length} 个技能？此操作不可撤销。`)) return
  loading.value = true
  try {
    if (window.preloadAPI) {
      const results = window.preloadAPI.batchDeleteSkills(batchSelected.value)
      batchResults.value = results
      const summary = `卸载完成: ${results.success.length} 成功, ${results.failed.length} 失败`
      if (window.ztools) window.ztools.showNotification(summary)
      else alert(summary)
      loadSkills()
      batchSelected.value = []
    }
  } catch (e: any) { alert('批量卸载异常: ' + e.message) }
  finally { loading.value = false }
}

const showImportModal = ref(false)
const importConfigText = ref('')
const importFileRef = ref<HTMLInputElement | null>(null)
const handleExport = async () => {
  if (!window.preloadAPI) return
  const path = await window.preloadAPI.selectSavePath('skills-hub-backup.json')
  if (path) {
    try {
      const configJson = window.preloadAPI.exportSkillsConfig()
      const savedPath = window.preloadAPI.saveFileDialog(configJson, path)
      if (window.ztools) window.ztools.showNotification('配置已导出到: ' + savedPath)
    } catch (e: any) { alert('导出失败: ' + e.message) }
  }
}

const triggerImportFile = () => {
  importConfigText.value = ''
  showImportModal.value = true
}

const onImportFileChange = (e: Event) => {
  const input = e.target as HTMLInputElement
  if (!input.files || input.files.length === 0) return
  const reader = new FileReader()
  reader.onload = () => { importConfigText.value = reader.result as string }
  reader.readAsText(input.files[0])
}

const confirmImport = async () => {
  if (!importConfigText.value.trim()) return
  showImportModal.value = false
  loading.value = true
  progressLogs.value = []
  try {
    if (window.preloadAPI) {
      const results = await window.preloadAPI.importSkillsConfig(importConfigText.value, (msg: any) => {
        const c = msg.text.replace(/[\u001b\x1b]\[[0-9;?]*[A-Za-z]/gi, '').trim()
        if (c) progressLogs.value.push(c)
      })
      const summary = `导入完成: ${results.success.length} 成功, ${results.failed.length} 失败, ${results.skipped.length} 跳过`
      if (window.ztools) window.ztools.showNotification(summary)
      else alert(summary)
      loadSkills()
    }
  } catch (e: any) { alert('导入失败: ' + e.message) }
  finally { loading.value = false; importConfigText.value = '' }
}
</script>

<template>
  <div class="skills-container" :class="{ 'dark-theme': isDark }">
    <div class="elegant-background"></div>

    <div class="app-content">
      <header class="hero-section">
        <div class="brand-panel">
          <div class="brand">
            <div class="logo-box">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="logo-icon"><polygon points="12 2 2 7 12 12 22 7 12 2"></polygon><polyline points="2 17 12 22 22 17"></polyline><polyline points="2 12 12 17 22 12"></polyline></svg>
            </div>
            <div class="titles">
              <h2>AI Skills Hub</h2>
              <p>Intelligence Distribution Matrix</p>
            </div>
          </div>
          <div class="header-actions">
            <button class="btn-batch-toggle" :class="{ active: batchMode }" @click="toggleBatchMode" title="批量操作">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 11 12 14 22 4"></polyline><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path></svg>
              <span>批量</span>
            </button>
            <button class="btn-batch-toggle" @click="handleExport" title="导出配置">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
              <span>导出</span>
            </button>
            <button class="btn-batch-toggle" @click="triggerImportFile" title="导入配置">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
              <span>导入</span>
            </button>
            <div class="view-toggle">
               <button :class="{ active: viewMode === 'grid' }" @click="viewMode = 'grid'" title="卡片视图">
                 <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>
               </button>
               <button :class="{ active: viewMode === 'list' }" @click="viewMode = 'list'" title="列表视图">
                 <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
               </button>
               <button :class="{ active: viewMode === 'grouped' }" @click="viewMode = 'grouped'" title="按仓库分组">
                 <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
               </button>
            </div>
            <button class="btn-refresh" @click="refreshAll" :disabled="loading" title="全量审计并同步全机 AI 技能">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" :class="{ 'spin-anim': loading }"><path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
            </button>
          </div>
        </div>

        <div class="control-panel">
          <div class="input-glass search-box">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="glass-icon"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
            <input v-model="localSearch" placeholder="检索本地已装载..." />
          </div>

          <div class="input-glass install-box">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="glass-icon"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
            <input v-model="installUrl" placeholder="GitHub 源 (如: obra/superpowers)" @keyup.enter="handleInstall" :disabled="loading || previewLoading" />
            <button class="btn-glow" @click="handleInstall" :disabled="loading || previewLoading || !installUrl">
               <span v-if="!previewLoading">分发</span>
               <span v-else>扫描...</span>
            </button>
          </div>
        </div>
        <div class="filter-container">
          <div class="agent-filter-wrapper" :class="{ expanded: isAgentsExpanded }">
            <div class="agent-filter-row">
              <button 
                v-for="agentId in agentOptions" 
                :key="agentId"
                class="filter-chip"
                :class="{ active: selectedAgent === agentId }"
                @click="selectedAgent = agentId"
              >
                {{ agentId === 'all' ? '全部项目' : getAgentNameById(agentId) }}
                <span class="count-badge" v-if="selectedAgent === agentId || agentId === 'all'">
                  {{ agentId === 'all' ? skills.length : skills.filter(s => getAgentIdByPath(s.localPath) === agentId).length }}
                </span>
              </button>
            </div>
            <button class="btn-expand-agents" @click="isAgentsExpanded = !isAgentsExpanded">
              {{ isAgentsExpanded ? '收起' : '更多' }} 
              <svg :class="{ active: isAgentsExpanded }" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
            </button>
          </div>
        </div>
      </header>
      
      <!-- 加载层 -->
      <transition name="fade">
        <div v-if="loading || previewLoading" class="processing-layer">
          <div class="processing-card">
            <div class="loader-ripple"><div></div><div></div></div>
            <h3 class="gradient-text">{{ previewLoading ? '正在扫描仓库' : '组件部署中' }}</h3>
            <div class="terminal-logs-sleek" v-if="progressLogs.length > 0">
              <div v-for="(log, idx) in progressLogs.slice(-4)" :key="idx" class="sleek-log">
                <span class="log-cursor">❯</span> {{ log }}
              </div>
            </div>
          </div>
        </div>
      </transition>
      
      <!-- 主列表 -->
      <!-- 批量操作：全选栏 -->
      <transition name="fade">
        <div v-if="batchMode" class="batch-select-bar">
          <label class="batch-check-all" @click.prevent="toggleBatchAll">
            <span class="batch-checkbox" :class="{ checked: batchSelected.length > 0 && batchSelected.length === filteredSkills().length, partial: batchSelected.length > 0 && batchSelected.length < filteredSkills().length }"></span>
            <span v-if="batchSelected.length === 0">全选</span>
            <span v-else>已选 {{ batchSelected.length }} / {{ filteredSkills().length }}</span>
          </label>
        </div>
      </transition>

      <div v-if="viewMode !== 'grouped'" :class="viewMode === 'grid' ? 'grid-layout' : 'list-layout'">
        <div v-for="skill in filteredSkills()" :key="skill.id" class="glass-card" :class="[viewMode, { 'batch-selected': batchMode && batchSelected.includes(skill.id) }]" @click="batchMode ? toggleBatchItem(skill.id) : undefined">
          <div class="card-top">
            <span v-if="batchMode" class="batch-checkbox" :class="{ checked: batchSelected.includes(skill.id) }" @click.stop="toggleBatchItem(skill.id)"></span>
             <div class="card-icon">{{ skill.name.charAt(0).toUpperCase() }}</div>
             <div class="card-meta">
               <h3>{{ skill.name }}</h3>
               <div class="badge-row">
                 <span class="badge-tag">{{ getPathAlias(skill.localPath) }}</span>
                 <button class="btn-icon-link" @click.stop="openLocalPath(skill.localPath)" title="打开本地目录">
                   <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
                 </button>
               </div>
             </div>
          </div>
          <div class="card-body">
            <div class="info-row">
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>
              <span class="source-text" :title="skill.sourceUrl">{{ shortUrl(skill.sourceUrl) }}</span>
              <button v-if="skill.sourceUrl !== '本地/未托管'" class="btn-icon-link" @click.stop="openSourceUrl(skill.sourceUrl)" title="在浏览器中打开">
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
              </button>
            </div>
            <div class="info-row" :title="'安装时间: ' + new Date(skill.installedAt).toLocaleString()">
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="12" y1="8" x2="12" y2="16"></line><line x1="8" y1="12" x2="16" y2="12"></line></svg>
              <span>{{ new Date(skill.installedAt).toLocaleDateString() + ' ' + new Date(skill.installedAt).getHours() + ':' + new Date(skill.installedAt).getMinutes().toString().padStart(2, '0') }}</span>
            </div>
            <div class="info-row" :title="'更新时间: ' + new Date(skill.updatedAt).toLocaleString()">
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"></path></svg>
              <span>{{ new Date(skill.updatedAt).toLocaleDateString() + ' ' + new Date(skill.updatedAt).getHours() + ':' + new Date(skill.updatedAt).getMinutes().toString().padStart(2, '0') }}</span>
            </div>
          </div>
          <div class="card-footer">
            <button class="btn-ghost-primary" @click="handleUpdate(skill.id)" :disabled="loading" title="同步源端">
               <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
               <span v-if="viewMode === 'grid'">更新</span>
            </button>
            <button class="btn-ghost-danger" @click="handleDelete(skill.id)" :disabled="loading" title="卸载">
               <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
               <span v-if="viewMode === 'grid'">移除</span>
            </button>
          </div>
        </div>

        <div v-if="filteredSkills().length === 0" class="empty-state glass-card">
          <svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
          <p>尚未检测到已安装的技能</p>
        </div>
      </div>

      <!-- 分组视图 -->
      <div v-if="viewMode === 'grouped'" class="grouped-layout">
        <div v-for="group in groupedSkills()" :key="group.repoKey" class="repo-group">
          <div class="repo-group-header" @click="toggleGroupCollapse(group.repoKey)">
            <div class="repo-header-left">
              <span class="collapse-arrow" :class="{ collapsed: collapsedGroups.has(group.repoKey) }">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
              </span>
              <div class="repo-icon">
                <svg v-if="group.repoKey !== '本地/未托管'" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"></path></svg>
                <svg v-else xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
              </div>
              <div class="repo-header-info">
                <strong>{{ group.repoKey }}</strong>
                <span class="repo-count">{{ group.skills.length }} 个技能</span>
              </div>
            </div>
            <div class="repo-header-right">
              <button v-if="group.repoUrl" class="btn-icon-link repo-link-btn" @click.stop="openSourceUrl(group.repoUrl)" title="打开仓库">
                <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
              </button>
              <button v-if="group.repoUrl" class="btn-group-update" @click.stop="batchUpdateGroup(group)" :disabled="loading" title="更新该仓库全部技能">
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
                 同步全组
              </button>
            </div>
          </div>
          <transition name="group-collapse">
            <div v-show="!collapsedGroups.has(group.repoKey)" class="repo-group-body">
              <div class="group-children-list">
                <div v-for="skill in group.skills" :key="skill.id" class="group-child-card">
                  <div class="child-left">
                    <div class="child-icon">{{ skill.name.charAt(0).toUpperCase() }}</div>
                    <div class="child-info">
                      <strong>{{ skill.name }}</strong>
                      <span class="child-badges">
                        <span class="badge-tag small">{{ getPathAlias(skill.localPath) }}</span>
                      </span>
                    </div>
                  </div>
                  <div class="child-right">
                    <span class="child-date">{{ new Date(skill.updatedAt).toLocaleDateString() + ' ' + new Date(skill.updatedAt).getHours() + ':' + new Date(skill.updatedAt).getMinutes().toString().padStart(2, '0') }}</span>
                    <button class="btn-icon-sm" @click="openLocalPath(skill.localPath)" title="打开目录">
                      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
                    </button>
                    <button class="btn-icon-sm primary" @click="handleUpdate(skill.id)" :disabled="loading" title="同步源码更新">
                      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
                    </button>
                    <button class="btn-icon-sm" @click="openDistribute(skill)" :disabled="loading" title="分发到其他 Agent">
                      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg>
                    </button>
                    <button class="btn-icon-sm danger" @click="handleDelete(skill.id)" :disabled="loading" title="移除技能">
                      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </transition>
        </div>

        <div v-if="groupedSkills().length === 0" class="empty-state glass-card">
          <svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
          <p>尚未检测到已安装的技能</p>
        </div>
      </div>

      <!-- 批量操作悬浮栏 -->
      <transition name="batch-bar">
        <div v-if="batchMode && batchSelected.length > 0" class="batch-action-bar">
          <div class="batch-bar-inner">
            <div class="batch-bar-info">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 11 12 14 22 4"></polyline><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path></svg>
              <span>已选中 <strong>{{ batchSelected.length }}</strong> 项</span>
            </div>
            <div class="batch-bar-actions">
              <button class="batch-btn batch-btn-sync" @click="batchDistribute" :disabled="batchProcessing">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg>
                批量分发
              </button>
              <button class="batch-btn batch-btn-update" @click="batchUpdate" :disabled="batchProcessing">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
                批量更新
              </button>
              <button class="batch-btn batch-btn-delete" @click="batchDelete" :disabled="batchProcessing">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                 批量移除
              </button>
              <button class="batch-btn batch-btn-cancel" @click="toggleBatchMode">
                取消
              </button>
            </div>
          </div>
        </div>
      </transition>
    </div>
    
    <!-- 分发模态框 -->
    <transition name="modal-scale">
      <div v-if="showDistributeModal" class="glass-modal-overlay">
        <div class="glass-modal">
          <div class="modal-header-sleek">
            <h3>跨平台分发</h3>
            <p v-if="distributionTargets.length === 1">将技能 [{{ distributionTargets[0].name }}] 同步到本地其他 Agent 目录</p>
            <p v-else>正在进行批量分发: 共选中 {{ distributionTargets.length }} 项技能</p>
          </div>
          <div class="modal-body-scroller">
            <div class="section-title">
              <span>🚀 目标 Agent 平台</span>
            </div>
            <div class="path-grid full-agent-grid">
               <label class="glass-checkbox" v-for="agent in supportedAgents" :key="agent.id">
                <input type="checkbox" v-model="distributionPaths" :value="agent.id">
                <span class="custom-check"></span>
                <div class="check-info">
                  <span class="check-label">{{ agent.name }}</span>
                </div>
              </label>
            </div>
          </div>
          <div class="modal-footer-sleek">
            <button class="btn-cancel" @click="showDistributeModal = false">取消</button>
            <button class="btn-confirm" @click="confirmDistribute" :disabled="loading">
              {{ loading ? '正在分发...' : '立即同步' }}
            </button>
          </div>
        </div>
      </div>
    </transition>

    <!-- 安装模态框 -->
    <transition name="modal-scale">
      <div v-if="showInstallPrompt" class="glass-modal-overlay">
        <div class="glass-modal">
          <div class="modal-header-sleek">
            <h3>选择待安装技能</h3>
            <p>发现 {{ availableSkills.length }} 个可用技能</p>
          </div>
          
          <div class="modal-body-scroller">
            <div class="section-title">
              <span>📦 可用技能</span>
              <button class="btn-select-all" @click="toggleSelectAll">
                {{ selectedSkillNames.length === availableSkills.length ? '取消全选' : '全选' }}
              </button>
            </div>
            <div class="path-grid">
              <label class="glass-checkbox" v-for="sk in availableSkills" :key="sk.name">
                <input type="checkbox" v-model="selectedSkillNames" :value="sk.name">
                <span class="custom-check"></span>
                <div class="check-info">
                  <strong>{{ sk.name }}</strong>
                  <span>{{ sk.path }}</span>
                </div>
              </label>
            </div>

            <div class="section-title" style="margin-top: 16px;">
              <span>🎯 安装目标</span>
            </div>
            <div class="path-grid full-agent-grid">
              <label class="glass-checkbox" v-for="agent in supportedAgents" :key="agent.id">
                <input type="checkbox" v-model="selectedPaths" :value="agent.id">
                <span class="custom-check"></span>
                <div class="check-info">
                  <strong>{{ agent.name }}</strong>
                  <span>~/{{ agent.path }}</span>
                </div>
              </label>
              <label class="glass-checkbox">
                <input type="checkbox" v-model="enableCustomPath">
                <span class="custom-check"></span>
                <div class="check-info">
                  <strong>自建路径</strong>
                  <span>手动指定完整目录</span>
                </div>
              </label>
            </div>
            <div class="custom-input-wrap" :class="{ 'visible': enableCustomPath }">
              <input type="text" v-model="customPathVal" placeholder="D:\Agents\skills" />
            </div>
          </div>

          <div class="modal-footer-sleek">
            <button class="btn-cancel" @click="cancelInstall">取消</button>
            <button class="btn-confirm" @click="confirmInstall" :disabled="selectedSkillNames.length === 0 || (selectedPaths.length === 0 && (!enableCustomPath || !customPathVal))">
              确认并安装于 {{ selectedPaths.length + (enableCustomPath ? 1 : 0) }} 个目标
            </button>
          </div>
        </div>
      </div>
    </transition>
    <!-- 导入配置模态框 -->
    <transition name="modal-scale">
      <div v-if="showImportModal" class="glass-modal-overlay">
        <div class="glass-modal large">
          <div class="modal-header-sleek">
            <h3>导入技能配置</h3>
            <p>粘贴 JSON 配置内容或选择文件以批量同步技能</p>
          </div>
          
          <div class="modal-body-scroller">
            <div class="import-area">
              <textarea 
                v-model="importConfigText" 
                class="import-textarea" 
                placeholder='在此粘贴 {"version": 1, "repositories": [...] } 格式的配置'
              ></textarea>
              <div class="import-file-actions">
                <input 
                  type="file" 
                  ref="importFileRef" 
                  style="display: none" 
                  accept=".json" 
                  @change="onImportFileChange"
                />
                <button class="btn-ghost-primary" @click="importFileRef?.click()">
                   <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                   选择 JSON 文件
                </button>
              </div>
            </div>
            
            <div v-if="importConfigText" class="import-preview-info">
               <p>⚠️ 注意：导入将根据配置中的仓库地址重新从 GitHub 克隆并安装。此过程可能因网络状况需要一些时间。</p>
            </div>
          </div>

          <div class="modal-footer-sleek">
            <button class="btn-cancel" @click="showImportModal = false">取消</button>
            <button class="btn-confirm" @click="confirmImport" :disabled="!importConfigText.trim()">
              开始导入同步
            </button>
          </div>
        </div>
      </div>
    </transition>
  </div>
</template>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');

.skills-container { min-height: 100vh; font-family: 'Inter', -apple-system, sans-serif; color: #1a1a2e; position: relative; background-color: #f8fafc; overflow-x: hidden; margin: -0.5rem; }
.skills-container.dark-theme { color: #e2e8f0; background-color: #0b0f19; }

.elegant-background { position: fixed; top: 0; left: 0; right: 0; bottom: 0; z-index: 0; pointer-events: none; }
.elegant-background::before { content: ''; position: absolute; top: -20vh; left: -10vw; width: 50vw; height: 50vw; background: radial-gradient(circle, rgba(99,102,241,0.05) 0%, transparent 70%); border-radius: 50%; }
.elegant-background::after { content: ''; position: absolute; bottom: -20vh; right: -10vw; width: 45vw; height: 45vw; background: radial-gradient(circle, rgba(14,165,233,0.05) 0%, transparent 70%); border-radius: 50%; }
.skills-container.dark-theme .elegant-background::before { background: radial-gradient(circle, rgba(99,102,241,0.1) 0%, transparent 70%); }
.skills-container.dark-theme .elegant-background::after { background: radial-gradient(circle, rgba(14,165,233,0.1) 0%, transparent 70%); }

.app-content { position: relative; z-index: 10; max-width: 1100px; margin: 0 auto; padding: 20px 20px; }

/* Header - Compact */
.hero-section { display: flex; flex-direction: column; gap: 14px; margin-bottom: 20px; }
.brand-panel { display: flex; align-items: center; justify-content: space-between; }
.brand { display: flex; align-items: center; gap: 12px; }
.logo-box { width: 36px; height: 36px; background: linear-gradient(135deg, #6366f1, #0ea5e9); border-radius: 10px; display: flex; justify-content: center; align-items: center; color: white; box-shadow: 0 4px 12px rgba(99,102,241,0.25); flex-shrink: 0; }
.logo-icon { width: 18px; height: 18px; }
.titles h2 { font-size: 18px; font-weight: 800; margin: 0; letter-spacing: -0.3px; background: linear-gradient(135deg, #1e293b, #475569); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
.skills-container.dark-theme .titles h2 { background: linear-gradient(135deg, #fff, #cbd5e1); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
.titles p { margin: 0; font-size: 11px; color: #94a3b8; font-weight: 500; }

.control-panel { display: flex; gap: 10px; }
.input-glass { display: flex; align-items: center; background: rgba(255,255,255,0.7); backdrop-filter: blur(12px); border: 1px solid rgba(226,232,240,0.8); border-radius: 8px; padding: 5px 6px 5px 10px; transition: all 0.2s; }
.input-glass:focus-within { border-color: rgba(99,102,241,0.5); box-shadow: 0 0 0 3px rgba(99,102,241,0.08); }
.skills-container.dark-theme .input-glass { background: rgba(30,41,59,0.5); border-color: rgba(51,65,85,0.6); }
.glass-icon { color: #94a3b8; margin-right: 8px; flex-shrink: 0; }
.input-glass input { background: transparent; border: none; outline: none; font-size: 12px; font-family: inherit; color: inherit; width: 100%; min-width: 120px; }
.install-box { flex: 1; }
.input-glass input::placeholder { color: #b0b8c4; }

.btn-glow { background: linear-gradient(135deg, #6366f1, #4f46e5); color: white; border: none; border-radius: 6px; padding: 5px 14px; font-weight: 600; font-size: 12px; cursor: pointer; box-shadow: 0 2px 8px rgba(79,70,229,0.3); transition: all 0.2s; white-space: nowrap; }
.btn-glow:hover:not(:disabled) { box-shadow: 0 4px 14px rgba(79,70,229,0.45); transform: translateY(-1px); }
.btn-glow:disabled { background: #94a3b8; box-shadow: none; cursor: not-allowed; opacity: 0.6; }

.view-toggle { display: flex; gap: 2px; background: rgba(226,232,240,0.5); padding: 3px; border-radius: 6px; }
.skills-container.dark-theme .view-toggle { background: rgba(51,65,85,0.5); }
.view-toggle button { background: transparent; border: none; padding: 4px; border-radius: 4px; cursor: pointer; color: #94a3b8; display: flex; align-items: center; justify-content: center; transition: all 0.2s; }
.view-toggle button.active { background: white; color: #4f46e5; box-shadow: 0 1px 2px rgba(0,0,0,0.08); }
.skills-container.dark-theme .view-toggle button.active { background: #1e293b; color: #818cf8; }

/* Grid & Cards - Compact */
.grid-layout { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; }
.list-layout { display: flex; flex-direction: column; gap: 6px; }

.glass-card { background: rgba(255,255,255,0.8); backdrop-filter: blur(16px); border: 1px solid rgba(226,232,240,0.7); border-radius: 12px; padding: 14px; display: flex; flex-direction: column; gap: 10px; transition: all 0.25s cubic-bezier(0.4,0,0.2,1); box-shadow: 0 1px 3px rgba(0,0,0,0.02); }
.glass-card:hover { transform: translateY(-2px); box-shadow: 0 8px 20px rgba(0,0,0,0.04); border-color: rgba(99,102,241,0.25); }
.skills-container.dark-theme .glass-card { background: rgba(30,41,59,0.45); border: 1px solid rgba(51,65,85,0.5); }
.skills-container.dark-theme .glass-card:hover { border-color: rgba(99,102,241,0.4); box-shadow: 0 8px 20px rgba(0,0,0,0.2); }

.card-top { display: flex; align-items: center; gap: 10px; }
.card-icon { width: 34px; height: 34px; background: linear-gradient(135deg, #1e293b, #475569); color: white; border-radius: 8px; display: flex; justify-content: center; align-items: center; font-size: 14px; font-weight: 800; text-transform: uppercase; flex-shrink: 0; }
.skills-container.dark-theme .card-icon { background: linear-gradient(135deg, #334155, #475569); }
.card-meta h3 { margin: 0 0 3px; font-size: 13px; font-weight: 700; letter-spacing: -0.2px; line-height: 1.2; word-break: break-all; }
.badge-tag { display: inline-flex; white-space: nowrap; background: rgba(16,185,129,0.08); color: #059669; padding: 2px 7px; border-radius: 10px; font-size: 10px; font-weight: 700; border: 1px solid rgba(16,185,129,0.15); }
.skills-container.dark-theme .badge-tag { color: #34d399; background: rgba(52,211,153,0.08); border-color: rgba(52,211,153,0.15); }
.badge-row { display: flex; align-items: center; gap: 4px; }

.card-body { display: flex; flex-direction: column; gap: 5px; flex-grow: 1; }
.info-row { display: flex; align-items: center; gap: 6px; color: #64748b; font-size: 11px; font-weight: 500; min-width: 0; }
.skills-container.dark-theme .info-row { color: #94a3b8; }
.info-row svg { opacity: 0.6; flex-shrink: 0; }
.info-row .source-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0; text-align: left; }
.info-row span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left; }

/* External link button */
.btn-icon-link { background: none; border: none; cursor: pointer; color: #94a3b8; padding: 2px; border-radius: 4px; display: flex; align-items: center; justify-content: center; transition: all 0.15s; flex-shrink: 0; opacity: 0.6; }
.btn-icon-link:hover { color: #6366f1; opacity: 1; background: rgba(99,102,241,0.08); }
.skills-container.dark-theme .btn-icon-link:hover { color: #818cf8; }

.card-footer { display: flex; gap: 8px; margin-top: auto; padding-top: 10px; border-top: 1px solid rgba(226,232,240,0.6); }
.skills-container.dark-theme .card-footer { border-color: rgba(51,65,85,0.5); }
.btn-ghost-primary, .btn-ghost-danger { flex: 1; padding: 6px 0; border-radius: 6px; font-weight: 600; font-size: 11px; cursor: pointer; transition: all 0.2s; background: transparent; display: flex; justify-content: center; align-items: center; gap: 4px; }
.btn-ghost-primary { border: 1px solid rgba(99,102,241,0.25); color: #4f46e5; }
.btn-ghost-primary:hover { background: rgba(99,102,241,0.06); border-color: rgba(99,102,241,0.6); }
.skills-container.dark-theme .btn-ghost-primary { color: #818cf8; border-color: rgba(99,102,241,0.25); }
.btn-ghost-danger { border: 1px solid rgba(239,68,68,0.25); color: #ef4444; }
.btn-ghost-danger:hover { background: rgba(239,68,68,0.06); border-color: rgba(239,68,68,0.6); }
.skills-container.dark-theme .btn-ghost-danger { color: #f87171; border-color: rgba(239,68,68,0.25); }

/* List Mode */
.glass-card.list { flex-direction: row; align-items: center; justify-content: flex-start; padding: 10px 14px; gap: 12px; }
.glass-card.list .card-top { flex: 0 0 360px; min-width: 0; display: flex; align-items: center; justify-content: flex-start; }
.glass-card.list .card-icon { width: 28px; height: 28px; font-size: 12px; border-radius: 6px; }
.glass-card.list .card-meta { display: flex; flex-direction: row; align-items: center; justify-content: flex-start; gap: 8px; overflow: hidden; width: 100%; text-align: left; }
.glass-card.list .card-meta h3 { margin: 0; font-size: 13px; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 0 1 auto; text-align: left; }
.glass-card.list .card-body { flex-direction: row; align-items: center; gap: 16px; flex: 1; min-width: 0; }
.glass-card.list .card-body .info-row { flex: 0 0 120px; min-width: 0; }
.glass-card.list .card-body .info-row:first-child { flex: 1; }
.glass-card.list .card-footer { margin-top: 0; padding-top: 0; border-top: none; gap: 6px; flex: 0 0 auto; width: 110px; justify-content: flex-end; }
.glass-card.list .card-footer button { padding: 5px; flex: none; width: 30px; height: 30px; }
.glass-card.list .card-footer button span { display: none; }

@media (max-width: 640px) {
  .brand-panel { flex-direction: column; align-items: flex-start; gap: 10px; }
  .control-panel { flex-direction: column; }
  .glass-card.list { flex-direction: column; align-items: stretch; }
  .glass-card.list .card-top { flex: auto; }
  .glass-card.list .card-body { flex-direction: column; gap: 5px; align-items: flex-start; }
  .glass-card.list .card-footer { border-top: 1px solid rgba(226,232,240,0.6); padding-top: 10px; width: 100%; }
  .glass-card.list .card-footer button { flex: 1; width: auto; }
}

.empty-state { align-items: center; justify-content: center; text-align: center; color: #94a3b8; padding: 40px 16px; grid-column: 1 / -1; }
.empty-state p { margin-top: 12px; font-weight: 500; font-size: 13px; }

/* Modal - Compact */
.glass-modal-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(15,23,42,0.5); backdrop-filter: blur(6px); display: flex; justify-content: center; align-items: center; z-index: 2000; }
.glass-modal { background: rgba(255,255,255,0.96); border: 1px solid rgba(226,232,240,0.8); box-shadow: 0 20px 40px rgba(0,0,0,0.15); border-radius: 16px; padding: 20px 24px; width: 460px; max-width: 92vw; max-height: 85vh; display: flex; flex-direction: column; }
.skills-container.dark-theme .glass-modal { background: rgba(30,41,59,0.96); border-color: rgba(51,65,85,0.8); box-shadow: 0 20px 40px rgba(0,0,0,0.4); }
.modal-header-sleek h3 { margin: 0 0 4px; font-size: 16px; font-weight: 800; letter-spacing: -0.3px; }
.modal-header-sleek p { margin: 0 0 14px; color: #64748b; font-size: 12px; font-weight: 500; }
.skills-container.dark-theme .modal-header-sleek p { color: #94a3b8; }

.section-title { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; font-size: 12px; font-weight: 700; color: #475569; }
.skills-container.dark-theme .section-title { color: #94a3b8; }
.btn-select-all { background: none; border: 1px solid rgba(99,102,241,0.3); color: #6366f1; padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 600; cursor: pointer; transition: all 0.15s; }
.btn-select-all:hover { background: rgba(99,102,241,0.08); }

.modal-body-scroller { overflow-y: auto; padding-right: 6px; margin-right: -6px; margin-bottom: 16px; max-height: 55vh; }
.modal-body-scroller::-webkit-scrollbar { width: 4px; }
.modal-body-scroller::-webkit-scrollbar-thumb { background: rgba(148,163,184,0.4); border-radius: 4px; }

.path-grid { display: flex; flex-direction: column; gap: 5px; }
.full-agent-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
@media (max-width: 400px) { .full-agent-grid { grid-template-columns: 1fr; } }
.glass-checkbox { position: relative; display: flex; align-items: center; gap: 10px; cursor: pointer; padding: 8px 10px; border-radius: 8px; background: rgba(248,250,252,0.5); border: 1px solid rgba(226,232,240,0.7); transition: all 0.15s; }
.skills-container.dark-theme .glass-checkbox { background: rgba(15,23,42,0.3); border-color: rgba(51,65,85,0.5); }
.glass-checkbox:hover { border-color: rgba(99,102,241,0.4); background: rgba(99,102,241,0.03); }
.glass-checkbox input { position: absolute; opacity: 0; cursor: pointer; height: 0; width: 0; }
.custom-check { height: 18px; width: 18px; border-radius: 4px; background: transparent; border: 2px solid #cbd5e1; transition: all 0.15s; position: relative; flex-shrink: 0; }
.skills-container.dark-theme .custom-check { border-color: #475569; }
.glass-checkbox:hover input ~ .custom-check { border-color: #818cf8; }
.glass-checkbox input:checked ~ .custom-check { background: #6366f1; border-color: #6366f1; }
.custom-check:after { content: ""; position: absolute; display: none; left: 5px; top: 2px; width: 4px; height: 8px; border: solid white; border-width: 0 2px 2px 0; transform: rotate(45deg); }
.glass-checkbox input:checked ~ .custom-check:after { display: block; }
.check-info strong { display: block; font-size: 12px; font-weight: 600; color: #1e293b; }
.skills-container.dark-theme .check-info strong { color: #f1f5f9; }
.check-info span { display: block; font-size: 10px; color: #94a3b8; font-family: 'Consolas', monospace; margin-top: 1px; }

.custom-input-wrap { margin-top: 8px; max-height: 0; overflow: hidden; opacity: 0; transition: all 0.25s; }
.custom-input-wrap.visible { max-height: 50px; opacity: 1; overflow: visible; }
.custom-input-wrap input { width: 100%; padding: 8px 12px; border-radius: 8px; border: 1px solid rgba(99,102,241,0.4); background: rgba(255,255,255,0.5); outline: none; font-size: 12px; box-sizing: border-box; }
.skills-container.dark-theme .custom-input-wrap input { background: rgba(15,23,42,0.5); color: white; }
.path-hint { font-size: 10px; color: #94a3b8; margin-top: 6px; line-height: 1.4; }

.modal-actions-sleek, .modal-footer-sleek { flex-shrink: 0; display: flex; justify-content: flex-end; gap: 14px; padding-top: 10px; border-top: 1px solid rgba(226, 232, 240, 0.5); }
.skills-container.dark-theme .modal-actions-sleek, .skills-container.dark-theme .modal-footer-sleek { border-top-color: rgba(51, 65, 85, 0.4); }

.btn-cancel, .btn-cancel-glass { background: rgba(148, 163, 184, 0.1); color: #64748b; border: 1px solid rgba(148, 163, 184, 0.2); border-radius: 8px; padding: 8px 20px; font-weight: 600; font-size: 13px; cursor: pointer; transition: all 0.2s; }
.btn-cancel:hover, .btn-cancel-glass:hover { background: rgba(148, 163, 184, 0.2); color: #334155; }
.skills-container.dark-theme .btn-cancel, .skills-container.dark-theme .btn-cancel-glass { color: #94a3b8; background: rgba(148, 163, 184, 0.08); border-color: rgba(148, 163, 184, 0.15); }
.skills-container.dark-theme .btn-cancel:hover { color: #f1f5f9; background: rgba(148, 163, 184, 0.15); }

.btn-confirm { background: linear-gradient(135deg, #6366f1, #4f46e5); color: white; border: none; border-radius: 8px; padding: 8px 24px; font-weight: 600; font-size: 13px; cursor: pointer; transition: all 0.2s; box-shadow: 0 4px 12px rgba(79, 70, 229, 0.2); }
.btn-confirm:hover { transform: translateY(-1px); box-shadow: 0 6px 16px rgba(79, 70, 229, 0.35); }
.btn-confirm:disabled { opacity: 0.5; transform: none; box-shadow: none; cursor: not-allowed; }

/* Processing */
.processing-layer { position: fixed; top: 0; left: 0; right: 0; bottom: 0; z-index: 1000; display: flex; justify-content: center; align-items: center; background: rgba(15,23,42,0.5); backdrop-filter: blur(10px); }
.processing-card { background: rgba(30,41,59,0.95); border: 1px solid rgba(51,65,85,0.8); padding: 30px; border-radius: 16px; width: 400px; max-width: 90vw; box-shadow: 0 20px 40px rgba(0,0,0,0.3); text-align: center; color: white; }
.loader-ripple { display: inline-block; position: relative; width: 56px; height: 56px; margin-bottom: 16px; }
.loader-ripple div { position: absolute; border: 3px solid #6366f1; opacity: 1; border-radius: 50%; animation: loader-ripple 1s cubic-bezier(0,0.2,0.8,1) infinite; }
.loader-ripple div:nth-child(2) { animation-delay: -0.5s; }
@keyframes loader-ripple { 0% { top: 24px; left: 24px; width: 0; height: 0; opacity: 0; } 5% { opacity: 1; } 100% { top: 0; left: 0; width: 48px; height: 48px; opacity: 0; } }
.gradient-text { font-size: 15px; font-weight: 700; margin: 0 0 16px; background: linear-gradient(135deg, #818cf8, #38bdf8); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
.terminal-logs-sleek { background: #0f172a; padding: 12px; border-radius: 10px; text-align: left; border: 1px solid #1e293b; font-family: 'Consolas', monospace; font-size: 11px; color: #38bdf8; max-height: 140px; overflow-y: auto; word-break: break-all; }
.terminal-logs-sleek::-webkit-scrollbar { width: 4px; }
.terminal-logs-sleek::-webkit-scrollbar-thumb { background: rgba(99,102,241,0.4); border-radius: 4px; }
.sleek-log { margin-bottom: 4px; line-height: 1.3; opacity: 0.7; }
.sleek-log:last-child { opacity: 1; color: #a5b4fc; }
.log-cursor { color: #4ade80; margin-right: 6px; }

.modal-scale-enter-active, .modal-scale-leave-active { transition: all 0.25s cubic-bezier(0.4,0,0.2,1); }
.modal-scale-enter-from, .modal-scale-leave-to { opacity: 0; transform: scale(0.96); }
.fade-enter-active, .fade-leave-active { transition: opacity 0.25s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

/* Batch Mode */
.header-actions { display: flex; align-items: center; gap: 8px; }
.btn-batch-toggle { display: flex; align-items: center; gap: 5px; background: transparent; border: 1px solid rgba(226,232,240,0.8); color: #64748b; padding: 4px 10px; border-radius: 6px; font-size: 11px; font-weight: 600; cursor: pointer; transition: all 0.2s; font-family: inherit; }
.btn-batch-toggle:hover { border-color: rgba(99,102,241,0.4); color: #4f46e5; background: rgba(99,102,241,0.04); }
.btn-batch-toggle.active { background: rgba(99,102,241,0.1); border-color: rgba(99,102,241,0.5); color: #4f46e5; }
.skills-container.dark-theme .btn-batch-toggle { border-color: rgba(51,65,85,0.6); color: #94a3b8; }

.agent-filter-row { display: flex; align-items: center; gap: 8px 6px; flex-wrap: wrap; }
.filter-container { margin: 8px 0; border-bottom: 1px solid rgba(226, 232, 240, 0.4); padding-bottom: 12px; }
.skills-container.dark-theme .filter-container { border-bottom-color: rgba(51, 65, 85, 0.3); }

.agent-filter-wrapper { position: relative; max-height: 28px; overflow: hidden; transition: max-height 0.4s cubic-bezier(0.4, 0, 0.2, 1); padding-right: 75px; }
.agent-filter-wrapper.expanded { max-height: 400px; }

.btn-expand-agents { position: absolute; right: 0; top: 0; height: 26px; display: flex; align-items: center; gap: 4px; background: rgba(226, 232, 240, 0.6); border: 1px solid rgba(226, 232, 240, 0.8); border-radius: 6px; color: #64748b; font-size: 11px; font-weight: 700; cursor: pointer; padding: 0 10px; transition: all 0.2s; z-index: 10; }
.skills-container.dark-theme .btn-expand-agents { background: rgba(30, 41, 59, 0.8); border-color: rgba(51, 65, 85, 0.6); color: #94a3b8; }
.btn-expand-agents:hover { background: rgba(99, 102, 241, 0.1); border-color: rgba(99, 102, 241, 0.4); color: #4f46e5; }
.btn-expand-agents svg { transition: transform 0.3s; }
.btn-expand-agents svg.active { transform: rotate(180deg); }

.filter-chip { background: transparent; border: 1px solid rgba(226, 232, 240, 0.8); color: #64748b; padding: 4px 12px; border-radius: 20px; font-size: 11px; font-weight: 600; cursor: pointer; transition: all 0.2s; display: flex; align-items: center; gap: 6px; white-space: nowrap; height: 26px; box-sizing: border-box; }
.skills-container.dark-theme .filter-chip { border-color: rgba(51, 65, 85, 0.6); color: #94a3b8; }
.filter-chip:hover { border-color: rgba(99,102,241,0.4); color: #4f46e5; background: rgba(99,102,241,0.04); }
.filter-chip.active { background: #6366f1; border-color: #6366f1; color: white; box-shadow: 0 4px 10px rgba(99,102,241,0.2); }
.count-badge { font-size: 9px; background: rgba(148,163,184,0.15); color: #64748b; padding: 1px 6px; border-radius: 10px; min-width: 14px; text-align: center; font-weight: 800; }
.skills-container.dark-theme .count-badge { background: rgba(255,255,255,0.1); color: #94a3b8; }
.filter-chip.active .count-badge { background: white; color: #6366f1; }
.skills-container.dark-theme .btn-batch-toggle:hover, .skills-container.dark-theme .btn-batch-toggle.active { color: #818cf8; border-color: rgba(99,102,241,0.4); background: rgba(99,102,241,0.08); }

.batch-select-bar { display: flex; align-items: center; margin-bottom: 8px; padding: 6px 12px; background: rgba(99,102,241,0.06); border: 1px solid rgba(99,102,241,0.15); border-radius: 8px; }
.skills-container.dark-theme .batch-select-bar { background: rgba(99,102,241,0.08); border-color: rgba(99,102,241,0.2); }
.batch-check-all { display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 12px; font-weight: 600; color: #4f46e5; user-select: none; }
.skills-container.dark-theme .batch-check-all { color: #818cf8; }

.batch-checkbox { width: 18px; height: 18px; border-radius: 4px; border: 2px solid #cbd5e1; position: relative; flex-shrink: 0; transition: all 0.15s; cursor: pointer; display: inline-block; box-sizing: border-box; }
.skills-container.dark-theme .batch-checkbox { border-color: #475569; }
.batch-checkbox:hover { border-color: #818cf8; }
.batch-checkbox.checked { background: #6366f1; border-color: #6366f1; }
.batch-checkbox.checked::after { content: ''; position: absolute; left: 5px; top: 2px; width: 4px; height: 8px; border: solid white; border-width: 0 2px 2px 0; transform: rotate(45deg); }
.batch-checkbox.partial { background: #6366f1; border-color: #6366f1; }
.batch-checkbox.partial::after { content: ''; position: absolute; left: 3px; top: 6px; width: 8px; height: 2px; background: white; border-radius: 1px; }

.glass-card.batch-selected { border-color: rgba(99,102,241,0.5) !important; background: rgba(99,102,241,0.04); }
.skills-container.dark-theme .glass-card.batch-selected { background: rgba(99,102,241,0.08); border-color: rgba(99,102,241,0.4) !important; }

.batch-action-bar { position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); z-index: 1500; width: auto; max-width: 90vw; }
.batch-bar-inner { display: flex; align-items: center; gap: 16px; background: rgba(30,41,59,0.95); backdrop-filter: blur(16px); border: 1px solid rgba(99,102,241,0.3); padding: 10px 20px; border-radius: 14px; box-shadow: 0 12px 40px rgba(0,0,0,0.3), 0 0 0 1px rgba(99,102,241,0.1); color: white; }
.batch-bar-info { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 500; white-space: nowrap; color: #cbd5e1; }
.batch-bar-info strong { color: #a5b4fc; }
.batch-bar-info svg { color: #818cf8; }
.batch-bar-actions { display: flex; gap: 8px; }

.batch-btn { display: flex; align-items: center; gap: 6px; border: none; border-radius: 8px; padding: 7px 14px; font-weight: 600; font-size: 12px; cursor: pointer; transition: all 0.2s; font-family: inherit; white-space: nowrap; }
.batch-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.batch-btn-update { background: linear-gradient(135deg, #6366f1, #4f46e5); color: white; box-shadow: 0 2px 8px rgba(79,70,229,0.3); }
.batch-btn-sync { background: linear-gradient(135deg, #ec4899, #d946ef); color: white; box-shadow: 0 2px 8px rgba(217,70,239,0.3); }
.batch-btn-sync:hover:not(:disabled) { box-shadow: 0 4px 14px rgba(217,70,239,0.45); transform: translateY(-1px); }
.batch-btn-update:hover:not(:disabled) { box-shadow: 0 4px 14px rgba(79,70,229,0.45); transform: translateY(-1px); }
.batch-btn-delete { background: rgba(239,68,68,0.15); color: #f87171; border: 1px solid rgba(239,68,68,0.3); }
.batch-btn-delete:hover:not(:disabled) { background: rgba(239,68,68,0.25); }
.batch-btn-cancel { background: rgba(148,163,184,0.15); color: #94a3b8; }
.batch-btn-cancel:hover { background: rgba(148,163,184,0.25); color: #cbd5e1; }

.batch-bar-enter-active, .batch-bar-leave-active { transition: all 0.3s cubic-bezier(0.4,0,0.2,1); }
.batch-bar-enter-from, .batch-bar-leave-to { opacity: 0; transform: translateX(-50%) translateY(20px); }

/* Grouped View */
.grouped-layout { display: flex; flex-direction: column; gap: 12px; }

.repo-group { background: rgba(255,255,255,0.6); backdrop-filter: blur(16px); border: 1px solid rgba(226,232,240,0.7); border-radius: 12px; overflow: hidden; transition: all 0.25s; }
.repo-group:hover { border-color: rgba(99,102,241,0.2); }
.skills-container.dark-theme .repo-group { background: rgba(30,41,59,0.4); border-color: rgba(51,65,85,0.5); }
.skills-container.dark-theme .repo-group:hover { border-color: rgba(99,102,241,0.3); }

.repo-group-header { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; cursor: pointer; user-select: none; transition: background 0.15s; }
.repo-group-header:hover { background: rgba(99,102,241,0.03); }
.skills-container.dark-theme .repo-group-header:hover { background: rgba(99,102,241,0.05); }

.repo-header-left { display: flex; align-items: center; gap: 10px; }

.collapse-arrow { display: flex; align-items: center; justify-content: center; color: #94a3b8; transition: transform 0.25s cubic-bezier(0.4,0,0.2,1); }
.collapse-arrow.collapsed { transform: rotate(-90deg); }

.repo-icon { width: 32px; height: 32px; background: linear-gradient(135deg, #6366f1, #0ea5e9); border-radius: 8px; display: flex; justify-content: center; align-items: center; color: white; flex-shrink: 0; }

.repo-header-info { display: flex; flex-direction: column; gap: 2px; align-items: flex-start; text-align: left; }
.repo-header-info strong { font-size: 13px; font-weight: 700; color: #1e293b; letter-spacing: -0.2px; }
.skills-container.dark-theme .repo-header-info strong { color: #f1f5f9; }
.repo-count { font-size: 11px; color: #94a3b8; font-weight: 500; }

.repo-header-right { display: flex; align-items: center; gap: 8px; }
.repo-link-btn { opacity: 0.7; }
.repo-link-btn:hover { opacity: 1; }

.btn-group-update { display: flex; align-items: center; gap: 5px; background: rgba(99,102,241,0.08); border: 1px solid rgba(99,102,241,0.25); color: #4f46e5; padding: 4px 10px; border-radius: 6px; font-size: 11px; font-weight: 600; cursor: pointer; transition: all 0.2s; font-family: inherit; white-space: nowrap; }
.btn-group-update:hover:not(:disabled) { background: rgba(99,102,241,0.15); border-color: rgba(99,102,241,0.5); }
.btn-group-update:disabled { opacity: 0.5; cursor: not-allowed; }
.skills-container.dark-theme .btn-group-update { color: #818cf8; background: rgba(99,102,241,0.1); border-color: rgba(99,102,241,0.3); }

.repo-group-body { border-top: 1px solid rgba(226,232,240,0.5); }
.skills-container.dark-theme .repo-group-body { border-color: rgba(51,65,85,0.4); }

.group-children-list { padding: 6px 8px; display: flex; flex-direction: column; gap: 2px; }

.group-child-card { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; border-radius: 8px; transition: background 0.15s; }
.group-child-card:hover { background: rgba(99,102,241,0.03); }
.skills-container.dark-theme .group-child-card:hover { background: rgba(99,102,241,0.05); }

.child-left { display: flex; align-items: center; gap: 10px; min-width: 0; }
.child-icon { width: 26px; height: 26px; background: linear-gradient(135deg, #334155, #475569); color: white; border-radius: 6px; display: flex; justify-content: center; align-items: center; font-size: 11px; font-weight: 800; text-transform: uppercase; flex-shrink: 0; }
.skills-container.dark-theme .child-icon { background: linear-gradient(135deg, #475569, #64748b); }
.child-info { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.child-info strong { font-size: 12px; font-weight: 600; color: #1e293b; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.skills-container.dark-theme .child-info strong { color: #e2e8f0; }
.child-badges { display: flex; gap: 4px; }
.badge-tag.small { font-size: 9px; padding: 1px 5px; }

.child-right { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
.child-date { font-size: 10px; color: #94a3b8; font-weight: 500; white-space: nowrap; }

.btn-icon-sm { width: 26px; height: 26px; border-radius: 5px; border: 1px solid rgba(226,232,240,0.6); background: transparent; color: #94a3b8; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.15s; flex-shrink: 0; }
.btn-icon-sm:hover { color: #64748b; border-color: rgba(148,163,184,0.5); background: rgba(148,163,184,0.06); }
.btn-icon-sm.primary { border-color: rgba(99,102,241,0.25); color: #818cf8; }
.btn-icon-sm.primary:hover { border-color: rgba(99,102,241,0.5); background: rgba(99,102,241,0.06); color: #6366f1; }
.btn-icon-sm.danger { border-color: rgba(239,68,68,0.25); color: #f87171; }
.btn-icon-sm.danger:hover { border-color: rgba(239,68,68,0.5); background: rgba(239,68,68,0.06); color: #ef4444; }
.btn-icon-sm:disabled { opacity: 0.4; cursor: not-allowed; }
.skills-container.dark-theme .btn-icon-sm { border-color: rgba(51,65,85,0.5); }

.group-collapse-enter-active, .group-collapse-leave-active { transition: all 0.25s cubic-bezier(0.4,0,0.2,1); overflow: hidden; }
.group-collapse-enter-from, .group-collapse-leave-to { opacity: 0; max-height: 0; }
.group-collapse-enter-to, .group-collapse-leave-from { opacity: 1; max-height: 2000px; }

/* Import Modal Specific */
.glass-modal.large { width: 600px; }
.import-area { display: flex; flex-direction: column; gap: 12px; }
.import-textarea { width: 100%; height: 200px; padding: 12px; border-radius: 10px; background: rgba(248,250,252,0.5); border: 1px solid rgba(226,232,240,0.8); font-family: 'Consolas', monospace; font-size: 11px; resize: vertical; outline: none; transition: all 0.2s; }
.skills-container.dark-theme .import-textarea { background: rgba(15,23,42,0.4); border-color: rgba(51,65,85,0.6); color: #cbd5e1; }
.import-textarea:focus { border-color: rgba(99,102,241,0.5); background: rgba(255,255,255,0.7); shadow: 0 0 0 3px rgba(99,102,241,0.08); }
.skills-container.dark-theme .import-textarea:focus { background: rgba(30,41,59,0.5); }

.import-preview-info { margin-top: 14px; padding: 10px; background: rgba(245,158,11,0.08); border-radius: 8px; border: 1px solid rgba(245,158,11,0.2); }
.import-preview-info p { color: #d97706; font-size: 11px; font-weight: 600; text-align: left; }

.import-file-actions { display: flex; justify-content: flex-start; }

.btn-batch-toggle { margin-right: 4px; }
.btn-refresh { display: flex; align-items: center; justify-content: center; width: 32px; height: 32px; border-radius: 8px; border: 1px solid rgba(226,232,240,0.8); background: white; color: #64748b; cursor: pointer; transition: all 0.2s; }
.btn-refresh:hover:not(:disabled) { border-color: rgba(99,102,241,0.5); color: #6366f1; background: rgba(99,102,241,0.03); }
.skills-container.dark-theme .btn-refresh { background: rgba(30,41,59,0.5); border-color: rgba(51,65,85,0.6); color: #94a3b8; }
.skills-container.dark-theme .btn-refresh:hover:not(:disabled) { border-color: rgba(99,102,241,0.5); color: #818cf8; background: rgba(99,102,241,0.1); }

@keyframes spin-cw { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
.spin-anim { animation: spin-cw 0.8s linear infinite; }
</style>
