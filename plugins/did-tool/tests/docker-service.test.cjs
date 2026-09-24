const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fsp = require('node:fs/promises')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const { Readable, Writable } = require('node:stream')
const { pipeline } = require('node:stream/promises')
const test = require('node:test')
const zlib = require('node:zlib')
const { DockerImageService, __test } = require('../public/preload/docker-service')

/** 验证常见 Docker 镜像引用格式。 */
test('解析 Docker 镜像引用', () => {
  assert.deepEqual(
    pickReference(__test.parseImageReference('nginx')),
    { registry: '', repository: 'library/nginx', reference: 'latest', logical: 'nginx' }
  )
  assert.deepEqual(
    pickReference(__test.parseImageReference('redis:7.4')),
    { registry: '', repository: 'library/redis', reference: '7.4', logical: 'redis' }
  )
  assert.deepEqual(
    pickReference(__test.parseImageReference('docker pull alpine:latest')),
    { registry: '', repository: 'library/alpine', reference: 'latest', logical: 'alpine' }
  )
  assert.deepEqual(
    pickReference(__test.parseImageReference('DOCKER   PULL   redis:7.4')),
    { registry: '', repository: 'library/redis', reference: '7.4', logical: 'redis' }
  )
  assert.deepEqual(
    pickReference(__test.parseImageReference('ghcr.io/acme/demo:v1')),
    { registry: 'ghcr.io', repository: 'acme/demo', reference: 'v1', logical: 'ghcr.io/acme/demo' }
  )
  assert.deepEqual(
    pickReference(__test.parseImageReference('localhost:5000/team/demo:dev')),
    {
      registry: 'localhost:5000',
      repository: 'team/demo',
      reference: 'dev',
      logical: 'localhost:5000/team/demo'
    }
  )
  assert.deepEqual(
    pickReference(__test.parseImageReference('registry.k8s.io/pause:3.10')),
    {
      registry: 'registry.k8s.io',
      repository: 'pause',
      reference: '3.10',
      logical: 'registry.k8s.io/pause'
    }
  )
})

/** 验证摘要引用及非法输入校验。 */
test('解析镜像摘要引用', () => {
  const digest = `sha256:${'a'.repeat(64)}`
  const parsed = __test.parseImageReference(`alpine@${digest}`)
  assert.equal(parsed.reference, digest)
  assert.equal(parsed.isDigest, true)
  assert.throws(() => __test.parseImageReference('alpine@sha256:1234'), /格式不正确/)
  assert.throws(() => __test.parseImageReference('bad image'), /有效的镜像名称/)
})

/** 验证下载源覆盖与导入标签保持逻辑。 */
test('解析实际 Registry 与导入标签', () => {
  const accelerated = __test.resolveTarget({ image: 'nginx:1.27', source: 'oneMs' })
  assert.equal(accelerated.registry, 'docker.1ms.run')
  assert.equal(accelerated.repository, 'library/nginx')
  assert.equal(accelerated.repoTag, 'nginx:1.27')

  const privateRegistry = __test.resolveTarget({ image: 'team/demo:v2', source: 'custom', customRegistry: 'http://localhost:5000' })
  assert.equal(privateRegistry.baseUrl, 'http://localhost:5000')
  assert.equal(privateRegistry.repoTag, 'team/demo:v2')
})

/** 验证 Registry Bearer 挑战头解析。 */
test('解析 Registry 认证挑战', () => {
  const challenge = __test.parseAuthChallenge(
    'Bearer realm="https://auth.example.com/token",service="registry.example.com",scope="repository:team/demo:pull"'
  )
  assert.equal(challenge.scheme, 'bearer')
  assert.equal(challenge.params.realm, 'https://auth.example.com/token')
  assert.equal(challenge.params.service, 'registry.example.com')
  assert.equal(challenge.params.scope, 'repository:team/demo:pull')
})

