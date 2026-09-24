'use strict'

const fs = require('node:fs')
const { spawn, spawnSync } = require('node:child_process')

if (process.argv[2] === 'grandchild') {
  setInterval(() => {}, 60_000)
} else {
  const pidFile = process.argv[2]
  if (!pidFile || process.platform === 'win32') process.exit(2)

  const grandchild = spawn(process.execPath, [__filename, 'grandchild'], {
    shell: false,
    stdio: 'ignore'
  })
  fs.writeFileSync(pidFile, JSON.stringify({
    helperPid: process.pid,
    grandchildPid: grandchild.pid
  }))

  // Fixed test-only command that simulates systeminformation being blocked in
  // execSync while another descendant remains alive.
  spawnSync('/bin/sleep', ['60'], {
    shell: false,
    stdio: 'ignore'
  })
}
