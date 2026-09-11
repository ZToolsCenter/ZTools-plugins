// public/preload/docker.js
// Docker 命令封装层：所有 Docker 操作收敛于此。
// 纯函数（parse*/classify*）从顶层导出，供 vitest 单测与 UI 层复用。

// ===== 纯函数解析 =====

// 逐行解析 `docker ps -a --format '{{json .}}'` 输出
function parseContainerList(stdout) {
  const lines = String(stdout || '').split('\n').filter((line) => line.trim())
  return lines
    .map((line) => {
      let raw
      try {
        raw = JSON.parse(line)
        if (!raw || typeof raw !== 'object') return null
      } catch {
        return null
      }
      return {
        id: raw.ID,
        names: raw.Names,
        name: (raw.Names || '').split(',')[0].replace(/^\//, ''),
        image: raw.Image,
        command: raw.Command,
        created: raw.CreatedAt,
        status: raw.Status,
        ports: raw.Ports,
        state: classifyState(raw.State, raw.Status),
        project: extractProject(raw.Labels)
      }
    })
    .filter((c) => c !== null)
}

// 从 docker ps --format '{{json .}}' 的 Labels 字段提取 compose 项目名。
// Labels 是逗号分隔的 k=v 字符串（如 "com.docker.compose.project=mta,..."）。
function extractProject(labels) {
  if (!labels) return undefined
  const prefix = 'com.docker.compose.project='
  const entry = String(labels)
    .split(',')
    .find((kv) => kv.indexOf(prefix) === 0)
  return entry ? entry.slice(prefix.length) : undefined
}

// 解析 `docker compose ls --format json` 输出（JSON 数组）
function parseComposeProjects(stdout) {
  let data
  try {
    data = JSON.parse(String(stdout || '[]') || '[]')
  } catch {
    return []
  }
  if (!Array.isArray(data)) return []
  return data
    .map((raw) => ({ name: raw.Name, status: raw.Status, configFiles: raw.ConfigFiles }))
    .filter((p) => p.name)
}

// 解析 `docker context ls --format '{{json .}}'` 输出（逐行 JSON）
function parseContextList(stdout) {
  return String(stdout || '')
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => {
      const raw = JSON.parse(line)
      return {
        name: raw.Name,
        description: raw.Description,
        endpoint: raw.DockerEndpoint,
        current: raw.Current
      }
    })
    .filter((c) => c.name)
}

// 解析 `docker images --format '{{json .}}'` 输出
function parseImageList(stdout) {
  return String(stdout || '')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const raw = JSON.parse(line)
      return {
        id: raw.ID,
        repository: raw.Repository,
        tag: raw.Tag,
        size: raw.Size,
        created: raw.CreatedSince
      }
    })
    .filter((i) => i.id)
}

// 解析 `docker volume ls --format '{{json .}}'` 输出
function parseVolumeList(stdout) {
  return String(stdout || '')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const raw = JSON.parse(line)
      return { name: raw.Name, driver: raw.Driver, mountpoint: raw.Mountpoint }
    })
    .filter((v) => v.name)
}

// 解析 `docker network ls --format '{{json .}}'` 输出
function parseNetworkList(stdout) {
  return String(stdout || '')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const raw = JSON.parse(line)
      return { id: raw.ID, name: raw.Name, driver: raw.Driver, scope: raw.Scope }
    })
    .filter((n) => n.name)
}

// 从 docker ps 的 Ports 字符串提取宿主机端口（如 "0.0.0.0:8080->80/tcp" → ["8080"]）
function extractHostPorts(portsStr) {
  const out = new Set()
  const re = /([^:>]+)->/g
  let m
  while ((m = re.exec(String(portsStr || ''))) !== null) {
    const port = m[1].trim().split(':').pop()
    if (port && /^\d+$/.test(port)) out.add(port)
  }
  return [...out]
}

// ===== 还原 docker run 命令引擎 =====

