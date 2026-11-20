const test = require('node:test')
const assert = require('node:assert')
const win = require('../src-ztools/runtime/preload/collector-win')

test('parseCim 单个和数组都能解，中文命令行原样保留', () => {
  const one = win.parseCim('{"pid":4,"ppid":0,"name":"System","cmd":null,"rss":128,"cpu":0,"start":"2026-11-20T10:00:00.0000000+08:00"}')
  assert.equal(one.length, 1)
  assert.equal(one[0].path, '')
  assert.equal(one[0].rss, 128)
  const two = win.parseCim(JSON.stringify([
    { pid: 8, ppid: 4, name: '输入法测试.exe', cmd: '"C:\\a\\输入法测试.exe" -n 60', rss: 2048 },
    { pid: 9, ppid: 8, name: 'x.exe', cmd: 'x', rss: 0 }
  ]))
  assert.equal(two[0].name, '输入法测试.exe')
  assert.ok(two[0].path.includes('输入法测试'))
  assert.deepEqual(win.parseCim(''), [])
  assert.deepEqual(win.parseCim('Get-CimInstance : 拒绝访问'), [])
})

test('cpuPercent 用两次采样的差值，首次为 0，新进程不被放大', () => {
  const t0 = Date.now()
  const start = new Date(t0 - 60000).toISOString()
  const now = t0 + 1000
  const prev = { at: t0, cum: 10e6, start }
  assert.equal(win.cpuPercent(100, now, undefined), 0)
  // 1 秒内走了 0.5 秒 CPU = 50%
  assert.equal(win.cpuPercent(15e6, now, prev), 50)
  // 进程刚起来：只活了 0.5 秒、间隔 1 秒，按 0.5 秒算，封顶 100%
  assert.equal(win.cpuPercent(15e6, now, { at: t0, cum: 10e6, start: new Date(now - 500).toISOString() }), 100)
  // 累计值反而变小（PID 被复用），不出负数
  assert.equal(win.cpuPercent(5e6, now, prev), 0)
})

test('parseNetstat 区分监听、连接和 UDP', () => {
  const out = [
    '',
    '活动连接',
    '',
    '  协议  本地地址          外部地址        状态           PID',
    '  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1832',
    '  TCP    [::]:135               [::]:0                 LISTENING       1832',
    '  TCP    127.0.0.1:1234         10.0.0.1:443           ESTABLISHED     900',
    '  TCP    127.0.0.1:5678         10.0.0.1:80            TIME_WAIT       0',
    '  UDP    0.0.0.0:123            *:*                                    29148',
    '  UDP    [::1]:5353             *:*                                    29148'
  ].join('\r\n')
  const map = win.parseNetstat(out)
  assert.deepEqual(map.get(1832).listen, [135])
  assert.deepEqual(map.get(900), { listen: [], conn: [1234] })
  assert.deepEqual(map.get(29148), { listen: [123, 5353], conn: [] })
  assert.equal(map.has(0), false)
})

test('exeFromCommandLine 取出命令行开头的 exe', () => {
  const { exeFromCommandLine } = require('../src-ztools/runtime/preload/actions')
  assert.equal(exeFromCommandLine('"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --type=renderer'), 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
  // 没有引号：参数里也可能有 .exe，宁可不认
  assert.equal(exeFromCommandLine('C:\\Windows\\ping.exe -n 60 127.0.0.1'), null)
  assert.equal(exeFromCommandLine(''), null)
})
