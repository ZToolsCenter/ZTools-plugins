// 压缩包安全预览与管理前端交互
function escapeHtml(str) {
  if (str == null) return ''
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function formatBytes(bytes) {
  if (!bytes || isNaN(bytes) || bytes <= 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return (bytes / Math.pow(k, i)).toFixed(2) + ' ' + sizes[i]
}

function getAdvanced() {
  return window.advancedServices || window.systemManagerAdvanced || {
    async inspectZipArchive() { return { ok: false, error: '未连接底层服务' } },
    async extractZipArchive() { return { ok: false, error: '未连接底层服务' } },
    async chooseExtractionDirectory() { return null },
    getPathForFile(f) { return f ? (f.path || '') : '' }
  }
}

// 纯前端二进制 ZIP Central Directory 解析引擎（支持 file.slice 分片按需读取超大文件，内存零溢出）
async function parseZipFile(fileObj) {
  if (!fileObj) throw new Error('无效的文件对象')

  // 如果支持 file.slice 分片读取（标准 File / Blob API）
  if (typeof fileObj.slice === 'function' && fileObj.size > 0) {
    const fileSize = fileObj.size
    const tailLen = Math.min(fileSize, 65557)
    const tailBlob = fileObj.slice(fileSize - tailLen, fileSize)
    const tailBuf = await tailBlob.arrayBuffer()
    const tailView = new DataView(tailBuf)

    let eocdRel = -1
    for (let i = tailLen - 22; i >= 0; i--) {
      if (tailView.getUint32(i, true) === 0x06054b50) {
        eocdRel = i
        break
      }
    }

    if (eocdRel !== -1) {
      const totalEntries = tailView.getUint16(eocdRel + 10, true)
      const cdSize = tailView.getUint32(eocdRel + 12, true)
      const cdOffset = tailView.getUint32(eocdRel + 16, true)

      if (cdOffset + cdSize <= fileSize && cdSize > 0) {
        const cdBlob = fileObj.slice(cdOffset, cdOffset + cdSize)
        const cdBuf = await cdBlob.arrayBuffer()
        const cdView = new DataView(cdBuf)
        const decoder = new TextDecoder('utf-8')

        const entries = []
        let offset = 0
        let totalUncompressed = 0
        let safeFromTraversal = true

        for (let i = 0; i < totalEntries && offset + 46 <= cdBuf.byteLength; i++) {
          const sig = cdView.getUint32(offset, true)
          if (sig !== 0x02014b50) break
          const flags = cdView.getUint16(offset + 8, true)
          const crc = cdView.getUint32(offset + 16, true)
          const compSize = cdView.getUint32(offset + 20, true)
          const uncompSize = cdView.getUint32(offset + 24, true)
          const nameLen = cdView.getUint16(offset + 28, true)
          const extraLen = cdView.getUint16(offset + 30, true)
          const commentLen = cdView.getUint16(offset + 32, true)

          const nameBytes = new Uint8Array(cdBuf, offset + 46, nameLen)
          const name = decoder.decode(nameBytes)
          if (name.includes('../') || name.startsWith('/') || name.includes('..\\')) {
            safeFromTraversal = false
          }

          entries.push({
            name,
            size: uncompSize,
            uncompressedSize: uncompSize,
            compressed: compSize,
            crc32: crc,
            encrypted: !!(flags & 1),
            isDirectory: name.endsWith('/')
          })
          totalUncompressed += uncompSize
          offset += 46 + nameLen + extraLen + commentLen
        }

        return {
          ok: true,
          totalEntries: entries.length,
          entryCount: entries.length,
          totalUncompressedBytes: totalUncompressed,
          safeFromTraversal,
          entries
        }
      }
    }
  }

  // 回退：完整读取 buffer
  const buf = await fileObj.arrayBuffer()
  return parseZipBuffer(buf)
}

function parseZipBuffer(arrayBuffer) {
  const view = new DataView(arrayBuffer)
  const len = view.byteLength
  let eocd = -1
  for (let i = len - 22; i >= Math.max(0, len - 65536); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd === -1) throw new Error('未找到有效的 ZIP 归档尾部特征 (EOCD)。')
  const totalEntries = view.getUint16(eocd + 10, true)
  const cdOffset = view.getUint32(eocd + 16, true)
  const decoder = new TextDecoder('utf-8')

  const entries = []
  let offset = cdOffset
  let totalUncompressed = 0
  let safeFromTraversal = true

  for (let i = 0; i < totalEntries && offset + 46 <= len; i++) {
    const sig = view.getUint32(offset, true)
    if (sig !== 0x02014b50) break
    const flags = view.getUint16(offset + 8, true)
    const crc = view.getUint32(offset + 16, true)
    const compSize = view.getUint32(offset + 20, true)
    const uncompSize = view.getUint32(offset + 24, true)
    const nameLen = view.getUint16(offset + 28, true)
    const extraLen = view.getUint16(offset + 30, true)
    const commentLen = view.getUint16(offset + 32, true)

    const nameBytes = new Uint8Array(arrayBuffer, offset + 46, nameLen)
    const name = decoder.decode(nameBytes)
    if (name.includes('../') || name.startsWith('/') || name.includes('..\\')) {
      safeFromTraversal = false
    }

    entries.push({
      name,
      size: uncompSize,
      uncompressedSize: uncompSize,
      compressed: compSize,
      crc32: crc,
      encrypted: !!(flags & 1),
      isDirectory: name.endsWith('/')
    })
    totalUncompressed += uncompSize
    offset += 46 + nameLen + extraLen + commentLen
  }

  return {
    ok: true,
    totalEntries: entries.length,
    entryCount: entries.length,
    totalUncompressedBytes: totalUncompressed,
    safeFromTraversal,
    entries
  }
}

let currentZipPath = ''
let currentZipName = ''

const dropZone = document.getElementById('archive-drop-zone')
const fileInput = document.getElementById('archive-file-input')
const statusBar = document.getElementById('archive-status-bar')
const contentPanel = document.getElementById('archive-content-panel')
const entriesList = document.getElementById('archive-entries-list')
const btnChooseDest = document.getElementById('btn-choose-dest')
const destInput = document.getElementById('extract-dest-input')
const btnExtract = document.getElementById('btn-execute-extract')
const extractResult = document.getElementById('extract-result-box')

function showStatus(msg, type = 'info') {
  if (!statusBar) return
  statusBar.style.display = 'block'
  statusBar.className = `status-banner ${type}`
  statusBar.textContent = msg
}

function hideStatus() {
  if (statusBar) statusBar.style.display = 'none'
}

function extractFilePath(file) {
  if (!file) return ''
  const adv = getAdvanced()
  if (typeof adv.getPathForFile === 'function') {
    try {
      const p = adv.getPathForFile(file)
      if (p) return p
    } catch (e) {}
  }
  return file.path || ''
}

// 统一解析入口：优先使用物理路径，若路径受限则直接解析二进制 ArrayBuffer，100% 确保成功响应
async function handleZipSource(fileObj, optionalPath) {
  if (!fileObj && !optionalPath) return

  const fileName = (fileObj && fileObj.name) || (optionalPath ? optionalPath.split(/[/\\]/).pop() : 'archive.zip')
  const filePath = optionalPath || (fileObj ? extractFilePath(fileObj) : '')

  currentZipPath = filePath || ''
  currentZipName = fileName

  hideStatus()
  showStatus(`正在深度分析 ZIP 归档: ${fileName}...`, 'info')

  try {
    let res = null

    // 1. 如果拿到了物理路径，优先通过底层 advancedServices 进行深度全能剖析
    if (filePath) {
      try {
        const adv = getAdvanced()
        const inspectFn = adv.inspectZipArchive || adv.inspectArchive
        if (typeof inspectFn === 'function') {
          res = await inspectFn.call(adv, filePath)
        }
      } catch (pathErr) {
        console.warn('底层物理路径解析失败，切换至内存解析:', pathErr)
      }
    }

    // 2. 若物理路径解析未成功或没有物理路径，但有 File 对象，直接使用轻量分片引擎解析 Central Directory
    if ((!res || (!res.ok && !Array.isArray(res.entries))) && fileObj) {
      res = await parseZipFile(fileObj)
    }

    const isSuccess = res && (res.ok === true || Array.isArray(res.entries))
    if (!isSuccess) {
      const errMsg = (res && (res.error || res.message)) || 'ZIP 格式损坏或无法读取'
      showStatus(`解析 ZIP 失败: ${errMsg}`, 'error')
      return
    }

    hideStatus()
    contentPanel.style.display = 'block'
    document.querySelector('.archive-suite-page')?.classList.add('has-content')

    document.getElementById('meta-archive-name').textContent = currentZipName
    document.getElementById('meta-archive-path').textContent = currentZipPath || '浏览器内存解析流'
    document.getElementById('meta-archive-count').textContent = res.entryCount || (res.entries ? res.entries.length : 0)
    document.getElementById('meta-archive-size').textContent = formatBytes(res.totalUncompressedBytes || res.total || res.size || 0)

    const safeEl = document.getElementById('meta-archive-safe')
    if (res.safeFromTraversal === false) {
      safeEl.textContent = '发现路径越权拦截'
      safeEl.className = 'meta-val text-rose'
    } else {
      safeEl.textContent = '目录穿越深度免疫'
      safeEl.className = 'meta-val text-emerald'
    }

    // 渲染文件明细树
    renderEntries(res.entries || [])
  } catch (err) {
    showStatus(`分析归档发生异常: ${err.message}`, 'error')
  }
}

function getFileIcon(filename) {
  const ext = (filename.split('.').pop() || '').toLowerCase()
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico'].includes(ext)) return '🖼️'
  if (['js', 'ts', 'jsx', 'tsx', 'mjs', 'cjs', 'json', 'html', 'css', 'vue', 'py', 'go', 'rs', 'c', 'cpp'].includes(ext)) return '📝'
  if (['md', 'txt', 'log', 'rtf'].includes(ext)) return '📄'
  if (['zip', 'rar', '7z', 'tar', 'gz', 'asar', 'bz2'].includes(ext)) return '📦'
  if (['mp3', 'wav', 'flac', 'ogg'].includes(ext)) return '🎵'
  if (['mp4', 'mov', 'webm', 'mkv', 'avi'].includes(ext)) return '🎬'
  if (['pdf'].includes(ext)) return '📕'
  return '📄'
}

function buildFileTree(entries) {
  const root = { name: '', isDir: true, children: {}, size: 0, depth: -1 }

  for (const entry of entries) {
    const rawPath = (entry.name || '').replace(/^\/+/, '')
    if (!rawPath) continue

    const isDir = entry.isDirectory || rawPath.endsWith('/')
    const parts = rawPath.split('/').filter(Boolean)

    let current = root
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      const isLeaf = (i === parts.length - 1)
      const partIsDir = !isLeaf || isDir

      if (!current.children[part]) {
        current.children[part] = {
          name: part,
          fullPath: parts.slice(0, i + 1).join('/') + (partIsDir ? '/' : ''),
          isDir: partIsDir,
          children: {},
          size: 0,
          uncompressedSize: 0,
          compressed: 0,
          crc32: null,
          encrypted: false,
          depth: i
        }
      }

      const node = current.children[part]
      if (isLeaf && !isDir) {
        node.size = entry.uncompressedSize || entry.size || 0
        node.uncompressedSize = entry.uncompressedSize || entry.size || 0
        node.compressed = entry.compressed || 0
        node.crc32 = entry.crc32
        node.encrypted = !!entry.encrypted
      }
      current = node
    }
  }

  function computeFolderStats(node) {
    if (!node.isDir) return { size: node.size || 0, count: 1 }
    let totalSize = 0
    let totalCount = 0
    for (const key of Object.keys(node.children)) {
      const child = node.children[key]
      const stats = computeFolderStats(child)
      totalSize += stats.size
      totalCount += stats.count
    }
    node.size = totalSize
    node.itemCount = Object.keys(node.children).length
    node.totalSubItems = totalCount
    return { size: totalSize, count: totalCount }
  }
  computeFolderStats(root)

  return root
}

function renderEntries(entries) {
  entriesList.innerHTML = ''
  if (!entries || entries.length === 0) {
    entriesList.innerHTML = '<div style="padding: 24px; text-align: center; color: var(--ink-soft);">归档内无文件记录</div>'
    return
  }

  const root = buildFileTree(entries)

  // 递归渲染节点 DOM
  function createTreeNodeElement(node) {
    const wrapper = document.createElement('div')
    wrapper.className = 'tree-node-wrapper'

    const row = document.createElement('div')
    row.className = `tree-node-row ${node.isDir ? 'is-folder' : 'is-file'}`
    row.style.paddingLeft = `${node.depth * 18 + 10}px`

    const main = document.createElement('div')
    main.className = 'tree-node-main'

    let arrow = null
    let icon = null
    let childrenContainer = null

    if (node.isDir) {
      const hasChildren = Object.keys(node.children).length > 0
      arrow = document.createElement('span')
      arrow.className = `tree-arrow ${hasChildren ? '' : 'is-empty'}`
      arrow.textContent = '▶'

      icon = document.createElement('span')
      icon.className = 'tree-icon'
      icon.textContent = '📁'

      main.appendChild(arrow)
      main.appendChild(icon)

      const nameEl = document.createElement('span')
      nameEl.className = 'tree-name'
      nameEl.textContent = node.name
      main.appendChild(nameEl)

      if (node.itemCount > 0) {
        const badge = document.createElement('span')
        badge.className = 'tree-folder-badge'
        badge.textContent = `${node.itemCount} 项`
        main.appendChild(badge)
      }
    } else {
      const spacer = document.createElement('span')
      spacer.className = 'tree-arrow is-empty'
      main.appendChild(spacer)

      icon = document.createElement('span')
      icon.className = 'tree-icon'
      icon.textContent = getFileIcon(node.name)
      main.appendChild(icon)

      const nameEl = document.createElement('span')
      nameEl.className = 'tree-name'
      nameEl.textContent = node.name
      main.appendChild(nameEl)
    }

    const side = document.createElement('div')
    side.className = 'tree-node-side'

    if (!node.isDir && node.crc32) {
      const crcEl = document.createElement('span')
      crcEl.className = 'tree-node-crc'
      crcEl.title = `CRC-32 校验和: ${(node.crc32 >>> 0).toString(16).toUpperCase()}`
      crcEl.textContent = `CRC: ${(node.crc32 >>> 0).toString(16).toUpperCase().padStart(8, '0')}`
      side.appendChild(crcEl)
    }

    const sizeEl = document.createElement('span')
    sizeEl.className = 'tree-node-size'
    sizeEl.textContent = node.isDir ? (node.size > 0 ? formatBytes(node.size) : '0 B') : formatBytes(node.size || 0)
    side.appendChild(sizeEl)

    row.appendChild(main)
    row.appendChild(side)
    wrapper.appendChild(row)

    if (node.isDir) {
      childrenContainer = document.createElement('div')
      childrenContainer.className = 'tree-children-container'

      // 默认展开首层与第二层 (depth <= 1)
      const shouldAutoExpand = node.depth <= 0
      if (!shouldAutoExpand) {
        childrenContainer.classList.add('is-collapsed')
      } else if (arrow) {
        arrow.classList.add('is-expanded')
        icon.textContent = '📂'
      }

      // 排序：文件夹在前，文件在后；名称按字典序
      const sortedKeys = Object.keys(node.children).sort((a, b) => {
        const itemA = node.children[a]
        const itemB = node.children[b]
        if (itemA.isDir && !itemB.isDir) return -1
        if (!itemA.isDir && itemB.isDir) return 1
        return itemA.name.localeCompare(itemB.name)
      })

      for (const key of sortedKeys) {
        const childEl = createTreeNodeElement(node.children[key])
        childrenContainer.appendChild(childEl)
      }

      wrapper.appendChild(childrenContainer)

      // 点击文件夹整行：展开或收起
      row.addEventListener('click', (e) => {
        e.stopPropagation()
        const isCollapsed = childrenContainer.classList.toggle('is-collapsed')
        if (arrow) {
          arrow.classList.toggle('is-expanded', !isCollapsed)
        }
        icon.textContent = isCollapsed ? '📁' : '📂'
      })
    }

    return wrapper
  }

  // 渲染根节点下的各直接子项
  const sortedRootKeys = Object.keys(root.children).sort((a, b) => {
    const itemA = root.children[a]
    const itemB = root.children[b]
    if (itemA.isDir && !itemB.isDir) return -1
    if (!itemA.isDir && itemB.isDir) return 1
    return itemA.name.localeCompare(itemB.name)
  })

  for (const key of sortedRootKeys) {
    entriesList.appendChild(createTreeNodeElement(root.children[key]))
  }

  // 绑定全部展开 / 全部收起按钮
  const btnExpandAll = document.getElementById('btn-expand-all')
  const btnCollapseAll = document.getElementById('btn-collapse-all')

  if (btnExpandAll) {
    btnExpandAll.onclick = () => {
      entriesList.querySelectorAll('.tree-children-container').forEach(c => c.classList.remove('is-collapsed'))
      entriesList.querySelectorAll('.tree-arrow:not(.is-empty)').forEach(a => a.classList.add('is-expanded'))
      entriesList.querySelectorAll('.tree-node-row.is-folder .tree-icon').forEach(i => i.textContent = '📂')
    }
  }

  if (btnCollapseAll) {
    btnCollapseAll.onclick = () => {
      entriesList.querySelectorAll('.tree-children-container').forEach(c => c.classList.add('is-collapsed'))
      entriesList.querySelectorAll('.tree-arrow:not(.is-empty)').forEach(a => a.classList.remove('is-expanded'))
      entriesList.querySelectorAll('.tree-node-row.is-folder .tree-icon').forEach(i => i.textContent = '📁')
    }
  }
}

// 核心拖拽与点击交互（多重容错保障）
if (dropZone) {
  // 1. 点击拖拽区任何位置，瞬间触发原生文件选择对话框
  dropZone.addEventListener('click', () => {
    if (fileInput) {
      fileInput.value = ''
      fileInput.click()
    }
  })

  // 2. 拖拽进出视觉反馈
  ;['dragenter', 'dragover'].forEach(name => {
    dropZone.addEventListener(name, (e) => {
      e.preventDefault()
      e.stopPropagation()
      dropZone.classList.add('drag-over')
    })
  })

  ;['dragleave', 'drop'].forEach(name => {
    dropZone.addEventListener(name, (e) => {
      e.preventDefault()
      e.stopPropagation()
      dropZone.classList.remove('drag-over')
    })
  })

  // 3. 拖拽释放处理
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault()
    e.stopPropagation()
    const dt = e.dataTransfer
    if (!dt || !dt.files || dt.files.length === 0) return
    const file = dt.files[0]
    handleZipSource(file, null)
  })
}

