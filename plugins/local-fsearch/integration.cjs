const fs = require('node:fs/promises')
const path = require('node:path')
const crypto = require('node:crypto')
const os = require('node:os')
const { createLatest, checkAbort } = require('./latest.cjs')
const { buildRequest } = require('./search.cjs')
const { resolveDirectories } = require('./filters.cjs')
const DEFAULTS = { autoHide: true, copyHide: false, remember: true, mainPush: false, workspace: '' }
const OPTIONS = { query: '', category: 'all', directory: '', field: 'engine', mode: 'native', caseSensitive: false, pageSize: 50, extensions: '', modified: '', size: '', exclude: '', git: '', boost: false, browse: false }
const PREFIX = 'fsearch.preset.'
const commands = new Set(['fs', 'find', 'fsearch', '全盘搜索', 'FSearch 文件搜索'])
const presetCode = name => PREFIX + crypto.createHash('sha256').update(name).digest('hex').slice(0, 20)
const macFeatures = [
  { code: 'search-content', explain: 'FSearch 正文搜索', platform: ['darwin'], cmds: ['搜正文', 'FSearch 正文'] },
  { code: 'search-symbol', explain: 'FSearch 代码定义', platform: ['darwin'], cmds: ['搜代码定义', 'FSearch 定义'] }
]

// 旧版 ZTools 可能忽略静态 feature 的 platform；只在 macOS 写入这两条指令。
function syncPlatformFeatures(ztools, platform) {
  const previous = new Map(ztools.getFeatures().map(feature => [feature.code, feature]))
  for (const feature of macFeatures) {
    const current = previous.get(feature.code)
    if (platform === 'darwin' && JSON.stringify(current) !== JSON.stringify(feature)) {
      const result = ztools.setFeature(feature)
      if (result?.success !== true) throw new Error(result?.error || '创建 macOS 搜索指令失败')
    } else if (platform === 'win32' && current && ztools.removeFeature(feature.code) !== true) {
      throw new Error('移除当前平台不可用的搜索指令失败')
    }
  }
}

