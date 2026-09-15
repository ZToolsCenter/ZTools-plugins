'use strict'

const LINUX_TERMINALS = Object.freeze([
  ['x-terminal-emulator', ['-e', 'bash', '-lc']],
  ['gnome-terminal', ['--', 'bash', '-lc']],
  ['konsole', ['-e', 'bash', '-lc']],
  ['xterm', ['-e', 'bash', '-lc']]
])

async function launchLinuxTerminal(execFile, command, options = {}) {
  let missing = null
  for (const [executable, args] of LINUX_TERMINALS) {
    try {
      await execFile(executable, [...args, command], { timeout: 10000, ...options })
      return executable
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      missing = error
    }
  }
  throw Object.assign(new Error('未找到可用的 Linux 终端（x-terminal-emulator、GNOME Terminal、Konsole 或 xterm）'), { code: 'ENOENT', cause: missing })
}

module.exports = { LINUX_TERMINALS, launchLinuxTerminal }
