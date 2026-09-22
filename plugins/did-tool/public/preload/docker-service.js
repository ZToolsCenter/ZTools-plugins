const crypto = require('node:crypto')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const http = require('node:http')
const https = require('node:https')
const path = require('node:path')
const { once } = require('node:events')
const { Transform } = require('node:stream')
const { finished, pipeline } = require('node:stream/promises')
const zlib = require('node:zlib')
const { Decompress: FzstdDecompress } = require('fzstd')
const { HttpProxyAgent } = require('http-proxy-agent')
const { HttpsProxyAgent } = require('https-proxy-agent')

const MANIFEST_ACCEPT = [
  'application/vnd.docker.distribution.manifest.v2+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.oci.image.index.v1+json'
].join(', ')

const SOURCES = {
  docker: 'https://registry-1.docker.io',
  oneMs: 'https://docker.1ms.run',
  daoCloud: 'https://docker.m.daocloud.io'
}

const MAX_TAR_ENTRY_SIZE = 8 * 1024 ** 3 - 1

/** 表示用户主动取消的任务。 */
class CancelledError extends Error {
  /** 创建取消异常。 */
  constructor() {
    super('任务已取消')
    this.name = 'CancelledError'
  }
}

/** 将写入的数据同步计入 SHA256。 */
class HashTransform extends Transform {
  /** 创建摘要转换流。 */
  constructor(onChunk) {
    super()
    this.hash = crypto.createHash('sha256')
    this.onChunk = onChunk
  }

  /** 处理一个数据块。 */
  _transform(chunk, _encoding, callback) {
    try {
      this.hash.update(chunk)
      this.onChunk?.(chunk.length)
      callback(null, chunk)
    } catch (error) {
      callback(error)
    }
  }

  /** 返回已处理内容的 SHA256。 */
  digest() {
    return `sha256:${this.hash.digest('hex')}`
  }
}

/** 将 zstd 解码器适配为 Node.js 转换流。 */
class ZstdDecompressTransform extends Transform {
  /** 创建流式 zstd 解码器。 */
  constructor() {
    super()
    this.decoder = new FzstdDecompress((chunk) => {
      if (chunk.length > 0) this.push(Buffer.from(chunk))
    })
  }

  /** 解码一个 zstd 数据块。 */
  _transform(chunk, _encoding, callback) {
    try {
      this.decoder.push(chunk)
      callback()
    } catch (error) {
      callback(error)
    }
  }

  /** 通知解码器输入已经结束。 */
  _flush(callback) {
    try {
      this.decoder.push(new Uint8Array(0), true)
      callback()
    } catch (error) {
      callback(error)
    }
  }
}

/** 创建可被 Docker load 读取的无压缩 tar 文件。 */
class TarWriter {
  /** 打开 tar 输出流。 */
  constructor(filePath, onBytes, isCancelled) {
    this.failure = null
    this.stream = fs.createWriteStream(filePath, { flags: 'wx' })
    this.stream.on('error', (error) => {
      this.failure = error
    })
    this.ready = once(this.stream, 'open')
    this.ready.catch(() => {})
    this.onBytes = onBytes
    this.isCancelled = isCancelled
  }

  /** 向 tar 流写入数据并处理背压。 */
  async write(buffer, countProgress = false) {
    await this.ready
    if (this.failure) throw this.failure
    if (this.isCancelled()) throw new CancelledError()
    if (!this.stream.write(buffer)) await once(this.stream, 'drain')
    if (this.failure) throw this.failure
    if (countProgress) this.onBytes(buffer.length)
  }

  /** 添加目录条目。 */
  async addDirectory(name) {
    await this.write(createTarHeader(`${name.replace(/\/$/, '')}/`, 0, '5'))
  }

  /** 添加内存中的文件。 */
  async addBuffer(name, content) {
    const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content)
    await this.write(createTarHeader(name, buffer.length, '0'))
    await this.write(buffer, true)
    await this.write(Buffer.alloc(paddingSize(buffer.length)))
  }

  /** 以流式方式添加磁盘文件。 */
  async addFile(name, filePath) {
    const stat = await fsp.stat(filePath)
    await this.write(createTarHeader(name, stat.size, '0', stat.mtime))
    for await (const chunk of fs.createReadStream(filePath)) {
      await this.write(chunk, true)
    }
    await this.write(Buffer.alloc(paddingSize(stat.size)))
  }

  /** 写入 tar 结束块并关闭输出流。 */
  async close() {
    await this.ready
    if (this.failure) throw this.failure
    await this.write(Buffer.alloc(1024))
    const completion = finished(this.stream)
    this.stream.end()
    await completion
  }

  /** 终止输出流。 */
  destroy() {
    this.stream.destroy()
  }
}

/** 构造 Registry 请求客户端。 */
class RegistryClient {
  /** 保存仓库地址与认证选项。 */
  constructor(target, options) {
    this.target = target
    this.network = options.network
    this.username = options.username || ''
    this.password = options.password || ''
    this.signal = options.signal
    this.authorization = this.username
      ? `Basic ${Buffer.from(`${this.username}:${this.password}`).toString('base64')}`
      : ''
  }

  /** 访问 Registry 根端点并初始化认证信息。 */
  async initialize() {
    const response = await request(`${this.target.baseUrl}/v2/`, {
      headers: this.authorization ? { Authorization: this.authorization } : {},
      network: this.network,
      signal: this.signal
    })
    if (response.statusCode === 401) {
      const challenge = response.headers['www-authenticate']
      response.resume()
      await this.authorize(challenge, this.target.repository)
      return
    }
    response.resume()
  }