/** 验证生成的 ustar 头包含有效校验和。 */
test('生成有效的 tar 文件头', () => {
  const header = __test.createTarHeader('manifest.json', 128, '0', new Date(0))
  const storedChecksum = Number.parseInt(header.toString('ascii', 148, 154), 8)
  const checksumBuffer = Buffer.from(header)
  checksumBuffer.fill(0x20, 148, 156)
  const actualChecksum = checksumBuffer.reduce((sum, byte) => sum + byte, 0)
  assert.equal(storedChecksum, actualChecksum)
  assert.equal(header.toString('ascii', 257, 262), 'ustar')
  assert.throws(
    () => __test.createTarHeader('layer.tar', 8 * 1024 ** 3, '0'),
    /8 GiB 上限/
  )
})

/** 验证配置必须为每个镜像层提供 diff_id。 */
test('校验解压层摘要列表', () => {
  const digest = `sha256:${'b'.repeat(64)}`
  assert.deepEqual(__test.validateDiffIds({ rootfs: { diff_ids: [digest] } }, [{}]), [digest])
  assert.throws(() => __test.validateDiffIds({ rootfs: { diff_ids: [] } }, [{}]), /摘要不完整/)
  assert.throws(() => __test.validateDiffIds({ rootfs: { diff_ids: ['sha256:1234'] } }, [{}]), /摘要不完整/)
})

/** 验证系统代理按协议选择并遵守 NO_PROXY。 */
test('选择系统代理', () => {
  const network = {
    proxyMode: 'system',
    httpProxy: 'http://127.0.0.1:8080',
    httpsProxy: 'http://127.0.0.1:8443',
    noProxy: 'localhost,.internal.example',
    verifySsl: true
  }
  assert.equal(__test.proxyForTarget(new URL('https://registry.example.com'), network), network.httpsProxy)
  assert.equal(__test.proxyForTarget(new URL('http://registry.example.com'), network), network.httpProxy)
  assert.equal(__test.proxyForTarget(new URL('https://harbor.internal.example'), network), '')
  assert.equal(__test.proxyForTarget(new URL('http://localhost:5000'), network), '')
})

/** 验证会识别原始文件名及重复下载后缀。 */
test('检测已存在的镜像包', async () => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'docker-image-existing-'))
  try {
    await fsp.writeFile(path.join(directory, 'demo_latest_linux_amd64_3.tar'), '第三次下载')
    await fsp.writeFile(path.join(directory, 'demo_latest_linux_amd64_2.tar'), '第二次下载')
    await fsp.writeFile(path.join(directory, 'unrelated.tar'), '其他文件')
    const target = __test.resolveTarget({
      image: 'demo:latest',
      source: 'custom',
      customRegistry: 'https://registry.example.com'
    })
    const fileName = __test.buildArchiveName(target, 'linux/amd64')
    assert.equal(fileName, 'demo_latest_linux_amd64.tar')
    assert.equal(
      path.basename(await __test.findExistingArchive(directory, fileName)),
      'demo_latest_linux_amd64_2.tar'
    )

    await fsp.writeFile(path.join(directory, fileName), '首次下载')
    assert.equal(path.basename(await __test.findExistingArchive(directory, fileName)), fileName)
  } finally {
    await fsp.rm(directory, { recursive: true, force: true })
  }
})

/** 验证最终发布不会覆盖已有 tar。 */
test('发布 tar 时保留同名文件', async () => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'docker-image-publish-'))
  try {
    await fsp.writeFile(path.join(directory, 'image.tar'), '原文件')
    const partialPath = path.join(directory, '.image.partial')
    await fsp.writeFile(partialPath, '新文件')
    const outputPath = await __test.publishArchive(partialPath, directory, 'image.tar')
    assert.equal(path.basename(outputPath), 'image_2.tar')
    assert.equal(await fsp.readFile(path.join(directory, 'image.tar'), 'utf8'), '原文件')
    assert.equal(await fsp.readFile(outputPath, 'utf8'), '新文件')
  } finally {
    await fsp.rm(directory, { recursive: true, force: true })
  }
})

