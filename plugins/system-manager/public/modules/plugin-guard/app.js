// 插件安全体检前端逻辑
function escapeHtml(str) {
  if (str == null) return ''
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function getAdvanced() {
  return window.advancedServices || window.systemManagerAdvanced || {
    async getInstalledPlugins() { return [] },
    async scanPluginDirectory() { return { score: 100, risks: [], files: 0, issues: [] } },
    async choosePluginDirectory() { return null }
  }
}

let installedPlugins = []
let activePlugin = null
let latestReport = null

const filterInput = document.getElementById('pg-filter-input')
const listContainer = document.getElementById('pg-plugins-list')
const summaryText = document.getElementById('pg-summary-text')
const badgeCount = document.getElementById('pg-badge-count')
const btnRefresh = document.getElementById('btn-refresh-list')
const btnChooseDir = document.getElementById('btn-choose-dir')
const btnReScan = document.getElementById('btn-re-scan')
const btnCopyMd = document.getElementById('btn-copy-guard-md')

async function loadPlugins() {
  try {
    summaryText.textContent = '正在深度探测本地已安装插件清单...'
    listContainer.innerHTML = '<div class="list-placeholder">正在扫描本地插件...</div>'

    const adv = getAdvanced()
    const list = await adv.getInstalledPlugins()
    installedPlugins = Array.isArray(list) ? list : []

    badgeCount.textContent = installedPlugins.length
    summaryText.textContent = `已自动定位本地 ${installedPlugins.length} 个插件，免选目录即时体检`

    renderList(filterInput ? filterInput.value : '')

    // 默认直接对列表第 1 个插件发起体检！
    if (installedPlugins.length > 0) {
      inspectPlugin(installedPlugins[0])
    }
  } catch (err) {
    summaryText.textContent = `扫描本地插件失败: ${err.message}`
    listContainer.innerHTML = `<div class="list-placeholder">扫描失败: ${escapeHtml(err.message)}</div>`
  }
}

function renderList(keyword) {
  const kw = (keyword || '').trim().toLowerCase()
  const filtered = installedPlugins.filter(p => {
    if (!kw) return true
    return (p.name && p.name.toLowerCase().includes(kw)) ||
           (p.id && p.id.toLowerCase().includes(kw)) ||
           (p.author && p.author.toLowerCase().includes(kw))
  })

  listContainer.innerHTML = ''
  if (filtered.length === 0) {
    listContainer.innerHTML = '<div class="list-placeholder">未匹配到符合条件的插件</div>'
    return
  }

  filtered.forEach(p => {
    const card = document.createElement('div')
    const isSelected = activePlugin && activePlugin.dirPath === p.dirPath
    card.className = `plugin-item-card ${isSelected ? 'active' : ''}`
    card.title = `${p.name} (${p.dirPath})`

    const logoHtml = p.logo 
      ? `<img class="item-logo" src="${escapeHtml(p.logo)}" alt="" onerror="this.outerHTML='<div class=\\'item-logo-fallback\\'>🧩</div>'"/>`
      : `<div class="item-logo-fallback">🧩</div>`

    card.innerHTML = `
      <div class="item-left">
        ${logoHtml}
        <div class="item-info">
          <div class="item-title-row">
            <span class="item-name">${escapeHtml(p.name)}</span>
            <span class="item-version">v${escapeHtml(p.version)}</span>
          </div>
          <div class="item-desc">${escapeHtml(p.description || p.id)}</div>
        </div>
      </div>
      <button class="btn-scan-item" type="button">体检</button>
    `

    card.addEventListener('click', () => {
      inspectPlugin(p)
    })

    const scanBtn = card.querySelector('.btn-scan-item')
    if (scanBtn) {
      scanBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        inspectPlugin(p)
      })
    }

    listContainer.appendChild(card)
  })
}
async function inspectPlugin(p) {
  if (!p) return
  activePlugin = p

  // 更新选中态高亮
  document.querySelectorAll('.plugin-item-card').forEach(c => {
    if (c.title && c.title.includes(p.dirPath)) {
      c.classList.add('active')
    } else {
      c.classList.remove('active')
    }
  })

  // 渲染头部
  const targetName = document.getElementById('guard-target-name')
  const targetMeta = document.getElementById('guard-target-meta')
  const targetIcon = document.getElementById('guard-target-icon')
  if (targetName) targetName.textContent = p.name
  if (targetMeta) targetMeta.textContent = `v${p.version} · ${p.author} · ${p.dirPath}`
  if (targetIcon) {
    targetIcon.innerHTML = p.logo 
      ? `<img src="${escapeHtml(p.logo)}" alt="" onerror="this.parentElement.innerHTML='🧩'"/>`
      : '🧩'
  }

  // 状态指示为扫描中
  const scoreVal = document.getElementById('guard-score-val')
  const scoreDesc = document.getElementById('guard-score-desc')
  if (scoreVal) scoreVal.textContent = '...'
  if (scoreDesc) scoreDesc.textContent = '正在进行静态语法与权限审计...'

  try {
    const adv = getAdvanced()
    const report = await adv.scanPluginDirectory(p.dirPath)
    latestReport = report
    renderReport(p, report)
  } catch (err) {
    if (scoreVal) scoreVal.textContent = '!'
    if (scoreDesc) scoreDesc.textContent = `体检出错: ${err.message}`
  }
}

