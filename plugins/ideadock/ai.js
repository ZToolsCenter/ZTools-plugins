// AI quick text and agent panel. Kept separate from app.js so the main editor file stays focused.
;(() => {
  const $ = id => document.getElementById(id)
  const AI_CFG_KEY = 'ideadock.aiConfig'
  const WORKSPACE_KEY = 'ideadock.workspacePath'
  const AGENT_ACCEPT_KEY = 'ideadock.aiAgentAccepted'
  const panels = ['python-output-panel', 'js-output-panel', 'md-preview-panel', 'csv-preview-panel', 'html-preview-panel', 'ai-panel']

  let open = false
  let busy = false
  let target = null
  let textHistory = []
  let agentHistory = []

  const defaultCfg = {
    provider: 'codex',
    mode: 'text',
    codexBin: 'codex',
    claudeBin: 'claude',
    url: '',
    apiKey: '',
    model: ''
  }

  function readStore(key) {
    try { if (typeof storeGet === 'function') return storeGet(key) } catch {}
    try { return localStorage.getItem(key) } catch { return null }
  }

  function writeStore(key, value) {
    try { if (typeof storeSet === 'function') { storeSet(key, value); return } } catch {}
    try { localStorage.setItem(key, value) } catch {}
  }

  function loadCfg() {
    try { return { ...defaultCfg, ...(JSON.parse(readStore(AI_CFG_KEY) || '{}') || {}) } }
    catch { return { ...defaultCfg } }
  }

  function saveCfg(cfg) { writeStore(AI_CFG_KEY, JSON.stringify(cfg)) }
  function toast(msg) { if (typeof showToast === 'function') showToast(msg) }

  function quoteCommand(bin) {
    const value = String(bin || '').trim()
    if (!value) return ''
    if (/^".*"$/.test(value) || /^'.*'$/.test(value)) return value
    return /\s/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value
  }

  function legacyBin(command, suffixRe, fallback) {
    const value = String(command || '').trim()
    if (!value) return fallback
    return value.replace(suffixRe, '').trim() || fallback
  }

  function cfgForProvider(provider, mode) {
    const cfg = loadCfg()
    if (provider === 'url') return { ...cfg, provider: 'url' }
    if (provider === 'claude') {
      const bin = quoteCommand(cfg.claudeBin || legacyBin(cfg.command, /\s+-p\s*$/, 'claude'))
      return { ...cfg, provider: 'claude', command: mode === 'agent' ? `${bin} --dangerously-skip-permissions -p` : `${bin} -p` }
    }
    const bin = quoteCommand(cfg.codexBin || legacyBin(cfg.command, /\s+exec\s+-\s*$/, 'codex'))
    return { ...cfg, provider: 'codex', command: mode === 'agent' ? `${bin} exec --dangerously-bypass-approvals-and-sandbox -` : `${bin} exec -` }
  }

  function captureTarget() {
    const editor = $('editor')
    const start = editor.selectionStart || 0
    const end = editor.selectionEnd || 0
    const hasSelection = end > start
    return {
      start: hasSelection ? start : 0,
      end: hasSelection ? end : editor.value.length,
      selected: hasSelection,
      text: hasSelection ? editor.value.slice(start, end) : editor.value
    }
  }

  function escapeHtml(str) {
    return String(str || '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]))
  }

  function targetStats(t) {
    const count = (t && t.text ? t.text.length : 0)
    return `当前将处理 ${count} 字`
  }
  function workspacePath() {
    return String(readStore(WORKSPACE_KEY) || window.textTool?.getDocumentsPath?.() || '').trim()
  }

  function agentAccepted() {
    return readStore(AGENT_ACCEPT_KEY) === '1'
  }

  function refreshTargetStats(clearResult = false) {
    if (!open || busy) return
    const prev = target
    target = captureTarget()
    const changed = !prev || prev.start !== target.start || prev.end !== target.end || prev.text.length !== target.text.length
    const countEl = $('ai-target-count')
    if (countEl) countEl.textContent = targetStats(target)
    if (clearResult && changed) {
      const output = $('ai-output')
      if (output && output.value) output.value = ''
      textHistory = []
    }
  }

  function buildTextPrompt(instruction, input, prior) {
    const context = prior.length
      ? '\n\nPrevious turns:\n' + prior.map(m => `${m.role}: ${m.content}`).join('\n\n')
      : ''
    return [
      'You are editing user text. Follow the instruction exactly.',
      'Return only the final text unless the user explicitly asks for explanation.',
      context,
      '\nInstruction:\n' + instruction,
      '\nText:\n' + input
    ].join('\n')
  }

  function buildAgentPrompt(instruction, cwd, prior) {
    const context = prior.length
      ? '\n\nPrevious turns:\n' + prior.map(m => `${m.role}: ${m.content}`).join('\n\n')
      : ''
    return [
      'You are running as a coding agent for the local workspace.',
      `Workspace root: ${cwd}`,
      'You may read, modify, create, and delete files inside this workspace and run commands with the workspace as cwd.',
      'Do not ask for step-by-step confirmation. Finish the requested task and summarize changed files and verification.',
      context,
      '\nUser request:\n' + instruction
    ].join('\n')
  }

  function render() {
    const cfg = loadCfg()
    const panel = $('ai-panel')
    if (!panel) return
    if (!target) target = captureTarget()
    const mode = cfg.mode || 'text'
    const cwd = workspacePath()
    const accepted = agentAccepted()
    panel.classList.toggle('agent-mode', mode === 'agent')
    panel.innerHTML = `
      <div class="ai-head">
        <div>
          <div class="ai-title">AI</div>
          <div class="ai-scope">${mode === 'agent' ? '在当前工作区执行任务' : '按指令处理当前文字'}</div>
        </div>
        <div class="ai-provider-buttons" role="group" aria-label="AI 后端">
          <button type="button" class="ai-provider-btn${cfg.provider === 'codex' ? ' active' : ''}" data-ai-provider="codex">Codex</button>
          <button type="button" class="ai-provider-btn${cfg.provider === 'claude' ? ' active' : ''}" data-ai-provider="claude">Claude</button>
          <button type="button" class="ai-provider-btn${cfg.provider === 'url' ? ' active' : ''}" data-ai-provider="url">URL</button>
        </div>
      </div>
      <div class="ai-mode-row" role="group" aria-label="AI 模式">
        <button type="button" class="ai-mode-btn${mode === 'text' ? ' active' : ''}" data-ai-mode="text">文本</button>
        <button type="button" class="ai-mode-btn${mode === 'agent' ? ' active' : ''}" data-ai-mode="agent">Agent</button>
      </div>
      <div class="ai-target-count" id="ai-target-count">${mode === 'agent' ? `工作区：${escapeHtml(cwd || '默认文档目录')}（可到左侧更改工作区路径）` : targetStats(target)}</div>
      <div class="ai-agent-warning" id="ai-agent-warning">
        <div class="ai-agent-warning-title">Agent 模式会自动操作当前工作区</div>
        <div>它会在工作区内读写文件并执行命令，不逐项确认。请只在可信项目中使用。</div>
        ${accepted ? '' : '<button type="button" class="btn-mini btn-run" id="ai-accept-agent">我知道了，启用 Agent</button>'}
      </div>
      <textarea id="ai-instruction" class="ai-instruction" placeholder="${mode === 'agent' ? '描述要让 Agent 完成的任务...' : '告诉 AI 要怎么处理这段文字...'}" spellcheck="false"></textarea>
      <div class="ai-actions">
        <div class="ai-template-actions">
          <button type="button" class="btn-mini ai-text-template" data-ai-template="润色这段文字，保持原意，只返回修改后的文本。">润色</button>
          <button type="button" class="btn-mini ai-text-template" data-ai-template="把这段文字翻译成英文，只返回译文。">翻译</button>
          <button type="button" class="btn-mini ai-text-template" data-ai-template="检查这段文字的问题，并改得更清晰，只返回修改后的文本。">优化</button>
          <button type="button" class="btn-mini ai-text-template" data-ai-template="提炼这段文字的核心要点，只返回结果。">提炼</button>
        </div>
        <button type="button" class="btn-mini btn-run" id="ai-run">执行</button>
      </div>
      <div class="ai-output-wrap">
        <textarea id="ai-output" class="ai-output" placeholder="${mode === 'agent' ? 'Agent 日志会显示在这里' : 'AI 结果会显示在这里'}" spellcheck="false"></textarea>
      </div>
      <div class="ai-apply">
        <button type="button" class="btn-mini btn-run ai-text-apply" id="ai-replace">应用到文字</button>
        <button type="button" class="btn-mini ai-text-apply" id="ai-insert">插入光标</button>
        <button type="button" class="btn-mini" id="ai-save-slot">保存为槽</button>
        <button type="button" class="btn-mini" id="ai-pin-slot">钉为便签</button>
        <button type="button" class="btn-mini" id="ai-copy">复制结果</button>
      </div>
    `
    bindPanel()
  }

  function currentMode() {
    return loadCfg().mode || 'text'
  }

  async function runAi() {
    if (busy) return
    const instruction = $('ai-instruction').value.trim()
    if (!instruction) { toast('请输入处理指令'); return }
    const mode = currentMode()
    const provider = loadCfg().provider || 'codex'
    if (mode === 'agent') return runAgent(instruction, provider)
    return runText(instruction, provider)
  }

  async function runText(instruction, provider) {
    target = captureTarget()
    if (!target.text) { toast('没有可处理的文字'); return }
    const cfg = cfgForProvider(provider, 'text')
    const prompt = buildTextPrompt(instruction, target.text, textHistory)
    const output = $('ai-output')
    output.value = '执行中...'
    busy = true
    $('ai-run').disabled = true
    try {
      if (!window.textTool || !window.textTool.runAi) throw new Error('AI 后端不可用')
      const res = await window.textTool.runAi({ ...cfg, mode: 'text', prompt, input: target.text, instruction, history: textHistory })
      if (!res || !res.ok) throw new Error((res && res.error) || 'AI request failed')
      output.value = (res.text || '').trim()
      textHistory.push({ role: 'user', content: instruction }, { role: 'assistant', content: output.value })
      if (textHistory.length > 8) textHistory = textHistory.slice(-8)
    } catch (e) {
      output.value = ''
      toast(e.message || 'AI 执行失败')
    } finally {
      busy = false
      $('ai-run').disabled = false
      $('ai-target-count').textContent = targetStats(target)
    }
  }

  async function runAgent(instruction, provider) {
    const output = $('ai-output')
    const cwd = workspacePath()
    if (!cwd) { toast('当前环境无法获取工作区路径'); return }
    if (!agentAccepted()) { toast('请先确认 Agent 模式提示'); return }
    if (provider === 'url') { toast('Agent 模式请使用 Codex 或 Claude'); return }
    const cfg = cfgForProvider(provider, 'agent')
    const prompt = buildAgentPrompt(instruction, cwd, agentHistory)
    output.value = `工作区：${cwd}\n执行中...\n`
    busy = true
    $('ai-run').disabled = true
    try {
      if (!window.textTool || !window.textTool.runAi) throw new Error('AI 后端不可用')
      const res = await window.textTool.runAi({ ...cfg, mode: 'agent', prompt, instruction, cwd, history: agentHistory })
      if (!res || !res.ok) throw new Error((res && res.error) || 'Agent 执行失败')
      output.value = (res.text || '').trim()
      agentHistory.push({ role: 'user', content: instruction }, { role: 'assistant', content: output.value })
      if (agentHistory.length > 8) agentHistory = agentHistory.slice(-8)
    } catch (e) {
      output.value = output.value + '\n' + (e.message || 'Agent 执行失败')
    } finally {
      busy = false
      $('ai-run').disabled = false
    }
  }

  function replaceTarget() {
    const result = $('ai-output').value
    if (!result || currentMode() === 'agent') return
    const editor = $('editor')
    const before = editor.value
    const start = Math.max(0, Math.min(target.start, before.length))
    const end = Math.max(start, Math.min(target.end, before.length))
    if (typeof flushTyping === 'function') flushTyping()
    if (typeof pushUndo === 'function') pushUndo({ value: before, selectionStart: editor.selectionStart, selectionEnd: editor.selectionEnd })
    editor.value = before.slice(0, start) + result + before.slice(end)
    editor.focus()
    editor.setSelectionRange(start, start + result.length)
    afterEditorChange('AI')
  }

  function insertResult() {
    const result = $('ai-output').value
    if (!result || currentMode() === 'agent') return
    const editor = $('editor')
    const before = editor.value
    const start = editor.selectionStart || 0
    const end = editor.selectionEnd || start
    if (typeof flushTyping === 'function') flushTyping()
    if (typeof pushUndo === 'function') pushUndo({ value: before, selectionStart: start, selectionEnd: end })
    editor.value = before.slice(0, start) + result + before.slice(end)
    const pos = start + result.length
    editor.focus()
    editor.setSelectionRange(pos, pos)
    afterEditorChange('AI insert')
  }

  function outputName() {
    return currentMode() === 'agent' ? 'Agent 日志' : 'AI 结果'
  }

  function saveOutput(pin = false) {
    const text = $('ai-output').value
    if (!text) return
    const api = pin ? window.textTool?.saveAndPinText : window.textTool?.saveTextToSlot
    if (!api) { toast('当前环境不支持保存槽位'); return }
    const res = api.call(window.textTool, { text, name: outputName() })
    if (res && res.name) toast(pin ? `已钉为便签：${res.name}` : `已保存为槽：${res.name}`)
    else toast(pin ? '已钉为便签' : '已保存为槽')
  }

  function afterEditorChange(name) {
    if (typeof persistCurrent === 'function') persistCurrent()
    if (typeof updateCount === 'function') updateCount()
    const lang = $('lang-select') && $('lang-select').value
    if (lang === 'markdown' && typeof renderMarkdown === 'function') renderMarkdown()
    if (lang === 'csv' && typeof renderCsv === 'function') renderCsv()
    if (lang === 'html' && typeof renderHtml === 'function') renderHtml()
    if (typeof showUndo === 'function') showUndo(name || 'AI')
  }

  function bindPanel() {
    document.querySelectorAll('[data-ai-provider]').forEach(btn => {
      btn.addEventListener('click', () => {
        const cfg = loadCfg()
        cfg.provider = btn.dataset.aiProvider
        saveCfg(cfg)
        render()
      })
    })
    document.querySelectorAll('[data-ai-mode]').forEach(btn => {
      btn.addEventListener('click', () => {
        const cfg = loadCfg()
        cfg.mode = btn.dataset.aiMode
        saveCfg(cfg)
        render()
      })
    })
    const accept = $('ai-accept-agent')
    if (accept) {
      accept.addEventListener('click', () => {
        writeStore(AGENT_ACCEPT_KEY, '1')
        render()
      })
    }
    document.querySelectorAll('[data-ai-template]').forEach(btn => {
      btn.addEventListener('click', () => {
        $('ai-instruction').value = btn.dataset.aiTemplate
        $('ai-instruction').focus()
      })
    })
    $('ai-run').addEventListener('click', runAi)
    $('ai-replace').addEventListener('click', replaceTarget)
    $('ai-insert').addEventListener('click', insertResult)
    $('ai-save-slot').addEventListener('click', () => saveOutput(false))
    $('ai-pin-slot').addEventListener('click', () => saveOutput(true))
    $('ai-copy').addEventListener('click', async () => {
      const text = $('ai-output').value
      if (!text) return
      if (window.textTool && window.textTool.writeClipboard) window.textTool.writeClipboard(text)
      else if (navigator.clipboard) await navigator.clipboard.writeText(text)
      toast('已复制')
    })
  }

  function openPanel() {
    if (typeof closeCompare === 'function') closeCompare({ restorePanel: false })
    if (typeof closeClipboard === 'function') closeClipboard()
    open = true
    target = captureTarget()
    panels.forEach(id => { const el = $(id); if (el) el.style.display = 'none' })
    $('ai-panel').style.display = ''
    $('btn-ai').classList.add('active')
    const btnCompare = $('btn-compare')
    if (btnCompare) btnCompare.classList.remove('active')
    render()
    refreshTargetStats(false)
    if (typeof updateSplitHandle === 'function') updateSplitHandle()
  }

  function markClosed() {
    open = false
    const btn = $('btn-ai')
    if (btn) btn.classList.remove('active')
  }

  function closePanel() {
    markClosed()
    $('ai-panel').style.display = 'none'
    if (typeof setLangPanel === 'function') setLangPanel($('lang-select').value)
  }

  function init() {
    const btn = $('btn-ai')
    if (!btn || !$('ai-panel')) return
    btn.addEventListener('click', () => (open && $('ai-panel').style.display !== 'none') ? closePanel() : openPanel())
    ;['mouseup', 'keyup', 'select', 'input'].forEach(evt => {
      $('editor').addEventListener(evt, () => setTimeout(() => refreshTargetStats(true), 0))
    })
    window.closeAiPanel = closePanel
    window.markAiPanelClosed = markClosed
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init)
  else init()
})()
