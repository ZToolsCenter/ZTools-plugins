import { describe, it, expect } from 'vitest'
import { terminalDefs, detectTerminals, escapeAppleScript } from '../public/preload/terminals.js'

describe('escapeAppleScript', () => {
  it('普通命令原样返回', () => {
    expect(escapeAppleScript('docker exec -it abc123 sh')).toBe('docker exec -it abc123 sh')
  })
  it('转义双引号与反斜杠', () => {
    expect(escapeAppleScript('echo "hi" \\ ok')).toBe('echo \\"hi\\" \\\\ ok')
  })
})

describe('terminalDefs / detectTerminals', () => {
  it('darwin 定义包含 iTerm2/Alacritty/Ghostty 且按优先级排序', () => {
    if (process.platform !== 'darwin') return
    const defs = terminalDefs()
    expect(defs[0].id).toBe('iterm')
    expect(defs[1].id).toBe('terminal')
    expect(defs.map((d) => d.id)).toContain('alacritty')
    expect(defs.map((d) => d.id)).toContain('ghostty')
    // execType 合法
    for (const d of defs) {
      expect(['applescript', 'openargs', 'none']).toContain(d.execType)
    }
  })
  it('detectTerminals 只返回已安装且保持优先级顺序（系统 Terminal 必在）', () => {
    if (process.platform !== 'darwin') return
    const list = detectTerminals()
    expect(list.some((t) => t.id === 'terminal')).toBe(true)
    expect(list.every((t) => t.path.includes('/'))).toBe(true)
  })
})