/** 验证纯 JavaScript zstd 流式解码回退。 */
test('流式解压 zstd 数据', async () => {
  if (typeof zlib.zstdCompressSync !== 'function') return
  const source = Buffer.from('离线镜像数据层'.repeat(4096), 'utf8')
  const compressed = zlib.zstdCompressSync(source)
  const chunks = []
  const sink = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.from(chunk))
      callback()
    }
  })
  await pipeline(
    Readable.from([compressed.subarray(0, 17), compressed.subarray(17)]),
    new __test.ZstdDecompressTransform(),
    sink
  )
  assert.deepEqual(Buffer.concat(chunks), source)
})

/** 验证不可信的清单摘要会被拒绝。 */
test('校验 Registry 清单摘要', async () => {
  const manifest = Buffer.from(JSON.stringify({ schemaVersion: 2, config: {}, layers: [] }))
  const server = http.createServer((request, response) => {
    if (request.url === '/v2/') {
      response.writeHead(200)
      response.end()
      return
    }
    response.writeHead(200, {
      'Content-Type': 'application/vnd.oci.image.manifest.v1+json',
      'Docker-Content-Digest': `sha256:${'0'.repeat(64)}`
    })
    response.end(manifest)
  })
  const port = await listen(server)
  const service = new DockerImageService()
  try {
    await assert.rejects(
      service.inspectImage({
        image: 'demo:latest',
        source: 'custom',
        customRegistry: `http://127.0.0.1:${port}`,
        platform: 'linux/amd64',
        proxyMode: 'none',
        verifySsl: true
      }),
      /清单与仓库返回的摘要不一致/
    )
  } finally {
    await close(server)
  }
})

/** 验证清单请求阶段也能立即取消。 */
test('取消等待响应头的下载任务', async () => {
  const server = http.createServer((request, response) => {
    const timer = setTimeout(() => response.end(), 5000)
    request.once('close', () => clearTimeout(timer))
  })
  const port = await listen(server)
  const service = new DockerImageService()
  try {
    const task = service.startDownload({
      image: 'demo:latest',
      source: 'custom',
      customRegistry: `http://127.0.0.1:${port}`,
      platform: 'linux/amd64',
      outputDir: process.cwd(),
      concurrency: 1,
      proxyMode: 'none',
      verifySsl: true
    })
    await wait(40)
    service.cancelTask(task.id)
    const finished = await waitForTerminalTask(service, task.id, 1200)
    assert.equal(finished.status, 'cancelled')
  } finally {
    await close(server)
  }
})