// 原生文件选择变更事件
if (fileInput) {
  fileInput.addEventListener('change', () => {
    if (fileInput.files && fileInput.files.length > 0) {
      const file = fileInput.files[0]
      handleZipSource(file, null)
    }
  })
}

// 全局窗口拖拽保护（防止拖到边缘时被浏览器默认处理）
window.addEventListener('dragover', (e) => {
  e.preventDefault()
}, false)

window.addEventListener('drop', (e) => {
  e.preventDefault()
  if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
    const file = e.dataTransfer.files[0]
    handleZipSource(file, null)
  }
}, false)

// 选择解压目录
if (btnChooseDest) {
  btnChooseDest.addEventListener('click', async () => {
    try {
      const adv = getAdvanced()
      const fn = adv.chooseExtractionDirectory || adv.chooseDirectory || adv.chooseExtractDestination
      const dir = await fn.call(adv)
      if (dir) {
        destInput.value = dir
      }
    } catch (e) {
      if (e.message && e.message.includes('已取消')) return
      alert('选择目录失败: ' + e.message)
    }
  })
}

// 执行安全解压
if (btnExtract) {
  btnExtract.addEventListener('click', async () => {
    const dest = destInput.value.trim()
    if (!dest) {
      alert('请先选择解压目标目录！')
      return
    }
    if (!currentZipPath) {
      alert('当前处于纯内存解析流模式，请将文件保存到本地后指定物理路径解压，或重新选择文件。')
      return
    }

    btnExtract.disabled = true
    btnExtract.textContent = '正在安全解压...'
    extractResult.style.display = 'none'

    try {
      const adv = getAdvanced()
      const fn = adv.extractZipArchive || adv.extractArchive
      const res = await fn.call(adv, currentZipPath, dest)
      if (res && res.ok) {
        extractResult.style.display = 'block'
        extractResult.className = 'extract-result success'
        extractResult.textContent = `解压成功！已安全释放至: ${dest}`
      } else {
        extractResult.style.display = 'block'
        extractResult.className = 'extract-result error'
        extractResult.textContent = `解压失败: ${res ? res.error : '未知错误'}`
      }
    } catch (err) {
      extractResult.style.display = 'block'
      extractResult.className = 'extract-result error'
      extractResult.textContent = `解压过程发生异常: ${err.message}`
    } finally {
      btnExtract.disabled = false
      btnExtract.textContent = '安全解压到该目录'
    }
  })
}
