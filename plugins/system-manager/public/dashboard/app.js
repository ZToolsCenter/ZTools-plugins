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