/** 验证完整的鉴权、续传、多层下载和 Docker tar 打包流程。 */
test('从模拟 Registry 导出多层镜像', async () => {
  const layerTars = ['第一层内容', '第二层内容', '第三层内容'].map((content, index) =>
    createLayerTar(`layer-${index + 1}.txt`, Buffer.from(content))
  )
  const compressedLayers = layerTars.map((content) => zlib.gzipSync(content))
  const layerDescriptors = compressedLayers.map((content) => ({
    mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip',
    digest: sha256(content),
    size: content.length
  }))
  const config = Buffer.from(
    JSON.stringify({
      architecture: 'amd64',
      os: 'linux',
      rootfs: { type: 'layers', diff_ids: layerTars.map(sha256) }
    })
  )
  const configDescriptor = {
    mediaType: 'application/vnd.oci.image.config.v1+json',
    digest: sha256(config),
    size: config.length
  }
  const manifest = Buffer.from(
    JSON.stringify({
      schemaVersion: 2,
      mediaType: 'application/vnd.oci.image.manifest.v1+json',
      config: configDescriptor,
      layers: layerDescriptors
    })
  )
  const manifestDigest = sha256(manifest)
  const index = Buffer.from(
    JSON.stringify({
      schemaVersion: 2,
      mediaType: 'application/vnd.oci.image.index.v1+json',
      manifests: [
        {
          mediaType: 'application/vnd.oci.image.manifest.v1+json',
          digest: manifestDigest,
          size: manifest.length,
          platform: { os: 'linux', architecture: 'amd64' }
        }
      ]
    })
  )
  const indexDigest = sha256(index)
  const blobs = new Map([[configDescriptor.digest, config]])
  layerDescriptors.forEach((descriptor, indexValue) => blobs.set(descriptor.digest, compressedLayers[indexValue]))
  let rangeRequests = 0
  let tokenRequests = 0
  let port = 0
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, `http://127.0.0.1:${port}`)
    const pathname = decodeURIComponent(url.pathname)
    const challenge = `Bearer realm="http://127.0.0.1:${port}/token",service="mock-registry"`
    if (pathname === '/token') {
      tokenRequests += 1
      sendJson(response, Buffer.from(JSON.stringify({ token: 'test-token' })))
      return
    }
    if (pathname === '/v2/' && request.headers.authorization !== 'Bearer test-token') {
      response.writeHead(401, { 'WWW-Authenticate': challenge })
      response.end()
      return
    }
    if (request.headers.authorization !== 'Bearer test-token') {
      response.writeHead(401, { 'WWW-Authenticate': challenge })
      response.end()
      return
    }
    if (pathname === '/v2/') {
      response.writeHead(200)
      response.end()
      return
    }
    if (pathname.endsWith('/manifests/latest')) {
      sendJson(response, index, indexDigest, 'application/vnd.oci.image.index.v1+json')
      return
    }
    if (pathname.endsWith(`/manifests/${manifestDigest}`)) {
      sendJson(response, manifest, manifestDigest, 'application/vnd.oci.image.manifest.v1+json')
      return
    }
    const digest = pathname.split('/blobs/')[1]
    const blob = blobs.get(digest)
    if (!blob) {
      response.writeHead(404)
      response.end()
      return
    }
    const range = request.headers.range?.match(/^bytes=(\d+)-$/)
    if (range) {
      const start = Number(range[1])
      rangeRequests += 1
      response.writeHead(206, {
        'Content-Length': blob.length - start,
        'Content-Range': `bytes ${start}-${blob.length - 1}/${blob.length}`
      })
      response.end(blob.subarray(start))
      return
    }
    response.writeHead(200, { 'Content-Length': blob.length })
    response.end(blob)
  })

  port = await listen(server)
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'docker-image-registry-'))
  try {
    const baseUrl = `http://127.0.0.1:${port}`
    const cacheKey = crypto
      .createHash('sha256')
      .update(`${baseUrl}|library/demo|latest|linux/amd64`)
      .digest('hex')
      .slice(0, 24)
    const resumeBlob = compressedLayers[0]
    const resumePath = path.join(
      directory,
      '.docker-image-cache',
      cacheKey,
      'blobs',
      `${layerDescriptors[0].digest.slice(7)}.blob`
    )
    await fsp.mkdir(path.dirname(resumePath), { recursive: true })
    await fsp.writeFile(resumePath, resumeBlob.subarray(0, Math.floor(resumeBlob.length / 2)))

    const service = new DockerImageService()
    const started = service.startDownload({
      image: 'demo:latest',
      source: 'custom',
      customRegistry: baseUrl,
      platform: 'linux/amd64',
      outputDir: directory,
      concurrency: 3,
      proxyMode: 'none',
      verifySsl: true
    })
    const completed = await waitForTerminalTask(service, started.id, 5000)
    assert.equal(completed.status, 'completed', completed.error)
    assert.equal(completed.layers.length, 4)
    assert.equal(completed.layers.every((layer) => layer.status === 'completed'), true)
    assert.ok(rangeRequests >= 1)
    assert.ok(tokenRequests >= 1)

    const archive = parseTar(await fsp.readFile(completed.outputPath))
    const dockerManifest = JSON.parse(archive.get('manifest.json').toString('utf8'))
    assert.equal(dockerManifest[0].RepoTags[0], 'demo:latest')
    assert.equal(dockerManifest[0].Layers.length, layerTars.length)
    dockerManifest[0].Layers.forEach((layerPath, indexValue) => {
      assert.deepEqual(archive.get(layerPath), layerTars[indexValue])
    })
  } finally {
    await close(server)
    await fsp.rm(directory, { recursive: true, force: true })
  }
})

