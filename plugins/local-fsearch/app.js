(() => {
  const api = window.fsearchApi
  const $ = id => document.getElementById(id)
  const windows = api.windows
  const modifier = windows ? 'Ctrl+' : '⌘'
  const modifiedKey = event => windows ? event.ctrlKey : event.metaKey
  const indexLabel = windows ? 'Everything 索引' : 'FSearch 索引'
  if (windows) {
    for (const value of ['content', 'symbol', 'engine']) $('match-field').querySelector(`[value="${value}"]`).remove()
    $('match-field').value = 'name'
    $('git').closest('label').hidden = true
    $('boost').closest('label').hidden = true
    $('editor').closest('.editor-controls').hidden = true
    $('exclude').placeholder = 'C:\\Users\\用户名\\Downloads'
    $('pref-auto-hide').nextSibling.textContent = ' 打开或定位成功后收起主窗口'
    document.querySelector('.shortcuts').textContent = '↑↓ 选择 · ↵ 打开 · 空格 预览图片 · Ctrl+↵ 定位 · Ctrl+L 搜索 · Ctrl+C 路径'
  }
  const icons = {
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    folder: '<path d="M3 7V5a1 1 0 0 1 1-1h5l3 3h8a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/>',
    file: '<path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8zM14 3v5h5M8 12h8M8 16h6"/>',
    table: '<rect x="4" y="3" width="16" height="18" rx="1"/><path d="M4 9h16M4 15h16M10 9v12"/>',
    slides: '<rect x="3" y="4" width="18" height="13" rx="1"/><path d="M12 17v4M8 21h8M7 8h10M7 12h6"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 5-5 4 4 4-6 5 7"/>',
    video: '<rect x="3" y="5" width="13" height="14" rx="2"/><path d="m16 10 5-3v10l-5-3"/>',
    audio: '<path d="M9 18V5l11-2v13M9 8l11-2"/><ellipse cx="6" cy="18" rx="3" ry="3"/><ellipse cx="17" cy="16" rx="3" ry="3"/>',
    code: '<path d="m8 6-6 6 6 6M16 6l6 6-6 6M14 3l-4 18"/>',
    archive: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M11 3v2h2v2h-2v2h2v2h-2v3M10 14h4v4h-4z"/>',
    copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
    refresh: '<path d="M20 7v5h-5M4 17v-5h5M6 6a8 8 0 0 1 13 2M18 18a8 8 0 0 1-13-2"/>'
  }
  let query = '', category = 'all', rows = [], selected = 0, generation = 0, timer, toastTimer
  let connectionReport = null, connectionBlocked = false, connectionGeneration = 0
  let lifecycle = 0, statusWarning = '', resultsValid = false, composing = false, frameId = null, lastTiming = null
  let scheduledAt = 0, filterFocus = null, phase = 'idle', restoreState = null, sourceFile = null, contentFile = null, basePage = 0
  const preferenceDefaults = { autoHide: true, copyHide: false, remember: true, mainPush: false, workspace: '' }
  const widePreview = window.matchMedia('(min-width: 1100px)')
  let settings = { presets: [], editor: 'vscode' }, detailGeneration = 0, lastOptions = null, lastFocused = null
  let pageOffsets = [0], pageStarts = [0], pageIndex = 0, nextOffset = null, loading = false
  let thumbnailObserver, thumbnailJobs = [], thumbnailRunning = 0, imagePreviewUrl, imagePreviewResize, imagePreviewPreviousHeight, imageWindow

  const isImage = item => item.kind === 'file' && Boolean(api.imageType(item.path))
  const imageUrl = ({ bytes, type }) => URL.createObjectURL(new Blob([bytes], { type }))
  function resetThumbnails() { thumbnailObserver?.disconnect(); thumbnailJobs = [] }
  function pumpThumbnails() {
    while (thumbnailRunning < 2 && thumbnailJobs.length) {
      const button = thumbnailJobs.shift()
      if (!button.isConnected) continue
      thumbnailRunning++
      void loadThumbnail(button).finally(() => { thumbnailRunning--; pumpThumbnails() })
    }
  }
  async function loadThumbnail(button) {
    let url
    try {
      const file = await api.readImage(button.dataset.imagePath)
      if (!button.isConnected) return
      url = imageUrl(file)
      const source = new Image()
      source.src = url
      await source.decode()
      if (!button.isConnected || !source.naturalWidth || !source.naturalHeight) return
      // 结果页只保留小图，原图与对象 URL 在生成后释放。
      const canvas = document.createElement('canvas')
      const scale = Math.min(1, 96 / Math.max(source.naturalWidth, source.naturalHeight))
      canvas.width = Math.max(1, Math.round(source.naturalWidth * scale))
      canvas.height = Math.max(1, Math.round(source.naturalHeight * scale))
      canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height)
      const thumb = new Image()
      thumb.alt = ''; thumb.src = canvas.toDataURL()
      button.replaceChildren(thumb)
    } catch { /* 图片不可读时保留图标，点击可查看原因或用系统应用打开。 */ }
    finally { if (url) URL.revokeObjectURL(url) }
  }
  function observeThumbnails(list) {
    thumbnailObserver ||= new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting && entry.target.isConnected) {
        thumbnailObserver.unobserve(entry.target); thumbnailJobs.push(entry.target)
      }
      pumpThumbnails()
    }, { root: list.parentElement, rootMargin: '80px' })
    for (const button of list.querySelectorAll('.image-thumb')) thumbnailObserver.observe(button)
  }

  /** 跟随 ZTools 的实际主题及实时变更，宿主手动选色时也保持一致。 */
  function applyTheme(info) { document.documentElement.dataset.theme = info.isDark ? 'dark' : 'light'; document.documentElement.style.colorScheme = info.isDark ? 'dark' : 'light' }
  applyTheme(window.ztools.getThemeInfo())
  window.ztools.onThemeChange(applyTheme)

  /** 仅把固定图标路径插入 SVG；所有文件名和路径始终用 textContent。 */
  function svg(name) { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.file}</svg>` }
  function showToast(text) { $('toast').textContent = text; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true }, 1800) }
  function showNotice(text) { const message = [statusWarning, text].filter(Boolean).join('\n'); $('notice').textContent = message; $('notice').hidden = !message }
  function formatSize(size) { if (size < 1024) return `${size} B`; const n = Math.floor(Math.log(size) / Math.log(1024)); return `${(size / 1024 ** n).toFixed(1)} ${['B', 'KB', 'MB', 'GB', 'TB'][n] || 'TB'}` }
  function formatDate(seconds) { return seconds ? new Date(seconds * 1000).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }) : '—' }
  function isEditing(target) { return target instanceof Element && Boolean(target.closest('input,textarea,select,[contenteditable="true"]')) }

  /** 复制按钮、路径文本和快捷键共用同一入口；不复制缩略的 ~/ 显示路径。 */
  async function copyPath(item) {
    try { await api.copy(item.path); showToast('已复制完整路径') }
    catch (error) { showNotice(error.message) }
  }

  /**
   * 读取一个原生分页结果；每次查询保存代次，翻页和条件变化都不能接受旧响应。
   * @param {number} version 本次请求代次
   * @returns {Promise<void>} 当前页加载结束
   */
  async function search(version) {
    if (!query.trim() && isContent()) {
      loading = false; rows = []; resultsValid = true; setResultState(); render(); emptyState('查找文本内容', '请输入正文关键词或代码定义名称。'); $('result-summary').textContent = ''; updatePagination(); return
    }
    $('result-summary').textContent = '搜索中…'; showNotice('')
    const options = searchOptions()
    lastOptions = options
    const requestedAt = performance.now()
    try {
      const response = await api.search(options)
      if (version !== generation) return
      const renderAt = performance.now(), previousPath = rows[selected]?.path
      const restoring = restoreState; restoreState = null
      rows = response.hits; selected = Math.max(0, rows.findIndex(item => item.path === (restoring?.selectedPath || previousPath))); nextOffset = response.next; loading = false; resultsValid = true; setResultState(); render()
      const range = rows.length ? `${pageStarts[pageIndex] + 1}–${pageStarts[pageIndex] + rows.length}` : '0'
      $('result-summary').textContent = `${range} ${response.recent ? '项最近文件' : response.content ? '个文件' : '项'} · 已更新`
      if (!rows.length) {
        if (response.content) emptyState(response.next !== null ? '本批次没有命中' : '没有找到文本命中', response.next !== null ? '可继续下一页，或缩小目录范围。' : '此范围未找到文本命中。索引可能受文件类型、大小、忽略规则或权限限制，可查看「索引状态」。')
        else if (response.recent) emptyState('暂无最近文件', windows ? '这里按修改时间显示 Everything 索引中的文件。也可以勾选「空关键词浏览筛选结果」。' : '从插件打开文件后会记录在这里；也可以勾选「空关键词浏览筛选结果」。')
        else emptyState(pageIndex ? '本页已无结果' : '没有找到匹配文件', pageIndex ? '索引实时变化，可以返回上一页或重新搜索。' : '试试更短的关键词，或切换匹配方式和搜索范围。')
      }
      if (response.contentIndexing > 0) showNotice('内容索引正在更新，部分文本结果可能暂未纳入，可稍后刷新。')
      if (response.content && response.complete === false && response.next === null) showNotice('本次文本检索尚未完成，请缩小目录范围后重试。')
      if (response.windowLimited) showNotice(response.windowMessage || '已达到引擎 20,000 项检索窗口上限，请缩小关键词、分类或目录范围。')
      updatePagination()
      $('results').parentElement.scrollTop = restoring?.scrollTop || 0
      lastTiming = { totalMs: performance.now() - scheduledAt, waitMs: requestedAt - scheduledAt, requestMs: renderAt - requestedAt, renderMs: performance.now() - renderAt, engineMs: Number.isFinite(response.took_us) ? response.took_us / 1000 : null, ...response.timings }
      if (frameId !== null) cancelAnimationFrame(frameId)
      frameId = requestAnimationFrame(() => { frameId = null; if (version === generation && lastTiming) lastTiming.frameMs = performance.now() - scheduledAt })
    } catch (error) {
      if (version !== generation) return
      loading = false; nextOffset = null; resultsValid = false; setResultState(); updatePagination(); $('result-summary').textContent = rows.length ? '更新失败 · 下方为上次结果，暂不可操作' : '更新失败'; if (!rows.length) emptyState('搜索未完成', '请检查上方提示，修改条件后重试。'); if (error.name !== 'AbortError') showNotice(error.message)
    }
  }

  /** 条件一变化立即重置游标并废弃在途请求，不能沿用上一次搜索的页码。 */
  function schedule() {
    closeDetail(); updateFilterSummary(); basePage = 0; restoreState = null; pageOffsets = [0]; pageStarts = [0]; pageIndex = 0; queueSearch(true)
  }

  /** 翻页立即执行，输入变化才防抖；加载期间禁止重复翻页。 */
  function queueSearch(debounce = false) {
    if (connectionBlocked) { clearTimeout(timer); showNotice('请先通过“使用与连接”检查搜索引擎，再点击“重新检测”。'); return }
    const version = ++generation
    clearTimeout(timer); api.invalidateSearch?.(); nextOffset = null; loading = true; resultsValid = false
    if (frameId !== null) { cancelAnimationFrame(frameId); frameId = null }
    scheduledAt = performance.now(); setResultState(); updatePagination(); showNotice('')
    $('result-summary').textContent = rows.length ? '正在更新 · 下方为上次结果，暂不可操作' : '正在搜索…'
    if (!rows.length) emptyState(composing ? '输入完成后搜索' : '正在搜索', '')
    if (composing) return
    if (debounce) timer = setTimeout(() => search(version), isContent() || $('match-mode').value === 'regex' ? 180 : 75)
    else search(version)
  }
  /** 旧列表仍可阅读，但不能打开、复制或翻页，防止对过期结果执行操作。 */
  function setResultState() {
    $('results').inert = !resultsValid
    $('results').setAttribute('aria-busy', String(loading))
    $('results').parentElement.classList.toggle('stale', !resultsValid && rows.length > 0)
  }

  /** 采用服务给出的 next 游标记录历史，不根据页大小猜测下一页位置。 */
  function changePage(direction) {
    if (loading || !resultsValid) return
    if (direction < 0) { if (!pageIndex) return; pageIndex-- }
    else {
      if (nextOffset === null) return
      pageOffsets = pageOffsets.slice(0, pageIndex + 1); pageOffsets.push(nextOffset); pageStarts = pageStarts.slice(0, pageIndex + 1); pageStarts.push(pageStarts[pageIndex] + rows.length); pageIndex++
      if (pageOffsets.length > 32) { pageOffsets.shift(); pageStarts.shift(); pageIndex--; basePage++ }
    }
    queueSearch()
  }
  function updatePagination() {
    $('previous-page').title = basePage > 0 && pageIndex === 0 ? '仅保留最近 32 页历史，可用新搜索从头查询' : '上一页'
    $('previous-page').disabled = !resultsValid || loading || pageIndex === 0
    $('next-page').disabled = !resultsValid || loading || nextOffset === null
    $('page-summary').textContent = `第 ${basePage + pageIndex + 1} 页`
    $('pagination').setAttribute('aria-busy', String(loading))
  }
  function isContent() { return ['content', 'symbol'].includes($('match-field').value) }
  /** 兼容性限制直接反映到控件，不把原生大小写不敏感伪装成 Aa 已生效。 */
  function updateModeHint() {
    const field = $('match-field').value, content = isContent(), symbol = field === 'symbol', native = field === 'engine'
    const previous = $('match-mode').value
    const modes = native ? [['native', '模糊查找']] : symbol ? [['literal', '定义识别']] : [['literal', content ? '文本包含' : '精确包含'], ...(!content ? [['fuzzy', '字符模糊']] : []), ['regex', '正则表达式']]
    $('match-mode').replaceChildren(...modes.map(([value, label]) => new Option(label, value)))
    $('match-mode').value = modes.some(([value]) => value === previous) ? previous : modes[0][0]
    $('match-mode').hidden = native || symbol; $('mode-label').hidden = native || symbol
    $('match-case').hidden = native; $('match-case').disabled = native
    $('content-note').hidden = !content; $('boost').disabled = content
    const hints = { literal: symbol ? '仅搜索定义' : content ? '逐行包含原文' : '连续包含输入原文', fuzzy: '字符按顺序出现', native: '包含父目录 · 不区分大小写', regex: windows ? '正则表达式匹配' : 'Rust 正则语法' }
    $('mode-hint').textContent = hints[$('match-mode').value]
    $('match-mode').title = $('match-mode').value === 'regex' && !windows ? '不支持前后查找和反向引用；内联标志可覆盖 Aa' : hints[$('match-mode').value]
    $('match-case').classList.toggle('active', $('match-case').getAttribute('aria-pressed') === 'true')
  }
  function emptyState(title, description) { $('empty-title').textContent = title; $('empty-description').textContent = description; $('empty').hidden = false }

  /** 选择只更新样式和焦点，不重建列表，保留滚动位置和键盘操作目标。 */
  function select(index, focus = false) {
    if (!resultsValid) return
    const followPreview = index !== selected && document.body.classList.contains('preview-docked')
    if (index !== selected) closeDetail(false)
    selected = index
    Array.from($('results').children).forEach((row, i) => { row.classList.toggle('selected', i === index); row.setAttribute('aria-selected', String(i === index)) })
    const item = rows[index]
    $('selection-summary').textContent = item ? `${pageStarts[pageIndex] + index + 1} · ${item.matches ? item.matches.length + ' 处命中预览' : item.kind === 'dir' ? '文件夹' : formatSize(item.size)}` : indexLabel
    if (focus && item) { const row = $('results').children[index]; row.focus({ preventScroll: true }); row.scrollIntoView({ block: 'nearest' }) }
    if (followPreview && item?.matches) previewItem(item)
  }

  /** 列表用安全文本构建，完整路径可直接点击复制；每项保留明确的复制按钮。 */
  function render() {
    resetThumbnails()
    const list = $('results'); list.replaceChildren(); $('empty').hidden = rows.length > 0
    const fragment = document.createDocumentFragment()
    rows.forEach((item, index) => {
      const row = document.createElement('li'); row.className = 'result' + (item.kind === 'dir' ? ' folder' : ''); row.tabIndex = -1; row.setAttribute('role', 'option')
      const picture = isImage(item)
      const icon = document.createElement(picture ? 'button' : 'span')
      icon.className = picture ? 'image-thumb' : 'file-icon'
      icon.innerHTML = svg(picture ? 'image' : item.kind === 'dir' ? 'folder' : 'file')
      if (picture) {
        row.classList.add('image-result')
        icon.dataset.imagePath = item.path
        icon.title = '预览大图（空格）'
        icon.setAttribute('aria-label', '预览大图：' + api.name(item.path))
        icon.onclick = event => { event.stopPropagation(); select(index); previewImage(item) }
      }
      const detail = document.createElement('div'); detail.className = 'file-detail'
      const head = document.createElement('div'); head.className = 'file-head'
      const name = document.createElement('div'); name.className = 'file-name'; name.textContent = api.name(item.path); name.title = name.textContent
      const type = document.createElement('span'); type.className = 'file-type'; type.textContent = item.kind === 'dir' ? '文件夹' : item.kind === 'link' ? '链接' : (name.textContent.includes('.') ? name.textContent.split('.').pop().toUpperCase() : '文件')
      head.append(name, type)
      if (item.git) { const badge = document.createElement('span'); badge.className = 'git-badge'; badge.textContent = gitLabel(item.git); head.append(badge) }
      const full = document.createElement('button'); full.className = 'file-path';
      const display = item.path.startsWith(api.home() + '/') ? '~/' + item.path.slice(api.home().length + 1) : item.path
      const cut = windows ? Math.max(display.lastIndexOf('/'), display.lastIndexOf('\\')) : display.lastIndexOf('/'), parent = document.createElement('span'), leaf = document.createElement('span'), parentText = document.createElement('bdi')
      parent.className = 'path-parent'; parentText.dir = 'ltr'; parentText.textContent = display.slice(0, cut + 1); parent.append(parentText)
      leaf.className = 'path-leaf'; leaf.textContent = display.slice(cut + 1); full.append(parent, leaf); full.title = '点击复制完整路径：' + item.path; full.setAttribute('aria-label', '复制完整路径：' + item.path)
      full.onclick = event => { event.stopPropagation(); select(index); copyPath(item) }
      const foot = document.createElement('div'); foot.className = 'file-foot'
      const meta = document.createElement('span'); meta.className = 'file-meta'; meta.textContent = item.matches ? `${item.matches.length} 处命中预览` : `${item.kind === 'dir' ? '文件夹' : formatSize(item.size)} · ${formatDate(item.mtime)}`
      const actions = document.createElement('div'); actions.className = 'actions'
      ;[...(picture ? [['预览大图', () => previewImage(item)]] : !windows ? [['预览', () => previewItem(item)]] : []), ['打开', api.open], ['定位', api.reveal], ['复制路径', () => copyPath(item)]].forEach(([label, action]) => {
        const button = document.createElement('button'); button.className = label === '复制路径' ? 'copy-action' : 'secondary-action'
        if (label === '复制路径') button.innerHTML = svg('copy')
        button.append(document.createTextNode(label)); button.title = label === '复制路径' ? `复制完整绝对路径（选中结果后 ${modifier}C）` : label === '定位' ? (windows ? '在文件资源管理器中显示' : '在 Finder 中显示') : label === '预览大图' ? '在插件内查看大图（空格）' : label === '预览' ? item.matches ? '展开正文命中及上下文' : '使用 macOS 快速预览' : '用默认应用打开'
        button.onclick = event => { event.stopPropagation(); select(index); Promise.resolve().then(() => action(item.path)).catch(error => showNotice(error.message)) }
        actions.append(button)
      })
      const menu = document.createElement('details'); menu.className = 'row-menu'
      const toggle = document.createElement('summary'); toggle.textContent = '更多'; toggle.setAttribute('aria-label', '更多操作：' + name.textContent)
      const menuBody = document.createElement('div')
      ;[...(!windows ? [['快速预览', () => api.quickLook(item.path)]] : []), ['粘贴文件到原应用', () => api.pasteFile(item.path)], ['粘贴路径到原应用', () => api.pastePath(item.path)], ['复制文件', async () => { await api.copyFile(item.path); showToast('已复制文件，可直接粘贴') }], ...(item.matches?.length ? [['编辑器跳转首个命中', () => api.openLine(item.path, item.matches[0].line, settings.editor)]] : [])].forEach(([label, action]) => { const button = document.createElement('button'); button.textContent = label; button.onclick = event => { event.stopPropagation(); menu.open = false; select(index); Promise.resolve().then(action).catch(error => showNotice(error.message)) }; menuBody.append(button) })
      menu.addEventListener('toggle', () => { if (menu.open) { const boundary = $('results').parentElement.getBoundingClientRect(); menu.classList.toggle('menu-up', menu.getBoundingClientRect().bottom + menuBody.offsetHeight + 6 > boundary.bottom) } })
      menu.onclick = event => event.stopPropagation(); menu.append(toggle, menuBody); actions.append(menu)
      head.insertBefore(meta, type); foot.append(actions); detail.append(head, full); if (item.matches?.length) detail.append(renderSummary(item)); detail.append(foot); row.append(icon, detail)
      row.onclick = () => { if (!window.getSelection()?.toString()) select(index, true) }
      row.ondblclick = event => { if (!event.target.closest('button')) Promise.resolve().then(() => api.open(item.path)).catch(error => showNotice(error.message)) }
      fragment.append(row)
    })
    list.append(fragment); if (list.querySelector('.image-thumb')) observeThumbnails(list); select(selected)
  }
  /** 列表只构建首处命中的一行摘要，完整上下文留给按需预览。 */
  function renderSummary(item) {
    const match = item.matches[0], line = document.createElement('div'); line.className = 'content-summary'
    const number = document.createElement('button'); number.className = 'jump-line'; number.textContent = match.line; number.setAttribute('aria-label', `第 ${match.line} 行`)
    number.title = '在编辑器中打开命中行'; number.onclick = event => { event.stopPropagation(); api.openLine(item.path, match.line, settings.editor).catch(error => showNotice(error.message)) }
    const code = document.createElement('code')
    if (match.outsidePreview) code.textContent = '命中位于行预览范围外，展开查看'
    else match.parts.forEach(part => { const node = document.createElement(part.matched ? 'mark' : 'span'); node.textContent = part.text; code.append(node) })
    line.append(number, code); return line
  }
  /** 行号和高亮都来自引擎，正文只作为文本节点插入，不能执行其中的 HTML。 */
  function renderSnippets(matches, target) {
    const container = document.createElement('div'); container.className = 'content-snippets'
    function line(number, parts, context = false) {
      const row = document.createElement('div'); row.className = 'snippet-line' + (context ? ' context-line' : ' match-line')
      const label = document.createElement(target && !context ? 'button' : 'span'); label.className = 'line-number' + (target && !context ? ' jump-line' : '');
      if (target && !context) { label.title = '在编辑器中打开第 ' + number + ' 行'; label.onclick = event => { event.stopPropagation(); api.openLine(target, number, settings.editor).catch(error => showNotice(error.message)) } }  label.textContent = number; label.setAttribute('aria-label', `第 ${number} 行`)
      const code = document.createElement('code')
      parts.forEach(part => { const node = document.createElement(part.matched ? 'mark' : 'span'); node.textContent = part.text; code.append(node) })
      row.append(label, code); return row
    }
    // 相邻命中的上下文可能重叠，按行号合并，命中样式优先，避免重复展示同一行。
    const lines = new Map()
    matches.forEach(match => {
      for (const item of [...match.before, ...match.after]) if (!lines.has(item.line)) lines.set(item.line, { number: item.line, parts: [{ text: item.text }], context: true })
      lines.set(match.line, { number: match.line, parts: match.parts, context: false, outside: match.outsidePreview })
    })
    let group, previous = -2
    for (const item of [...lines.values()].sort((a, b) => a.number - b.number)) {
      if (item.number !== previous + 1) { group = document.createElement('div'); group.className = 'snippet-group'; container.append(group) }
      group.append(line(item.number, item.parts, item.context))
      if (item.outside) { const note = document.createElement('div'); note.className = 'snippet-note'; note.textContent = '命中位置超出本行预览，打开文件查看。'; group.append(note) }
      previous = item.number
    }
    return container
  }
  function updateCategoryTitle() {
    const item = api.categories.find(item => item.id === category)
    $('category-title').textContent = isContent() ? ($('match-field').value === 'symbol' ? '代码定义' : category === 'all' ? '文件内容' : item.contentLabel || item.label) : item.label
  }
  function renderCategories() {
    $('categories').replaceChildren()
    const content = isContent()
    api.categories.filter(item => !content || item.contentSupported).forEach(item => {
      const button = document.createElement('button'); button.disabled = Boolean(contentFile && isContent()); button.className = 'category' + (category === item.id ? ' active' : ''); button.setAttribute('aria-pressed', String(category === item.id)); button.innerHTML = svg(item.icon); button.append(document.createTextNode(content ? item.contentLabel || item.label : item.label))
      button.onclick = () => { category = item.id; updateCategoryTitle(); renderCategories(); schedule() }
      $('categories').append(button)
    })
  }

  /** 首次连接失败停止自动搜索；显式重试才重新检测，不让输入触发重复启动。 */
  async function refreshStatus(recheck = false) {
    const active = lifecycle, attempt = ++connectionGeneration
    if (recheck) { connectionBlocked = true; generation++; clearTimeout(timer); api.invalidateSearch?.(); resultsValid = false; setResultState(); updatePagination() }
    try {
      const report = await api.connection({ recheck })
      if (active !== lifecycle || attempt !== connectionGeneration) return null
      connectionReport = report
      if (!report.usable) {
        connectionBlocked = true; statusWarning = ''; resultsValid = false; rows = []; render(); setResultState(); updatePagination()
        $('index-summary').textContent = '未就绪'; $('status-dot').classList.remove('ready')
        emptyState(report.title, report.message + ' 点击“使用与连接”查看指引。'); showNotice(report.detail); return false
      }
      const data = report.status
      if (active !== lifecycle || attempt !== connectionGeneration) return null
      connectionBlocked = false
      if (windows) {
        $('index-summary').textContent = 'Everything 已连接'
        $('index-summary').title = 'Everything ' + data.version
        $('status-dot').classList.add('ready')
        statusWarning = ''; showNotice('')
        return true
      }
      $('index-summary').textContent = `${(data.entries / 10000).toFixed(1)} 万项`
      $('index-summary').title = `已索引 ${data.entries.toLocaleString()} 个文件和目录；${data.full_disk_access ? '完整磁盘访问可用' : '权限受限'}`
      $('status-dot').classList.add('ready')
      statusWarning = data.full_disk_access ? '' : '完整磁盘访问未开启，部分受保护目录可能未纳入索引。可在“使用与连接”查看授权指引。'
      showNotice(data.content_pending > 0 ? `正文索引待更新 ${data.content_pending} 个文件。` : '')
      return true
    } catch (error) {
      if (active !== lifecycle || attempt !== connectionGeneration) return null
      connectionBlocked = true; $('index-summary').textContent = '未就绪'; $('status-dot').classList.remove('ready'); showNotice(error.message); return false
    }
  }
  /** 当前条件只保存字符串和开关；不保存结果或正文，预设最多 20 条。 */
  function searchOptions() {
    return { query, category, directory: $('directory').value.trim(), mode: $('match-mode').value, field: $('match-field').value, caseSensitive: $('match-field').value !== 'engine' && $('match-case').getAttribute('aria-pressed') === 'true', pageSize: Number($('page-size').value), offset: pageOffsets[pageIndex], extensions: $('extensions').value.trim(), modified: $('modified').value, size: $('size').value.trim(), exclude: $('exclude').value.trim(), git: $('git').value, file: isContent() ? contentFile || undefined : undefined, boost: $('boost').checked && !isContent(), browse: $('browse').checked || Boolean($('git').value) }
  }
  function gitLabel(value) { return ({ modified: '已修改', staged: '已暂存', untracked: '未跟踪', conflict: '冲突', clean: '未修改', tracked: '已跟踪', ignored: '已忽略', added: '新增', renamed: '重命名', deleted: '已删除' })[value] || value }
  function updateFilterSummary() {
    const single = Boolean(contentFile && isContent())
    for (const id of ['directory', 'location', 'apply', 'clear', 'extensions', 'modified', 'size', 'exclude', 'git']) $(id).disabled = single
    $('directory').placeholder = single ? '当前文件：' + api.name(contentFile) : '所有索引位置'
    const chips = $('filter-chips'); chips.replaceChildren()
    if (contentFile && isContent()) addChip('单文件正文', () => { contentFile = null; renderCategories(); schedule() }, contentFile)
    const fields = { extensions: '类型', modified: '时间', size: '大小', exclude: '排除', git: 'Git' }
    for (const [id, label] of Object.entries(fields)) {
      const value = $(id).value.trim(); if (!value) continue
      const text = id === 'exclude' ? `${value.split('\n').filter(Boolean).length} 个目录` : id === 'git' ? $('git').selectedOptions[0].textContent : value
      addChip(`${label}：${text}`, () => { $(id).value = ''; schedule() })
    }
    if ($('directory').value.trim()) addChip('指定目录', () => { $('directory').value = ''; schedule() }, $('directory').value)
    if ($('boost').checked && !isContent()) addChip('常用优先', () => { $('boost').checked = false; schedule() })
    if ($('browse').checked) addChip('浏览', () => { $('browse').checked = false; schedule() })
    $('filter-summary').textContent = single ? '当前直接搜索单个文件；移除「单文件正文」条件后可使用其他筛选。' : chips.children.length ? `当前 ${chips.children.length} 项条件；修改后自动更新结果。` : '未限制额外条件。'
    function addChip(text, remove, title = text) { const button = document.createElement('button'); button.className = 'filter-chip'; button.textContent = text + ' ×'; button.title = title + '（点击移除）'; button.setAttribute('aria-label', '移除筛选：' + text); button.onclick = remove; chips.append(button) }
  }
  /** 宽屏正文作为侧栏，不阻塞列表；窄屏与筛选使用可关闭的模态面板。 */
  function syncPanelLayout() {
    const detail = !$('detail-panel').hidden, filter = !$('advanced').hidden
    const docked = detail && $('detail-panel').dataset.kind === 'preview' && widePreview.matches
    document.body.classList.toggle('preview-docked', docked)
    $('detail-panel').setAttribute('role', docked ? 'region' : 'dialog')
    $('detail-panel').setAttribute('aria-modal', String(!docked))
    document.querySelector('.workspace').inert = filter || (detail && !docked)
    $('panel-backdrop').hidden = !(filter || (detail && !docked))
  }
  function closeFilters(restore = true) {
    $('advanced').hidden = true; syncPanelLayout()
    if (restore && filterFocus?.isConnected) filterFocus.focus({ preventScroll: true }); filterFocus = null
  }
  function closeDetail(restore = true) {
    imagePreviewResize?.(); imagePreviewResize = null
    detailGeneration++; api.invalidatePreview?.(); $('detail-panel').hidden = true; $('detail-body').replaceChildren(); $('detail-actions').replaceChildren(); syncPanelLayout()
    if (imagePreviewUrl) { URL.revokeObjectURL(imagePreviewUrl); imagePreviewUrl = null }
    if (imagePreviewPreviousHeight !== undefined) {
      const height = imagePreviewPreviousHeight; imagePreviewPreviousHeight = undefined
      requestPreviewHeight(height)
    }
    if (restore && lastFocused?.isConnected) lastFocused.focus({ preventScroll: true }); lastFocused = null
  }
  function openDetail(title, kind = 'diagnostics') {
    closeFilters(false); closeDetail(false); lastFocused = document.activeElement
    $('detail-title').textContent = title; $('detail-panel').dataset.kind = kind; $('detail-panel').hidden = false; syncPanelLayout(); if ($('detail-panel').getAttribute('aria-modal') === 'true') $('close-detail').focus()
    return ++detailGeneration
  }
  widePreview.addEventListener('change', () => { syncPanelLayout(); if (!$('detail-panel').hidden && $('detail-panel').getAttribute('aria-modal') === 'true') $('close-detail').focus() })
  function detailText(text) { const p = document.createElement('p'); p.textContent = text; $('detail-body').append(p) }
  function detailButton(text, action, disabled = false) {
    const button = document.createElement('button'); button.textContent = text; button.disabled = disabled
    button.onclick = () => { const version = detailGeneration; Promise.resolve().then(action).catch(error => { if (version === detailGeneration) detailText(error.message) }) }
    $('detail-actions').append(button)
  }
  function requestPreviewHeight(height) {
    // 旧宿主可能不支持调整高度；面板仍按当前可用空间布局。
    try { Promise.resolve(window.ztools.setExpendHeight?.(height)).catch(() => {}) } catch {}
  }
  function expandImagePreview() {
    if (typeof window.ztools.setExpendHeight !== 'function') return
    let windowType
    try { windowType = window.ztools.getWindowType?.() } catch {}
    if (windowType && windowType !== 'main') return
    // 为接近全宽的 16:9 画布预留工具栏高度，同时给宿主标题栏和屏幕边缘留空间。
    const height = Math.min(Math.ceil(window.innerWidth * 9 / 16 + 118), screen.availHeight - 90)
    if (height > window.innerHeight) {
      imagePreviewPreviousHeight = window.innerHeight
      requestPreviewHeight(height)
    }
  }
  function openImageWindow(item) {
    if (typeof window.ztools.createBrowserWindow !== 'function' || location.protocol !== 'file:') return false
    const url = new URL('image-preview.html', location.href)
    url.hash = encodeURIComponent(item.path)
    let area
    try {
      const point = window.ztools.getCursorScreenPoint?.()
      if (point) area = window.ztools.getDisplayNearestPoint?.(point)?.workArea
    } catch {}
    const availableWidth = area?.width || screen.availWidth, availableHeight = area?.height || screen.availHeight
    const width = Math.floor(availableWidth * 0.92), height = Math.floor(availableHeight * 0.91)
    const position = area ? { x: area.x + Math.floor((availableWidth - width) / 2), y: area.y + Math.floor((availableHeight - height) / 2) } : {}
    try {
      const next = window.ztools.createBrowserWindow(url.href, { ...position, width, height,
        title: '图片预览', resizable: true, maximizable: true, webPreferences: { preload: 'image-window-preload.js' } })
      if (!Number.isInteger(next?.id)) return false
      const previous = imageWindow; imageWindow = next
      try { if (previous && !previous.isDestroyed()) previous.close() } catch {}
      return true
    } catch { return false }
  }
  async function previewImage(item) {
    if (openImageWindow(item)) return
    const version = openDetail(api.name(item.path), 'image')
    expandImagePreview()
    detailText('正在加载图片…')
    detailButton('用默认应用打开', () => api.open(item.path))
    detailButton('复制路径', () => copyPath(item))
    try {
      const file = await api.readImage(item.path)
      if (version !== detailGeneration) return
      imagePreviewUrl = imageUrl(file)
      const image = new Image()
      image.className = 'image-preview'; image.alt = api.name(item.path); image.src = imagePreviewUrl
      try { await image.decode() } catch { throw new Error('无法预览此图片，格式可能不受支持或文件已损坏。') }
      if (version !== detailGeneration) return
      imagePreviewResize = window.mountImageViewer($('detail-body'), image, formatSize(file.bytes.byteLength))
    } catch (error) {
      if (version !== detailGeneration) return
      if (imagePreviewUrl) { URL.revokeObjectURL(imagePreviewUrl); imagePreviewUrl = null }
      $('detail-body').replaceChildren(); detailText(error.message)
    }
  }
  /** 仅选中文件请求有限上下文；代次阻止旧文件响应覆盖新选择，不缓存全文。 */
  async function previewItem(item) {
    if (!item.matches) return api.quickLook(item.path)
    const version = openDetail(api.name(item.path) + ' · 正文命中', 'preview')
    const options = { ...lastOptions }
    async function load() {
      $('detail-body').replaceChildren(); $('detail-actions').replaceChildren(); detailText('读取命中上下文…')
      try {
        const response = await api.preview(options, item.path)
        if (version !== detailGeneration) return
        $('detail-body').replaceChildren()
        detailText(item.path)
        if (response.matches.length) $('detail-body').append(renderSnippets(response.matches, item.path))
        else detailText('当前文件未返回命中，可能在搜索后已被修改。')
        detailText('最多展开前 100 处命中，前后各 3 行；点击命中行号可跳转编辑器。')
        if (response.limited) detailText('已显示前 100 处命中；更多内容可在编辑器中查看。')
        if (response.complete === false) detailText('此文件读取未完成，可关闭后重试。')
        detailButton('系统预览', () => api.quickLook(item.path))
        detailButton('复制路径', () => copyPath(item))
      } catch (error) { if (version === detailGeneration) { $('detail-body').replaceChildren(); detailText(error.message) } }
    }
    await load()
  }
  /** 诊断只读取引擎状态和有限的忽略配置；不为解释空结果偷偷重扫全盘。 */
  async function diagnostics() {
    const version = openDetail('索引状态与搜索覆盖'); detailText('读取引擎状态…')
    try {
      const { status: data, skipped, config } = await api.diagnostics()
      if (version !== detailGeneration) return
      $('detail-body').replaceChildren()
      if (windows) detailText(`Everything ${data.version} 已连接。\n搜索范围以 Everything 的索引配置为准，可在 Everything 的「工具 → 选项」查看卷、文件夹和排除设置。`)
      else detailText(`名称索引：${data.entries.toLocaleString()} 项\n内容索引：${(data.content_docs || 0).toLocaleString()} 个文件\n待更新正文：${data.content_pending || 0} 个\n名称索引磁盘大小：${formatSize(data.index_bytes)}\n正文索引磁盘大小：${formatSize(data.content_bytes)}\n完整磁盘访问：${data.full_disk_access ? '可用' : '未开启，受保护目录可能被跳过'}`)
      if (lastTiming) {
        const metric = value => Number.isFinite(value) ? value.toFixed(1) + ' ms' : '未提供'
        detailText(`最近一次搜索耗时\n结果就绪（含防抖与 DOM 更新）：${metric(lastTiming.totalMs)}\n等待发送：${metric(lastTiming.waitMs)}\n后台排队：${metric(lastTiming.queueMs)}\n异步目录校验：${metric(lastTiming.validationMs)}\n本地通信（含引擎处理）：${metric(lastTiming.transportMs)}\n引擎处理：${metric(lastTiming.engineMs)}\n页面请求往返：${metric(lastTiming.requestMs)}\nDOM 更新：${metric(lastTiming.renderMs)}\n下一帧回调：${metric(lastTiming.frameMs)}\n以上耗时部分互相包含，不能相加；只保存最近一条测量。`)
      }
      if (!windows) detailText('正文索引规则：普通目录文本文件最大 1 MB，Git 项目内最大 10 MB；会跳过 Git 忽略、依赖与构建产物、锁文件、100 KB 及以上 JSON、压缩混淆资源等。名称可搜到不代表正文已被索引。')
      detailText('空结果也可能来自筛选条件交集为空或文件已变更。这里展示覆盖规则，无法仅凭空结果断定某个文件的具体原因。')
      const push = api.pushStatus?.(); if (push) detailText(`主搜索推送：${push.enabled ? '已启用（还需宿主开关）' : '关闭'}${push.lastError ? '\n最近错误：' + push.lastError : ''}`)
      if (!windows) {
        detailText('内容额外排除配置：' + config)
        const pre = document.createElement('pre'); pre.textContent = skipped || '未配置额外排除目录'; $('detail-body').append(pre)
      }
      detailButton('重新读取状态', diagnostics)
    } catch (error) { if (version === detailGeneration) { $('detail-body').replaceChildren(); detailText(error.message) } }
  }
  /** 安装及权限只提供指引；不自动下载、不调整系统权限、不创建另一份索引。 */
  function connectionHelp() {
    const version = openDetail('使用与连接')
    if (windows) {
      detailText('Windows 使用 Everything 的本地索引。请安装并运行 Everything 客户端，再点击“重新检测”。只启动系统服务无法搜索。')
      if (connectionReport) detailText(connectionReport.usable ? 'Everything ' + connectionReport.status.version + ' 已连接。' : connectionReport.title + '\n' + connectionReport.detail)
    } else {
      detailText('macOS 版是连接独立 FSearch 引擎的第三方插件。初始验证：Apple Silicon、ZTools 3.3.0-beta.2、FSearch 0.2.1；Intel Mac 尚未实机验证。')
      detailText('1. 从 FSearch 官方 v0.2.1 发布页下载适合本机的程序，按文档执行 ./fsearch install。标准安装位置为 ~/.local/bin/fsearch。插件不会自动下载或覆盖引擎。')
      detailText('2. 在“系统设置 → 隐私与安全性 → 完全磁盘访问权限”按 FSearch 文档授权。登录项方式需要授权 ~/.local/bin/fsearch；从终端启动则注意终端的权限。权限不足仍可搜索可访问目录。')
      detailText('3. 在终端运行 ~/.local/bin/fsearch status，首次索引建立需要时间。返回插件点击“重新检测”。无需开放 HTTP 端口，也无需为插件另装 Node.js。')
      if (connectionReport) {
        const r = connectionReport
        if (!r.usable) detailText(`${r.title}\n${r.message}\n具体原因：${r.detail}`)
        else {
          detailText(`连接状态：${r.state === 'limited' ? '可用，部分目录权限受限' : r.state === 'content-indexing' ? '可用，正文索引更新中' : '可用'}\n已验证：${r.capabilities.join('、')}\n安装文件：${r.identity.version ? '与官方 FSearch ' + r.identity.version + ' 文件一致' : '不在已验证指纹列表内，当前接口探针通过'}\n检测时间：${new Date(r.checkedAt).toLocaleString('zh-CN')}`)
          if (r.identity.warning) detailText(r.identity.warning)
          if (r.arch !== 'arm64') detailText('当前架构未实机验证；接口检测通过不代表所有系统操作都已验收。')
          detailText('安装文件指纹不能证明正在运行的守护进程版本。接口探针不等于全盘覆盖或所有筛选、分页行为的完整验收。')
        }
        detailText(`程序：${r.binaryPath}\n本地连接：${r.socketPath}`)
      }
    }
    detailText('索引由本地引擎管理。插件不上传文件名或正文；会在 ZTools 本地保存偏好、预设和可关闭的上次搜索条件。打开帮助网页才会连接对应网站；提供反馈前请移除私人路径与搜索内容。')
    detailButton('重新检测', async () => {
      const active = lifecycle, ready = await refreshStatus(true)
      if (ready === null || active !== lifecycle) return
      if (ready) queueSearch()
      // 用户已关闭或切换面板时不重新弹出；旧检测也不能覆盖新一轮检测。
      if (version === detailGeneration && !$('detail-panel').hidden) connectionHelp()
    })
    if (api.openHelp) {
      if (windows) detailButton('Everything 下载', () => api.openHelp('everything'))
      else { detailButton('FSearch 安装文档', () => api.openHelp('install')); detailButton('权限说明', () => api.openHelp('permissions')) }
      detailButton('插件仓库', () => api.openHelp('project'))
    }
  }
  /** 按范围更新控件后再应用模式，防止原生模式的动态选项丢失。 */
  function applyOptions(options = {}) {
    const o = { query: '', category: 'all', directory: '', mode: windows ? 'literal' : 'native', field: windows ? 'name' : 'engine', caseSensitive: false, pageSize: 50, extensions: '', modified: '', size: '', exclude: '', git: '', boost: false, browse: false, ...options }
    if (windows) {
      if (!['name', 'path'].includes(o.field)) Object.assign(o, { field: 'name', mode: 'literal' })
      Object.assign(o, { file: undefined, git: '', boost: false })
    }
    if (typeof o.query !== 'string' || !api.categories.some(c => c.id === o.category) || !['name', 'path', 'content', 'symbol', 'engine'].includes(o.field)) throw new Error('搜索条件格式无效')
    query = o.query; category = o.category; contentFile = o.file || null; $('match-field').value = o.field; updateModeHint()
    $('match-mode').value = o.mode
    if (!$('match-mode').value) throw new Error('当前范围不支持保存的匹配模式')
    for (const [key, id] of Object.entries({ directory: 'directory', pageSize: 'page-size', extensions: 'extensions', modified: 'modified', size: 'size', exclude: 'exclude', git: 'git' })) $(id).value = o[key]
    $('match-case').setAttribute('aria-pressed', String(o.caseSensitive)); $('boost').checked = o.boost; $('browse').checked = o.browse
    updateModeHint(); renderCategories(); updateCategoryTitle(); updateFilterSummary()
  }
  async function newSearch() {
    if (phase !== 'active') { await enter({ code: 'search-new', type: 'text' }); api.focusInput(true); return }
    applyOptions(); sourceFile = null; renderSourceFile(); basePage = 0; pageOffsets = [0]; pageStarts = [0]; pageIndex = 0; restoreState = null
    await window.ztools.setSubInputValue(''); schedule(); api.focusInput(true)
  }
  function renderSourceFile() {
    $('source-file').hidden = !sourceFile; $('source-file-actions').replaceChildren()
    if (!sourceFile) return
    const targetFile = sourceFile
    $('source-file-name').textContent = '来自文件：' + api.name(sourceFile); $('source-file-name').title = sourceFile
    const actions = [['打开', () => api.open(targetFile)], ['定位', () => api.reveal(targetFile)], ['复制路径', () => copyPath({ path: targetFile })]]
    if (!windows) actions.push(['搜此文件正文', async () => {
      const target = targetFile
      applyOptions({ field: 'content', mode: 'literal', file: target }); sourceFile = target; renderSourceFile(); await window.ztools.setSubInputValue(''); schedule(); api.focusInput(true)
    }])
    for (const [label, action] of actions) { const button = document.createElement('button'); button.textContent = label; button.onclick = () => Promise.resolve().then(action).catch(error => showNotice(error.message)); $('source-file-actions').append(button) }
  }
  function renderPreferences() {
    for (const [key, id] of Object.entries({ autoHide: 'pref-auto-hide', copyHide: 'pref-copy-hide', remember: 'pref-remember', mainPush: 'pref-push' })) $(id).checked = settings.integration[key]
    $('pref-workspace').value = settings.integration.workspace
  }
  function changePreference() {
    try {
      const prefs = { autoHide: $('pref-auto-hide').checked, copyHide: $('pref-copy-hide').checked, remember: $('pref-remember').checked, mainPush: $('pref-push').checked, workspace: $('pref-workspace').value.trim() }
      saveSettings({ ...settings, integration: prefs })
    } catch (error) { renderPreferences(); showNotice(error.message) }
  }
  ;['pref-auto-hide', 'pref-copy-hide', 'pref-remember', 'pref-push', 'pref-workspace'].forEach(id => $(id).addEventListener('change', changePreference))
  $('shortcut-settings').onclick = () => { try { api.shortcutSettings() } catch (error) { showNotice(error.message) } }
  $('new-search').onclick = () => newSearch().catch(error => showNotice(error.message))
  function renderPresets() {
    const previousName = $('presets').value === '' ? null : $('presets').selectedOptions[0]?.textContent
    $('presets').replaceChildren(new Option('选择已保存预设', ''))
    settings.presets.forEach((preset, index) => $('presets').append(new Option(preset.name, String(index))))
    const index = settings.presets.findIndex(p => p.name === previousName)
    if (index >= 0) $('presets').value = String(index)
    $('delete-preset').disabled = index < 0
  }
  function saveSettings(next) {
    // 宿主存储可能失败，成功前不能更新内存或显示保存成功。
    api.saveSettings(next); settings = next; renderPresets(); showToast('设置已保存')
  }
  try {
    const saved = api.loadSettings?.()
    if (saved) {
      if (!Array.isArray(saved.presets) || saved.presets.length > 20 || saved.presets.some(p => typeof p.name !== 'string' || !p.options) || !['vscode', 'cursor'].includes(saved.editor)) throw new Error('搜索设置格式无效')
      settings = { ...saved, integration: { ...preferenceDefaults, ...saved.integration } }
    }
  } catch (error) { showNotice(error.message) }
  settings.integration = { ...preferenceDefaults, ...settings.integration }
  $('editor').value = settings.editor; renderPresets(); renderPreferences()
  $('close-detail').onclick = () => closeDetail()
  $('open-filters').onclick = () => { closeDetail(false); filterFocus = document.activeElement; $('advanced').hidden = false; syncPanelLayout(); $('close-filters').focus() }
  $('close-filters').onclick = () => closeFilters()
  $('panel-backdrop').onclick = () => { closeFilters(); closeDetail() }
  $('diagnostics').onclick = diagnostics
  $('connection-help').onclick = connectionHelp
  $('location').onchange = () => { const value = $('location').value; if (!value) return; $('directory').value = value === 'all' ? '' : value === 'home' ? api.home() : api.home() + '/' + value; schedule() }
  ;['extensions', 'size', 'exclude'].forEach(id => $(id).addEventListener('input', schedule))
  ;['modified', 'git', 'boost', 'browse'].forEach(id => $(id).addEventListener('change', schedule))
  $('reset-filters').onclick = () => { ['extensions', 'modified', 'size', 'exclude', 'git'].forEach(id => { $(id).value = '' }); $('boost').checked = false; $('browse').checked = false; schedule() }
  $('editor').onchange = () => { try { saveSettings({ ...settings, editor: $('editor').value }) } catch (error) { $('editor').value = settings.editor; showNotice(error.message) } }
  $('save-preset').onclick = () => {
    try {
      const name = $('preset-name').value.trim()
      if (!name) throw new Error('请输入预设名称')
      const options = { ...searchOptions(), offset: 0 }
      const presets = settings.presets.slice(), found = presets.findIndex(p => p.name === name)
      if (found >= 0) presets[found] = { name, options, command: $('preset-command').checked }
      else { if (presets.length >= 20) throw new Error('最多保存 20 个预设，请先删除不用的预设'); presets.push({ name, options, command: $('preset-command').checked }) }
      saveSettings({ ...settings, presets }); $('presets').value = String(presets.findIndex(p => p.name === name)); $('delete-preset').disabled = false
    } catch (error) { showNotice(error.message) }
  }
  $('delete-preset').onclick = () => { try { const index = Number($('presets').value); if ($('presets').value !== '') saveSettings({ ...settings, presets: settings.presets.filter((_, i) => i !== index) }) } catch (error) { showNotice(error.message) } }
  $('presets').onchange = async () => {
    if ($('presets').value === '') { $('delete-preset').disabled = true; return }
    const active = lifecycle, preset = settings.presets[Number($('presets').value)], o = preset.options
    applyOptions(o); sourceFile = o.file || null; renderSourceFile(); $('preset-name').value = preset.name; $('preset-command').checked = preset.command !== false; $('delete-preset').disabled = false
    await window.ztools.setSubInputValue(query); if (active === lifecycle) schedule()
  }
  $('refresh').innerHTML = svg('refresh'); $('empty-icon').innerHTML = svg('search')
  $('refresh').onclick = async () => { showNotice(''); if (await refreshStatus(true)) queueSearch() }
  $('match-mode').onchange = () => { updateModeHint(); schedule() }
  $('match-field').onchange = () => {
    if (isContent() && !api.categories.find(item => item.id === category).contentSupported) category = 'all'
    updateModeHint(); updateCategoryTitle(); renderCategories(); schedule()
  }
  $('match-case').onclick = () => {
    const enabled = $('match-case').getAttribute('aria-pressed') !== 'true'
    $('match-case').setAttribute('aria-pressed', String(enabled)); updateModeHint(); schedule()
  }
  $('page-size').onchange = schedule
  $('previous-page').onclick = () => changePage(-1)
  $('next-page').onclick = () => changePage(1)
  $('apply').onclick = schedule
  $('clear').onclick = () => { $('directory').value = ''; schedule() }
  document.addEventListener('compositionstart', event => { if (isEditing(event.target)) { composing = true; schedule() } })
  document.addEventListener('compositionend', event => { if (isEditing(event.target)) { composing = false; schedule() } })
  $('results').addEventListener('click', event => { if (!resultsValid) { event.preventDefault(); event.stopImmediatePropagation() } }, true)
  $('directory').addEventListener('keydown', event => { if (event.key === 'Enter' && !event.isComposing && !composing) { event.preventDefault(); event.stopPropagation(); schedule() } })
  document.addEventListener('keydown', event => {
    if (event.isComposing || composing || event.keyCode === 229) return
    if (modifiedKey(event) && event.key.toLowerCase() === 'l') { event.preventDefault(); api.focusInput(true); return }
    if (modifiedKey(event) && event.key.toLowerCase() === 'n' && !isEditing(event.target)) { event.preventDefault(); newSearch().catch(error => showNotice(error.message)); return }
    const modal = !$('advanced').hidden ? $('advanced') : !$('detail-panel').hidden && $('detail-panel').getAttribute('aria-modal') === 'true' ? $('detail-panel') : null
    if (event.key === 'Tab' && modal) {
      const controls = [...modal.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]')].filter(element => !element.hidden)
      const first = controls[0], last = controls.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    if (event.key === 'Tab' && !modal && !(event.target instanceof Element && event.target.closest('input,textarea,select,button,summary'))) {
      event.preventDefault()
      if (event.target === document.body || event.target === document) { api.focusResults(); if (resultsValid && rows.length) select(selected, true) }
      else api.focusInput(false)
      return
    }
    if (event.key === 'Escape') {
      if (!$('advanced').hidden) { event.preventDefault(); closeFilters(); return }
      if (!$('detail-panel').hidden) { event.preventDefault(); closeDetail(); return }
    }
    // 编辑输入框或选中文本时保留系统复制；只有结果区选择才复制文件完整路径。
    if (isEditing(event.target) || !resultsValid || !rows.length || window.getSelection()?.toString() || (!$('detail-panel').hidden && $('detail-panel').getAttribute('aria-modal') === 'true') || (event.target instanceof Element && event.target.closest('#detail-panel'))) return
    if (modifiedKey(event) && event.key.toLowerCase() === 'c') { event.preventDefault(); if (event.shiftKey) Promise.resolve().then(() => api.copyFile(rows[selected].path)).then(() => showToast('已复制文件，可直接粘贴')).catch(error => showNotice(error.message)); else copyPath(rows[selected]); return }
    if (event.target instanceof Element && event.target.closest('button,summary')) return
    if (event.key === ' ' && (isImage(rows[selected]) || !windows)) {
      event.preventDefault()
      if (isImage(rows[selected])) void previewImage(rows[selected])
      else Promise.resolve().then(() => api.quickLook(rows[selected].path)).catch(error => showNotice(error.message))
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); select((selected + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length, true) }
    else if (event.key === 'Enter') { event.preventDefault(); Promise.resolve().then(() => (modifiedKey(event) ? api.reveal : api.open)(rows[selected].path)).catch(error => showNotice(error.message)) }
  })
  /** 只保存条件、32 页游标和选中路径；退出不持有结果数组或正文。 */
  function snapshot() {
    return { options: searchOptions(), sourceFile, selectedPath: resultsValid ? rows[selected]?.path || null : null, scrollTop: resultsValid ? $('results').parentElement.scrollTop : 0, pageOffsets: pageOffsets.slice(), pageStarts: pageStarts.slice(), pageIndex, basePage }
  }
  function remember() { try { api.saveSession(snapshot()) } catch (error) { showNotice(error.message) } }
  function releaseUI(final) {
    generation++; connectionGeneration++; clearTimeout(timer); clearTimeout(toastTimer); if (frameId !== null) cancelAnimationFrame(frameId); frameId = null
    closeFilters(false); closeDetail(false); composing = false; resultsValid = false; loading = false; rows = []; restoreState = null; lastTiming = null
    resetThumbnails(); $('results').replaceChildren(); $('toast').hidden = true; setResultState()
    if (final) api.dispose(); else api.suspend()
  }
  /** 宿主重新进入优先使用显式参数；普通唤起才恢复会话，避免覆盖选中文本或 Finder 上下文。 */
  async function enter(action = { code: 'search' }) {
    const active = ++lifecycle; phase = 'entering'
    try {
      // 先消费本次 mainPush 令牌，再释放后台推送缓存，避免「更多结果」丢失入口参数。
      const pendingPlan = api.resolveEntry(action)
      releaseUI(false); connectionBlocked = true; showNotice('')
      const plan = await pendingPlan
      if (active !== lifecycle || phase !== 'entering') return
      let session = plan.kind === 'resume' ? api.loadSession() : null
      if (session) {
        if (!Array.isArray(session.pageOffsets) || !Array.isArray(session.pageStarts) || session.pageOffsets.length > 32 || session.pageOffsets.length !== session.pageStarts.length || !Number.isSafeInteger(session.pageIndex) || session.pageIndex < 0 || session.pageIndex >= session.pageOffsets.length || session.pageOffsets.some(n => !Number.isSafeInteger(n) || n < 0) || session.pageStarts.some(n => !Number.isSafeInteger(n) || n < 0)) throw new Error('上次搜索状态无效，请使用「新搜索」')
      }
      applyOptions(session?.options || plan.options || {})
      sourceFile = session?.sourceFile || plan.sourceFile || null; renderSourceFile()
      pageOffsets = session?.pageOffsets || [0]; pageStarts = session?.pageStarts || [0]; pageIndex = session?.pageIndex || 0; basePage = session?.basePage || 0
      restoreState = session ? { selectedPath: session.selectedPath, scrollTop: session.scrollTop } : { selectedPath: plan.selectPath, scrollTop: 0 }
      render(); updatePagination()
      await window.ztools.setSubInput(input => {
        if (phase !== 'active') return
        const value = typeof input === 'string' ? input : input.text
        if (query === value && !composing && !input?.isComposing) return
        closeFilters(false); closeDetail(false)
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
        query = value; composing = typeof input === 'object' && input.isComposing === true; schedule()
      }, windows ? '输入文件名或路径 · Ctrl+L 返回搜索框' : '输入文件名、正文或定义 · ⌘L 返回搜索框', true)
      if (active !== lifecycle || phase !== 'entering') return
      await window.ztools.setSubInputValue(query)
      if (active !== lifecycle || phase !== 'entering') return
      phase = 'active'
      if (plan.configureWorkspace) {
        showNotice(plan.notice); emptyState('设置工作目录', plan.notice); $('open-filters').click(); $('pref-workspace').focus(); return
      }
      const ready = await refreshStatus()
      if (ready && active === lifecycle && phase === 'active') { queueSearch(); if (api.integrationError) showNotice(api.integrationError) }
    } catch (error) { if (active === lifecycle) { phase = 'error'; emptyState('未能开始搜索', error.message); showNotice(error.message) } }
  }
  window.ztools.onPluginEnter(enter)
  window.ztools.onPluginOut(isKill => {
    const hiddenReturn = !isKill && phase === 'suspended'
    if (phase === 'active') remember()
    lifecycle++; phase = 'out'
    // 宿主隐藏后的自动返回也会发普通退出，不能因此杀掉正在看的系统预览。
    // 可见退出、终止进程或 beforeunload 会释放预览；隐藏时保留的预览由用户关闭。
    releaseUI(!hiddenReturn); window.ztools.removeSubInput()
  })
  window.ztools.onPluginDetach?.(() => api.setDetached(true))
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && ['active', 'entering'].includes(phase)) { if (phase === 'active') remember(); lifecycle++; phase = 'suspended'; releaseUI(false) }
    else if (document.visibilityState === 'visible' && phase === 'suspended') void enter()
  })
  // 宿主把导航键发送给插件 WebContents；失去焦点时清除旧按钮焦点，避免顶部回车误触旧按钮。
  window.addEventListener('blur', () => { if (phase === 'active' && $('advanced').hidden && $('detail-panel').hidden && document.activeElement instanceof HTMLElement) document.activeElement.blur() })
  window.addEventListener('beforeunload', () => { if (phase === 'active') remember(); api.dispose() })
  renderCategories(); updateModeHint(); updateCategoryTitle(); updatePagination()
})()
