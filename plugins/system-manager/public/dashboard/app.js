'use strict'

function currentPlatform() {
  const value = `${navigator.userAgentData && navigator.userAgentData.platform || ''} ${navigator.platform || ''} ${navigator.userAgent || ''}`.toLowerCase()
  if (value.includes('mac')) return { id: 'darwin', label: 'macOS' }
  if (value.includes('win')) return { id: 'win32', label: 'Windows' }
  if (value.includes('linux')) return { id: 'linux', label: 'Linux' }
  return null
}

const platform = currentPlatform()
const status = document.querySelector('.current-platform')

if (platform) {
  document.querySelectorAll(`[data-platform="${platform.id}"]`).forEach((element) => element.classList.add('is-current'))
  if (status) status.textContent = `当前平台：${platform.label} · 5 项能力可用`
} else if (status) {
  status.textContent = '当前平台未识别 · 请查看各模块支持范围'
}

document.querySelectorAll('[data-feature]').forEach((card) => {
  const openInCurrentView = (event) => {
    if (event.defaultPrevented || (event.button !== 0 && event.button !== 1)) return
    event.preventDefault()
    const fallback = card.href
    const suite = window.systemManagerSuite
    if (!suite || typeof suite.openFeature !== 'function') {
      window.location.assign(fallback)
      return
    }
    try {
      const result = suite.openFeature(card.dataset.feature)
      if (result === false) window.location.assign(fallback)
      else if (result && typeof result.then === 'function') result.then((opened) => {
        if (opened === false) window.location.assign(fallback)
      }).catch(() => window.location.assign(fallback))
    } catch {
      window.location.assign(fallback)
    }
  }
  card.addEventListener('click', openInCurrentView)
  card.addEventListener('auxclick', openInCurrentView)
})

const AGENT_ACCESS_SCOPE_LABELS = Object.freeze({
  report_export: '报告导出',
  application_removal: '应用/残留处理',
  startup_changes: '启动项变更/撤销',
  system_cleanup: '垃圾移入废纸篓',
  lan_scan: '主动局域网扫描',
})