  /** 根据 Registry 返回的认证挑战获取访问凭据。 */
  async authorize(challengeValue, repository) {
    const challenge = parseAuthChallenge(challengeValue)
    if (!challenge) throw new Error('镜像仓库要求认证，但未返回有效的认证信息')
    if (challenge.scheme === 'basic') {
      if (!this.username) throw new Error('该镜像仓库需要用户名和密码')
      this.authorization = `Basic ${Buffer.from(`${this.username}:${this.password}`).toString('base64')}`
      return
    }
    if (challenge.scheme !== 'bearer' || !challenge.params.realm) {
      throw new Error(`暂不支持镜像仓库的 ${challenge.scheme} 认证方式`)
    }

    const tokenUrl = new URL(challenge.params.realm)
    if (challenge.params.service) tokenUrl.searchParams.set('service', challenge.params.service)
    tokenUrl.searchParams.set('scope', challenge.params.scope || `repository:${repository}:pull`)
    const headers = this.username
      ? { Authorization: `Basic ${Buffer.from(`${this.username}:${this.password}`).toString('base64')}` }
      : {}
    const response = await request(tokenUrl.toString(), { headers, network: this.network, signal: this.signal })
    const body = await readResponseBuffer(response)
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw createHttpError('获取镜像仓库访问令牌失败', response, body)
    }
    const payload = parseJson(body, '镜像仓库返回了无效的访问令牌')
    const token = payload.token || payload.access_token
    if (!token) throw new Error('镜像仓库未返回访问令牌')
    this.authorization = `Bearer ${token}`
  }

  /** 请求 Registry 内容，并在令牌失效时自动刷新一次。 */
  async fetch(registryPath, options = {}, retried = false) {
    const headers = { ...(options.headers || {}) }
    if (this.authorization) headers.Authorization = this.authorization
    const response = await request(`${this.target.baseUrl}${registryPath}`, {
      ...options,
      headers,
      network: this.network,
      signal: this.signal
    })
    if (response.statusCode === 401 && !retried) {
      const challenge = response.headers['www-authenticate']
      response.resume()
      await this.authorize(challenge, this.target.repository)
      return this.fetch(registryPath, options, true)
    }
    return response
  }

  /** 获取镜像清单。 */
  async getManifest(reference) {
    const registryPath = `/v2/${encodeRepository(this.target.repository)}/manifests/${encodeURIComponent(reference)}`
    const response = await this.fetch(registryPath, { headers: { Accept: MANIFEST_ACCEPT } })
    const body = await readResponseBuffer(response)
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw createHttpError('获取镜像清单失败', response, body)
    }
    const manifest = parseJson(body, '镜像仓库返回了无效的清单数据')
    const actualDigest = `sha256:${crypto.createHash('sha256').update(body).digest('hex')}`
    const responseDigest = response.headers['docker-content-digest'] || ''
    const requestedDigest = /^sha256:[a-f0-9]{64}$/i.test(reference) ? reference.toLowerCase() : ''
    if (responseDigest && responseDigest.toLowerCase() !== actualDigest) {
      throw new Error('镜像清单与仓库返回的摘要不一致')
    }
    if (requestedDigest && requestedDigest !== actualDigest) {
      throw new Error('镜像清单与请求的摘要不一致')
    }
    return {
      digest: actualDigest,
      mediaType: response.headers['content-type'] || '',
      manifest
    }
  }

  /** 获取镜像配置内容。 */
  async getBlobBuffer(digest) {
    const response = await this.openBlob(digest)
    const body = await readResponseBuffer(response, 64 * 1024 * 1024)
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw createHttpError('获取镜像配置失败', response, body)
    }
    return body
  }

  /** 打开镜像数据层响应流。 */
  async openBlob(digest, rangeStart = 0) {
    const headers = rangeStart > 0 ? { Range: `bytes=${rangeStart}-` } : {}
    return this.fetch(`/v2/${encodeRepository(this.target.repository)}/blobs/${digest}`, { headers })
  }
}

/** Docker 镜像下载服务。 */
class DockerImageService {
  /** 初始化任务存储。 */
  constructor() {
    this.tasks = new Map()
    this.workspaceLocks = new Map()
  }

  /** 解析镜像并返回平台、层数和压缩大小。 */
  async inspectImage(options) {
    const prepared = await prepareImage({ ...options, allowPlatformFallback: true })
    const outputFileName = buildArchiveName(prepared.target, prepared.selectedPlatform.key)
    return {
      ...serializeInspection(prepared),
      outputFileName,
      existingOutputPath: await findExistingArchive(options.outputDir, outputFileName)
    }
  }

  /** 创建后台下载任务。 */
  startDownload(options) {
    const id = crypto.randomUUID()
    const task = {
      id,
      status: 'preparing',
      phase: '正在读取镜像清单',
      image: String(options.image || '').trim(),
      platform: options.platform || 'linux/amd64',
      registry: '',
      outputPath: '',
      fileName: '',
      totalBytes: 0,
      downloadedBytes: 0,
      speed: 0,
      etaSeconds: null,
      packedBytes: 0,
      packTotalBytes: 0,
      layers: [],
      logs: [],
      error: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      finishedAt: null,
      cancelled: false,
      abortController: new AbortController(),
      activeStreams: new Set(),
      metricAt: Date.now(),
      metricBytes: 0
    }
    this.tasks.set(id, task)
    this.trimTasks()
    Promise.resolve().then(() => this.runDownload(task, options))
    return snapshotTask(task)
  }

  /** 查询下载任务快照。 */
  getTask(id) {
    const task = this.tasks.get(id)
    return task ? snapshotTask(task) : null
  }

  /** 取消正在执行的下载任务。 */
  cancelTask(id) {
    const task = this.tasks.get(id)
    if (!task || isTerminalStatus(task.status)) return false
    task.cancelled = true
    task.phase = '正在取消任务'
    task.abortController.abort()
    for (const stream of task.activeStreams) stream.destroy(new CancelledError())
    return true
  }

