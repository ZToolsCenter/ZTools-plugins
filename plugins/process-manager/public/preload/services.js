const { exec, spawn } = require('node:child_process')

const iconv = require('iconv-lite')

function execAsync(cmd, timeout) {
  return new Promise((resolve) => {
    exec(cmd, { timeout, encoding: 'buffer' }, (err, stdout) => {
      resolve(err ? '' : iconv.decode(stdout, 'gbk'))
    })
  })
}

function parseWmicCsv(output) {
  const lines = output.trim().replace(/\r/g, '').split('\n').filter(Boolean)
  if (lines.length < 2) return []
  const header = lines[0].split(',').map(h => h.trim().toLowerCase())
  const nameIdx = header.indexOf('name')
  const pidIdx = header.indexOf('processid')
  const pathIdx = header.indexOf('executablepath')
  if (nameIdx === -1 || pidIdx === -1) return []

  return lines.slice(1).map(line => {
    const parts = line.startsWith('"')
      ? line.replace(/^"|"$/g, '').split('","')
      : line.split(',')
    return {
      name: (parts[nameIdx] || '').trim(),
      pid: parseInt(parts[pidIdx], 10) || 0,
      path: (parts[pathIdx] || '').trim()
    }
  }).filter(p => p.pid > 0)
}

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

window.services = {
  async listProcesses() {
    let raw = await execAsync('wmic process get ProcessId,Name,ExecutablePath /FORMAT:CSV', 8000)
    if (raw) return parseWmicCsv(raw)
    raw = await execAsync('tasklist /FO CSV /NH', 5000)
    if (!raw) return []
    const lines = raw.trim().replace(/\r/g, '').split('\n').filter(Boolean)
    return lines.map(line => {
      const parts = line.replace(/^"|"$/g, '').split('","')
      return { name: parts[0] || '', pid: parseInt(parts[1], 10) || 0, path: '' }
    }).filter(p => p.pid > 0)
  },

  async scanPorts() {
    const raw = await execAsync('netstat -ano', 5000)
    return raw ? parseNetstat(raw) : []
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