function renderReport(plugin, report) {
  const risks = report.risks || []
  const issues = report.issues || []
  const allFindings = [...issues, ...risks]

  let score = 100
  for (const f of allFindings) {
    if (f.level === 'high') score -= 25
    else if (f.level === 'medium') score -= 10
    else score -= 3
  }
  score = Math.max(0, score)

  const scoreVal = document.getElementById('guard-score-val')
  const scoreDesc = document.getElementById('guard-score-desc')
  const risksCount = document.getElementById('guard-risks-count')
  const filesCount = document.getElementById('guard-files-count')

  if (scoreVal) {
    scoreVal.textContent = score
    if (score >= 85) {
      scoreVal.className = 'score-number score-excellent'
      if (scoreDesc) scoreDesc.textContent = '安全健康良好，未见高危调用'
    } else if (score >= 60) {
      scoreVal.className = 'score-number score-warning'
      if (scoreDesc) scoreDesc.textContent = '存在中度风险，建议审慎授权'
    } else {
      scoreVal.className = 'score-number score-danger'
      if (scoreDesc) scoreDesc.textContent = '检测到高危行为，存在安全隐患'
    }
  }

  if (risksCount) {
    risksCount.textContent = allFindings.length
    risksCount.className = allFindings.length === 0 ? 'risk-number text-emerald' : 'risk-number text-rose'
  }

  if (filesCount) {
    filesCount.textContent = report.files || report.fileCount || 0
  }

  // 渲染风险清单
  const risksList = document.getElementById('guard-risks-list')
  if (risksList) {
    if (allFindings.length === 0) {
      risksList.innerHTML = `
        <div class="empty-state-card">
          <span class="empty-icon">🛡️</span>
          <span>未发现敏感高危代码调用与违规权限声明，插件健康良好。</span>
        </div>
      `
    } else {
      risksList.innerHTML = ''
      allFindings.forEach(item => {
        const div = document.createElement('div')
        const lvl = (item.level || 'low').toLowerCase()
        div.className = `finding-item level-${lvl}`
        div.innerHTML = `
          <div class="finding-head">
            <span class="finding-title">${escapeHtml(item.message || item.ruleId || '安全风险项')}</span>
            <span class="finding-tag tag-${lvl}">${escapeHtml(lvl)}</span>
          </div>
          <div class="finding-desc">${escapeHtml(item.detail || item.ruleDescription || (item.code ? `规则代号: ${item.code}` : '安全与规范检测项'))}</div>
          ${item.file ? `<div class="finding-file">位置: ${escapeHtml(item.file)}${item.line ? `:${item.line}` : ''}</div>` : ''}
        `
        risksList.appendChild(div)
      })
    }
  }

  // 清单审查
  const metaId = document.getElementById('meta-id')
  const metaAuthor = document.getElementById('meta-author')
  const metaFeatures = document.getElementById('meta-features')
  const metaPath = document.getElementById('meta-path')

  if (metaId) metaId.textContent = plugin.id || '—'
  if (metaAuthor) metaAuthor.textContent = plugin.author || '—'
  if (metaFeatures) metaFeatures.textContent = `${plugin.featuresCount || 0} 项功能特性`
  if (metaPath) metaPath.textContent = plugin.dirPath || '—'
}

if (filterInput) {
  filterInput.addEventListener('input', () => {
    renderList(filterInput.value)
  })
}

if (btnRefresh) {
  btnRefresh.addEventListener('click', () => {
    loadPlugins()
  })
}

if (btnReScan) {
  btnReScan.addEventListener('click', () => {
    if (activePlugin) {
      inspectPlugin(activePlugin)
    }
  })
}

if (btnChooseDir) {
  btnChooseDir.addEventListener('click', async () => {
    try {
      const adv = getAdvanced()
      const chosen = await adv.choosePluginDirectory()
      if (chosen) {
        const customPlugin = {
          id: 'custom-' + Date.now(),
          name: chosen.split('/').filter(Boolean).pop() || '外部插件目录',
          version: '外部目录',
          author: '自定义',
          description: chosen,
          dirPath: chosen,
          logo: '',
          featuresCount: 1,
          isExternal: true
        }
        installedPlugins.unshift(customPlugin)
        renderList()
        selectPlugin(customPlugin)
      }
    } catch (e) {
      if (e.message && e.message.includes('已取消')) return
      alert('打开目录失败: ' + e.message)
    }
  })
}

if (btnCopyMd) {
  btnCopyMd.addEventListener('click', async () => {
    if (!latestReport || !activePlugin) {
      alert('请先体检插件再复制报告！')
      return
    }
    const md = [
      `# 插件安全体检报告: ${activePlugin.name} (v${activePlugin.version})`,
      `- 审计路径: ${activePlugin.dirPath}`,
      `- 文件总数: ${latestReport.files || 0}`,
      `- 风险总数: ${(latestReport.risks || []).length}`,
      '',
      '## 发现项明细:',
      ...(latestReport.risks || []).map(r => `- [${r.level || 'INFO'}] ${r.message || r.ruleId} (${r.file || 'manifest'})`)
    ].join('\n')

    try {
      await navigator.clipboard.writeText(md)
      btnCopyMd.textContent = '已复制到剪贴板！'
      setTimeout(() => { btnCopyMd.textContent = '复制 Markdown 报告' }, 1800)
    } catch (e) {
      prompt('请手动复制 Markdown 报告:', md)
    }
  })
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', loadPlugins)
} else {
  loadPlugins()
}