  /** 执行镜像下载、校验、解压和打包。 */
  async runDownload(task, options) {
    let partialTar = ''
    let lockKey = ''
    try {
      addLog(task, 'info', '开始解析镜像清单')
      const prepared = await prepareImage(options, task.abortController.signal)
      assertNotCancelled(task)
      task.image = prepared.target.input
      task.registry = prepared.target.registry
      task.platform = prepared.selectedPlatform.key
      task.phase = '正在准备下载目录'

      const outputDir = path.resolve(options.outputDir)
      await fsp.mkdir(outputDir, { recursive: true })
      const cacheKey = crypto
        .createHash('sha256')
        .update(`${prepared.target.baseUrl}|${prepared.target.repository}|${prepared.target.reference}|${task.platform}`)
        .digest('hex')
        .slice(0, 24)
      const workspace = path.join(outputDir, '.docker-image-cache', cacheKey)
      lockKey = process.platform === 'win32' ? workspace.toLowerCase() : workspace
      const lockedBy = this.workspaceLocks.get(lockKey)
      if (lockedBy && lockedBy !== task.id) throw new Error('相同镜像和平台已有下载任务正在运行')
      this.workspaceLocks.set(lockKey, task.id)
      const blobDir = path.join(workspace, 'blobs')
      const layoutDir = path.join(workspace, 'layout')
      await fsp.mkdir(blobDir, { recursive: true })
      await fsp.rm(layoutDir, { recursive: true, force: true })
      await fsp.mkdir(layoutDir, { recursive: true })

      const configItem = createDownloadItem(prepared.manifest.config, '镜像配置', 'config')
      const layerItems = prepared.manifest.layers.map((layer, index) =>
        createDownloadItem(layer, `数据层 ${index + 1}`, 'layer')
      )
      task.layers = [configItem, ...layerItems]
      task.totalBytes = task.layers.reduce((sum, item) => sum + item.size, 0)
      task.status = 'downloading'
      task.phase = `正在下载 ${task.layers.length} 个文件`
      addLog(task, 'info', `目标平台：${task.platform}`)

      const client = prepared.client
      const downloadEntries = task.layers.map((item) => ({
        item,
        filePath: path.join(blobDir, `${digestHex(item.digest)}.blob`)
      }))
      const uniqueDownloads = new Map()
      for (const entry of downloadEntries) {
        const existing = uniqueDownloads.get(entry.item.digest)
        if (existing) {
          existing.aliases.push(entry.item)
        } else {
          uniqueDownloads.set(entry.item.digest, { ...entry, aliases: [] })
        }
      }
      await runPool(
        [...uniqueDownloads.values()],
        clamp(Number(options.concurrency) || 3, 1, 6),
        async (entry) => {
          await downloadBlob(task, client, entry.item, entry.filePath)
          for (const alias of entry.aliases) {
            alias.downloaded = entry.item.downloaded
            alias.status = entry.item.status
          }
          updateTaskMetrics(task, true)
        }
      )

      assertNotCancelled(task)
      task.status = 'processing'
      task.phase = '正在解压并校验镜像层'
      task.speed = 0
      task.etaSeconds = null
      addLog(task, 'info', '所有文件下载完成，开始生成 Docker 镜像结构')

      const configPath = downloadEntries[0].filePath
      const config = parseJson(await fsp.readFile(configPath), '镜像配置文件无效')
      const diffIds = validateDiffIds(config, prepared.manifest.layers)
      const configName = `${digestHex(prepared.manifest.config.digest)}.json`
      await fsp.copyFile(configPath, path.join(layoutDir, configName))

      const layerPaths = []
      let parentId = ''
      for (let index = 0; index < prepared.manifest.layers.length; index += 1) {
        assertNotCancelled(task)
        const layer = prepared.manifest.layers[index]
        const item = layerItems[index]
        const layerId = crypto
          .createHash('sha256')
          .update(`${parentId}\n${layer.digest}\n`)
          .digest('hex')
        const layerDir = path.join(layoutDir, layerId)
        await fsp.mkdir(layerDir, { recursive: true })
        item.status = 'processing'
        task.phase = `正在处理数据层 ${index + 1}/${layerItems.length}`
        await extractLayer(
          task,
          downloadEntries[index + 1].filePath,
          path.join(layerDir, 'layer.tar'),
          layer.mediaType || '',
          diffIds[index]
        )
        const layerMetadata = parentId ? { id: layerId, parent: parentId } : { id: layerId }
        await fsp.writeFile(path.join(layerDir, 'json'), JSON.stringify(layerMetadata), 'utf8')
        await fsp.writeFile(path.join(layerDir, 'VERSION'), '1.0', 'utf8')
        layerPaths.push(`${layerId}/layer.tar`)
        parentId = layerId
        item.status = 'completed'
      }

      const repoTags = prepared.target.isDigest ? null : [prepared.target.repoTag]
      const dockerManifest = [{ Config: configName, RepoTags: repoTags, Layers: layerPaths }]
      await fsp.writeFile(path.join(layoutDir, 'manifest.json'), JSON.stringify(dockerManifest), 'utf8')
      if (!prepared.target.isDigest && parentId) {
        const repositories = { [prepared.target.repoTagRepository]: { [prepared.target.tag]: parentId } }
        await fsp.writeFile(path.join(layoutDir, 'repositories'), JSON.stringify(repositories), 'utf8')
      }

      assertNotCancelled(task)
      task.status = 'packing'
      task.phase = '正在写入 tar 镜像包'
      task.packTotalBytes = await directoryFileSize(layoutDir)
      task.packedBytes = 0
      const archiveName = buildArchiveName(prepared.target, task.platform)
      partialTar = path.join(outputDir, `.${archiveName}.partial-${task.id}`)
      await fsp.rm(partialTar, { force: true })
      await createDockerTar(layoutDir, partialTar, task)
      assertNotCancelled(task)
      const outputPath = await publishArchive(partialTar, outputDir, archiveName)
      partialTar = ''
      task.outputPath = outputPath
      task.fileName = path.basename(outputPath)
      task.status = 'completed'
      task.phase = '镜像包已生成'
      task.finishedAt = Date.now()
      addLog(task, 'success', `镜像已保存：${task.fileName}`)
      await fsp.rm(workspace, { recursive: true, force: true }).catch(() => {
        addLog(task, 'warning', '镜像已生成，但缓存目录清理失败')
      })
    } catch (error) {
      if (partialTar) await fsp.rm(partialTar, { force: true }).catch(() => {})
      task.finishedAt = Date.now()
      if (error instanceof CancelledError || task.cancelled) {
        task.status = 'cancelled'
        task.phase = '任务已取消，可再次下载以继续未完成的文件'
        addLog(task, 'warning', '任务已取消，已保留断点文件')
      } else {
        task.status = 'failed'
        task.phase = '下载失败'
        task.error = normalizeError(error)
        addLog(task, 'error', task.error)
      }
    } finally {
      if (lockKey && this.workspaceLocks.get(lockKey) === task.id) this.workspaceLocks.delete(lockKey)
      task.speed = 0
      task.etaSeconds = null
      task.updatedAt = Date.now()
    }
  }

  /** 限制内存中保存的历史任务数量。 */
  trimTasks() {
    if (this.tasks.size <= 20) return
    for (const [id, task] of this.tasks) {
      if (isTerminalStatus(task.status)) this.tasks.delete(id)
      if (this.tasks.size <= 20) break
    }
  }
}

