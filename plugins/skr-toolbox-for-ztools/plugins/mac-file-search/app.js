(function () {
  const SEARCH_DELAY_MS = 160
  const DEFAULT_LIMIT = 200
  const TRIGGER_WORDS = new Set(['find', '文件搜索', '搜索文件'])
  const PUSH_PREFIX_RE = /^[ '\u2018\u2019]+/
  const CATEGORY_DEFS = [
    { id: 'all', label: '全部' },
    { id: 'folder', label: '文件夹' },
    { id: 'excel', label: 'EXCEL' },
    { id: 'word', label: 'WORD' },
    { id: 'ppt', label: 'PPT' },
    { id: 'pdf', label: 'PDF' },
    { id: 'image', label: '图片' },
    { id: 'video', label: '视频' },
    { id: 'audio', label: '音频' },
    { id: 'archive', label: '压缩文件' }
  ]
  const EXT_GROUPS = {
    excel: new Set(['xls', 'xlsx', 'xlsm', 'xlsb', 'csv', 'numbers', 'ods']),
    word: new Set(['doc', 'docx', 'docm', 'rtf', 'odt', 'pages']),
    ppt: new Set(['ppt', 'pptx', 'pptm', 'pps', 'ppsx', 'key', 'odp']),
    image: new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'heic', 'svg', 'tif', 'tiff']),
    video: new Set(['mp4', 'mov', 'm4v', 'avi', 'mkv', 'flv', 'wmv', 'webm']),
    audio: new Set(['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'aiff']),
    archive: new Set(['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'tgz', 'tar.gz'])
  }

  const state = {
    query: '',
    directory: '',
    loading: false,
    error: '',
    results: [],
    selectedIndex: -1,
    categoryId: 'all'
  }

  const els = {
    resultList: document.getElementById('result-list'),
    categoryList: document.getElementById('category-list')
  }

  const homePath = safeGetHomePath()

  let searchTimer = null
  let searchNonce = 0

  function safeGetHomePath() {
    try {
      if (window.fileSearchApi && typeof window.fileSearchApi.getPath === 'function') {
        return window.fileSearchApi.getPath('home') || ''
      }
    } catch (error) {
      // ignore
    }
    return ''
  }

  function normalizeDisplayPath(fullPath) {
    if (!homePath || typeof fullPath !== 'string') return fullPath
    if (fullPath === homePath) return '~'
    if (fullPath.startsWith(homePath + '/')) {
      return '~' + fullPath.slice(homePath.length)
    }
    return fullPath
  }

  function formatBytes(size) {
    if (!Number.isFinite(size) || size < 0) return '-'
    if (size < 1024) return size + ' B'
    if (size < 1024 * 1024) return (size / 1024).toFixed(1) + ' KB'
    if (size < 1024 * 1024 * 1024) return (size / (1024 * 1024)).toFixed(1) + ' MB'
    return (size / (1024 * 1024 * 1024)).toFixed(1) + ' GB'
  }

  function formatTime(mtimeMs) {
    if (!Number.isFinite(mtimeMs) || mtimeMs <= 0) return '-'
    return new Date(mtimeMs).toLocaleString('zh-CN', { hour12: false })
  }

  function dirnameOf(filePath) {
    if (typeof filePath !== 'string' || !filePath) return ''
    if (filePath === '/') return '/'
    const index = filePath.lastIndexOf('/')
    if (index <= 0) return '/'
    return filePath.slice(0, index)
  }

  function extOf(item) {
    return String((item && item.ext) || '').toLowerCase()
  }

  function hasExt(item, extSet) {
    return extSet.has(extOf(item))
  }

  function isCategoryMatched(item, categoryId) {
    if (categoryId === 'all') return true
    if (categoryId === 'folder') return Boolean(item.isDirectory)
    if (item.isDirectory) return false

    switch (categoryId) {
      case 'excel':
        return hasExt(item, EXT_GROUPS.excel)
      case 'word':
        return hasExt(item, EXT_GROUPS.word)
      case 'ppt':
        return hasExt(item, EXT_GROUPS.ppt)
      case 'pdf':
        return extOf(item) === 'pdf'
      case 'image':
        return hasExt(item, EXT_GROUPS.image)
      case 'video':
        return hasExt(item, EXT_GROUPS.video)
      case 'audio':
        return hasExt(item, EXT_GROUPS.audio)
      case 'archive':
        return hasExt(item, EXT_GROUPS.archive)
      default:
        return true
    }
  }

  function getVisibleResults() {
    return state.results.filter((item) => isCategoryMatched(item, state.categoryId))
  }

  function renderEmpty(text) {
    els.resultList.innerHTML = ''
    const empty = document.createElement('li')
    empty.className = 'empty'
    empty.textContent = text
    els.resultList.appendChild(empty)
  }

  function renderCategories() {
    if (!els.categoryList) return

    const fragment = document.createDocumentFragment()
    CATEGORY_DEFS.forEach((category) => {
      const count = state.results.filter((item) => isCategoryMatched(item, category.id)).length
      const li = document.createElement('li')

      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'category-item'
      if (category.id === state.categoryId) {
        button.classList.add('active')
      }
      button.addEventListener('click', () => {
        state.categoryId = category.id
        const visible = getVisibleResults()
        state.selectedIndex = visible.length ? 0 : -1
        render()
      })

      const label = document.createElement('span')
      label.className = 'category-label'
      label.textContent = category.label
      const countEl = document.createElement('span')
      countEl.className = 'category-count'
      countEl.textContent = String(count)

      button.appendChild(label)
      button.appendChild(countEl)
      li.appendChild(button)
      fragment.appendChild(li)
    })

    els.categoryList.innerHTML = ''
    els.categoryList.appendChild(fragment)
  }

  function createActionButton(label, onClick) {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = label
    button.addEventListener('click', (event) => {
      event.stopPropagation()
      onClick()
    })
    return button
  }

  function openResult(item) {
    window.fileSearchApi.openPath(item.path)
    if (window.ztools && typeof window.ztools.hideMainWindow === 'function') {
      window.ztools.hideMainWindow(true)
    }
  }

  function revealResult(item) {
    window.fileSearchApi.showInFinder(item.path)
  }

  function copyPath(item) {
    window.fileSearchApi.copyText(item.path)
  }

  function renderResults() {
    const visibleResults = getVisibleResults()

    if (!state.query.trim()) {
      state.selectedIndex = -1
      renderEmpty('输入关键词后将显示搜索结果')
      return
    }

    if (state.error) {
      state.selectedIndex = -1
      renderEmpty(state.error)
      return
    }

    if (!visibleResults.length) {
      state.selectedIndex = -1
      renderEmpty('没有匹配结果')
      return
    }

    if (state.selectedIndex < 0 || state.selectedIndex >= visibleResults.length) {
      state.selectedIndex = 0
    }

    const fragment = document.createDocumentFragment()

    visibleResults.forEach((item, index) => {
      const row = document.createElement('li')
      row.className = 'result-item'
      if (index === state.selectedIndex) {
        row.classList.add('is-active')
      }
      row.tabIndex = 0
      row.addEventListener('click', () => {
        state.selectedIndex = index
        renderResults()
      })
      row.addEventListener('dblclick', () => {
        openResult(item)
      })

      const head = document.createElement('div')
      head.className = 'result-head'

      const name = document.createElement('div')
      name.className = 'result-name'
      name.textContent = item.name || item.path

      const badge = document.createElement('span')
      badge.className = 'badge'
      badge.textContent = item.isDirectory ? '目录' : '文件'

      head.appendChild(name)
      head.appendChild(badge)

      const pathEl = document.createElement('div')
      pathEl.className = 'result-path'
      pathEl.textContent = normalizeDisplayPath(item.path)

      const foot = document.createElement('div')
      foot.className = 'result-foot'

      const meta = document.createElement('div')
      meta.className = 'meta'
      const sizeText = item.isDirectory ? '目录' : formatBytes(item.size)
      meta.textContent = `${sizeText} · ${formatTime(item.mtimeMs)}`

      const actions = document.createElement('div')
      actions.className = 'actions'
      actions.appendChild(createActionButton('打开', () => openResult(item)))
      actions.appendChild(createActionButton('定位', () => revealResult(item)))
      actions.appendChild(createActionButton('复制路径', () => copyPath(item)))

      foot.appendChild(meta)
      foot.appendChild(actions)

      row.appendChild(head)
      row.appendChild(pathEl)
      row.appendChild(foot)

      fragment.appendChild(row)
    })

    els.resultList.innerHTML = ''
    els.resultList.appendChild(fragment)
  }

  function render() {
    renderCategories()
    renderResults()
  }

  function scheduleSearch() {
    clearTimeout(searchTimer)
    searchTimer = setTimeout(runSearch, SEARCH_DELAY_MS)
  }

  async function runSearch() {
    const query = state.query.trim()
    if (!query) {
      state.loading = false
      state.error = ''
      state.results = []
      state.selectedIndex = -1
      render()
      return
    }

    if (!window.fileSearchApi || typeof window.fileSearchApi.searchFiles !== 'function') {
      state.loading = false
      state.error = 'preload API 未就绪'
      render()
      return
    }

    const nonce = ++searchNonce
    state.loading = true
    state.error = ''
    render()

    try {
      const results = await window.fileSearchApi.searchFiles({
        query,
        directory: state.directory || undefined,
        limit: DEFAULT_LIMIT
      })
      if (nonce !== searchNonce) return

      state.loading = false
      state.results = Array.isArray(results) ? results : []
      state.selectedIndex = getVisibleResults().length ? 0 : -1
      render()
    } catch (error) {
      if (nonce !== searchNonce) return
      state.loading = false
      state.error = error && error.message ? error.message : String(error)
      state.results = []
      state.selectedIndex = -1
      render()
    }
  }

  function extractQueryFromAction(action) {
    if (!action || typeof action.payload !== 'string') return ''
    const text = action.payload.trim()
    if (!text) return ''

    if (action.code === 'find-push') {
      return text.replace(PUSH_PREFIX_RE, '').trim()
    }

    if (action.type === 'text') {
      const lower = text.toLowerCase()
      if (TRIGGER_WORDS.has(text) || TRIGGER_WORDS.has(lower)) {
        return ''
      }
    }

    return text
  }

  function applyDirectoryFromAction(action) {
    if (!action) return

    if (action.type === 'files' && Array.isArray(action.payload) && action.payload.length) {
      const first = action.payload[0]
      const targetPath = typeof first === 'string' ? first : first && first.path
      if (typeof targetPath === 'string' && targetPath) {
        const looksDirectory = Boolean(
          first && typeof first === 'object' && (first.isDirectory || first.type === 'directory')
        )
        state.directory = looksDirectory ? targetPath : dirnameOf(targetPath)
      }
      return
    }

    if (action.type === 'regex' && typeof action.payload === 'string' && action.payload.startsWith('/')) {
      state.directory = action.payload
      return
    }

    if (action.type === 'window' && window.fileSearchApi && window.fileSearchApi.readCurrentFolderPath) {
      window.fileSearchApi
        .readCurrentFolderPath()
        .then((folder) => {
          if (typeof folder === 'string' && folder) {
            state.directory = folder
            scheduleSearch()
            render()
          }
        })
        .catch(() => {
          // ignore
        })
    }
  }

  function installSubInput() {
    if (!window.ztools || typeof window.ztools.setSubInput !== 'function') return

    window.ztools.setSubInput(
      (input) => {
        const text = typeof input === 'string' ? input : input && typeof input.text === 'string' ? input.text : ''
        state.query = text
        state.error = ''
        scheduleSearch()
        render()
      },
      '搜索',
      true
    )

    if (typeof window.ztools.setSubInputValue === 'function') {
      window.ztools.setSubInputValue(state.query)
    }
  }

  function moveSelection(step) {
    const visible = getVisibleResults()
    if (!visible.length) return

    const total = visible.length
    const current = state.selectedIndex < 0 ? 0 : state.selectedIndex
    state.selectedIndex = (current + step + total) % total
    renderResults()
  }

  function currentResult() {
    const visible = getVisibleResults()
    if (state.selectedIndex < 0 || state.selectedIndex >= visible.length) return null
    return visible[state.selectedIndex]
  }

  function bindKeyboard() {
    document.addEventListener('keydown', (event) => {
      if (!getVisibleResults().length) return

      if (event.key === 'ArrowDown') {
        event.preventDefault()
        moveSelection(1)
        return
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault()
        moveSelection(-1)
        return
      }

      const item = currentResult()
      if (!item) return

      if (event.key === 'Enter') {
        event.preventDefault()
        if (event.metaKey || event.ctrlKey) {
          revealResult(item)
        } else {
          openResult(item)
        }
        return
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'c') {
        event.preventDefault()
        copyPath(item)
      }
    })
  }

  function initEventBindings() {
    bindKeyboard()

    if (window.ztools && typeof window.ztools.onPluginEnter === 'function') {
      window.ztools.onPluginEnter((action) => {
        applyDirectoryFromAction(action)
        state.query = extractQueryFromAction(action)
        state.error = ''

        installSubInput()
        scheduleSearch()
        render()
      })
    }

    if (window.ztools && typeof window.ztools.onPluginOut === 'function') {
      window.ztools.onPluginOut(() => {
        if (window.fileSearchApi && typeof window.fileSearchApi.abortSearch === 'function') {
          window.fileSearchApi.abortSearch()
        }
        if (window.ztools && typeof window.ztools.removeSubInput === 'function') {
          window.ztools.removeSubInput()
        }
      })
    }
  }

  function preflight() {
    if (!window.fileSearchApi || typeof window.fileSearchApi.isMac !== 'function') return
    if (!window.fileSearchApi.isMac()) {
      state.error = '该插件仅支持 macOS'
    }
  }

  preflight()
  initEventBindings()
  render()
})()
