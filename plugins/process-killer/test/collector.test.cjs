const test = require('node:test')
const assert = require('node:assert')
const collector = require('../src-ztools/runtime/preload/collector')

test('parsePs 解析 ps 输出', () => {
  const out = [
    '  180   13227 wenzhuangxie   0.4  0.2  35632 /Applications/Google Chrome Helper',
    '    1       0 root            0.0  0.1  11376 /sbin/launchd'
  ].join('\n')
  const list = collector.parsePs(out)
  assert.equal(list.length, 2)
  assert.equal(list[0].pid, 180)
  assert.equal(list[0].ppid, 13227)
  assert.equal(list[0].user, 'wenzhuangxie')
  assert.equal(list[0].cpu, 0.4)
  assert.equal(list[0].mem, 0.2)
  assert.equal(list[0].rss, 35632)
  assert.equal(list[0].name, 'Google Chrome Helper')
})

test('parsePs 跳过表头和空行', () => {
  assert.deepEqual(collector.parsePs(''), [])
  assert.deepEqual(collector.parsePs('\n\n'), [])
  assert.deepEqual(collector.parsePs('PID PPID USER %CPU %MEM RSS COMMAND\n'), [])
})

test('parseLsof 区分监听与连接', () => {
  const out = [
    'p645', 'cControlCenter', 'n*:7000', 'n*:5000',
    'p838', 'credis-server', 'n127.0.0.1:6379',
    'p900', 'cnode', 'n127.0.0.1:1234->10.0.0.1:5678'
  ].join('\n')
  const map = collector.parseLsof(out)
  assert.deepEqual(map.get(645).listen, [5000, 7000])
  assert.deepEqual(map.get(838).listen, [6379])
  assert.deepEqual(map.get(900).listen, [])
  assert.deepEqual(map.get(900).conn, [1234])
})

test('parseLsof 处理 IPv6 地址与空输出', () => {
  const map = collector.parseLsof('p42\ncnode\nn[::1]:8080')
  assert.deepEqual(map.get(42).listen, [8080])
  assert.equal(collector.parseLsof('').size, 0)
})

test('appBundleOf 提取 .app 路径', () => {
  assert.equal(
    collector.appBundleOf('/Applications/IntelliJ IDEA.app/Contents/MacOS/idea'),
    '/Applications/IntelliJ IDEA.app'
  )
  assert.equal(collector.appBundleOf('/sbin/launchd'), null)
})

test('merge 合并端口计数', () => {
  const procs = [{ pid: 1, name: 'a', path: '/a', rss: 100 }]
  const ports = new Map([[1, { listen: [8080], conn: [9090] }]])
  const merged = collector.merge(procs, ports)
  assert.deepEqual(merged[0].listen, [8080])
  assert.equal(merged[0].portCount, 2)
  assert.equal(merged[0].app, null)
})

test('snapshot 在真实环境返回进程', async () => {
  const data = await collector.snapshot()
  assert.ok(Array.isArray(data.processes))
  assert.ok(data.processes.length > 10)
  assert.ok(data.processes.every(p => Number.isInteger(p.pid)))
  if (process.platform === 'win32') {
    // 单看进程号是不是一个进程，才能说明别人真关了我们已经算过的进程
    const self = data.processes.find(p => p.pid === process.pid)
    assert.ok(self && self.path.includes('node'), '应能从命令行认出本进程')
    assert.ok(data.processes.filter(p => p.listen.length > 0).length >= 1, '至少应有一个监听端口的进程')
  }
})
