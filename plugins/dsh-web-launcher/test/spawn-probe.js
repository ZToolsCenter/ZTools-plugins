// 诊断脚本：验证修复写法（经 start 新建控制台）是否留下可见窗口并继承 cwd
// 用法: node test/spawn-probe.js
'use strict'

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')

const shell = process.env.ComSpec || process.env.COMSPEC || 'cmd.exe'
const probeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-console-probe-'))
const inner = 'title DSH_FIX_PROBE & cd > dsh-cwd-probe.txt'

// 与修复后的 launch() 完全相同的参数形状
const child = spawn(shell, ['/c', 'start', '', shell, '/k', inner], {
  cwd: probeDir,
  detached: true,
  stdio: 'ignore',
  windowsHide: false,
  shell: false
})
child.on('error', function (error) {
  console.log('spawn 出错: ' + error.message)
})
child.unref()

console.log('外层 pid=' + child.pid)
console.log('探针目录=' + probeDir)
console.log('期望窗口标题=DSH_FIX_PROBE')
