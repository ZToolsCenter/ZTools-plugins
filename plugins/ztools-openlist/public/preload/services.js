const fs = require('node:fs')
const path = require('node:path')
const axios = require('axios')

const configPath = path.join(window.ztools.getPath('userData'), 'openlist-config.json')
const DOWNLOAD_PROGRESS_INTERVAL_MS = 200
const COPY_BUFFER_LIMIT_BYTES = 100 * 1024 * 1024

function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || '').trim().replace(/\/+$/, '')
}

function normalizeRemoteDir(value) {
  const trimmed = String(value || '').trim()
  if (!trimmed) return '/'
  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`
  return withLeadingSlash.replace(/\/+$/, '') || '/'
}

function splitFileName(fileName) {
  const dotIndex = fileName.lastIndexOf('.')
  if (dotIndex <= 0) {
    return {
      base: fileName,
      ext: ''
    }
  }

  return {
    base: fileName.slice(0, dotIndex),
    ext: fileName.slice(dotIndex)
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function readJsonFile(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'))
  } catch {
    return fallback
  }
}

function writeJsonFile(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf-8')
}

function sanitizeLocalName(name) {
  return String(name || 'download')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/[. ]+$/g, '') || 'download'
}

async function request(baseUrl, endpoint, options = {}) {
  const method = String(options.method || 'GET').toLowerCase()
  const headers = options.headers || {}
  const data = normalizeRequestData(options.body ?? options.data, headers)
  const res = await axios.request({
    baseURL: normalizeBaseUrl(baseUrl),
    url: endpoint,
    method,
    headers,
    data,
    responseType: options.responseType || 'json',
    validateStatus: () => true,
    maxBodyLength: Infinity,
    maxContentLength: Infinity
  })

  return parseOpenListResponse(res)
}

function normalizeRequestData(body, headers) {
  if (typeof body !== 'string') return body

  const contentType = String(headers['Content-Type'] || headers['content-type'] || '')
  if (!contentType.includes('application/json')) return body

  try {
    return JSON.parse(body)
  } catch {
    return body
  }
}

function getPayloadMessage(payload, fallback) {
  if (typeof payload === 'string') return payload
  if (payload && typeof payload === 'object') {
    return payload.message || payload.msg || fallback
  }
  return fallback
}

function parseOpenListResponse(res) {
  const payload = res.data || null

  if (res.status < 200 || res.status >= 300) {
    throw new Error(getPayloadMessage(payload, `HTTP ${res.status}`))
  }

  if (payload && typeof payload === 'object' && payload.code !== undefined && payload.code !== 200) {
    throw new Error(getPayloadMessage(payload, `OpenList error: ${payload.code}`))
  }

  return payload
}

function getResponseHeader(headers, name) {
  if (!headers) return ''
  if (typeof headers.get === 'function') return headers.get(name) || ''
  return headers[name] || headers[name.toLowerCase()] || ''
}

function emitDownloadProgress(onProgress, loaded, total, state = null, force = false) {
  if (typeof onProgress !== 'function') return
  const percent = total ? Math.min(100, Math.round((loaded / total) * 100)) : 0

  if (state && !force) {
    const now = Date.now()
    if (now - state.lastEmitAt < DOWNLOAD_PROGRESS_INTERVAL_MS) {
      return
    }
    state.lastEmitAt = now
    state.lastPercent = percent
  }

  onProgress({
    loaded,
    total,
    percent
  })
}

async function downloadUrlToBuffer(url, token, knownSize = 0) {
  const expectedSize = Number(knownSize) || 0
  if (expectedSize > COPY_BUFFER_LIMIT_BYTES) {
    throw new Error(`文件超过复制兜底限制：${Math.round(COPY_BUFFER_LIMIT_BYTES / 1024 / 1024)}MB`)
  }

  const res = await axios.get(url, {
    adapter: 'http',
    headers: authHeaders(token, {
      'Accept-Encoding': 'identity'
    }),
    responseType: 'stream',
    decompress: false,
    validateStatus: () => true,
    maxBodyLength: Infinity,
    maxContentLength: Infinity
  })

  if (res.status < 200 || res.status >= 300) {
    destroyReadableStream(res.data)
    throw new Error(`HTTP ${res.status}`)
  }

  const contentLength = Number(getResponseHeader(res.headers, 'content-length')) || 0
  if (contentLength > COPY_BUFFER_LIMIT_BYTES) {
    destroyReadableStream(res.data)
    throw new Error(`文件超过复制兜底限制：${Math.round(COPY_BUFFER_LIMIT_BYTES / 1024 / 1024)}MB`)
  }

  return readStreamToBuffer(res.data, COPY_BUFFER_LIMIT_BYTES)
}

function destroyReadableStream(stream) {
  if (!stream) return
  if (typeof stream.destroy === 'function') {
    stream.destroy()
  } else if (typeof stream.cancel === 'function') {
    stream.cancel().catch(() => {})
  }
}

async function readStreamToBuffer(stream, limit) {
  const chunks = []
  let loaded = 0

  if (stream && typeof stream[Symbol.asyncIterator] === 'function') {
    for await (const chunk of stream) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      loaded += buffer.length
      if (loaded > limit) {
        destroyReadableStream(stream)
        throw new Error(`文件超过复制兜底限制：${Math.round(limit / 1024 / 1024)}MB`)
      }
      chunks.push(buffer)
    }

    return Buffer.concat(chunks, loaded)
  }

  if (stream && typeof stream.getReader === 'function') {
    const reader = stream.getReader()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const buffer = Buffer.from(value)
        loaded += buffer.length
        if (loaded > limit) {
          await reader.cancel().catch(() => {})
          throw new Error(`文件超过复制兜底限制：${Math.round(limit / 1024 / 1024)}MB`)
        }
        chunks.push(buffer)
      }
    } finally {
      reader.releaseLock()
    }

    return Buffer.concat(chunks, loaded)
  }

  throw new Error('下载响应不是可流式读取的数据，已拒绝使用 Buffer 保存大文件')
}

async function writeNodeStreamToFile(stream, savePath, total, onProgress) {
  let loaded = 0
  const progressState = { lastEmitAt: 0, lastPercent: -1 }

  await new Promise((resolve, reject) => {
    const fileStream = fs.createWriteStream(savePath)
    let settled = false

    const fail = (err) => {
      if (settled) return
      settled = true
      destroyReadableStream(stream)
      fileStream.destroy()
      reject(err)
    }

    stream.on('data', (chunk) => {
      loaded += chunk.length
      emitDownloadProgress(onProgress, loaded, total, progressState)
    })
    stream.once('error', fail)
    fileStream.once('error', fail)
    fileStream.once('finish', () => {
      if (settled) return
      settled = true
      resolve()
    })
    stream.pipe(fileStream)
  })

  emitDownloadProgress(onProgress, loaded, total || loaded, progressState, true)
  return loaded
}

async function writeWebStreamToFile(stream, savePath, total, onProgress) {
  const reader = stream.getReader()
  const fileStream = fs.createWriteStream(savePath)
  let loaded = 0
  const progressState = { lastEmitAt: 0, lastPercent: -1 }

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      const chunk = Buffer.from(value)
      loaded += chunk.length

      await new Promise((resolve, reject) => {
        fileStream.write(chunk, (err) => {
          if (err) reject(err)
          else resolve()
        })
      })
      emitDownloadProgress(onProgress, loaded, total, progressState)
    }

    await new Promise((resolve, reject) => {
      fileStream.once('error', reject)
      fileStream.end(resolve)
    })
  } catch (err) {
    fileStream.destroy()
    throw err
  }

  emitDownloadProgress(onProgress, loaded, total || loaded, progressState, true)
  return loaded
}

async function downloadUrlToFile(url, token, savePath, fallbackTotal = 0, onProgress) {
  const res = await axios.get(url, {
    // Force Node's HTTP adapter so Electron/ZTools receives incremental chunks.
    adapter: 'http',
    headers: authHeaders(token, {
      'Accept-Encoding': 'identity'
    }),
    responseType: 'stream',
    decompress: false,
    validateStatus: () => true,
    maxBodyLength: Infinity,
    maxContentLength: Infinity
  })

  if (res.status < 200 || res.status >= 300) {
    throw new Error(`HTTP ${res.status}`)
  }

  const total = Number(getResponseHeader(res.headers, 'content-length')) || fallbackTotal || 0
  let loaded = 0
  fs.mkdirSync(path.dirname(savePath), { recursive: true })

  if (res.data && typeof res.data.pipe === 'function' && typeof res.data.on === 'function') {
    loaded = await writeNodeStreamToFile(res.data, savePath, total, onProgress)
  } else if (res.data && typeof res.data.getReader === 'function') {
    loaded = await writeWebStreamToFile(res.data, savePath, total, onProgress)
  } else {
    throw new Error('下载响应不是可流式读取的数据，已拒绝使用 Buffer 保存大文件')
  }
  return savePath
}

function authHeaders(token, extra = {}) {
  return {
    Authorization: token,
    ...extra
  }
}

async function uploadOpenListBuffer(baseUrl, token, remoteDir, fileName, data, dataLength, onProgress) {
  const remotePath = path.posix.join(remoteDir || '/', fileName)
  const explicitLength = Number(dataLength)
  const contentLength =
    Number.isFinite(explicitLength) && explicitLength >= 0
      ? explicitLength
      : Buffer.isBuffer(data)
        ? data.length
        : null

  if (contentLength === null) {
    throw new Error('上传流缺少有效的 Content-Length')
  }

  const res = await axios.put(`${normalizeBaseUrl(baseUrl)}/api/fs/put`, data, {
    adapter: 'http',
    headers: authHeaders(token, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(contentLength),
      'File-Path': encodeURIComponent(remotePath),
      'As-Task': 'false'
    }),
    validateStatus: () => true,
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    onUploadProgress(progress) {
      if (typeof onProgress !== 'function') return
      const loaded = progress.loaded || 0
      const total = progress.total || contentLength
      onProgress({
        loaded,
        total,
        percent: total ? Math.round((loaded / total) * 100) : 100
      })
    }
  })
  const payload = parseOpenListResponse(res)

  return {
    path: remotePath,
    fileName,
    data: payload?.data || null
  }
}

async function listOpenListFiles(baseUrl, token, dirPath) {
  const payload = await request(baseUrl, '/api/fs/list', {
    method: 'POST',
    headers: authHeaders(token, {
      'Content-Type': 'application/json'
    }),
    data: {
      path: dirPath || '/',
      password: '',
      page: 1,
      per_page: 0,
      refresh: true
    }
  })

  return payload?.data?.content || []
}

async function getAvailableCopyName(baseUrl, token, dstDir, fileName, isDir = false) {
  const files = await listOpenListFiles(baseUrl, token, dstDir)
  const names = new Set(files.map((file) => file.name))

  if (!names.has(fileName)) return fileName

  const { base, ext } = isDir ? { base: fileName, ext: '' } : splitFileName(fileName)
  let index = 1
  let nextName = `${base} - 副本${ext}`

  while (names.has(nextName)) {
    index += 1
    nextName = `${base} - 副本 ${index}${ext}`
  }

  return nextName
}

function findOpenListItem(items, name) {
  return items.find((item) => item.name === name) || null
}

async function waitForCopiedNames(baseUrl, token, dstDir, names) {
  for (const delay of [300, 700, 1200]) {
    await sleep(delay)
    const files = await listOpenListFiles(baseUrl, token, dstDir)
    const copiedNames = new Set(files.map((file) => file.name))

    if (names.every((name) => copiedNames.has(name))) {
      return true
    }
  }

  return false
}

async function ensureOpenListChildDir(baseUrl, token, parentDir, name) {
  const files = await listOpenListFiles(baseUrl, token, parentDir)
  const existing = findOpenListItem(files, name)
  const targetPath = path.posix.join(parentDir, name)

  if (existing) {
    if (existing.is_dir) return targetPath
    throw new Error(`目标位置已存在同名文件：${targetPath}`)
  }

  await request(baseUrl, '/api/fs/mkdir', {
    method: 'POST',
    headers: authHeaders(token, {
      'Content-Type': 'application/json'
    }),
    data: {
      path: targetPath
    }
  })

  return targetPath
}

async function downloadOpenListFileBuffer(baseUrl, token, filePath) {
  const detailPayload = await request(baseUrl, '/api/fs/get', {
    method: 'POST',
    headers: authHeaders(token, {
      'Content-Type': 'application/json'
    }),
    data: {
      path: filePath,
      password: ''
    }
  })
  const detail = detailPayload?.data || null
  const rawUrl = detail?.raw_url

  if (!rawUrl) {
    throw new Error('OpenList did not return a downloadable raw_url')
  }

  const downloadUrl = new URL(rawUrl, normalizeBaseUrl(baseUrl)).toString()
  return downloadUrlToBuffer(downloadUrl, token, Number(detail?.size) || 0)
}

async function getOpenListDownloadLink(baseUrl, token, filePath) {
  const detailPayload = await request(baseUrl, '/api/fs/get', {
    method: 'POST',
    headers: authHeaders(token, {
      'Content-Type': 'application/json'
    }),
    data: {
      path: filePath,
      password: ''
    }
  })
  const detail = detailPayload?.data || null
  const rawUrl = detail?.raw_url

  if (!rawUrl) {
    throw new Error(`OpenList 未返回文件直链：${filePath}`)
  }

  return {
    url: new URL(rawUrl, normalizeBaseUrl(baseUrl)).toString(),
    size: Number(detail?.size) || 0
  }
}

async function collectOpenListDownloadEntries(baseUrl, token, remoteDir, relativeDir = '') {
  const children = await listOpenListFiles(baseUrl, token, remoteDir)
  const entries = []

  for (const child of children) {
    const childRemotePath = path.posix.join(remoteDir, child.name)
    const childRelativePath = path.posix.join(relativeDir, child.name)

    if (child.is_dir) {
      entries.push({
        type: 'dir',
        relativePath: childRelativePath
      })
      entries.push(
        ...(await collectOpenListDownloadEntries(baseUrl, token, childRemotePath, childRelativePath))
      )
    } else {
      const link = await getOpenListDownloadLink(baseUrl, token, childRemotePath)
      entries.push({
        type: 'file',
        relativePath: childRelativePath,
        url: link.url,
        size: link.size || Number(child.size) || 0
      })
    }
  }

  return entries
}

function resolveLocalChildPath(rootDir, relativePath) {
  const parts = String(relativePath || '')
    .split('/')
    .filter(Boolean)
    .map(sanitizeLocalName)

  return path.join(rootDir, ...parts)
}

function emitAggregateDownloadProgress(onProgress, loaded, total, fallbackLoaded, fallbackTotal) {
  if (typeof onProgress !== 'function') return

  if (total > 0) {
    onProgress({
      loaded,
      total,
      percent: Math.min(100, Math.round((loaded / total) * 100))
    })
    return
  }

  onProgress({
    loaded: fallbackLoaded,
    total: fallbackTotal,
    percent: fallbackTotal ? Math.min(100, Math.round((fallbackLoaded / fallbackTotal) * 100)) : 0
  })
}

async function downloadOpenListEntries(entries, localRootDir, token, onProgress) {
  const fileEntries = entries.filter((entry) => entry.type === 'file')
  const totalBytes = fileEntries.reduce((sum, entry) => sum + (Number(entry.size) || 0), 0)
  const canUseByteProgress = fileEntries.length > 0 && fileEntries.every((entry) => Number(entry.size) > 0)
  const loadedByFile = new Map()
  let loadedBytes = 0
  let completedFiles = 0

  emitAggregateDownloadProgress(
    onProgress,
    0,
    canUseByteProgress ? totalBytes : 0,
    0,
    fileEntries.length
  )

  for (const entry of entries) {
    const targetPath = resolveLocalChildPath(localRootDir, entry.relativePath)

    if (entry.type === 'dir') {
      fs.mkdirSync(targetPath, { recursive: true })
      continue
    }

    fs.mkdirSync(path.dirname(targetPath), { recursive: true })

    await downloadUrlToFile(entry.url, token, targetPath, Number(entry.size) || 0, (progress) => {
      const currentLoaded = Number(progress.loaded) || 0
      const previousLoaded = loadedByFile.get(entry.relativePath) || 0
      const delta = Math.max(0, currentLoaded - previousLoaded)
      loadedByFile.set(entry.relativePath, currentLoaded)
      loadedBytes += delta
      emitAggregateDownloadProgress(
        onProgress,
        loadedBytes,
        canUseByteProgress ? totalBytes : 0,
        completedFiles,
        fileEntries.length
      )
    })

    completedFiles += 1
    if (!canUseByteProgress) {
      emitAggregateDownloadProgress(onProgress, 0, 0, completedFiles, fileEntries.length)
    }
  }

  if (fileEntries.length === 0) {
    if (typeof onProgress === 'function') {
      onProgress({ loaded: 0, total: 0, percent: 100 })
    }
  } else {
    emitAggregateDownloadProgress(
      onProgress,
      canUseByteProgress ? totalBytes : 0,
      canUseByteProgress ? totalBytes : 0,
      fileEntries.length,
      fileEntries.length
    )
  }
}

async function collectSelectedOpenListDownloadEntries(baseUrl, token, srcDir, names) {
  const normalizedSrcDir = normalizeRemoteDir(srcDir)
  const sourceItems = await listOpenListFiles(baseUrl, token, normalizedSrcDir)
  const entries = []

  for (const name of names) {
    const sourceItem = findOpenListItem(sourceItems, name)

    if (!sourceItem) {
      throw new Error(`源文件不存在：${path.posix.join(normalizedSrcDir, name)}`)
    }

    const remotePath = path.posix.join(normalizedSrcDir, sourceItem.name)

    if (sourceItem.is_dir) {
      entries.push({
        type: 'dir',
        relativePath: sourceItem.name
      })
      entries.push(...(await collectOpenListDownloadEntries(baseUrl, token, remotePath, sourceItem.name)))
      continue
    }

    const link = await getOpenListDownloadLink(baseUrl, token, remotePath)
    entries.push({
      type: 'file',
      relativePath: sourceItem.name,
      url: link.url,
      size: link.size || Number(sourceItem.size) || 0
    })
  }

  return entries
}

async function copyOpenListFileByDownload(baseUrl, token, srcDir, dstDir, sourceName, targetName) {
  const sourcePath = path.posix.join(srcDir, sourceName)
  const fileBuffer = await downloadOpenListFileBuffer(baseUrl, token, sourcePath)
  return uploadOpenListBuffer(baseUrl, token, dstDir, targetName, fileBuffer, fileBuffer.length)
}

async function copyOpenListDirByList(baseUrl, token, sourcePath, targetParentDir, targetName) {
  const targetDir = await ensureOpenListChildDir(baseUrl, token, targetParentDir, targetName)
  const children = await listOpenListFiles(baseUrl, token, sourcePath)
  const copied = []

  for (const child of children) {
    if (child.is_dir) {
      copied.push(
        ...(await copyOpenListDirByList(
          baseUrl,
          token,
          path.posix.join(sourcePath, child.name),
          targetDir,
          child.name
        ))
      )
    } else {
      copied.push(
        await copyOpenListFileByDownload(baseUrl, token, sourcePath, targetDir, child.name, child.name)
      )
    }
  }

  return copied
}

async function copyOpenListFilesManually(baseUrl, token, srcDir, dstDir, names) {
  const normalizedSrcDir = normalizeRemoteDir(srcDir)
  const normalizedDstDir = normalizeRemoteDir(dstDir)
  const sourceItems = await listOpenListFiles(baseUrl, token, normalizedSrcDir)
  const copied = []

  for (const name of names) {
    const sourceItem = findOpenListItem(sourceItems, name)

    if (!sourceItem) {
      throw new Error(`源文件不存在：${path.posix.join(normalizedSrcDir, name)}`)
    }

    const targetName = await getAvailableCopyName(
      baseUrl,
      token,
      normalizedDstDir,
      sourceItem.name,
      sourceItem.is_dir
    )

    if (sourceItem.is_dir) {
      copied.push(
        ...(await copyOpenListDirByList(
          baseUrl,
          token,
          path.posix.join(normalizedSrcDir, sourceItem.name),
          normalizedDstDir,
          targetName
        ))
      )
    } else {
      copied.push(
        await copyOpenListFileByDownload(
          baseUrl,
          token,
          normalizedSrcDir,
          normalizedDstDir,
          sourceItem.name,
          targetName
        )
      )
    }
  }

  return copied
}

window.services = {
  loadOpenListConfig() {
    return readJsonFile(configPath, {
      baseUrl: '',
      username: '',
      token: ''
    })
  },

  saveOpenListConfig(config) {
    const current = readJsonFile(configPath, {})
    const next = {
      ...current,
      ...config,
      baseUrl: normalizeBaseUrl(config.baseUrl ?? current.baseUrl)
    }
    writeJsonFile(configPath, next)
    return next
  },

  clearOpenListConfig() {
    const next = {
      baseUrl: '',
      username: '',
      token: ''
    }
    writeJsonFile(configPath, next)
    return next
  },

  async loginOpenList(baseUrl, username, password) {
    const payload = await request(baseUrl, '/api/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      data: { username, password }
    })

    const token = payload?.data?.token
    if (!token) {
      throw new Error('OpenList did not return a token')
    }

    const saved = this.saveOpenListConfig({ baseUrl, username, token })
    return saved
  },

  async listOpenList(baseUrl, token, dirPath, password = '', refresh = false) {
    const payload = await request(baseUrl, '/api/fs/list', {
      method: 'POST',
      headers: authHeaders(token, {
        'Content-Type': 'application/json'
      }),
      data: {
        path: dirPath || '/',
        password,
        page: 1,
        per_page: 0,
        refresh
      }
    })

    return payload?.data || { content: [], total: 0 }
  },

  async getOpenListFile(baseUrl, token, filePath, password = '') {
    const payload = await request(baseUrl, '/api/fs/get', {
      method: 'POST',
      headers: authHeaders(token, {
        'Content-Type': 'application/json'
      }),
      data: {
        path: filePath,
        password
      }
    })

    return payload?.data || null
  },

  async listOpenListDirs(baseUrl, token, dirPath = '/', password = '', forceRoot = false) {
    const payload = await request(baseUrl, '/api/fs/dirs', {
      method: 'POST',
      headers: authHeaders(token, {
        'Content-Type': 'application/json'
      }),
      data: {
        path: dirPath || '/',
        password,
        force_root: forceRoot
      }
    })

    return payload?.data || []
  },

  async makeOpenListDir(baseUrl, token, dirPath, name) {
    const remotePath = path.posix.join(dirPath || '/', name)
    const payload = await request(baseUrl, '/api/fs/mkdir', {
      method: 'POST',
      headers: authHeaders(token, {
        'Content-Type': 'application/json'
      }),
      data: {
        path: remotePath
      }
    })

    return payload?.data || { path: remotePath }
  },

  async renameOpenListFile(baseUrl, token, filePath, name) {
    const payload = await request(baseUrl, '/api/fs/rename', {
      method: 'POST',
      headers: authHeaders(token, {
        'Content-Type': 'application/json'
      }),
      data: {
        path: filePath,
        name
      }
    })

    return payload?.data || null
  },

  async moveOpenListFiles(baseUrl, token, srcDir, dstDir, names) {
    const payload = await request(baseUrl, '/api/fs/move', {
      method: 'POST',
      headers: authHeaders(token, {
        'Content-Type': 'application/json'
      }),
      data: {
        src_dir: srcDir || '/',
        dst_dir: dstDir || '/',
        names
      }
    })

    return payload?.data || null
  },

  async copyOpenListFiles(baseUrl, token, srcDir, dstDir, names) {
    const normalizedSrcDir = normalizeRemoteDir(srcDir)
    const normalizedDstDir = normalizeRemoteDir(dstDir)
    const sourceItems = await listOpenListFiles(baseUrl, token, normalizedSrcDir)
    const selectedItems = names.map((name) => {
      const item = findOpenListItem(sourceItems, name)

      if (!item) {
        throw new Error(`源文件不存在：${path.posix.join(normalizedSrcDir, name)}`)
      }

      return item
    })

    const hasDirectory = selectedItems.some((item) => item.is_dir)

    if (normalizedSrcDir === normalizedDstDir || hasDirectory) {
      return copyOpenListFilesManually(baseUrl, token, normalizedSrcDir, normalizedDstDir, names)
    }

    try {
      const payload = await request(baseUrl, '/api/fs/copy', {
        method: 'POST',
        headers: authHeaders(token, {
          'Content-Type': 'application/json'
        }),
        data: {
          src_dir: normalizedSrcDir,
          dst_dir: normalizedDstDir,
          names
        }
      })

      const copied = await waitForCopiedNames(baseUrl, token, normalizedDstDir, names)
      if (copied) return payload?.data || null

      return copyOpenListFilesManually(baseUrl, token, normalizedSrcDir, normalizedDstDir, names)
    } catch (err) {
      return copyOpenListFilesManually(baseUrl, token, normalizedSrcDir, normalizedDstDir, names)
    }
  },

  async removeOpenListFiles(baseUrl, token, dirPath, names) {
    const payload = await request(baseUrl, '/api/fs/remove', {
      method: 'POST',
      headers: authHeaders(token, {
        'Content-Type': 'application/json'
      }),
      data: {
        dir: dirPath || '/',
        names
      }
    })

    return payload?.data || null
  },

  async downloadOpenListFile(
    baseUrl,
    token,
    fileUrl,
    savePath,
    onProgress,
    knownSize = 0
  ) {
    if (!fileUrl) {
      throw new Error('No downloadable file link provided')
    }

    const downloadUrl = new URL(fileUrl, normalizeBaseUrl(baseUrl)).toString()
    return downloadUrlToFile(downloadUrl, token, savePath, knownSize || 0, onProgress)
  },

  async downloadOpenListDir(baseUrl, token, remoteDir, localParentDir, onProgress) {
    const normalizedRemoteDir = normalizeRemoteDir(remoteDir)
    const rootName = sanitizeLocalName(path.posix.basename(normalizedRemoteDir) || 'OpenList 下载')
    const localRootDir = path.join(localParentDir, rootName)

    fs.mkdirSync(localRootDir, { recursive: true })

    const entries = await collectOpenListDownloadEntries(baseUrl, token, normalizedRemoteDir)
    await downloadOpenListEntries(entries, localRootDir, token, onProgress)

    return localRootDir
  },

  async downloadOpenListItems(baseUrl, token, srcDir, names, localParentDir, onProgress) {
    const localRootDir = localParentDir
    fs.mkdirSync(localRootDir, { recursive: true })

    const entries = await collectSelectedOpenListDownloadEntries(baseUrl, token, srcDir, names)
    await downloadOpenListEntries(entries, localRootDir, token, onProgress)

    return localRootDir
  },

  async uploadOpenListFile(baseUrl, token, remoteDir, localFilePath, onProgress) {
    const fileName = path.basename(localFilePath)
    const stats = fs.statSync(localFilePath)
    const fileStream = fs.createReadStream(localFilePath)

    return uploadOpenListBuffer(baseUrl, token, remoteDir, fileName, fileStream, stats.size, onProgress)
  },

  async uploadOpenListFileContent(baseUrl, token, remoteDir, fileName, arrayBuffer, onProgress) {
    const fileBuffer = Buffer.from(arrayBuffer)

    return uploadOpenListBuffer(
      baseUrl,
      token,
      remoteDir,
      fileName,
      fileBuffer,
      fileBuffer.length,
      onProgress
    )
  }
}

