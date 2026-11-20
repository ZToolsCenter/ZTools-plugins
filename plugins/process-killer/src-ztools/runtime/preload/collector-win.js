// Windows 采集：进程走 PowerShell/CIM（命令行和中文进程名只有这里有），端口走 netstat -ano
const { execFile, execFileSync } = require('node:child_process')
const path = require('node:path')

// 全量取回来一次转成 JSON：每条一个对象的管道会把跨机关的时候放大几十倍。
// 内存用 WorkingSetSize（CIM 的副本，略有延迟），顺序另跑一次 Get-Process
const PS_SCRIPT = [
  'Get-CimInstance Win32_Process -Filter "ProcessId>0" |',
  '  ForEach-Object { [pscustomobject]@{ pid = $_.ProcessId; ppid = $_.ParentProcessId; name = $_.Name; cmd = $_.CommandLine;',
  '    rss = [long]($_.WorkingSetSize / 1KB); cpu = [long]$_.KernelModeTime + [long]$_.UserModeTime; start = $_.CreationDate } } |',
  '  ConvertTo-Json -Compress'
].join('\n')

// Get-Process 的输出顺序就是任务管理器默认的顺序（系统进程在前，之后按名称拼音排）。
// 中文名进程在这里会少 .exe 后缀，名称一律以 CIM 为准
const ORDER_SCRIPT = 'Get-Process | Out-String -Width 64'

function parseCim(stdout) {
  const text = String(stdout).trim()
  if (!text) return []
  let data
  try { data = JSON.parse(text) } catch (e) { return [] }
  return [].concat(data).filter(p => p && p.pid).map(p => {
    const prev = cpuState.get(p.pid)
    const now = Date.now()
    const cum = Number(p.cpu) || 0
    const result = {
      pid: p.pid, ppid: p.ppid || 0, user: '', cpu: cpuPercent(cum, now, prev),
      name: String(p.name || ''), path: String(p.cmd || ''), rss: Number(p.rss) || 0
    }
    cpuState.set(p.pid, { at: now, cum, start: startOf(p.start) })
    return result
  })
}

// CIM 的 CreationDate 序列化后是 /Date(毫秒)/，也接受纯 ISO 字符串
function startOf(v) {
  if (!v) return null
  if (typeof v === 'string') {
    const m = /^\/Date\((\d+)\)\/$/.exec(v)
    return m ? new Date(Number(m[1])).toISOString() : v
  }
  return v.value || null
}

// 输出刚好 64K 时 PowerShell 被管道堵死，cmd.exe 只能杀掉它——截断要么报错要么给乱码，
// 无论哪种都当作没拿到顺序
const MAX_CHARS = 60000

// 输出全是 ASCII JSON / ASCII 名称，字节当 latin1 读再按 utf8 解，才能拿到中文
function exec(file, args) {
  return new Promise(resolve => {
    execFile(file, args, { encoding: 'latin1', maxBuffer: 32 * 1024 * 1024, timeout: 20000, windowsHide: true },
      (err, stdout) => resolve({ ok: !err, stdout: Buffer.from(stdout || '', 'latin1').toString('utf8'), error: err ? err.message : null }))
  })
}

function psExe() {
  return path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
}

const psArgs = script => [psExe(), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script]]