/** 解析并验证镜像引用。 */
function parseImageReference(value) {
  const input = String(value || '')
    .trim()
    .replace(/^docker\s+pull\s+/i, '')
    .replace(/^docker:\/\//i, '')
  if (!input || /\s/.test(input)) throw new Error('请输入有效的镜像名称，例如 nginx:latest')

  const slashIndex = input.lastIndexOf('/')
  const digestIndex = input.indexOf('@', slashIndex + 1)
  const colonIndex = input.lastIndexOf(':')
  const isDigest = digestIndex > slashIndex
  const reference = isDigest
    ? input.slice(digestIndex + 1)
    : colonIndex > slashIndex
      ? input.slice(colonIndex + 1)
      : 'latest'
  const namePart = isDigest
    ? input.slice(0, digestIndex)
    : colonIndex > slashIndex
      ? input.slice(0, colonIndex)
      : input
  if (!namePart || !reference || (isDigest && !/^sha256:[a-f0-9]{64}$/i.test(reference))) {
    throw new Error('镜像名称或标签格式不正确')
  }

  const parts = namePart.split('/')
  const first = parts[0]
  const hasRegistry = parts.length > 1 && (first.includes('.') || first.includes(':') || first === 'localhost')
  const inputRegistry = hasRegistry ? first : ''
  let repository = hasRegistry ? parts.slice(1).join('/') : namePart
  if (!hasRegistry && !repository.includes('/')) repository = `library/${repository}`
  if (!repository || repository.includes('..')) throw new Error('镜像仓库路径不正确')

  const logicalRepository = hasRegistry
    ? `${inputRegistry}/${repository}`
    : repository.startsWith('library/')
      ? repository.slice('library/'.length)
      : repository
  const tag = isDigest ? reference.slice(7, 19) : reference
  return { input, inputRegistry, repository, logicalRepository, reference, tag, isDigest }
}

/** 根据镜像引用和下载源生成实际 Registry 地址。 */
function resolveTarget(options) {
  const parsed = parseImageReference(options.image)
  let endpoint
  if (options.source === 'custom') {
    endpoint = normalizeRegistryUrl(options.customRegistry)
  } else if (options.source && options.source !== 'auto') {
    endpoint = SOURCES[options.source]
    if (!endpoint) throw new Error('未知的镜像下载源')
  } else {
    const registry = parsed.inputRegistry || 'registry-1.docker.io'
    endpoint = normalizeRegistryUrl(['docker.io', 'index.docker.io'].includes(registry) ? 'registry-1.docker.io' : registry)
  }
  const endpointUrl = new URL(endpoint)
  const repoTagRepository = parsed.logicalRepository
  return {
    ...parsed,
    baseUrl: endpoint.replace(/\/$/, ''),
    registry: endpointUrl.host,
    repoTagRepository,
    repoTag: parsed.isDigest ? '' : `${repoTagRepository}:${parsed.reference}`
  }
}

/** 规范化 Registry 地址，仅允许 HTTP 或 HTTPS。 */
function normalizeRegistryUrl(value) {
  const raw = String(value || '').trim().replace(/\/$/, '')
  if (!raw) throw new Error('请输入自定义镜像仓库地址')
  const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('镜像仓库仅支持 HTTP 或 HTTPS 地址')
  if (url.username || url.password || url.search || url.hash) throw new Error('镜像仓库地址中不能包含凭据或查询参数')
  return url.toString().replace(/\/$/, '')
}

/** 创建网络配置。 */
function createNetworkOptions(options) {
  const proxyMode = options.proxyMode || 'none'
  const verifySsl = options.verifySsl !== false
  if (proxyMode === 'custom') {
    return {
      proxyMode,
      proxyUrl: normalizeProxyUrl(options.proxyUrl),
      httpProxy: '',
      httpsProxy: '',
      noProxy: '',
      verifySsl
    }
  }
  if (proxyMode === 'system') {
    return {
      proxyMode,
      proxyUrl: '',
      httpProxy: normalizeProxyUrl(process.env.HTTP_PROXY || process.env.http_proxy || '', true),
      httpsProxy: normalizeProxyUrl(process.env.HTTPS_PROXY || process.env.https_proxy || '', true),
      noProxy: process.env.NO_PROXY || process.env.no_proxy || '',
      verifySsl
    }
  }
  return { proxyMode: 'none', proxyUrl: '', httpProxy: '', httpsProxy: '', noProxy: '', verifySsl }
}

/** 规范化代理地址。 */
function normalizeProxyUrl(value, optional = false) {
  let proxyUrl = String(value || '').trim()
  if (!proxyUrl && optional) return ''
  if (!proxyUrl) throw new Error('请输入自定义代理地址')
  if (!/^https?:\/\//i.test(proxyUrl)) proxyUrl = `http://${proxyUrl}`
  try {
    const url = new URL(proxyUrl)
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) throw new Error()
    return url.toString()
  } catch {
    throw new Error('代理地址格式不正确')
  }
}

/** 拉取镜像清单并选择目标平台。 */
async function prepareImage(options, signal) {
  const target = resolveTarget(options)
  const network = createNetworkOptions(options)
  const client = new RegistryClient(target, { ...options, network, signal })
  await client.initialize()
  const root = await client.getManifest(target.reference)
  const indexEntries = Array.isArray(root.manifest.manifests) ? root.manifest.manifests : []
  const platforms = indexEntries
    .map((entry) => platformFromManifest(entry))
    .filter(
      (platform) =>
        platform.os &&
        platform.os !== 'unknown' &&
        platform.architecture &&
        platform.architecture !== 'unknown'
    )

  let selectedPlatform
  let selectedManifest = root.manifest
  let manifestDigest = root.digest || target.reference
  if (indexEntries.length > 0) {
    const requested = options.platform || 'linux/amd64'
    let selectedIndex = platforms.findIndex((platform) => platform.key === requested)
    if (selectedIndex < 0) {
      const requestedParts = requested.split('/')
      selectedIndex = platforms.findIndex(
        (platform) => platform.os === requestedParts[0] && platform.architecture === requestedParts[1]
      )
    }
    if (selectedIndex < 0 && options.allowPlatformFallback && platforms.length > 0) selectedIndex = 0
    if (selectedIndex < 0) {
      const available = platforms.map((platform) => platform.key).join('、')
      throw new Error(`未找到 ${requested} 平台，可用平台：${available || '无'}`)
    }
    selectedPlatform = platforms[selectedIndex]
    const child = await client.getManifest(selectedPlatform.digest)
    selectedManifest = child.manifest
    manifestDigest = child.digest || selectedPlatform.digest
  }

  validateImageManifest(selectedManifest)
  if (!selectedPlatform) {
    const configBody = await client.getBlobBuffer(selectedManifest.config.digest)
    await verifyBufferDigest(configBody, selectedManifest.config.digest, '镜像配置')
    const config = parseJson(configBody, '镜像配置文件无效')
    selectedPlatform = {
      os: config.os || 'linux',
      architecture: config.architecture || 'unknown',
      variant: config.variant || '',
      digest: manifestDigest,
      key: platformKey(config.os || 'linux', config.architecture || 'unknown', config.variant || '')
    }
    platforms.push(selectedPlatform)
  }

  return {
    client,
    target,
    manifest: selectedManifest,
    manifestDigest,
    platforms: uniquePlatforms(platforms),
    selectedPlatform
  }
}

/** 验证清单是否包含下载所需字段。 */
function validateImageManifest(manifest) {
  if (!manifest?.config?.digest || !Array.isArray(manifest.layers)) {
    throw new Error('镜像清单格式不完整，缺少配置或数据层')
  }
  const descriptors = [manifest.config, ...manifest.layers]
  if (descriptors.some((item) => !/^sha256:[a-f0-9]{64}$/i.test(item.digest || ''))) {
    throw new Error('镜像清单包含不受支持的数据摘要')
  }
}

/** 校验配置中的解压层摘要与清单层数是否一致。 */
function validateDiffIds(config, layers) {
  const diffIds = config.rootfs?.diff_ids
  if (
    !Array.isArray(diffIds) ||
    diffIds.length !== layers.length ||
    diffIds.some((digest) => !/^sha256:[a-f0-9]{64}$/i.test(digest))
  ) {
    throw new Error('镜像配置中的数据层摘要不完整')
  }
  return diffIds
}

/** 将清单平台信息转换为界面数据。 */
function platformFromManifest(entry) {
  const platform = entry.platform || {}
  const architecture =
    platform.architecture || entry.annotations?.['com.docker.official-images.bashbrew.arch'] || ''
  return {
    os: platform.os || '',
    architecture,
    variant: platform.variant || '',
    digest: entry.digest || '',
    key: platformKey(platform.os || '', architecture, platform.variant || '')
  }
}

/** 生成标准平台标识。 */
function platformKey(os, architecture, variant) {
  return [os, architecture, variant].filter(Boolean).join('/')
}

/** 去除平台清单中的重复项。 */
function uniquePlatforms(platforms) {
  const seen = new Set()
  return platforms.filter((platform) => {
    if (seen.has(platform.key)) return false
    seen.add(platform.key)
    return true
  })
}

/** 生成可传给渲染层的预检结果。 */
function serializeInspection(prepared) {
  const descriptors = [prepared.manifest.config, ...prepared.manifest.layers]
  return {
    image: prepared.target.input,
    registry: prepared.target.registry,
    repository: prepared.target.repository,
    reference: prepared.target.reference,
    repoTag: prepared.target.repoTag,
    manifestDigest: prepared.manifestDigest,
    mediaType: prepared.manifest.mediaType || '',
    selectedPlatform: prepared.selectedPlatform,
    platforms: prepared.platforms,
    layerCount: prepared.manifest.layers.length,
    totalSize: descriptors.reduce((sum, item) => sum + Number(item.size || 0), 0)
  }
}

/** 创建一个下载文件进度项。 */
function createDownloadItem(descriptor, label, kind) {
  return {
    digest: descriptor.digest,
    shortDigest: digestHex(descriptor.digest).slice(0, 12),
    mediaType: descriptor.mediaType || '',
    label,
    kind,
    size: Number(descriptor.size || 0),
    downloaded: 0,
    status: 'pending'
  }
}

/** 下载并校验单个 Registry blob，支持断点续传。 */
async function downloadBlob(task, client, item, filePath) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    assertNotCancelled(task)
    let existingSize = await fileSize(filePath)
    if (item.size > 0 && existingSize > item.size) {
      await fsp.rm(filePath, { force: true })
      existingSize = 0
    }
    item.downloaded = existingSize
    item.status = 'downloading'
    updateTaskMetrics(task, true)
    let response = null
    try {
      if (item.size > 0 && existingSize === item.size) {
        await verifyFileDigest(filePath, item.digest, item.label, task.abortController.signal)
        item.status = 'completed'
        updateTaskMetrics(task, true)
        return
      }

      response = await client.openBlob(item.digest, existingSize)
      if (response.statusCode === 416 && item.size > 0 && existingSize === item.size) {
        response.resume()
        await verifyFileDigest(filePath, item.digest, item.label, task.abortController.signal)
        item.status = 'completed'
        return
      }
      if (![200, 206].includes(response.statusCode)) {
        const body = await readResponseBuffer(response)
        throw createHttpError(`${item.label} 下载失败`, response, body)
      }

      const canResume = existingSize > 0 && response.statusCode === 206
      if (!canResume) {
        existingSize = 0
        item.downloaded = 0
      }
      task.activeStreams.add(response)
      const tracker = new Transform({
        transform(chunk, _encoding, callback) {
          if (task.cancelled) return callback(new CancelledError())
          item.downloaded += chunk.length
          updateTaskMetrics(task)
          callback(null, chunk)
        }
      })
      await pipeline(response, tracker, fs.createWriteStream(filePath, { flags: canResume ? 'a' : 'w' }))
      task.activeStreams.delete(response)
      if (item.size > 0 && item.downloaded !== item.size) {
        throw new Error(`${item.label} 文件大小不完整`)
      }
      item.status = 'verifying'
      await verifyFileDigest(filePath, item.digest, item.label, task.abortController.signal)
      item.status = 'completed'
      updateTaskMetrics(task, true)
      return
    } catch (error) {
      if (response) task.activeStreams.delete(response)
      if (error instanceof CancelledError || task.cancelled) throw new CancelledError()
      item.status = 'retrying'
      if (attempt >= 4) throw error
      const delay = Math.min(1000 * 2 ** attempt, 8000)
      addLog(task, 'warning', `${item.label} 下载中断，${delay / 1000} 秒后重试`)
      await sleep(delay, task.abortController.signal)
    }
  }
}

