const { exec, execFile, spawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const iconv = require('iconv-lite')

function execAsync(cmd, timeout, encoding = 'gbk') {
  return new Promise((resolve) => {
    exec(cmd, { timeout, encoding: 'buffer' }, (err, stdout) => {
      resolve(err ? '' : iconv.decode(stdout, encoding))
    })
  })
}

// 按 CSV 规则拆分，路径中可能含逗号或引号
function parseCsvLine(line) {
  const fields = []
  let field = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quoted) {
      if (ch !== '"') field += ch
      else if (line[i + 1] === '"') { field += '"'; i++ }
      else quoted = false
    } else if (ch === '"') {
      quoted = true
    } else if (ch === ',') {
      fields.push(field)
      field = ''
    } else {
      field += ch
    }
  }
  fields.push(field)
  return fields
}

// 同时兼容 PowerShell 的 ConvertTo-Csv 与 wmic /FORMAT:CSV 输出
function parseProcessCsv(output) {
  const lines = output.replace(/^﻿/, '').trim().replace(/\r/g, '').split('\n').filter(Boolean)
  if (lines.length < 2) return []
  const header = parseCsvLine(lines[0]).map(h => h.trim().toLowerCase())
  const nameIdx = header.indexOf('name')
  const pidIdx = header.indexOf('processid')
  const pathIdx = header.indexOf('executablepath')
  if (nameIdx === -1 || pidIdx === -1) return []

  return lines.slice(1).map(line => {
    const parts = parseCsvLine(line)
    return {
      name: (parts[nameIdx] || '').trim(),
      pid: parseInt(parts[pidIdx], 10) || 0,
      path: (parts[pathIdx] || '').trim()
    }
  }).filter(p => p.pid > 0)
}

// Windows 11 24H2 起 wmic 默认不再安装，优先用 PowerShell 的 CIM 查询
const PS_LIST_PROCESSES_ARGS = [
  '-NoProfile',
  '-NonInteractive',
  '-Command',
  '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; ' +
  'Get-CimInstance Win32_Process | ' +
  'Select-Object ProcessId,Name,ExecutablePath | ' +
  'ConvertTo-Csv -NoTypeInformation'
]

function parseNetstat(output) {
  const lines = output.trim().replace(/\r/g, '').split('\n').filter(Boolean)
  const ports = []
  for (const line of lines) {
    const parts = line.trim().split(/\s+/)
    if (parts.length < 5) continue
    const addr = parts[1]
    const pid = parseInt(parts[4], 10)
    if (!addr || isNaN(pid)) continue
    const portMatch = addr.match(/:(\d+)$/)
    if (portMatch) {
      ports.push({ port: parseInt(portMatch[1], 10), pid, protocol: parts[0] })
    }
  }
  return ports
}

function findScript(name) {
  const bases = []
  if (typeof __dirname === 'string') {
    bases.push(__dirname, path.join(__dirname, '..'))
  }
  bases.push(process.cwd(), path.join(process.cwd(), 'preload'))

  for (const base of bases) {
    const candidate = path.join(base, name)
    if (fs.existsSync(candidate)) return candidate
  }
  return null
}

function runPowerShell(args, timeout, encoding = 'gbk') {
  return new Promise((resolve) => {
    execFile('powershell.exe', args, {
      timeout,
      windowsHide: true,
      encoding: 'buffer',
      maxBuffer: 1024 * 1024
    }, (err, stdout, stderr) => {
      resolve({
        ok: !err,
        stdout: stdout ? iconv.decode(stdout, encoding) : '',
        stderr: stderr ? iconv.decode(stderr, encoding) : ''
      })
    })
  })
}

function parseWhoLocks(output) {
  const lines = output.replace(/\r/g, '').split('\n').filter(line => line.trim() !== '')
  const result = {
    success: true,
    holders: [],
    kind: 'file',
    scanned: 1,
    truncated: false
  }

  for (const line of lines) {
    if (line.startsWith('META\t')) {
      const [, kind, scanned, truncated] = line.split('\t')
      result.kind = kind === 'directory' ? 'directory' : 'file'
      result.scanned = parseInt(scanned, 10) || 0
      result.truncated = truncated === '1'
      continue
    }
    if (line.startsWith('No process is locking:')) continue

    const parts = line.split('\t')
    if (parts[0] === 'PID') continue
    const pid = parseInt(parts[0], 10)
    if (!Number.isInteger(pid) || pid <= 0) return { success: false, error: line }
    result.holders.push({
      pid,
      name: parts[1] || '',
      service: parts[2] || '',
      type: parts[3] ? parseInt(parts[3], 10) : undefined
    })
  }
  return result
}

