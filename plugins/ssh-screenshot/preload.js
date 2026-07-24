// preload.js — runs in Electron preload context with Node integration.
// Exposes a small bridge on window.sshShot so the Vue UI can drive the SSH flow
// without ever loading native modules in the renderer.

const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const { NodeSSH } = require('node-ssh')

function ensureForwardSlash(p) {
  return String(p || '').replace(/\\/g, '/')
}

function joinRemote(dir, name) {
  const d = ensureForwardSlash(dir).replace(/\/+$/, '')
  return d ? `${d}/${name}` : name
}

function timestampName(ext) {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  const stamp =
    d.getFullYear().toString() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    '-' +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds()) +
    '-' +
    String(d.getMilliseconds()).padStart(3, '0')
  return `shot-${stamp}${ext || '.png'}`
}

async function withSSH(config, fn) {
  const ssh = new NodeSSH()
  await ssh.connect({
    host: config.host,
    port: Number(config.port) || 22,
    username: config.username,
    password: config.password,
    readyTimeout: 10000,
    keepaliveInterval: 5000
  })
  try {
    return await fn(ssh)
  } finally {
    ssh.dispose()
  }
}

async function testConnection(config) {
  return withSSH(config, async (ssh) => {
    const remoteDir = ensureForwardSlash(config.remoteDir || '')
    if (!remoteDir) {
      throw new Error('未配置远端截图存放路径')
    }
    // mkdir -p on remote; use POSIX mkdir
    const { code, stderr } = await ssh.execCommand(
      `mkdir -p ${shellQuote(remoteDir)} && test -w ${shellQuote(remoteDir)}`
    )
    if (code !== 0) {
      throw new Error(stderr || `远端目录不可写: ${remoteDir}`)
    }
    return { ok: true, remoteDir }
  })
}

function shellQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`
}

async function uploadFile(config, localPath, remoteName) {
  if (!fs.existsSync(localPath)) {
    throw new Error(`本地文件不存在: ${localPath}`)
  }
  const remoteDir = ensureForwardSlash(config.remoteDir || '')
  if (!remoteDir) throw new Error('未配置远端截图存放路径')

  return withSSH(config, async (ssh) => {
    await ssh.execCommand(`mkdir -p ${shellQuote(remoteDir)}`)
    const finalName = remoteName || timestampName(path.extname(localPath) || '.png')
    const remotePath = joinRemote(remoteDir, finalName)
    await ssh.putFile(localPath, remotePath)
    return { remotePath, remoteDir, name: finalName }
  })
}

function parseDataUrl(dataUrl) {
  const m = /^data:image\/([a-z0-9.+-]+);base64,(.+)$/i.exec(String(dataUrl || ''))
  if (!m) throw new Error('payload 不是合法的 data:image base64 字符串')
  return { ext: m[1].toLowerCase().replace('jpeg', 'jpg'), b64: m[2] }
}

async function uploadDataUrl(config, dataUrl) {
  const { ext, b64 } = parseDataUrl(dataUrl)
  const tmpFile = path.join(os.tmpdir(), `ssh-screenshot-${Date.now()}.${ext}`)
  await fs.promises.writeFile(tmpFile, Buffer.from(b64, 'base64'))
  try {
    return await uploadFile(config, tmpFile, timestampName('.' + ext))
  } finally {
    fs.promises.unlink(tmpFile).catch(() => {})
  }
}

window.sshShot = {
  testConnection,
  uploadFile,
  uploadDataUrl
}

// quiet log so the user can verify preload loaded
console.log('[ssh-screenshot] preload ready')