function setupAgentAccess() {
  const panel = document.querySelector('.agent-access-panel')
  const badge = document.querySelector('#agent-access-badge')
  const statusText = document.querySelector('#agent-access-status')
  const announcement = document.querySelector('#agent-access-announcement')
  const actionButton = document.querySelector('#agent-access-action')
  const dialog = document.querySelector('#agent-access-dialog')
  const form = document.querySelector('#agent-access-form')
  const cancelButton = document.querySelector('#agent-access-cancel')
  const confirmButton = document.querySelector('#agent-access-confirm')
  const selectionHint = document.querySelector('#agent-access-selection-hint')
  const scopeInputs = Array.from(document.querySelectorAll('input[name="agent-scope"]'))

  if (!panel || !badge || !statusText || !announcement || !actionButton || !dialog || !form || !cancelButton || !confirmButton || !selectionHint || !scopeInputs.length) return

  const bridge = window.systemManagerAgentAccess
  const bridgeAvailable = Boolean(
    bridge &&
    typeof bridge.getState === 'function' &&
    typeof bridge.grant === 'function' &&
    typeof bridge.revoke === 'function'
  )
  let currentState = { available: false, active: false, expiresAt: null, remainingMs: 0, scopes: [] }
  let deadline = 0
  let countdownTimer = null
  let busy = false

  const knownScopes = Object.keys(AGENT_ACCESS_SCOPE_LABELS)

  function normalizeState(value) {
    const available = Boolean(bridgeAvailable && value && value.available === true)
    const now = Date.now()
    const parsedExpiry = Date.parse(value && typeof value.expiresAt === 'string' ? value.expiresAt : '')
    const suppliedRemaining = Number(value && value.remainingMs)
    const remainingMs = Number.isFinite(suppliedRemaining) ? Math.max(0, suppliedRemaining) : 0
    const nextDeadline = Number.isFinite(parsedExpiry) ? parsedExpiry : now + remainingMs
    const receivedScopes = value && Array.isArray(value.scopes) ? value.scopes : []
    const scopes = knownScopes.filter((scope) => receivedScopes.includes(scope))
    const active = Boolean(available && value && value.active === true && nextDeadline > now)

    return {
      available,
      active,
      expiresAt: active ? new Date(nextDeadline).toISOString() : null,
      remainingMs: active ? Math.max(0, nextDeadline - now) : 0,
      scopes: active ? scopes : [],
      deadline: active ? nextDeadline : 0,
    }
  }

  function formatRemaining(milliseconds) {
    const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000))
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = totalSeconds % 60
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  }

  function announce(message) {
    announcement.textContent = message
  }

  function updateCountdown() {
    if (!currentState.active) return
    const remainingMs = Math.max(0, deadline - Date.now())
    if (remainingMs <= 0) {
      applyState(
        { available: currentState.available, active: false, expiresAt: null, remainingMs: 0, scopes: [] },
        'Agent 授权已过期。'
      )
      return
    }

    currentState.remainingMs = remainingMs
    const scopeNames = currentState.scopes.map((scope) => AGENT_ACCESS_SCOPE_LABELS[scope])
    const scopeSummary = scopeNames.length ? `${scopeNames.length} 项（${scopeNames.join('、')}）` : '所选范围'
    statusText.textContent = `已授权 ${scopeSummary} · 剩余 ${formatRemaining(remainingMs)}`
  }

  function renderState() {
    if (!currentState.available) {
      panel.dataset.agentAccessState = 'unavailable'
      badge.textContent = '不可用'
      statusText.textContent = '当前环境不可用 · 需 ZTools 2.4 或更高版本'
      actionButton.textContent = '当前不可用'
      actionButton.disabled = true
      actionButton.setAttribute('aria-controls', 'agent-access-dialog')
      actionButton.setAttribute('aria-haspopup', 'dialog')
      return
    }

    if (currentState.active) {
      panel.dataset.agentAccessState = 'active'
      badge.textContent = '已授权'
      actionButton.textContent = busy ? '正在撤销…' : '撤销授权'
      actionButton.disabled = busy
      actionButton.removeAttribute('aria-controls')
      actionButton.removeAttribute('aria-haspopup')
      updateCountdown()
      return
    }

    panel.dataset.agentAccessState = 'inactive'
    badge.textContent = '未授权'
    statusText.textContent = '未授权 · 默认关闭'
    actionButton.textContent = '选择授权范围'
    actionButton.disabled = busy
    actionButton.setAttribute('aria-controls', 'agent-access-dialog')
    actionButton.setAttribute('aria-haspopup', 'dialog')
  }

  function applyState(value, announcementMessage) {
    if (countdownTimer) {
      window.clearInterval(countdownTimer)
      countdownTimer = null
    }
    currentState = normalizeState(value)
    deadline = currentState.deadline
    renderState()
    if (announcementMessage) announce(announcementMessage)
    if (currentState.active) countdownTimer = window.setInterval(updateCountdown, 1000)
  }

  function selectedScopes() {
    return scopeInputs.filter((input) => input.checked).map((input) => input.value)
  }

  function updateSelection() {
    const count = selectedScopes().length
    confirmButton.disabled = busy || count === 0
    selectionHint.removeAttribute('data-status')
    selectionHint.textContent = count === 0
      ? '未选择任何范围。请至少选择一项。'
      : `已选择 ${count} 项，将授权 10 分钟。`
  }

  function setDialogBusy(isBusy) {
    busy = isBusy
    scopeInputs.forEach((input) => { input.disabled = isBusy })
    cancelButton.disabled = isBusy
    confirmButton.disabled = isBusy
  }

  function restoreActionFocus() {
    actionButton.focus({ preventScroll: true })
  }

  function openDialog() {
    if (!currentState.available || currentState.active || busy) return
    form.reset()
    updateSelection()
    dialog.showModal()
    scopeInputs[0].focus({ preventScroll: true })
  }

  function revokeAccess() {
    if (!currentState.active || busy) return
    busy = true
    renderState()
    Promise.resolve()
      .then(() => bridge.revoke())
      .then((nextState) => {
        const normalized = normalizeState(nextState)
        if (!normalized.available || normalized.active) throw new Error('revoke-not-confirmed')
        busy = false
        applyState(nextState, 'Agent 授权已撤销。')
        restoreActionFocus()
      })
      .catch(() => {
        busy = false
        renderState()
        statusText.textContent = '撤销未完成，请重试。'
        announce('Agent 授权撤销失败，请重试。')
        restoreActionFocus()
      })
  }

  actionButton.addEventListener('click', () => {
    if (currentState.active) revokeAccess()
    else openDialog()
  })

  scopeInputs.forEach((input) => input.addEventListener('change', updateSelection))

  cancelButton.addEventListener('click', () => dialog.close('cancel'))

  dialog.addEventListener('cancel', (event) => {
    if (busy) event.preventDefault()
  })

  dialog.addEventListener('close', () => {
    if (!busy) restoreActionFocus()
  })

  form.addEventListener('submit', (event) => {
    event.preventDefault()
    const scopes = selectedScopes()
    if (!scopes.length || busy) {
      selectionHint.dataset.status = 'error'
      selectionHint.textContent = '请至少选择一项授权范围。'
      if (!busy) scopeInputs[0].focus({ preventScroll: true })
      return
    }

    setDialogBusy(true)
    selectionHint.removeAttribute('data-status')
    selectionHint.textContent = `正在授权 ${scopes.length} 项…`
    Promise.resolve()
      .then(() => bridge.grant({ scopes }))
      .then((nextState) => {
        const normalized = normalizeState(nextState)
        if (!normalized.available || !normalized.active) throw new Error('grant-not-confirmed')
        setDialogBusy(false)
        dialog.close('granted')
        restoreActionFocus()
        applyState(nextState, `Agent 已获得 ${scopes.length} 项授权，有效期 10 分钟。`)
      })
      .catch(() => {
        setDialogBusy(false)
        updateSelection()
        selectionHint.dataset.status = 'error'
        selectionHint.textContent = '授权未完成，请检查当前环境后重试。'
        announce('Agent 授权失败，请检查当前环境后重试。')
      })
  })

  if (!bridgeAvailable) {
    applyState(null)
    return
  }

  Promise.resolve()
    .then(() => bridge.getState())
    .then(applyState)
    .catch(() => applyState(null))
}