/** 宿主桥只保存条件、单个会话和最多六个推送令牌；不保存搜索结果集或正文。 */
function createIntegration(ztools, host, pushRequest, { windows = false, searchPush } = {}) {
  const defaults = windows ? { ...OPTIONS, field: 'name', mode: 'literal' } : OPTIONS
  let detached = false
  let issued = new Map(), pushError = '', session = null
  const notify = error => ztools.showNotification?.(error.message || String(error))
  const stored = key => ztools.dbStorage.getItem(key)
  function write(key, value) {
    const error = ztools.dbStorage.setItem(key, value)
    if (error !== undefined) throw new Error(error.error || '宿主存储写入失败')
  }
  function loadSettings() {
    const saved = stored('fsearch-settings')
    const value = saved || { presets: [], editor: 'vscode' }
    if (!Array.isArray(value.presets) || value.presets.length > 20 || !['vscode', 'cursor'].includes(value.editor)) throw new Error('搜索设置格式无效')
    const integration = { ...DEFAULTS, ...value.integration }
    for (const key of ['autoHide', 'copyHide', 'remember', 'mainPush']) if (typeof integration[key] !== 'boolean') throw new Error('集成开关格式无效')
    if (typeof integration.workspace !== 'string') throw new Error('工作目录格式无效')
    return { ...value, integration }
  }
  function features(settings) {
    return settings.presets.filter(p => p.command !== false).map(p => {
      if (typeof p.name !== 'string' || !p.name.trim() || p.name.length > 30 || !p.options) throw new Error('预设格式无效')
      return { code: presetCode(p.name), explain: 'FSearch 搜索预设：' + p.name, platform: [windows ? 'win32' : 'darwin'], cmds: ['FSearch · ' + p.name] }
    })
  }
  /** 只同步本插件拥有的预设指令；失败恢复旧指令，不能显示虚假的保存成功。 */
  function syncFeatures(settings) {
    const previous = ztools.getFeatures().filter(f => f.code?.startsWith(PREFIX))
    const wanted = features(settings), byCode = new Map(wanted.map(f => [f.code, f]))
    const set = feature => { const result = ztools.setFeature(feature); if (result?.success !== true) throw new Error(result?.error || '创建 ZTools 指令失败') }
    try {
      for (const f of wanted) if (JSON.stringify(previous.find(p => p.code === f.code)) !== JSON.stringify(f)) set(f)
      for (const f of previous) if (!byCode.has(f.code) && ztools.removeFeature(f.code) !== true) throw new Error('删除 ZTools 指令失败')
    } catch (error) {
      try { for (const f of previous) set(f); for (const f of wanted) if (!previous.some(p => p.code === f.code)) ztools.removeFeature(f.code) }
      catch (rollback) { throw new Error(error.message + '；指令恢复失败：' + rollback.message) }
      throw error
    }
    return previous
  }
  function saveSettings(settings) {
    const normalized = { ...settings, integration: { ...DEFAULTS, ...settings.integration } }
    if (normalized.integration.workspace.trim()) require('./filters.cjs').directoryPath(normalized.integration.workspace.trim())
    const previous = syncFeatures(normalized)
    const oldSettings = stored('fsearch-settings') || null, oldSession = stored('fsearch-session') || null
    try {
      write('fsearch-settings', normalized)
      if (!normalized.integration.remember) write('fsearch-session', null)
    }
    catch (error) {
      try { write('fsearch-settings', oldSettings); write('fsearch-session', oldSession); const old = new Map(previous.map(f => [f.code, f])); for (const f of features(normalized)) if (!old.has(f.code)) ztools.removeFeature(f.code); for (const f of previous) { const r = ztools.setFeature(f); if (!r?.success) throw new Error(r?.error || '指令恢复失败') } }
      catch (rollback) { throw new Error(error.message + '；' + rollback.message) }
      throw error
    }
    if (!normalized.integration.remember) session = null
    issued.clear(); push.invalidate()
  }
  function saveSession(value) {
    if (!loadSettings().integration.remember) return
    // 游标历史只留 32 页；序列化后设硬上限，不能把异常大的输入持久保存。
    if (Buffer.byteLength(JSON.stringify(value), 'utf8') > 32768) throw new Error('搜索状态过大，未保存本次恢复状态')
    session = structuredClone(value); write('fsearch-session', session)
  }
  function loadSession() { const value = loadSettings().integration.remember ? session || stored('fsearch-session') : null; return value ? structuredClone(value) : null }
  function focusInput(select = true) { return select ? ztools.subInputSelect() : ztools.subInputFocus() }
  async function finishAction(copy = false) {
    const prefs = loadSettings().integration
    if (detached) return
    if (copy ? prefs.copyHide : prefs.autoHide) await ztools.hideMainWindow(copy)
  }
  const actions = {
    async open(target) { const result = await host.open(target); await finishAction(); if (result?.warning) notify(result.warning) },
    async openLine(target, line, editor) { const result = await host.openLine(target, line, editor); await finishAction(); if (result?.warning) notify(result.warning) },
    async reveal(target) { await fs.access(target); await ztools.shellShowItemInFolder(target); await finishAction() },
    async copy(target) { if (typeof target !== 'string' || !path.isAbsolute(target)) throw new Error('文件路径无效'); if (ztools.copyText(target) !== true) throw new Error('复制路径失败'); await finishAction(true); return true },
    async copyFile(target) { await fs.access(target); host.copyFile(target); await finishAction(true); return true },
    async pasteFile(target) {
      await fs.access(target)
      // 仅点击动作才调用宿主恢复原窗口并粘贴；不追加回车或发送操作。
      if (ztools.hideMainWindowPasteFile(target) !== true) throw new Error('未能向原应用粘贴文件，请检查宿主权限；独立窗口中请使用复制文件')
      return true
    },
    async pastePath(target) {
      if (typeof target !== 'string' || !path.isAbsolute(target)) throw new Error('文件路径无效')
      if (ztools.hideMainWindowPasteText(target) !== true) throw new Error('未能向原应用粘贴路径，请检查宿主权限')
      return true
    }
  }
  /** 进入参数只解释已声明的入口；普通选中文本中的 fs 前缀不会被误删。 */
  async function resolveEntry(action = {}) {
    const settings = loadSettings(), code = action.code || 'search', type = action.type || 'text', payload = action.payload
    if (code.startsWith(PREFIX)) {
      const preset = settings.presets.find(p => presetCode(p.name) === code)
      if (!preset) throw new Error('此预设已删除，请从 ZTools 指令中重新选择')
      return { kind: 'search', options: { ...defaults, ...preset.options } }
    }
    if (type === 'files') {
      if (!Array.isArray(payload) || payload.length !== 1) throw new Error('请一次交入一个文件或文件夹')
      const target = typeof payload[0] === 'string' ? payload[0] : payload[0]?.path
      if (typeof target !== 'string' || !path.isAbsolute(target)) throw new Error('交入的文件路径无效')
      const stat = await fs.stat(target), real = await fs.realpath(target)
      if (stat.isDirectory()) return { kind: 'search', options: { ...defaults, directory: real, browse: true } }
      if (!stat.isFile()) throw new Error('此入口只接收普通文件或文件夹')
      return { kind: 'search', options: { ...defaults, field: 'name', mode: 'literal', directory: path.dirname(real), query: path.basename(real) }, sourceFile: real, selectPath: real }
    }
    let text = typeof payload === 'string' ? payload : typeof payload?.query === 'string' ? payload.query : ''
    if (action.option?.fsearchToken) {
      const record = issued.get(action.option.fsearchToken)
      if (!record || record.action !== 'more') throw new Error('主搜索结果已过期，请重新搜索')
      return { kind: 'search', options: { ...defaults, query: record.query } }
    }
    if (code === 'search-query') {
      const match = /^(?:fs|find)\s+([\s\S]+)$/i.exec(text)
      if (!match) throw new Error('参数入口格式为 fs 关键词或 find 关键词')
      text = match[1]
    } else if (code === 'search-content' || code === 'search-symbol' || code === 'search-workspace' || code === 'search-new') {
      if (type === 'text' && typeof payload === 'string') {
        const labels = { 'search-content': ['搜正文', 'FSearch 正文'], 'search-symbol': ['搜代码定义', 'FSearch 定义'], 'search-workspace': ['搜工作目录', 'FSearch 工作目录'], 'search-new': ['FSearch 新搜索'] }[code]
        const label = labels.find(label => text === label || text.startsWith(label + ' '))
        if (label) text = text.slice(label.length).trimStart()
        if (code === 'search-new') text = ''
      }
    } else if (type === 'text' && commands.has(text.trim())) text = ''
    else if (code === 'search' && type === 'text' && action.from !== 'redirect') {
      const match = /^(?:fs|find|fsearch|全盘搜索|FSearch 文件搜索)\s+([\s\S]+)$/i.exec(text)
      if (match) text = match[1]
    }
    if (code === 'search' && !text.trim() && !payload?.query) return { kind: 'resume' }
    const options = { ...defaults, query: text }
    if (windows && ['search-content', 'search-symbol'].includes(code)) throw new Error('Windows 暂不支持正文或代码定义搜索')
    if (code === 'search-content') Object.assign(options, { field: 'content', mode: 'literal' })
    if (code === 'search-symbol') Object.assign(options, { field: 'symbol', mode: 'literal' })
    if (code === 'search-workspace') {
      if (!settings.integration.workspace.trim()) return { kind: 'search', options, configureWorkspace: true, notice: '请先设置工作目录，再使用工作目录搜索指令' }
      options.directory = settings.integration.workspace.trim()
    }
    return { kind: 'search', options }
  }
  const push = createLatest(async (query, context) => {
    // 仅按 fs 前缀触发，延迟后再判断是否过期；普通 ZTools 输入不查询、不启动服务。
    await new Promise(resolve => setTimeout(resolve, 150)); checkAbort(context.signal)
    if (!context.isCurrent()) return []
    let response
    const options = { ...defaults, field: 'name', mode: 'literal', query }
    if (searchPush) response = await searchPush(options, context)
    else {
      const payload = buildRequest(await resolveDirectories(options, context)); payload.limit = 5
      if (!context.isCurrent()) return []
      response = await pushRequest(payload, { signal: context.signal })
    }
    if (!context.isCurrent()) return []
    if (!Array.isArray(response.hits)) throw new Error('主搜索推送响应无效')
    issued.clear()
    const issue = record => { const token = crypto.randomUUID(); issued.set(token, record); return token }
    const hits = response.hits.slice(0, 5).map(hit => ({ text: path.basename(hit.path), title: hit.path, fsearchToken: issue({ action: 'open', path: hit.path, query }) }))
    hits.push({ text: '更多结果…', title: '进入 FSearch 完整搜索', fsearchToken: issue({ action: 'more', query }) })
    pushError = ''; return hits
  })
  async function queryPush(data = {}) {
    issued.clear()
    const text = typeof data.inputState?.searchQuery === 'string' ? data.inputState.searchQuery : typeof data.payload === 'string' ? data.payload : ''
    const match = /^fs\s+(.{2,120})$/i.exec(text)
    if (!loadSettings().integration.mainPush || !match) { push.invalidate(); return [] }
    try { return await push.submit(match[1]) }
    catch (error) { if (error.name !== 'AbortError') pushError = error.message; return [] }
  }
  function selectPush(data = {}) {
    const token = data.option?.fsearchToken
    const record = issued.get(token)
    if (!record) { notify(new Error('主搜索结果已过期，请重新搜索')); return false }
    if (record.action === 'more') return true
    // 不自动收起时，同一批其他结果仍在宿主界面上；只消费被点击的文件令牌。
    issued.delete(token); void actions.open(record.path).catch(notify); return false
  }
  return { ...actions, loadSettings, saveSettings, saveSession, loadSession, focusInput, focusResults: () => ztools.subInputBlur(), resolveEntry,
    syncFeatures: () => syncFeatures(loadSettings()),
    queryPush, selectPush, pushStatus: () => ({ enabled: loadSettings().integration.mainPush, lastError: pushError }),
    suspend() { push.dispose(); issued.clear() },
    setDetached: value => { detached = value },
    shortcutSettings: () => ztools.redirectHotKeySetting('FSearch 文件搜索'),
    home: () => os.homedir()
  }
}
module.exports = { createIntegration, syncPlatformFeatures, presetCode, DEFAULTS, OPTIONS }
