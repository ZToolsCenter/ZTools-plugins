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

function findAsset(name) {
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

const DETECTOR_NAME = 'win-file-lock-detector.exe'

function firstLine(text) {
  return (text || '').trim().split(/\r?\n/)[0] || ''
}

// 检测器退出码：0 无占用，1 有占用，2 出错
function runDetector(args, timeout) {
  const exePath = findAsset(DETECTOR_NAME)
  if (!exePath) {
    return Promise.resolve({ error: `未找到 ${DETECTOR_NAME}` })
  }

  return new Promise((resolve) => {
    const child = execFile(exePath, args, {
      timeout,
      windowsHide: true,
      encoding: 'buffer',
      maxBuffer: 64 * 1024 * 1024
    }, (err, stdout, stderr) => {
      resolve({
        pid: child.pid,
        exitCode: err ? (typeof err.code === 'number' ? err.code : null) : 0,
        timedOut: !!(err && err.killed),
        spawnError: err && typeof err.code !== 'number' ? err.message : '',
        stdout: stdout ? stdout.toString('utf8').replace(/^﻿/, '') : '',
        stderr: stderr ? stderr.toString('utf8') : ''
      })
    })
  })
}

function groupHandles(handles) {
  const byPid = new Map()
  for (const handle of handles) {
    if (!Number.isInteger(handle.pid) || handle.pid <= 0) continue

    let entry = byPid.get(handle.pid)
    if (!entry) {
      entry = { pid: handle.pid, name: handle.name || '', handleCount: 0, handlePath: '', handlePaths: [] }
      byPid.set(handle.pid, entry)
    }

    entry.handleCount++
    const handlePath = handle.path || ''
    if (handlePath && !entry.handlePaths.includes(handlePath)) {
      entry.handlePaths.push(handlePath)
      if (!entry.handlePath) entry.handlePath = handlePath
    }
  }

  return Array.from(byPid.values()).sort((a, b) => a.name.localeCompare(b.name) || a.pid - b.pid)
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

    // 单文件用 Restart Manager；目录和句柄模式都交给检测器做句柄枚举
    const useRestartManager = !isDirectory && mode === 'files'
    const args = [target, '--json']
    if (!useRestartManager) args.push('--handles')

    const scan = await runDetector(args, useRestartManager ? 20000 : 120000)
    if (scan.error) {
      return { success: false, error: scan.error }
    }
    if (scan.timedOut) {
      return { success: false, error: '检测超时，进程句柄较多时请稍后重试' }
    }
    if (scan.exitCode !== 0 && scan.exitCode !== 1) {
      return { success: false, error: firstLine(scan.stderr) || firstLine(scan.spawnError) || '检测失败' }
    }

    let data
    try {
      data = JSON.parse(scan.stdout)
    } catch {
      return { success: false, error: firstLine(scan.stderr) || '无法解析检测结果' }
    }

    if (data.method === 'restart-manager') {
      const holders = (Array.isArray(data.processes) ? data.processes : [])
        .filter(process => Number.isInteger(process.pid) && process.pid > 0)
        .map(process => ({
          pid: process.pid,
          // 友好名称（如 Windows PowerShell）优先，与进程名不同时 UI 会单独标注
          name: process.app_name || process.name || '',
          service: process.service || undefined,
          type: process.type || undefined
        }))

      return {
        success: true,
        mode: 'files',
        kind: 'file',
        method: 'restart-manager',
        holders
      }
    }

    const skipped = Array.isArray(data.skipped_processes) ? data.skipped_processes : []
    const timedOut = Array.isArray(data.timed_out_processes) ? data.timed_out_processes : []
    let handles = Array.isArray(data.handles) ? data.handles : []

    // 检测器自身的工作目录句柄也会出现在结果里
    if (Number.isInteger(scan.pid)) {
      handles = handles.filter(handle => handle.pid !== scan.pid)
    }
    // 目录句柄模式只看文件夹句柄，目录内文件模式只看文件句柄
    if (isDirectory) {
      const objectKind = mode === 'handles' ? 'directory' : 'file'
      handles = handles.filter(handle => handle.object === objectKind)
    }

    return {
      success: true,
      mode,
      kind: isDirectory ? 'directory' : 'file',
      method: 'handle-scan',
      holders: groupHandles(handles),
      partial: skipped.length > 0 || timedOut.length > 0,
      skipped: skipped.length,
      timedOut: timedOut.length,
      examined: data.examined_handles || 0
    }
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