// shell 单引号转义（值含空格/特殊字符时加引号，安全且可读）
function shQuote(value) {
  const s = String(value)
  if (/^[\w@%+=:,./-]+$/.test(s)) return s
  return "'" + s.replace(/'/g, "'\\''") + "'"
}

// 从 docker inspect 的完整数据还原等效的 docker run 命令
function buildRunCommand(data) {
  const parts = ['docker run']
  const cfg = data.Config || {}
  const host = data.HostConfig || {}
  const net = data.NetworkSettings || {}
  const name = (data.Name || '').replace(/^\//, '')

  if (name) parts.push('--name', shQuote(name))

  // 交互 / 后台
  if (cfg.Tty && cfg.OpenStdin) parts.push('-it')
  else if (cfg.Tty) parts.push('-t')
  else if (cfg.OpenStdin) parts.push('-i')
  else parts.push('-d')

  // 重启策略
  const rp = host.RestartPolicy || {}
  if (rp.Name && rp.Name !== 'no') {
    let p = rp.Name
    if (rp.Name === 'on-failure' && rp.MaximumRetryCount) p += ':' + rp.MaximumRetryCount
    parts.push('--restart', shQuote(p))
  }

  // 端口映射
  for (const [containerPort, bindings] of Object.entries(net.Ports || {})) {
    if (!bindings) continue
    for (const b of bindings) {
      const ip = b.HostIp && b.HostIp !== '0.0.0.0' ? b.HostIp + ':' : ''
      parts.push('-p', shQuote(ip + b.HostPort + ':' + containerPort))
    }
  }
  if (host.PublishAllPorts) parts.push('-P')

  // 目录挂载
  for (const m of data.Mounts || []) {
    if (m.Type === 'bind') {
      parts.push('-v', shQuote(m.Source + ':' + m.Destination + (m.Mode ? ':' + m.Mode : '')))
    } else if (m.Type === 'volume') {
      parts.push('-v', shQuote(m.Name + ':' + m.Destination + (m.RW ? '' : ':ro')))
    }
  }
  for (const vf of host.VolumesFrom || []) parts.push('--volumes-from', shQuote(vf))

  // 环境变量
  for (const e of cfg.Env || []) parts.push('-e', shQuote(e))

  // 标签
  for (const [k, v] of Object.entries(cfg.Labels || {})) parts.push('-l', shQuote(k + '=' + v))

  // 网络 / IPC / PID / USerns
  const netMode = host.NetworkMode || 'default'
  if (netMode && netMode !== 'default') parts.push('--network', shQuote(netMode))
  if (host.IpcMode && host.IpcMode !== 'private') parts.push('--ipc', shQuote(host.IpcMode))
  if (host.PidMode) parts.push('--pid', shQuote(host.PidMode))
  if (host.UsernsMode) parts.push('--userns', shQuote(host.UsernsMode))

  // hostname / user / 工作目录（hostname 默认即容器 ID 前缀，无需还原）
  if (cfg.Hostname && cfg.Hostname !== name && cfg.Hostname !== (data.Id || '').slice(0, 12)) {
    parts.push('--hostname', shQuote(cfg.Hostname))
  }
  if (cfg.User) parts.push('-u', shQuote(cfg.User))
  if (cfg.WorkingDir) parts.push('-w', shQuote(cfg.WorkingDir))

  // 权限
  if (host.Privileged) parts.push('--privileged')
  if (host.CapAdd && host.CapAdd.length) parts.push('--cap-add', shQuote(host.CapAdd.join(',')))
  if (host.CapDrop && host.CapDrop.length) parts.push('--cap-drop', shQuote(host.CapDrop.join(',')))

  // 资源限制
  if (host.Memory) parts.push('-m', String(host.Memory))
  if (host.NanoCpus) parts.push('--cpus', String(host.NanoCpus / 1e9))
  if (host.CpuShares) parts.push('--cpu-shares', String(host.CpuShares))

  // 额外主机 / DNS
  for (const h of host.ExtraHosts || []) parts.push('--add-host', shQuote(h))
  for (const d of host.Dns || []) parts.push('--dns', shQuote(d))

  // tmpfs / sysctl / devices
  for (const [dir, opts] of Object.entries(host.Tmpfs || {})) {
    parts.push('--tmpfs', shQuote(opts ? dir + ':' + opts : dir))
  }
  for (const [k, v] of Object.entries(host.Sysctls || {})) parts.push('--sysctl', shQuote(k + '=' + v))
  for (const d of host.Devices || []) {
    const p = d.PathOnHost + (d.PathInContainer && d.PathInContainer !== d.PathOnHost ? ':' + d.PathInContainer : '')
    parts.push('--device', shQuote(p))
  }

  // 安全选项 / 日志驱动
  for (const so of host.SecurityOpt || []) parts.push('--security-opt', shQuote(so))
  const lc = host.LogConfig || {}
  if (lc.Type && lc.Type !== 'json-file') parts.push('--log-driver', shQuote(lc.Type))

  // 镜像 + entrypoint/cmd
  parts.push(data.Image || cfg.Image || '')
  const tail = [...(cfg.Entrypoint || []), ...(cfg.Cmd || [])]
  for (const t of tail) parts.push(shQuote(t))

  return parts.join(' ')
}

// 将 docker State/Status 归一化为 running | paused | stopped
// 注意：Status 文本（如 "Up (Paused)"）优先于 State 字段，避免两者不一致时误判
function classifyState(state, status) {
  if (state === 'paused') return 'paused'
  if (/\(Paused\)/i.test(status || '')) return 'paused'
  if (state === 'running') return 'running'
  return 'stopped'
}

// 解析 `docker inspect <id>` 输出，提取端口映射与目录挂载
function parseInspect(stdout) {
  const data = JSON.parse(stdout)[0]
  const ports = (data.NetworkSettings && data.NetworkSettings.Ports) || {}
  const mounts = data.Mounts || []
  const rp = (data.HostConfig && data.HostConfig.RestartPolicy) || {}
  return {
    id: data.Id,
    name: (data.Name || '').replace(/^\//, ''),
    image: (data.Config && data.Config.Image) || null,
    created: data.Created,
    state: (data.State && data.State.Status) || null,
    restartPolicy: {
      name: rp.Name || '',
      maxRetryCount: rp.MaximumRetryCount || 0
    },
    ports: Object.entries(ports).map(([containerPort, bindings]) => ({
      containerPort,
      bindings: (bindings || []).map((b) => b.HostPort)
    })),
    mounts: mounts.map((m) => ({
      type: m.Type,
      source: m.Source,
      destination: m.Destination,
      mode: m.Mode,
      rw: m.RW
    }))
  }
}

// 将 child_process 错误归一化为可展示的结构
function classifyDockerError(err) {
  const stderr = (err && (err.stderr || err.message || '')) || ''
  if (err && err.code === 'ENOENT') {
    return { code: 'DOCKER_NOT_FOUND', message: '未检测到 docker 命令' }
  }
  if (err && (err.killed || err.timedOut)) {
    return { code: 'DOCKER_ERROR', message: '操作超时' }
  }
  if (/Cannot connect to the Docker daemon/.test(stderr)) {
    return { code: 'DAEMON_DOWN', message: stderr }
  }
  return { code: 'DOCKER_ERROR', message: stderr || (err && err.message) || 'docker 命令执行失败' }
}

// ===== 命令执行层 =====
const { execFile, spawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')

// 解析 Docker CLI 可执行文件完整路径。
// Electron（ZTools）作为 GUI 应用启动时继承的 PATH 通常只有系统默认路径
// （/usr/bin:/bin:/usr/sbin:/sbin），不含 /usr/local/bin、Homebrew 前缀、
// /snap/bin 或用户目录，直接 spawn('docker') 会报 ENOENT 被误判为
// "未检测到 docker 命令"。此处显式探测各平台常见安装位置；全部缺失时
// 退回 'docker'（届时 ENOENT 正确表示未安装）。
function resolveDockerBin(candidates) {
  const found = candidates.find((p) => p && fs.existsSync(p))
  return found || 'docker'
}

// 展开用户目录（兼容 HOME 缺失场景）
function homePath(rel) {
  const home = process.env.HOME || os.homedir()
  return home ? path.join(home, rel) : null
}

const DOCKER_BIN = resolveDockerBin(
  [
    process.env.DOCKER_BIN,
    // macOS（Docker Desktop / Homebrew / Intel / Apple Silicon）
    '/usr/local/bin/docker',
    '/opt/homebrew/bin/docker',
    '/Applications/Docker.app/Contents/Resources/bin/docker',
    // Linux：发行版包 + Docker 官方仓库（apt/dnf/pacman）
    // 注：Docker Desktop for Linux 的 CLI 包装脚本同样位于 /usr/bin/docker
    '/usr/bin/docker',
    // Linux：Ubuntu snap（软链接到 Snap 沙盒内部）
    '/snap/bin/docker',
    // Linux/macOS：官方静态二进制手动安装
    '/usr/local/bin/docker',
    // Linux：Rootless 模式（非特权用户安装，位于用户家目录）
    homePath('.docker/bin/docker'),
    // Linux：Homebrew（linuxbrew）
    '/home/linuxbrew/.linuxbrew/bin/docker',
    // Linux：NixOS 系统配置
    '/run/current-system/sw/bin/docker',
    // Linux：nix 用户 profile
    homePath('.nix-profile/bin/docker'),
    // Linux：Rancher Desktop
    homePath('.rd/bin/docker'),
    // 继承 PATH 中的 docker 兜底（Windows 下为 docker.exe）
    (process.env.PATH || '')
      .split(path.delimiter)
      .map((dir) => path.join(dir, process.platform === 'win32' ? 'docker.exe' : 'docker'))
      .find((p) => fs.existsSync(p))
  ].filter(Boolean)
)

// 扩展 PATH：Electron（ZTools）GUI 启动的 PATH 不含 Docker Desktop 凭据工具
// （docker-credential-desktop/osxkeychain 等），拉取需认证镜像时报
// "error getting credentials - exec: docker-credential-*: not found"。
// 统一注入常见目录。
function dockerEnv() {
  const extra = [
    '/Applications/Docker.app/Contents/Resources/bin',
    '/Applications/OrbStack.app/Contents/Resources/bin',
    '/usr/local/bin',
    '/opt/homebrew/bin'
  ]
  return { ...process.env, PATH: [...extra, process.env.PATH].filter(Boolean).join(':') }
}

// ===== 远程/自定义连接管理 =====
// 支持本机、DOCKER_HOST（tcp/ssh/unix）与 docker context 三种连接方式。
let currentConnection = { type: 'local' }

function setConnection(conn) {
  currentConnection = conn || { type: 'local' }
}

function getConnection() {
  return { ...currentConnection }
}

// 根据当前连接构造 docker 全局参数（置于子命令之前）
function connectionArgs() {
  if (currentConnection.type === 'context') return ['--context', currentConnection.name]
  if (currentConnection.type === 'host') return ['--host', currentConnection.host]
  return []
}

// 非流式：执行 docker 命令，15s 超时防挂死，统一返回 { ok, stdout } 或 { ok:false, error }
function run(args, { timeout = 15000, applyConnection = true } = {}) {
  const cmdArgs = applyConnection ? [...connectionArgs(), ...args] : args
  return new Promise((resolve) => {
    execFile(DOCKER_BIN, cmdArgs, { timeout, maxBuffer: 10 * 1024 * 1024, env: dockerEnv() }, (err, stdout) => {
      if (err) {
        resolve({ ok: false, error: classifyDockerError(err) })
      } else {
        resolve({ ok: true, stdout })
      }
    })
  })
}

// 清洗 ANSI 颜色码
function stripAnsi(text) {
  // eslint-disable-next-line no-control-regex
  return String(text).replace(/\x1b\[[0-9;]*m/g, '')
}

// 为子进程 stdout/stderr 挂载按流独立分行的行缓冲，返回 close 时刷尾部残行的方法
function attachLogBuffering(child, onData) {
  const buffers = new Map()   // stream -> partial line
  const flush = (stream) => (chunk) => {
    let buffer = (buffers.get(stream) || '') + chunk.toString()
    const lines = buffer.split('\n')
    buffers.set(stream, lines.pop())
    lines.forEach((line) => onData && onData(stripAnsi(line)))
  }
  const flushTail = () => {
    buffers.forEach((tail) => {
      if (tail) onData && onData(stripAnsi(tail))
    })
    buffers.clear()
  }
  child.stdout.on('data', flush(child.stdout))
  child.stderr.on('data', flush(child.stderr))
  return flushTail
}

// 过滤非 TTY 交互 shell 的 job-control warning 行（不影响提示符/输出）
function cleanShellWarning(text) {
  return String(text)
    .replace(/sh: \d+: can't access tty[^\n]*\n?/g, '')
    .replace(/bash: cannot set terminal process group[^\n]*\n?/g, '')
    .replace(/bash: no job control in this shell\n?/g, '')
}

const docker = {
  async listContainers() {
    const res = await run(['ps', '-a', '--no-trunc', '--format', '{{json .}}'])
    if (!res.ok) return res
    try {
      return { ok: true, containers: parseContainerList(res.stdout) }
    } catch (err) {
      return { ok: false, error: classifyDockerError(err) }
    }
  },

  // compose 项目列表（docker compose ls）。compose 插件不可用时返回错误，UI 降级为扁平列表。
  async listComposeProjects() {
    const res = await run(['compose', 'ls', '--all', '--format', 'json'])
    if (!res.ok) return res
    try {
      return { ok: true, projects: parseComposeProjects(res.stdout) }
    } catch (err) {
      return { ok: false, error: classifyDockerError(err) }
    }
  },

  // 本机已配置的 docker context 列表（不受当前连接影响，始终查询本机）
  async listContexts() {
    const res = await run(['context', 'ls', '--format', '{{json .}}'], { applyConnection: false })
    if (!res.ok) return res
    try {
      return { ok: true, contexts: parseContextList(res.stdout) }
    } catch (err) {
      return { ok: false, error: classifyDockerError(err) }
    }
  },

  // 仅对运行中容器调用；停止容器在 UI 层跳过
  async inspectContainer(id) {
    const res = await run(['inspect', id])
    if (!res.ok) return res
    try {
      return { ok: true, container: parseInspect(res.stdout) }
    } catch (err) {
      return { ok: false, error: classifyDockerError(err) }
    }
  },

  async startContainer(id) {
    return run(['start', id])
  },

  async stopContainer(id) {
    return run(['stop', id])
  },

  async restartContainer(id) {
    return run(['restart', id])
  },

  async pauseContainer(id) {
    return run(['pause', id])
  },

  async unpauseContainer(id) {
    return run(['unpause', id])
  },

  async removeContainer(id) {
    return run(['rm', '-f', id])
  },

  // 动态调整容器重启策略（docker update --restart）
  async updateRestartPolicy(id, policy) {
    return run(['update', '--restart', policy, id])
  },

  // 还原容器 docker run 启动命令
  async getRunCommand(id) {
    const res = await run(['inspect', id])
    if (!res.ok) return res
    try {
      const data = JSON.parse(res.stdout)[0]
      return { ok: true, command: buildRunCommand(data) }
    } catch (err) {
      return { ok: false, error: classifyDockerError(err) }
    }
  },

  // 创建容器（docker run -d，args 由前端构造 --name/-p/-e/-v/--restart 等），返回容器 id
  async createContainer(args) {
    const res = await run(['run', '-d', ...args])
    if (!res.ok) return res
    return { ok: true, id: (res.stdout || '').trim() }
  },

  // 检测容器名是否已被使用（创建前预检）
  async checkContainerName(name) {
    const n = String(name || '').trim()
    if (!n) return { ok: true, used: false }
    const res = await run(['ps', '-a', '--no-trunc', '--format', '{{.Names}}'])
    if (!res.ok) return { ok: false, error: res.error }
    const names = res.stdout.split('\n').map((x) => x.trim()).filter(Boolean)
    return { ok: true, used: names.includes(n) }
  },

  // 检测宿主机端口是否被其他容器占用（创建前预检）
  async checkPorts(ports) {
    const hostPorts = (ports || [])
      .map((p) => String(p).trim().split(':')[0])
      .filter((p) => /^\d+$/.test(p))
    if (!hostPorts.length) return { ok: true, occupied: [] }
    const res = await run(['ps', '--no-trunc', '--format', '{{json .}}'])
    if (!res.ok) return { ok: false, error: res.error }
    try {
      const list = parseContainerList(res.stdout)
      const used = new Set()
      for (const c of list) extractHostPorts(c.ports).forEach((p) => used.add(p))
      const occupied = hostPorts.filter((p) => used.has(p))
      return { ok: true, occupied }
    } catch (e) {
      return { ok: true, occupied: [] }
    }
  },

  // 完整删除：容器 + 其数据卷 + 镜像（数据不可恢复）
  async removeContainerFully(id) {
    const ins = await run(['inspect', id])
    if (!ins.ok) return ins
    let data
    try {
      data = JSON.parse(ins.stdout)[0]
    } catch (e) {
      return { ok: false, error: classifyDockerError(e) }
    }
    const volumes = (data.Mounts || []).filter((m) => m.Type === 'volume').map((m) => m.Name)
    const image = data.Config && data.Config.Image
    const rm = await run(['rm', '-f', id])
    if (!rm.ok) return rm
    for (const v of volumes) await run(['volume', 'rm', v])
    let imgRes = { ok: true }
    if (image) imgRes = await run(['rmi', '-f', image])
    return imgRes
  },

  // ===== 镜像管理 =====
  async listImages() {
    const res = await run(['images', '--format', '{{json .}}'])
    if (!res.ok) return res
    try {
      return { ok: true, images: parseImageList(res.stdout) }
    } catch (err) {
      return { ok: false, error: classifyDockerError(err) }
    }
  },

  async removeImage(ref) {
    return run(['rmi', ref])
  },

  // 镜像是否存在（docker image inspect 成功即存在）
  async imageExists(image) {
    const res = await run(['image', 'inspect', image])
    return res.ok
  },

  // 流式拉取镜像，onData 逐块输出（含层下载进度）
  pullImage(image, onData, onError) {
    const child = spawn(DOCKER_BIN, [...connectionArgs(), 'pull', image], { env: dockerEnv() })
    child.stdout.on('data', (c) => onData && onData(c.toString()))
    child.stderr.on('data', (c) => onData && onData(c.toString()))
    child.on('error', (err) => onError && onError(classifyDockerError(err)))
    child.on('close', (code) => {
      if (code !== 0) {
        onError && onError({ code: 'DOCKER_ERROR', message: '镜像拉取失败（' + code + '）' })
      } else {
        onData && onData('[PULL_DONE]\n')
      }
    })
    return {
      stop() {
        try { child.kill() } catch (e) { /* 已退出则忽略 */ }
      }
    }
  },

  // ===== 卷管理 =====
  async listVolumes() {
    const res = await run(['volume', 'ls', '--format', '{{json .}}'])
    if (!res.ok) return res
    try {
      return { ok: true, volumes: parseVolumeList(res.stdout) }
    } catch (err) {
      return { ok: false, error: classifyDockerError(err) }
    }
  },

  async removeVolume(name) {
    return run(['volume', 'rm', name])
  },

  // ===== 网络管理 =====
  async listNetworks() {
    const res = await run(['network', 'ls', '--format', '{{json .}}'])
    if (!res.ok) return res
    try {
      return { ok: true, networks: parseNetworkList(res.stdout) }
    } catch (err) {
      return { ok: false, error: classifyDockerError(err) }
    }
  },

  async removeNetwork(id) {
    return run(['network', 'rm', id])
  },

  // ===== 系统清理 =====
  async systemDf() {
    return run(['system', 'df'])
  },

  async systemPrune(all) {
    return run(all ? ['system', 'prune', '-a', '-f'] : ['system', 'prune', '-f'])
  },

  async volumePrune() {
    return run(['volume', 'prune', '-f'])
  },

  async builderPrune() {
    return run(['builder', 'prune', '-f'])
  },

  // 流式：docker logs -f --tail 200，返回 { stop() } 句柄用于取消
  followLogs(id, onData, onError) {
    const child = spawn(DOCKER_BIN, [...connectionArgs(), 'logs', '-f', '--tail', '200', id], { env: dockerEnv() })
    const flushTail = attachLogBuffering(child, onData)
    child.on('error', (err) => onError && onError(classifyDockerError(err)))
    child.on('close', (code) => {
      flushTail()   // 不再丢失结尾无换行的部分行
      const suffix = code == null ? '' : ': ' + code
      onError && onError({ code: 'LOG_CLOSED', message: 'logs 进程已退出' + suffix })
    })
    return {
      stop() {
        try { child.kill() } catch (e) { /* 已退出则忽略 */ }
      }
    }
  },

  // 流式：docker compose -f <配置> logs -f --tail 200，聚合整个 compose 项目日志
  followComposeLogs(configFile, onData, onError) {
    const args = ['compose']
    if (configFile) args.push('-f', configFile)
    args.push('logs', '-f', '--tail', '200')
    const child = spawn(DOCKER_BIN, [...connectionArgs(), ...args], { env: dockerEnv() })
    const flushTail = attachLogBuffering(child, (line) => {
      // 过滤 compose 自身的 warning 提示行（time="..." level=warning msg=...）
      if (/^time="[^"]*" level=warning/.test(line)) return
      onData(line)
    })
    child.on('error', (err) => onError && onError(classifyDockerError(err)))
    child.on('close', (code) => {
      flushTail()
      const suffix = code == null ? '' : ': ' + code
      onError && onError({ code: 'LOG_CLOSED', message: 'compose logs 进程已退出' + suffix })
    })
    return {
      stop() {
        try { child.kill() } catch (e) { /* 已退出则忽略 */ }
      }
    }
  },

  // 附加到容器交互 shell：docker exec -i <id> <sh|bash|ash> -i（管道模式，无 TTY）。
  // -i 让 shell 进入交互模式以显示提示符；依次回退 sh/bash/ash，
  // 容器内无可用 shell 时最后才报断开并说明。
  attachContainerShell(id, onData, onError) {
    const shells = ['sh', 'bash', 'ash']
    let child = null
    let stopped = false
    let index = 0

    const start = () => {
      if (stopped || index >= shells.length) return
      const shell = shells[index]
      child = spawn(DOCKER_BIN, [...connectionArgs(), 'exec', '-i', id, shell, '-i'], { env: dockerEnv() })
      child.stdout.on('data', (chunk) => onData && onData(chunk.toString()))
      child.stderr.on('data', (chunk) => {
        const text = cleanShellWarning(chunk.toString())
        if (text) onData && onData(text)
      })
      child.on('error', (err) => {
        if (!stopped) onError && onError(classifyDockerError(err))
      })
      child.on('close', (code) => {
        if (stopped) return
        // 非 0 退出（如 127 找不到 shell）且还有 shell 可试 → 回退下一个
        if (code && code !== 0 && index < shells.length - 1) {
          index++
          start()
          return
        }
        const suffix = code == null ? '' : ' (' + code + ')'
        const tried = shells.slice(0, index + 1).join('/')
        onError &&
          onError({
            code: 'SHELL_CLOSED',
            message: 'shell 会话已结束' + suffix + '，已尝试 ' + tried + (code === 127 ? '（容器内可能无可用 shell）' : '')
          })
      })
    }

    start()

    return {
      write(s) {
        try { if (child && child.stdin.writable) child.stdin.write(s) } catch (e) { /* 已关闭则忽略 */ }
      },
      stop() {
        stopped = true
        try { if (child) child.stdin.end() } catch (e) { /* 忽略 */ }
        try { if (child) child.kill() } catch (e) { /* 已退出则忽略 */ }
      }
    }
  }
}

module.exports = {
  ...docker,
  parseContainerList,
  parseInspect,
  classifyDockerError,
  classifyState,
  stripAnsi,
  resolveDockerBin,
  extractProject,
  parseComposeProjects,
  parseContextList,
  setConnection,
  getConnection,
  buildRunCommand,
  shQuote,
  cleanShellWarning,
  parseImageList,
  parseVolumeList,
  parseNetworkList,
  extractHostPorts
}