async function snapshot() {
  const root = process.env.SystemRoot || 'C:\\Windows'
  const [cim, order, netstat] = await Promise.all([
    exec(...psArgs(PS_SCRIPT)),
    exec(...psArgs(ORDER_SCRIPT)),
    exec(path.join(root, 'System32', 'NETSTAT.EXE'), ['-ano'])
  ])
  // Get-Process 的表格列：Handles、NPM(K)、PM(K)、WS(K)、CPU(s)、Id、SI、ProcessName，
  // Id 后面那格是 SI（纯数字）或名称，CPU(s) 带小数点。列宽随区域和终端变，不按列号取
  const table = order.ok && order.stdout.length < MAX_CHARS ? order.stdout.split(/\r?\n/).filter(line => line.trim()) : []
  const pids = table.length > 3 && /^\s*-+\s/.test(table[2])
    ? table.slice(3).map(line => {
      const cells = line.trim().split(/\s+/)
      // FindProcessId 是第 6 列；分隔行之后的每一行都一样，按位置取最稳，但要先确认那一格真的是 PID
      const pid = Number(cells[5])
      return cells.length >= 7 && Number.isInteger(pid) && pid > 0 ? pid : null
    }).filter(Boolean)
    : []
  const list = parseCim(cim.stdout)
  // 编码对不上时 CIM 那部分可能整段没回来，以 Get-Process 的进程号为底
  const byPid = new Map(list.map(p => [p.pid, p]))
  const seen = new Set(pids)
  const base = pids.filter(pid => pid > 0).map(pid => byPid.get(pid) || enrich(pid))
  for (const p of list) if (!seen.has(p.pid) && p.pid > 0) base.push(p)
  if (!base.length) throw new Error('读取进程列表失败: ' + (cim.error || order.error || 'PowerShell 无输出'))
  return { processes: base, ports: netstat.ok ? parseNetstat(netstat.stdout) : null }
}

// 只补一个进程；拿不到时用 "?" 占位，不冒充原名
function enrich(pid) {
  const placeholder = { pid, ppid: 0, user: '', cpu: 0, name: String(pid) + '?', path: '', rss: 0 }
  try {
    const out = execFileSync(psExe(), ['-NoProfile', '-NonInteractive', '-Command',
      'Get-Process -Id ' + pid + ' | ForEach-Object { "" + $_.ProcessName + ";" + [int]$_.WorkingSet64 }'], { encoding: 'latin1' }).toString('latin1')
    const [name, ws] = Buffer.from(out, 'latin1').toString('utf8').trim().split(';')
    return name ? { ...placeholder, name, rss: Math.round((Number(ws) || 0) / 1024) } : placeholder
  } catch (e) {
    return placeholder
  }
}
// netstat -ano 每行：协议 本地地址 外部地址 状态 PID；UDP 没有状态那一列
const NETSTAT_LINE = /^\s*(TCP|UDP)\s+(\S+)\s+(\S+)\s+([A-Z_]+)?\s*(\d+)\s*$/

function parseNetstat(text) {
  const map = new Map()
  for (const line of String(text).split(/\r?\n/)) {
    const m = NETSTAT_LINE.exec(line)
    if (!m) continue
    const pid = Number(m[5])
    const pm = /:(\d+)$/.exec(m[2])
    if (!pid || !pm) continue
    const port = Number(pm[1])
    if (!map.has(pid)) map.set(pid, { listen: new Set(), conn: new Set() })
    const entry = map.get(pid)
    const state = m[4] || ''
    // UDP 按端口统计，按端口关掉占用它的进程是常见需求
    if (m[1] === 'UDP' || state === 'LISTENING') entry.listen.add(port)
    else if (state === 'ESTABLISHED' || state === 'SYN_SENT') entry.conn.add(port)
  }
  const out = new Map()
  for (const [key, v] of map) out.set(key, { listen: [...v.listen].sort((a, b) => a - b), conn: [...v.conn].sort((a, b) => a - b) })
  return out
}

// CPU 要两次采样才准，而自动刷新每 3 秒跑一次，所以各记各的累计值，用真实间隔算。
// 累计值单位是 100ns；比例和上次的累计都按秒折算，免得大数相减丢精度
const cpuState = new Map()
function cpuPercent(cum, now, prev) {
  if (!prev || !prev.start || now <= prev.at) return 0
  const dt = (now - prev.at) / 1000
  // 进程刚起来时区间比它的生命周期长，按短的算
  const span = Math.min(dt, (now - Date.parse(prev.start)) / 1000)
  const busy = (cum - prev.cum) / 10 ** 7
  return span > 0 ? Math.min(100, Math.max(0, busy / span * 100)) : 0
}

module.exports = { parseCim, parseNetstat, snapshot, psArgs, psExe, NETSTAT_LINE, PS_SCRIPT, ORDER_SCRIPT, MAX_CHARS, cpuState, cpuPercent }