/** 并发执行固定数量的异步任务，并等待所有已启动任务结束。 */
async function runPool(items, concurrency, worker) {
  let cursor = 0
  let failure = null
  /** 依次领取并执行任务。 */
  async function consume() {
    while (cursor < items.length && !failure) {
      const current = cursor
      cursor += 1
      try {
        await worker(items[current])
      } catch (error) {
        if (!failure) failure = error
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => consume()))
  if (failure) throw failure
}

/** 解压数据层并核对镜像配置中的 diff_id。 */
async function extractLayer(task, inputPath, outputPath, mediaType, expectedDiffId) {
  const magic = Buffer.alloc(4)
  const handle = await fsp.open(inputPath, 'r')
  await handle.read(magic, 0, 4, 0)
  await handle.close()
  const magicIsGzip = magic[0] === 0x1f && magic[1] === 0x8b
  const magicIsZstd = magic.equals(Buffer.from([0x28, 0xb5, 0x2f, 0xfd]))
  const isZstd = magicIsZstd || (!magicIsGzip && mediaType.includes('zstd'))
  const isGzip = !isZstd && (magicIsGzip || mediaType.includes('gzip'))
  const hashStream = new HashTransform(() => {
    if (task.cancelled) throw new CancelledError()
  })
  const streams = [fs.createReadStream(inputPath)]
  if (isGzip) streams.push(zlib.createGunzip())
  if (isZstd) {
    streams.push(
      typeof zlib.createZstdDecompress === 'function'
        ? zlib.createZstdDecompress()
        : new ZstdDecompressTransform()
    )
  }
  streams.push(hashStream, fs.createWriteStream(outputPath))
  await pipeline(...streams)
  const actualDiffId = hashStream.digest()
  if (expectedDiffId && actualDiffId !== expectedDiffId.toLowerCase()) {
    await fsp.rm(outputPath, { force: true })
    throw new Error('镜像层解压后 SHA256 校验失败')
  }
}

/** 将 Docker 镜像目录流式写入 tar。 */
async function createDockerTar(layoutDir, outputPath, task) {
  const writer = new TarWriter(
    outputPath,
    (bytes) => {
      task.packedBytes += bytes
      task.updatedAt = Date.now()
    },
    () => task.cancelled
  )
  try {
    const rootEntries = await fsp.readdir(layoutDir, { withFileTypes: true })
    const files = rootEntries.filter((entry) => entry.isFile()).sort((a, b) => a.name.localeCompare(b.name))
    const directories = rootEntries
      .filter((entry) => entry.isDirectory())
      .sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of files) await writer.addFile(entry.name, path.join(layoutDir, entry.name))
    for (const directory of directories) {
      await writer.addDirectory(directory.name)
      const children = await fsp.readdir(path.join(layoutDir, directory.name))
      for (const child of children.sort()) {
        await writer.addFile(`${directory.name}/${child}`, path.join(layoutDir, directory.name, child))
      }
    }
    await writer.close()
  } catch (error) {
    writer.destroy()
    throw error
  }
}