/** 验证缺少 dbCryptoStorage 时仍能加密保存设置。 */
test('兼容旧版 ZTools 设置存储', () => {
  const servicePath = require.resolve('../public/preload/services.js')
  let storedValue = null
  global.window = {
    ztools: {
      getPath(name) {
        if (name === 'downloads') return 'C:\\Users\\tester\\Downloads'
        if (name === 'home') return 'C:\\Users\\tester'
        return 'C:\\Users\\tester\\AppData'
      },
      getNativeId() {
        return 'test-device-id'
      },
      dbStorage: {
        getItem() {
          return storedValue
        },
        setItem(_key, value) {
          storedValue = value
        }
      },
      showOpenDialog() {},
      shellShowItemInFolder() {}
    }
  }
  try {
    delete require.cache[servicePath]
    require(servicePath)
    assert.equal(window.services.getDefaults().outputDir, 'C:\\Users\\tester\\Downloads\\did-tool')
    const settings = {
      version: 2,
      sources: [
        {
          id: 'private',
          name: '私有镜像源',
          url: 'https://registry.example.com',
          username: 'admin',
          password: 'secret'
        }
      ],
      selectedSourceId: 'private',
      proxy: {
        protocol: 'http',
        address: '127.0.0.1:7890',
        username: 'proxy',
        password: 'proxy-secret'
      },
      downloadPath: 'C:\\Users\\tester\\did-tool'
    }
    window.services.saveSettings(settings)
    assert.equal(storedValue.version, 1)
    assert.equal(JSON.stringify(storedValue).includes('secret'), false)
    assert.deepEqual(window.services.loadSettings(), settings)
  } finally {
    delete require.cache[servicePath]
    delete global.window
  }
})

/** 计算测试数据的 SHA256 摘要。 */
function sha256(content) {
  return `sha256:${crypto.createHash('sha256').update(content).digest('hex')}`
}

/** 创建包含单个文件的最小 tar 数据层。 */
function createLayerTar(fileName, content) {
  const padding = Buffer.alloc((512 - (content.length % 512)) % 512)
  return Buffer.concat([
    __test.createTarHeader(fileName, content.length, '0', new Date(0)),
    content,
    padding,
    Buffer.alloc(1024)
  ])
}

/** 向模拟 Registry 返回 JSON 数据。 */
function sendJson(response, body, digest = '', mediaType = 'application/json') {
  const headers = { 'Content-Type': mediaType, 'Content-Length': body.length }
  if (digest) headers['Docker-Content-Digest'] = digest
  response.writeHead(200, headers)
  response.end(body)
}

/** 解析小型测试 tar 的文件条目。 */
function parseTar(buffer) {
  const entries = new Map()
  let offset = 0
  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512)
    if (header.every((byte) => byte === 0)) break
    const name = header.toString('utf8', 0, 100).replace(/\0.*$/, '')
    const size = Number.parseInt(header.toString('ascii', 124, 136).replace(/\0.*$/, '').trim() || '0', 8)
    const start = offset + 512
    if (header.toString('ascii', 156, 157) !== '5') entries.set(name, buffer.subarray(start, start + size))
    offset = start + Math.ceil(size / 512) * 512
  }
  return entries
}

/** 启动本地测试服务器并返回端口。 */
async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  return server.address().port
}

/** 关闭本地测试服务器。 */
async function close(server) {
  await new Promise((resolve) => server.close(resolve))
}

/** 等待指定时间。 */
function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

/** 等待下载任务进入结束状态。 */
async function waitForTerminalTask(service, taskId, timeout) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeout) {
    const task = service.getTask(taskId)
    if (['completed', 'failed', 'cancelled'].includes(task.status)) return task
    await wait(20)
  }
  throw new Error('等待任务取消超时')
}

/** 提取镜像引用测试关注的字段。 */
function pickReference(parsed) {
  return {
    registry: parsed.inputRegistry,
    repository: parsed.repository,
    reference: parsed.reference,
    logical: parsed.logicalRepository
  }
}