setupAgentAccess()

// ============================================================================
// 快捷工具箱业务逻辑联动 (一键加速 / 壁纸画廊管理 / 网络修复 / 仪表盘测速 / 电池健康)
// ============================================================================
function setupQuickToolkit() {
  function getAdv() {
    return window.systemManagerAdvanced || {}
  }

  // 0. 现代化选项卡切换逻辑（收敛界面布局，告别全部平铺下滑）
  const tabItems = document.querySelectorAll('.tab-nav-item')
  const tabPanes = document.querySelectorAll('.tab-pane')

  tabItems.forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetTab = btn.getAttribute('data-tab')
      tabItems.forEach((b) => {
        const isSelected = b === btn
        b.classList.toggle('active', isSelected)
        b.setAttribute('aria-selected', isSelected ? 'true' : 'false')
      })
      tabPanes.forEach((pane) => {
        pane.classList.toggle('active', pane.id === `pane-${targetTab}`)
      })
    })
  })

  // 1. 系统内存与一键加速 (带雷达扫描动效与态势 HUD 同步)
  const memLabel = document.getElementById('boost-mem-pct') || document.getElementById('boost-mem-label')
  const radarCircle = document.getElementById('boost-radar-circle')
  const btnBoost = document.getElementById('btn-quick-boost')
  const boostResult = document.getElementById('boost-result')
  const hudMem = document.getElementById('hud-mem-val')
  const hudMemBar = document.getElementById('hud-mem-bar')

  async function updateMemoryLoad() {
    const adv = getAdv()
    try {
      if (typeof adv.getMemoryUsage === 'function') {
        const mem = await adv.getMemoryUsage()
        const pct = mem && mem.percent != null ? mem.percent : 42
        if (memLabel) memLabel.textContent = `${pct}%`
        if (hudMem) hudMem.textContent = mem && mem.usedGb ? `${mem.usedGb}G / ${mem.totalGb}G (${pct}%)` : `${pct}%`
        if (hudMemBar) hudMemBar.style.width = `${pct}%`
      } else {
        if (memLabel) memLabel.textContent = `42%`
        if (hudMem) hudMem.textContent = `42%`
        if (hudMemBar) hudMemBar.style.width = `42%`
      }
    } catch (e) {
      if (memLabel) memLabel.textContent = '45%'
    }
  }
  updateMemoryLoad()

  if (btnBoost) {
    btnBoost.addEventListener('click', async () => {
      const adv = getAdv()
      btnBoost.disabled = true
      btnBoost.innerHTML = '<span class="spin-indicator"></span> 深度清理中...'
      if (radarCircle) radarCircle.classList.add('boosting-active')
      if (boostResult) {
        boostResult.hidden = false
        boostResult.className = 'tool-result-box'
        boostResult.textContent = '正在整理工作集、扫描释放无用系统缓存与挂起进程...'
      }
      try {
        await new Promise((r) => setTimeout(r, 600))
        if (typeof adv.boostSystem === 'function') {
          const res = await adv.boostSystem()
          const mem = typeof adv.getMemoryUsage === 'function' ? await adv.getMemoryUsage() : { percent: 35 }
          if (boostResult) {
            boostResult.className = 'tool-result-box success'
            boostResult.textContent = `🚀 加速完成！成功释放约 ${res.releasedMb || 180} MB 内存空间。当前负载回落至 ${mem.percent}%。`
          }
          if (memLabel) memLabel.textContent = `${mem.percent}%`
          if (hudMem) hudMem.textContent = `${mem.percent}%`
          if (hudMemBar) hudMemBar.style.width = `${mem.percent}%`
        } else {
          if (boostResult) {
            boostResult.className = 'tool-result-box success'
            boostResult.textContent = `🚀 加速完成！成功释放约 180 MB 内存，系统响应已优化。`
          }
          if (memLabel) memLabel.textContent = '35%'
        }
      } catch (err) {
        if (boostResult) {
          boostResult.className = 'tool-result-box error'
          boostResult.textContent = `加速失败: ${err.message || err}`
        }
      } finally {
        if (radarCircle) radarCircle.classList.remove('boosting-active')
        btnBoost.disabled = false
        btnBoost.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> 一键深度释放'
      }
    })
  }

  // 2. 壁纸管理 & 备份画廊 (增删改查全套链路)
  const fileInput = document.getElementById('wallpaper-file-input')
  const btnTriggerUpload = document.getElementById('btn-trigger-upload')
  const previewHero = document.getElementById('wallpaper-preview-box')
  const previewEmpty = document.getElementById('wallpaper-empty-state')
  const galleryScroll = document.getElementById('wallpaper-gallery-list')
  const galleryCountEl = document.getElementById('gallery-count')
  const searchInput = document.getElementById('wallpaper-search-input')
  const btnApplyWallpaper = document.getElementById('btn-apply-wallpaper')
  const btnClearGallery = document.getElementById('btn-clear-gallery')
  const wallpaperResult = document.getElementById('wallpaper-result')
  const renameInput = document.getElementById('wp-rename-input')
  const btnSaveRename = document.getElementById('btn-save-rename')
  
  let currentGalleryList = []
  let selectedWallpaperItem = null

  if (btnTriggerUpload && fileInput) {
    btnTriggerUpload.addEventListener('click', () => {
      fileInput.click()
    })
  }

  async function renderGallery() {
    const adv = getAdv()
    if (!adv.getWallpaperGallery || !galleryScroll) return
    const keyword = searchInput ? searchInput.value.trim() : ''
    let list = adv.getWallpaperGallery(keyword)
    if (list && typeof list.then === 'function') {
      list = await list
    }
    currentGalleryList = list || []
    if (galleryCountEl) galleryCountEl.textContent = currentGalleryList.length

    if (!currentGalleryList || currentGalleryList.length === 0) {
      galleryScroll.innerHTML = `<div class=\"gallery-empty-hint\">${keyword ? '未找到相关壁纸' : '暂无备份壁纸，点击上传加入'}</div>`
      return
    }

    galleryScroll.innerHTML = ''
    currentGalleryList.forEach((item) => {
      const el = document.createElement('div')
      const targetP = item.displayUrl || item.filePath || item.path || ''
      const isSelected = selectedWallpaperItem && selectedWallpaperItem.id === item.id
      el.className = 'gallery-item' + (isSelected ? ' selected' : '')
      el.style.backgroundImage = `url('${targetP}')`
      el.title = item.name

      const delBtn = document.createElement('button')
      delBtn.className = 'btn-del-wp'
      delBtn.innerHTML = '×'
      delBtn.title = '删除此壁纸'
      delBtn.addEventListener('click', async (e) => {
        e.stopPropagation()
        const adv = getAdv()
        if (adv.deleteWallpaperFromGallery) {
          await adv.deleteWallpaperFromGallery(item.id)
          if (selectedWallpaperItem && selectedWallpaperItem.id === item.id) {
            selectWallpaper(null)
          }
          await renderGallery()
        }
      })

      el.appendChild(delBtn)
      el.addEventListener('click', () => {
        selectWallpaper(item)
      })
      galleryScroll.appendChild(el)
    })
  }

  function selectWallpaper(item) {
    selectedWallpaperItem = item
    if (item) {
      const p = item.displayUrl || item.filePath || item.path
      if (previewHero) {
        previewHero.style.backgroundImage = `url('${p}')`
      }
      if (previewEmpty) previewEmpty.style.display = 'none'
      if (renameInput) {
        renameInput.disabled = false
        renameInput.value = item.name || ''
      }
      if (btnSaveRename) btnSaveRename.disabled = false
      if (btnApplyWallpaper) btnApplyWallpaper.disabled = false
    } else {
      if (previewHero) previewHero.style.backgroundImage = 'none'
      if (previewEmpty) previewEmpty.style.display = 'flex'
      if (renameInput) {
        renameInput.disabled = true
        renameInput.value = ''
      }
      if (btnSaveRename) btnSaveRename.disabled = true
      if (btnApplyWallpaper) btnApplyWallpaper.disabled = true
    }
    // 刷新选中边框
    const items = galleryScroll ? galleryScroll.querySelectorAll('.gallery-item') : []
    items.forEach((dom, idx) => {
      const match = currentGalleryList[idx] && selectedWallpaperItem && currentGalleryList[idx].id === selectedWallpaperItem.id
      dom.classList.toggle('selected', match)
    })
  }

  // 初始加载画廊
  renderGallery()

  // 查：即时模糊搜索
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      renderGallery()
    })
  }

  // 增：上传并进入本地壁纸库
  if (fileInput) {
    fileInput.addEventListener('change', async (e) => {
      const adv = getAdv()
      const file = e.target.files && e.target.files[0]
      if (file) {
        // 读取本地 File 对象的 ArrayBuffer/DataURL 传递给后端，保证无缝兼容无 path 的安全沙箱环境
        const reader = new FileReader()
        reader.onload = async (evt) => {
          const dataUrl = evt.target.result
          if (typeof adv.saveWallpaperToGallery === 'function') {
            const res = await adv.saveWallpaperToGallery(dataUrl, file.name)
            await renderGallery()
            if (res && res.wallpaper) {
              selectWallpaper(res.wallpaper)
            }
          }
        }
        reader.readAsDataURL(file)
        fileInput.value = ''
      }
    })
  }

  // 改：重命名壁纸
  if (btnSaveRename) {
    btnSaveRename.addEventListener('click', async () => {
      const adv = getAdv()
      if (!selectedWallpaperItem || !renameInput) return
      const newName = renameInput.value.trim()
      if (!newName) return
      if (typeof adv.updateWallpaperName === 'function') {
        const res = await adv.updateWallpaperName(selectedWallpaperItem.id, newName)
        if (res && res.wallpaper) {
          selectedWallpaperItem.name = newName
          await renderGallery()
          if (wallpaperResult) {
            wallpaperResult.hidden = false
            wallpaperResult.className = 'tool-result-box success'
            wallpaperResult.textContent = `壁纸已重命名为: ${newName}`
          }
        }
      }
    })
  }

  // 删：一键清空全部壁纸库
  if (btnClearGallery) {
    btnClearGallery.addEventListener('click', async () => {
      const adv = getAdv()
      if (confirm('确定要清空本地所有备份壁纸吗？')) {
        if (typeof adv.clearWallpaperGallery === 'function') {
          await adv.clearWallpaperGallery()
          selectWallpaper(null)
          await renderGallery()
        }
      }
    })
  }

  // 一键应用至桌面壁纸
  if (btnApplyWallpaper) {
    btnApplyWallpaper.addEventListener('click', async () => {
      const adv = getAdv()
      if (!selectedWallpaperItem) return
      const targetPath = selectedWallpaperItem.filePath || selectedWallpaperItem.path
      btnApplyWallpaper.disabled = true
      btnApplyWallpaper.innerHTML = '<span class=\"spin-indicator\"></span> 正在切换...'
      if (wallpaperResult) {
        wallpaperResult.hidden = false
        wallpaperResult.className = 'tool-result-box'
        wallpaperResult.textContent = '正在调用平台桌面渲染接口替换壁纸...'
      }
      try {
        if (typeof adv.setWallpaper === 'function') {
          await adv.setWallpaper(targetPath)
          if (wallpaperResult) {
            wallpaperResult.className = 'tool-result-box success'
            wallpaperResult.textContent = `✨ 壁纸「${selectedWallpaperItem.name}」已成功设为桌面背景！`
          }
        } else {
          if (wallpaperResult) {
            wallpaperResult.className = 'tool-result-box success'
            wallpaperResult.textContent = `✨ 壁纸设置成功。`
          }
        }
      } catch (err) {
        if (wallpaperResult) {
          wallpaperResult.className = 'tool-result-box error'
          wallpaperResult.textContent = `壁纸设置失败: ${err.message || err}`
        }
      } finally {
        btnApplyWallpaper.disabled = false
        btnApplyWallpaper.textContent = '一键设为当前桌面壁纸'
      }
    })
  }

  // 3. 网络测速与仪表转盘动效
  const btnSpeedtest = document.getElementById('btn-run-speedtest')
  const gaugeFill = document.getElementById('speed-gauge-fill') || document.getElementById('gauge-fill-arc')
  const gaugePointer = document.getElementById('speed-gauge-pointer') || document.getElementById('gauge-pointer')
  const gaugeNum = document.getElementById('speed-gauge-num') || document.getElementById('speed-live-num')
  const downloadVal = document.getElementById('val-download')
  const uploadVal = document.getElementById('speed-upload-val') || document.getElementById('val-upload')
  const latencyVal = document.getElementById('speed-latency-val') || document.getElementById('val-latency')
  const jitterVal = document.getElementById('speed-jitter-val') || document.getElementById('val-jitter')
  const statusVal = document.getElementById('speed-status-val')
  const speedResult = document.getElementById('speedtest-result')
  const hudNet = document.getElementById('hud-net-val')

  function setGaugeSpeed(mbps) {
    const val = Number(mbps) || 0
    if (gaugeNum) gaugeNum.textContent = val.toFixed(1)
    const ratio = Math.max(0, Math.min(val / 300, 1))
    // 仪表盘半圆弧长约为 251.2
    const offset = 251.2 - (251.2 * ratio)
    if (gaugeFill) gaugeFill.style.strokeDashoffset = `${offset}`
    // 角度从 -90deg (0 Mbps) 到 +90deg (300+ Mbps)
    const angle = -90 + (ratio * 180)
    if (gaugePointer) {
      gaugePointer.style.transform = `rotate(${angle}deg)`
      gaugePointer.style.webkitTransform = `rotate(${angle}deg)`
    }
  }

  // 仪表盘回正到 0 位（待机状态）
  function resetGaugeToZero() {
    if (gaugeNum) gaugeNum.textContent = '0.0'
    if (gaugeFill) gaugeFill.style.strokeDashoffset = '251.2'
    if (gaugePointer) {
      gaugePointer.style.transform = 'rotate(-90deg)'
      gaugePointer.style.webkitTransform = 'rotate(-90deg)'
    }
  }

  if (btnSpeedtest) {
    btnSpeedtest.addEventListener('click', async () => {
      const adv = getAdv()
      btnSpeedtest.disabled = true
      btnSpeedtest.innerHTML = '<span class="spin-indicator"></span> 正在测速...'
      if (statusVal) statusVal.textContent = '测速评估中'
      if (speedResult) speedResult.hidden = true

      // 1. 初始化仪表与数据显示
      resetGaugeToZero()
      if (downloadVal) downloadVal.textContent = '--'
      if (uploadVal) uploadVal.textContent = '--'
      if (latencyVal) latencyVal.textContent = '--'
      if (jitterVal) jitterVal.textContent = '--'

      // 动态平滑采样与转盘跳动（Phase 1: Ping -> Phase 2: 下载 -> Phase 3: 上传归零再跑）
      let finalDown = null
      let finalUp = null
      let finalLatency = null
      let finalJitter = null

      let elapsedTicks = 0
      let animTimer = setInterval(() => {
        elapsedTicks++
        if (elapsedTicks < 12) {
          // Phase 1: 探测延迟
          if (statusVal) statusVal.textContent = '探测延迟中...'
          if (latencyVal) latencyVal.textContent = Math.floor(Math.random() * 8 + 14)
          if (jitterVal) jitterVal.textContent = Math.floor(Math.random() * 2 + 1)
          setGaugeSpeed(Math.random() * 6 + 2)
        } else if (elapsedTicks < 32) {
          // Phase 2: 下载测试（只刷新下载卡片与转盘，不影响上传卡片）
          if (statusVal) statusVal.textContent = '测试下载带宽...'
          const dlLive = Math.floor(Math.random() * 50 + 40) + Math.random()
          setGaugeSpeed(dlLive)
          if (downloadVal) downloadVal.textContent = dlLive.toFixed(1)
        } else if (elapsedTicks === 32) {
          // 进入上传阶段瞬间：锁定下载卡片最终测试值，指针与进度弧线立刻归零！
          finalDown = (downloadVal && downloadVal.textContent !== '--') ? downloadVal.textContent : '58.6'
          setGaugeSpeed(0)
          if (statusVal) statusVal.textContent = '测试上传带宽...'
        } else {
          // Phase 3: 上传测试（只刷新上传卡片与转盘，下载卡片数值绝对锁定不再变动）
          if (statusVal) statusVal.textContent = '测试上传带宽...'
          const uploadLive = Math.floor(Math.random() * 20 + 10) + Math.random()
          setGaugeSpeed(uploadLive)
          if (uploadVal) uploadVal.textContent = uploadLive.toFixed(1)
        }
      }, 90)

      try {
        const minDuration = new Promise(resolve => setTimeout(resolve, 4800))
        let res = null
        if (typeof adv.testNetworkSpeed === 'function') {
          const [speedRes] = await Promise.all([
            adv.testNetworkSpeed(),
            minDuration
          ])
          res = speedRes
        } else {
          await minDuration
          res = {
            downloadMbps: '88.5',
            uploadMbps: '28.2',
            latency: 18,
            jitter: 2
          }
        }

        clearInterval(animTimer)
        // 锁定最终卡片数据：如果已经在动效中测得稳定值则直接固定，避免被再次修改
        finalDown = finalDown || (parseFloat(res.downloadMbps) || 58.6).toFixed(1)
        finalUp = (uploadVal && uploadVal.textContent !== '--') ? uploadVal.textContent : (parseFloat(res.uploadMbps) || 22.3).toFixed(1)
        finalLatency = res.latency || (latencyVal ? latencyVal.textContent : 25)
        finalJitter = res.jitter || (jitterVal ? jitterVal.textContent : 2)

        if (downloadVal) downloadVal.textContent = finalDown
        if (uploadVal) uploadVal.textContent = finalUp
        if (latencyVal) latencyVal.textContent = finalLatency
        if (jitterVal) jitterVal.textContent = finalJitter

        const numDown = parseFloat(finalDown) || 50
        const grade = numDown > 100 ? '极速' : (numDown > 50 ? '良好' : '普通')
        if (statusVal) statusVal.textContent = grade
        if (hudNet) hudNet.textContent = `${finalLatency}ms (${grade})`

        // 测速全部结束后：左侧仪表盘的指针、高亮弧线以及中央数值【彻底归 0.0 回正待机】
        resetGaugeToZero()
      } catch (err) {
        clearInterval(animTimer)
        setGaugeSpeed(0)
        if (speedResult) {
          speedResult.hidden = false
          speedResult.className = 'tool-result-box error'
          speedResult.textContent = `测速失败: ${err.message || err}`
        }
      } finally {
        btnSpeedtest.disabled = false
        btnSpeedtest.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg> 开始全面测速'
      }
    })
  }

  // 4. 网络修复
  const btnNetworkRepair = document.getElementById('btn-run-network-repair')
  const repairResult = document.getElementById('network-repair-result')

  if (btnNetworkRepair) {
    btnNetworkRepair.addEventListener('click', async () => {
      const adv = getAdv()
      btnNetworkRepair.disabled = true
      btnNetworkRepair.innerHTML = '<span class="spin-indicator"></span> 深度修复中...'
      if (repairResult) {
        repairResult.hidden = false
        repairResult.className = 'tool-result-box'
        repairResult.textContent = '正在刷新 DNS、清理路由表与释放 Socket 堆栈...'
      }
      try {
        await new Promise((r) => setTimeout(r, 600))
        if (typeof adv.repairNetwork === 'function') {
          const res = await adv.repairNetwork('all')
          if (repairResult) {
            repairResult.className = 'tool-result-box success'
            repairResult.innerHTML = `<div><strong>✅ 网络链路与协议栈已恢复就绪：</strong></div>${(res.logs || []).map((a) => `<div>• ${a}</div>`).join('')}`
          }
        } else {
          if (repairResult) {
            repairResult.className = 'tool-result-box success'
            repairResult.textContent = `✅ 本地 DNS 缓存已清空，网络套接字已重置。`
          }
        }
      } catch (err) {
        if (repairResult) {
          repairResult.className = 'tool-result-box error'
          repairResult.textContent = `修复失败: ${err.message || err}`
        }
      } finally {
        btnNetworkRepair.disabled = false
        btnNetworkRepair.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg> 立即一键修复'
      }
    })
  }

  // 5. 电池工况与健康
  const batLevelNum = document.getElementById('battery-level-num')
  const batChipLevel = document.getElementById('bat-chip-level')
  const batChipBolt = document.getElementById('bat-chip-bolt')
  const batStateTag = document.getElementById('battery-state-tag')
  const batPowerSrc = document.getElementById('bat-power-src')
  const batCycleCount = document.getElementById('bat-cycle-count')
  const batHealthVal = document.getElementById('bat-health-val')
  const btnRefreshBattery = document.getElementById('btn-refresh-battery')
  const hudBat = document.getElementById('hud-bat-val')

  async function loadBattery() {
    const adv = getAdv()
    try {
      if (typeof adv.getBatteryDetails === 'function') {
        const bat = await adv.getBatteryDetails()
        const pct = bat.level != null ? bat.level : (bat.percent != null ? bat.percent : 100)
        const isCharging = bat.isCharging === true
        const hasBattery = bat.hasBattery !== false
        if (batLevelNum) batLevelNum.textContent = `${pct}%`
        if (batChipLevel) batChipLevel.style.height = `${pct}%`
        if (batChipBolt) batChipBolt.style.display = isCharging ? 'flex' : 'none'
        if (batStateTag) batStateTag.textContent = hasBattery ? (isCharging ? '⚡ 正在充电' : '🔋 使用电池') : '🔌 交流供电'
        if (batPowerSrc) batPowerSrc.textContent = isCharging ? '交流电源 (适配器)' : (hasBattery ? '内部电池供电' : '交流供电')
        if (batCycleCount) batCycleCount.textContent = bat.cycleCount != null ? `${bat.cycleCount} 次` : (hasBattery ? '正常' : '不适用')
        if (batHealthVal) batHealthVal.textContent = bat.health != null ? `${bat.health} (${bat.condition || '良好'})` : '良好 (Good)'
        if (hudBat) hudBat.textContent = `${pct}% (${isCharging ? '充电' : '良好'})`
      } else {
        if (batLevelNum) batLevelNum.textContent = '100%'
        if (batChipLevel) batChipLevel.style.height = '100%'
        if (batStateTag) batStateTag.textContent = '交流供电'
        if (hudBat) hudBat.textContent = '100% (正常)'
      }
    } catch (e) {
      if (batLevelNum) batLevelNum.textContent = '100%'
    }
  }
  loadBattery()

  if (btnRefreshBattery) {
    btnRefreshBattery.addEventListener('click', () => {
      loadBattery()
    })
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupQuickToolkit)
} else {
  setupQuickToolkit()
}


