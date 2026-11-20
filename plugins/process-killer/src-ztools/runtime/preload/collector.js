const { execFile } = require('node:child_process')

const MAX_BUFFER = 32 * 1024 * 1024
const TIMEOUT = 15000

function exec(file, args) {
  return new Promise(resolve => {
    execFile(file, args, { encoding: 'utf8', maxBuffer: MAX_BUFFER, timeout: TIMEOUT, windowsHide: true },
      (err, stdout) => resolve({ ok: !err, stdout: stdout || '', error: err ? err.message : null }))
  })
}

const PS_ARGS = ['-axo', 'pid=,ppid=,user=,pcpu=,pmem=,rss=,comm=']
const PS_LINE = /^(\d+)\s+(\d+)\s+(\S+)\s+([\d.]+)\s+([\d.]+)\s+(\d+)\s+(.+)$/

function parsePs(stdout) {
  const list = []
  for (const raw of String(stdout).split('\n')) {
    if (!raw.trim()) continue
    const m = PS_LINE.exec(raw.trim())
    if (!m) continue
    const path = m[7].trim()
    list.push({
      pid: Number(m[1]),
      ppid: Number(m[2]),
      user: m[3],
      cpu: Number(m[4]),
      mem: Number(m[5]),
      rss: Number(m[6]),
      path,
      name: path.split('/').pop() || path
    })
  }
  return list
}

// lsof -F pcn 输出是逐字段一行：p<pid> / c<comm> / n<地址>
// 地址形如 *:7000、127.0.0.1:6379、[::1]:8080、127.0.0.1:1234->10.0.0.1:5678
function parseLsof(stdout) {
  const map = new Map()
  let pid = null
  for (const line of String(stdout).split('\n')) {
    if (!line) continue
    const tag = line[0]
    const value = line.slice(1)
    if (tag === 'p') { pid = Number(value); continue }
    if (tag !== 'n' || !pid) continue
    const m = /:(\d+)(?:->(.+))?$/.exec(value)
    if (!m) continue
    if (!map.has(pid)) map.set(pid, { listen: new Set(), conn: new Set() })
    const entry = map.get(pid)
    if (m[2]) entry.conn.add(Number(m[1]))
    else entry.listen.add(Number(m[1]))
  }
  const out = new Map()
  for (const [key, v] of map) out.set(key, { listen: [...v.listen].sort((a, b) => a - b), conn: [...v.conn].sort((a, b) => a - b) })
  return out
}

function merge(processes, ports) {
  return processes.map(p => {
    const rec = ports.get(p.pid)
    const listen = rec ? rec.listen : []
    const conn = rec ? rec.conn : []
    return { ...p, listen, conn, portCount: new Set([...listen, ...conn]).size, app: appBundleOf(p.path) }
  })
}

function appBundleOf(path) {
  const m = /^(.*?\.app)\//.exec(path || '')
  return m ? m[1] : null
}

// Windows：列表里已有 PPID、命令行、内存和 CPU，合并端口后补上内存占比
function snapshotWindows() {
  return require('./collector-win').snapshot().then(({ processes, ports }) => {
    const memTotal = require('node:os').totalmem() / 1048576
    return {
      processes: merge(processes, ports || new Map()).map(p => ({ ...p, mem: memTotal ? p.rss / memTotal * 100 : 0 })),
      portWarning: ports ? null : '端口信息不可用：netstat 执行失败'
    }
  })
}

async function snapshot() {
  if (process.platform === 'win32') return snapshotWindows()
  const [ps, lsof] = await Promise.all([
    exec('/bin/ps', PS_ARGS),
    exec('/usr/sbin/lsof', ['-nP', '-iTCP', '-F', 'pcn'])
  ])
  if (!ps.ok) throw new Error('读取进程列表失败: ' + ps.error)
  const processes = merge(parsePs(ps.stdout), lsof.ok ? parseLsof(lsof.stdout) : new Map())
  return { processes, portWarning: lsof.ok ? null : '端口信息受限：可能缺少显示其他用户进程的权限' }
}

module.exports = { exec, parsePs, parseLsof, merge, appBundleOf, snapshot, snapshotWindows, PS_ARGS, PS_LINE }