/** 发起支持重定向、代理和取消信号的 HTTP 请求。 */
async function request(urlValue, options = {}, redirectCount = 0) {
  if (redirectCount > 5) throw new Error('网络请求重定向次数过多')
  if (options.signal?.aborted) throw new CancelledError()
  const url = new URL(urlValue)
  const transport = url.protocol === 'https:' ? https : http
  const agent = createAgent(url, options.network || {})
  const response = await new Promise((resolve, reject) => {
    const requestOptions = {
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method: options.method || 'GET',
      headers: { 'User-Agent': 'ZTools-Docker-Image-Downloader/1.0', ...(options.headers || {}) },
      agent,
      rejectUnauthorized: options.network?.verifySsl !== false
    }
    const req = transport.request(requestOptions)
    /** 移除请求阶段的取消监听器。 */
    function removeAbortListener() {
      options.signal?.removeEventListener('abort', abortRequest)
    }
    /** 取消尚未收到响应头的请求。 */
    function abortRequest() {
      req.destroy(new CancelledError())
    }
    req.setTimeout(options.timeout || 60000, () => req.destroy(new Error('网络请求超时')))
    req.once('response', (incoming) => {
      removeAbortListener()
      bindResponseAbort(incoming, options.signal)
      resolve(incoming)
    })
    req.once('error', (error) => {
      removeAbortListener()
      reject(error)
    })
    options.signal?.addEventListener('abort', abortRequest, { once: true })
    req.end()
  })
  if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
    const redirectedUrl = new URL(response.headers.location, url)
    const headers = { ...(options.headers || {}) }
    if (redirectedUrl.origin !== url.origin) delete headers.Authorization
    response.resume()
    return request(redirectedUrl.toString(), { ...options, headers }, redirectCount + 1)
  }
  return response
}

/** 让响应流在任务取消时立即终止。 */
function bindResponseAbort(response, signal) {
  if (!signal) return
  /** 移除响应阶段的取消监听器。 */
  function removeAbortListener() {
    signal.removeEventListener('abort', abortResponse)
  }
  /** 取消正在读取正文的响应。 */
  function abortResponse() {
    response.destroy(new CancelledError())
  }
  response.once('close', removeAbortListener)
  response.once('error', () => {})
  signal.addEventListener('abort', abortResponse, { once: true })
  if (signal.aborted) abortResponse()
}

/** 根据目标协议和代理配置创建连接代理。 */
function createAgent(targetUrl, network) {
  const proxyUrl = proxyForTarget(targetUrl, network)
  if (proxyUrl) {
    const Agent = targetUrl.protocol === 'https:' ? HttpsProxyAgent : HttpProxyAgent
    return new Agent(proxyUrl, { rejectUnauthorized: network.verifySsl !== false })
  }
  if (targetUrl.protocol === 'https:') {
    return new https.Agent({ keepAlive: true, rejectUnauthorized: network.verifySsl !== false })
  }
  return new http.Agent({ keepAlive: true })
}

/** 为当前目标选择系统或自定义代理。 */
function proxyForTarget(targetUrl, network) {
  if (network.proxyMode === 'custom') return network.proxyUrl
  if (network.proxyMode !== 'system' || shouldBypassProxy(targetUrl, network.noProxy)) return ''
  return targetUrl.protocol === 'https:'
    ? network.httpsProxy || network.httpProxy
    : network.httpProxy || network.httpsProxy
}

