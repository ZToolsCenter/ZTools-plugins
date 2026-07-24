let spawnSync

try {
  ;({ spawnSync } = require('child_process'))
} catch (error) {
  window.servicesLoadError = error instanceof Error ? error.message : String(error)
}

const PORT_QUERY_SCRIPT = `
$payload = @{
  tcpLines = @(netstat -ano -p tcp)
  udpLines = @(netstat -ano -p udp)
  processes = @(Get-Process -ErrorAction SilentlyContinue | Select-Object Id, ProcessName)
}
$payload | ConvertTo-Json -Depth 4 -Compress
`

function parseJsonOutput(raw, actionLabel) {
  try {
    return JSON.parse(raw)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`${actionLabel} 返回了无法解析的内容: ${detail}`)
  }
}

function runPwsh(script) {
  if (!spawnSync) {
    throw new Error(window.servicesLoadError || 'preload 未能加载 child_process')
  }

  const args = ['-NoProfile', '-Command', script]
  const options = {
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 10 * 1024 * 1024
  }

  // Windows 上不一定安装 PowerShell Core，这里优先 pwsh，再兼容系统自带的 powershell.exe。
  let result = spawnSync('pwsh', args, options)
  if (result.error && result.error.code === 'ENOENT') {
    result = spawnSync('powershell', args, options)
  }

  if (result.error) {
    throw result.error
  }

  if (result.status !== 0) {
    const detail = result.stderr || result.stdout || `PowerShell exited with code ${result.status}`
    throw new Error(detail.trim())
  }

  return result.stdout
}

function splitAddress(address) {
  const text = String(address || '').trim()
  if (!text) {
    return {
      host: '',
      port: ''
    }
  }

  const ipv6Match = text.match(/^\[(.*)\]:(\*|\d+)$/)
  if (ipv6Match) {
    return {
      host: ipv6Match[1],
      port: ipv6Match[2]
    }
  }

  const separatorIndex = text.lastIndexOf(':')
  if (separatorIndex === -1) {
    return {
      host: text,
      port: ''
    }
  }

  return {
    host: text.slice(0, separatorIndex),
    port: text.slice(separatorIndex + 1)
  }
}

function asArray(value) {
  if (Array.isArray(value)) {
    return value
  }

  if (value == null) {
    return []
  }

  return [value]
}

function normalizeProcessMap(processes) {
  const processMap = new Map()

  for (const processInfo of asArray(processes)) {
    if (!processInfo || processInfo.Id == null) {
      continue
    }

    processMap.set(String(processInfo.Id), processInfo.ProcessName || '')
  }

  return processMap
}

function parseNetstatLines(lines, protocol, processMap) {
  const entries = []

  for (const rawLine of asArray(lines)) {
    const line = String(rawLine || '').trim()
    if (!line.startsWith(protocol)) {
      continue
    }

    const parts = line.split(/\s+/)
    if (protocol === 'TCP' && parts.length >= 5) {
      const pidText = parts[4]
      const localAddress = parts[1]
      const remoteAddress = parts[2]
      const local = splitAddress(localAddress)
      const remote = splitAddress(remoteAddress)

      entries.push({
        protocol,
        processName: processMap.get(pidText) || '未知进程',
        pid: Number.parseInt(pidText, 10),
        state: parts[3],
        localAddress,
        localHost: local.host,
        localPort: local.port,
        remoteAddress,
        remoteHost: remote.host,
        remotePort: remote.port
      })
      continue
    }

    if (protocol === 'UDP' && parts.length >= 4) {
      const pidText = parts[3]
      const localAddress = parts[1]
      const remoteAddress = parts[2]
      const local = splitAddress(localAddress)
      const remote = splitAddress(remoteAddress)

      entries.push({
        protocol,
        processName: processMap.get(pidText) || '未知进程',
        pid: Number.parseInt(pidText, 10),
        state: 'BOUND',
        localAddress,
        localHost: local.host,
        localPort: local.port,
        remoteAddress,
        remoteHost: remote.host,
        remotePort: remote.port
      })
    }
  }

  return entries
}

function comparePortUsage(left, right) {
  const leftPort = Number.parseInt(left.localPort, 10)
  const rightPort = Number.parseInt(right.localPort, 10)

  if (Number.isFinite(leftPort) && Number.isFinite(rightPort) && leftPort !== rightPort) {
    return leftPort - rightPort
  }

  return `${left.processName}-${left.pid}-${left.localAddress}`.localeCompare(
    `${right.processName}-${right.pid}-${right.localAddress}`,
    'zh-CN'
  )
}

try {
  window.services = {
    getPortUsage() {
      // Get-NetTCPConnection 在普通权限下可能被拒绝，这里改用 netstat 再补进程名，兼容性更稳。
      const raw = runPwsh(PORT_QUERY_SCRIPT).trim()
      if (!raw) {
        return []
      }

      const payload = parseJsonOutput(raw, '端口查询')
      const processMap = normalizeProcessMap(payload.processes)
      const tcpEntries = parseNetstatLines(payload.tcpLines, 'TCP', processMap)
      const udpEntries = parseNetstatLines(payload.udpLines, 'UDP', processMap)

      return [...tcpEntries, ...udpEntries].sort(comparePortUsage)
    },
    killProcess(pid) {
      const numericPid = Number.parseInt(String(pid), 10)
      if (!Number.isInteger(numericPid) || numericPid <= 0) {
        throw new Error('无效的 PID')
      }

      const script = `
$process = Get-Process -Id ${numericPid} -ErrorAction Stop
$processName = $process.ProcessName
Stop-Process -Id ${numericPid} -Force -ErrorAction Stop
@{
  pid = ${numericPid}
  processName = $processName
} | ConvertTo-Json -Compress
`

      const raw = runPwsh(script).trim()
      return raw ? parseJsonOutput(raw, '结束进程') : { pid: numericPid }
    }
  }
} catch (error) {
  window.servicesLoadError = error instanceof Error ? error.message : String(error)
}