function parseDirHandles(output) {
  const lines = output.replace(/\r/g, '').split('\n').filter(line => line.trim() !== '')
  const result = {
    success: true,
    holders: [],
    admin: false,
    all: false,
    candidates: 0,
    mode: 'handles',
    kind: 'directory'
  }
  const byPid = new Map()

  for (const line of lines) {
    if (line.startsWith('META\t')) {
      const [, admin, all, candidates] = line.split('\t')
      result.admin = admin === '1'
      result.all = all === '1'
      result.candidates = parseInt(candidates, 10) || 0
      continue
    }
    if (line.startsWith('No handles found')) continue

    const parts = line.split('\t')
    if (parts[0] === 'PID') continue
    const pid = parseInt(parts[0], 10)
    if (!Number.isInteger(pid) || pid <= 0) return { success: false, error: line }

    let entry = byPid.get(pid)
    if (!entry) {
      const rawName = parts[1] || ''
      const name = rawName && !/\.exe$/i.test(rawName) ? `${rawName}.exe` : rawName
      entry = { pid, name, handleCount: 0, handlePath: '', handlePaths: [] }
      byPid.set(pid, entry)
    }

    entry.handleCount++
    const handlePath = parts[3] || ''
    if (handlePath && !entry.handlePaths.includes(handlePath)) {
      entry.handlePaths.push(handlePath)
      if (!entry.handlePath) entry.handlePath = handlePath
    }
  }

  result.holders = Array.from(byPid.values())
  return result
}

window.services = {
  async listProcesses() {
    // PowerShell CIM：新系统上唯一稳定能拿到 ExecutablePath 的来源
    const ps = await runPowerShell(PS_LIST_PROCESSES_ARGS, 8000, 'utf8')
    const psList = parseProcessCsv(ps.stdout)
    if (psList.length) return psList

    // 旧系统兜底：wmic 仍在时优先用它，输出为 GBK
    const wmicRaw = await execAsync('wmic process get ProcessId,Name,ExecutablePath /FORMAT:CSV', 8000)
    if (wmicRaw) {
      const wmicList = parseProcessCsv(wmicRaw)
      if (wmicList.length) return wmicList
    }

    // 最后兜底：tasklist 没有路径列，仅保证进程列表可用
    const raw = await execAsync('tasklist /FO CSV /NH', 5000)
    if (!raw) return []
    return raw.trim().replace(/\r/g, '').split('\n').filter(Boolean)
      .map(line => {
        const parts = parseCsvLine(line)
        return { name: parts[0] || '', pid: parseInt(parts[1], 10) || 0, path: '' }
      }).filter(p => p.pid > 0)
  },

  async scanPorts() {
    const raw = await execAsync('netstat -ano', 5000)
    return raw ? parseNetstat(raw) : []
  },

  pathInfo(filePath) {
    if (typeof filePath !== 'string' || !filePath.trim()) {
      return { success: false, exists: false, isFile: false, isDirectory: false, path: '' }
    }

    const target = path.resolve(filePath.trim())
    try {
      const stat = fs.statSync(target)
      return {
        success: true,
        exists: true,
        isFile: stat.isFile(),
        isDirectory: stat.isDirectory(),
        path: target
      }
    } catch {
      return { success: false, exists: false, isFile: false, isDirectory: false, path: target }
    }
  },

  async whoLocks(filePath, options = {}) {
    if (typeof filePath !== 'string' || !filePath.trim()) {
      return { success: false, error: '无效的文件路径' }
    }

    const target = path.resolve(filePath.trim())
    let stat
    try {
      stat = fs.statSync(target)
    } catch {
      return { success: false, error: `文件或目录不存在: ${target}` }
    }
    if (!stat.isFile() && !stat.isDirectory()) {
      return { success: false, error: `不是文件或目录: ${target}` }
    }

    const isDirectory = stat.isDirectory()
    const mode = options.mode === 'handles' || options.mode === 'files'
      ? options.mode
      : (isDirectory ? 'handles' : 'files')

    if (mode === 'handles') {
      const scriptPath = findScript('dir-handles.ps1')
      if (!scriptPath) {
        return { success: false, error: '未找到 dir-handles.ps1' }
      }

      const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-Path', target]
      if (options.all) args.push('-All')

      const { stdout, stderr } = await runPowerShell(args, options.all ? 300000 : 30000)

      if (!stdout.trim()) {
        const message = stderr.trim().split(/\r?\n/)[0]
        return { success: false, error: message || '检测失败' }
      }

      return parseDirHandles(stdout)
    }

    const scriptPath = findScript('who-locks.ps1')
    if (!scriptPath) {
      return { success: false, error: '未找到 who-locks.ps1' }
    }

    const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, target]
    if (options?.recurse) args.push('-Recurse')

    const { stdout, stderr } = await runPowerShell(args, isDirectory ? 30000 : 15000)

    if (!stdout.trim()) {
      const message = stderr.trim().split(/\r?\n/)[0]
      return { success: false, error: message || '查询失败' }
    }

    const parsed = parseWhoLocks(stdout)
    parsed.mode = 'files'
    parsed.kind = parsed.kind || (isDirectory ? 'directory' : 'file')
    return parsed
  },

  async killProcess(pid) {
    // 严格校验 pid 为正整数
    if (!Number.isInteger(pid) || pid <= 0) {
      return { success: false, error: '无效的 PID' }
    }

    return new Promise((resolve) => {
      const child = spawn('taskkill', ['/PID', String(pid), '/F'], {
        timeout: 3000,
        stdio: ['ignore', 'pipe', 'pipe']
      })

      let stderr = ''
      child.stderr.on('data', (data) => {
        stderr += data.toString()
      })

      child.on('close', (code) => {
        if (code === 0) {
          resolve({ success: true })
        } else {
          console.error('Kill process failed:', stderr)
          resolve({ success: false, error: 'Kill 失败' })
        }
      })

      child.on('error', (err) => {
        console.error('Kill process error:', err)
        resolve({ success: false, error: 'Kill 失败' })
      })
    })
  }
}