/** 判断目标地址是否匹配 NO_PROXY。 */
function shouldBypassProxy(targetUrl, noProxy) {
  const hostname = targetUrl.hostname.toLowerCase()
  const port = targetUrl.port || (targetUrl.protocol === 'https:' ? '443' : '80')
  return String(noProxy || '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .some((entry) => {
      if (entry === '*') return true
      const match = entry.match(/^(.+?)(?::(\d+))?$/)
      if (!match || (match[2] && match[2] !== port)) return false
      const domain = match[1].replace(/^\*?\./, '').replace(/^\[|\]$/g, '')
      return hostname === domain || hostname.endsWith(`.${domain}`)
    })
}

/** 读取响应体，并限制异常响应占用的内存。 */
async function readResponseBuffer(response, maximum = 16 * 1024 * 1024) {
  const chunks = []
  let size = 0
  for await (const chunk of response) {
    size += chunk.length
    if (size > maximum) {
      response.destroy()
      throw new Error('镜像仓库返回的数据过大')
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

/** 解析 Registry 的 WWW-Authenticate 响应头。 */
function parseAuthChallenge(value) {
  if (!value) return null
  const match = String(value).match(/^\s*([a-z]+)\s*(.*)$/i)
  if (!match) return null
  const params = {}
  const pattern = /([a-z][a-z0-9_-]*)="([^"]*)"/gi
  let parameter
  while ((parameter = pattern.exec(match[2]))) params[parameter[1].toLowerCase()] = parameter[2]
  return { scheme: match[1].toLowerCase(), params }
}

/** 将仓库路径按分段编码，保留斜杠。 */
function encodeRepository(repository) {
  return repository.split('/').map(encodeURIComponent).join('/')
}

/** 从响应内容创建可读的网络错误。 */
function createHttpError(prefix, response, body) {
  let detail = ''
  try {
    const payload = JSON.parse(body.toString('utf8'))
    detail = payload.errors?.[0]?.message || payload.message || ''
  } catch {
    detail = body.toString('utf8').slice(0, 200)
  }
  const suffix = detail ? `：${detail}` : ''
  return new Error(`${prefix}（HTTP ${response.statusCode}）${suffix}`)
}

/** 解析 JSON，并转换为中文错误。 */
function parseJson(buffer, errorMessage) {
  try {
    return JSON.parse(buffer.toString('utf8'))
  } catch {
    throw new Error(errorMessage)
  }
}

/** 校验内存数据的摘要。 */
async function verifyBufferDigest(buffer, expected, label) {
  const actual = `sha256:${crypto.createHash('sha256').update(buffer).digest('hex')}`
  if (actual !== expected.toLowerCase()) throw new Error(`${label} SHA256 校验失败`)
}

/** 以流式方式校验文件摘要。 */
async function verifyFileDigest(filePath, expected, label, signal) {
  const hash = crypto.createHash('sha256')
  for await (const chunk of fs.createReadStream(filePath)) {
    if (signal?.aborted) throw new CancelledError()
    hash.update(chunk)
  }
  const actual = `sha256:${hash.digest('hex')}`
  if (actual !== expected.toLowerCase()) {
    await fsp.rm(filePath, { force: true })
    throw new Error(`${label} SHA256 校验失败`)
  }
}

/** 获取文件大小，不存在时返回零。 */
async function fileSize(filePath) {
  try {
    return (await fsp.stat(filePath)).size
  } catch (error) {
    if (error.code === 'ENOENT') return 0
    throw error
  }
}

/** 汇总目录内所有文件的大小。 */
async function directoryFileSize(directory) {
  let total = 0
  for (const entry of await fsp.readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name)
    total += entry.isDirectory() ? await directoryFileSize(fullPath) : (await fsp.stat(fullPath)).size
  }
  return total
}

/** 以不覆盖已有文件的方式原子发布 tar 镜像包。 */
async function publishArchive(partialPath, directory, fileName) {
  const extension = path.extname(fileName)
  const baseName = path.basename(fileName, extension)
  for (let index = 0; index < 1000; index += 1) {
    const suffix = index === 0 ? '' : `_${index + 1}`
    const outputPath = path.join(directory, `${baseName}${suffix}${extension}`)
    let published = false
    try {
      await fsp.link(partialPath, outputPath)
      published = true
    } catch (error) {
      if (error.code === 'EEXIST') continue
      if (!['EPERM', 'ENOTSUP', 'EOPNOTSUPP'].includes(error.code)) throw error
      try {
        await fsp.copyFile(partialPath, outputPath, fs.constants.COPYFILE_EXCL)
        published = true
      } catch (copyError) {
        if (copyError.code === 'EEXIST') continue
        throw copyError
      }
    }
    if (published) {
      await fsp.rm(partialPath, { force: true }).catch(() => {})
      return outputPath
    }
  }
  throw new Error('输出目录中存在过多同名镜像包')
}

/** 检查目标 tar 文件及其重复下载文件是否已经存在。 */
async function findExistingArchive(directory, fileName) {
  const rawDirectory = String(directory || '').trim()
  if (!rawDirectory) return ''
  const outputDir = path.resolve(rawDirectory)
  let entries
  try {
    entries = await fsp.readdir(outputDir, { withFileTypes: true })
  } catch (error) {
    if (error.code === 'ENOENT') return ''
    throw error
  }

  const extension = path.extname(fileName)
  const baseName = path.basename(fileName, extension)
  const candidates = entries
    .filter((entry) => entry.isFile())
    .map((entry) => ({ name: entry.name, rank: archiveNameRank(entry.name, baseName, extension) }))
    .filter((entry) => Number.isFinite(entry.rank))
    .sort((left, right) => left.rank - right.rank)
  return candidates.length > 0 ? path.join(outputDir, candidates[0].name) : ''
}

/** 返回镜像包文件名对应的重复下载序号。 */
function archiveNameRank(fileName, baseName, extension) {
  if (fileName === `${baseName}${extension}`) return 0
  const prefix = `${baseName}_`
  if (!fileName.startsWith(prefix) || !fileName.endsWith(extension)) return Number.POSITIVE_INFINITY
  const suffix = fileName.slice(prefix.length, fileName.length - extension.length)
  if (!/^\d+$/.test(suffix)) return Number.POSITIVE_INFINITY
  const rank = Number(suffix)
  return rank >= 2 ? rank : Number.POSITIVE_INFINITY
}

/** 生成安全的 tar 文件名。 */
function buildArchiveName(target, platform) {
  const reference = target.isDigest ? target.reference.slice(7, 19) : target.reference
  const raw = `${target.repoTagRepository}_${reference}_${platform}`
  const safeName = raw.replace(/[\\/:*?"<>|\s]+/g, '_').replace(/_+/g, '_').slice(0, 120)
  return `${safeName}.tar`
}

/** 从 SHA256 摘要中提取十六进制部分。 */
function digestHex(digest) {
  return String(digest).replace(/^sha256:/, '')
}

/** 创建符合 ustar 格式的 512 字节头。 */
function createTarHeader(name, size, type, modifiedAt = new Date()) {
  const nameBuffer = Buffer.from(name)
  if (nameBuffer.length > 100) throw new Error(`tar 内部路径过长：${name}`)
  if (!Number.isSafeInteger(size) || size < 0 || size > MAX_TAR_ENTRY_SIZE) {
    throw new Error(`单个镜像层超过传统 Docker tar 格式支持的 8 GiB 上限：${name}`)
  }
  const header = Buffer.alloc(512)
  nameBuffer.copy(header, 0)
  writeTarOctal(header, 100, 8, type === '5' ? 0o755 : 0o644)
  writeTarOctal(header, 108, 8, 0)
  writeTarOctal(header, 116, 8, 0)
  writeTarOctal(header, 124, 12, size)
  writeTarOctal(header, 136, 12, Math.floor(new Date(modifiedAt).getTime() / 1000))
  header.fill(0x20, 148, 156)
  header.write(type, 156, 1, 'ascii')
  header.write('ustar\0', 257, 6, 'ascii')
  header.write('00', 263, 2, 'ascii')
  header.write('root', 265, 4, 'ascii')
  header.write('root', 297, 4, 'ascii')
  let checksum = 0
  for (const byte of header) checksum += byte
  header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii')
  return header
}

/** 向 tar 头写入八进制数值。 */
function writeTarOctal(buffer, offset, length, value) {
  const number = Math.max(0, Number(value))
  const digits = number.toString(8)
  if (!Number.isSafeInteger(number) || digits.length > length - 1) {
    throw new Error('tar 文件头数值超出支持范围')
  }
  buffer.write(`${digits.padStart(length - 1, '0')}\0`, offset, length, 'ascii')
}

/** 计算 tar 文件块需要的补齐字节数。 */
function paddingSize(size) {
  return (512 - (size % 512)) % 512
}

/** 更新任务的总进度、速度和预计剩余时间。 */
function updateTaskMetrics(task, force = false) {
  task.downloadedBytes = task.layers.reduce((sum, item) => sum + item.downloaded, 0)
  const now = Date.now()
  const elapsed = (now - task.metricAt) / 1000
  if (force || elapsed >= 0.4) {
    if (elapsed > 0) {
      const currentSpeed = Math.max(0, (task.downloadedBytes - task.metricBytes) / elapsed)
      task.speed = task.speed > 0 ? task.speed * 0.65 + currentSpeed * 0.35 : currentSpeed
      const remaining = Math.max(0, task.totalBytes - task.downloadedBytes)
      task.etaSeconds = task.speed > 0 ? Math.ceil(remaining / task.speed) : null
    }
    task.metricAt = now
    task.metricBytes = task.downloadedBytes
  }
  task.updatedAt = now
}

/** 记录一条任务日志并限制日志长度。 */
function addLog(task, level, message) {
  task.logs.push({ time: Date.now(), level, message })
  if (task.logs.length > 60) task.logs.splice(0, task.logs.length - 60)
  task.updatedAt = Date.now()
}

/** 创建不包含内部对象的任务快照。 */
function snapshotTask(task) {
  return {
    id: task.id,
    status: task.status,
    phase: task.phase,
    image: task.image,
    platform: task.platform,
    registry: task.registry,
    outputPath: task.outputPath,
    fileName: task.fileName,
    totalBytes: task.totalBytes,
    downloadedBytes: task.downloadedBytes,
    speed: task.speed,
    etaSeconds: task.etaSeconds,
    packedBytes: task.packedBytes,
    packTotalBytes: task.packTotalBytes,
    layers: task.layers.map((item) => ({ ...item })),
    logs: task.logs.map((item) => ({ ...item })),
    error: task.error,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    finishedAt: task.finishedAt
  }
}

/** 检查任务是否已取消。 */
function assertNotCancelled(task) {
  if (task.cancelled) throw new CancelledError()
}

/** 判断任务状态是否已结束。 */
function isTerminalStatus(status) {
  return ['completed', 'failed', 'cancelled'].includes(status)
}

/** 将未知异常转换为用户可读文本。 */
function normalizeError(error) {
  const message = error instanceof Error ? error.message : String(error)
  const mappings = [
    [/ENOTFOUND|EAI_AGAIN/i, '无法解析镜像仓库地址，请检查网络、下载源或代理设置'],
    [/ECONNREFUSED/i, '镜像仓库拒绝连接，请检查仓库地址或代理设置'],
    [/CERT_|certificate|self.signed/i, 'SSL 证书验证失败，可确认仓库可信后关闭证书验证'],
    [/ETIMEDOUT|timeout|超时/i, '连接镜像仓库超时，请检查网络或代理设置'],
    [/ENOSPC/i, '磁盘空间不足，无法继续写入镜像文件'],
    [/EACCES|EPERM/i, '没有权限写入所选目录']
  ]
  return mappings.find(([pattern]) => pattern.test(message))?.[1] || message
}

/** 将数字限制在指定范围。 */
function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value))
}

/** 等待指定毫秒数，并响应任务取消。 */
function sleep(milliseconds, signal) {
  if (signal?.aborted) return Promise.reject(new CancelledError())
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', cancelWait)
      resolve()
    }, milliseconds)
    /** 取消重试等待。 */
    function cancelWait() {
      clearTimeout(timer)
      reject(new CancelledError())
    }
    signal?.addEventListener('abort', cancelWait, { once: true })
  })
}

module.exports = {
  DockerImageService,
  __test: {
    buildArchiveName,
    createTarHeader,
    findExistingArchive,
    parseAuthChallenge,
    parseImageReference,
    proxyForTarget,
    publishArchive,
    resolveTarget,
    validateDiffIds,
    ZstdDecompressTransform
  }
}
