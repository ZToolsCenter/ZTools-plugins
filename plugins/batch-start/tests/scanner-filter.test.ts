import { describe, expect, it } from 'vitest'
import { isUninstallEntry, rejectUninstallApps } from '../src/services/scanner/filter'

describe('uninstall filter', () => {
  it('detects uninstall / 卸载 in name or path', () => {
    expect(isUninstallEntry('Uninstall WeChat', 'C:/x.exe')).toBe(true)
    expect(isUninstallEntry('卸载 微信', 'C:/x.exe')).toBe(true)
    expect(isUninstallEntry('微信', 'C:/Program Files/WeChat/Uninstall.exe')).toBe(true)
    expect(isUninstallEntry('App', 'C:/app/unins000.exe')).toBe(true)
    expect(isUninstallEntry('微信', 'C:/Program Files/WeChat/WeChat.exe')).toBe(false)
  })

  it('rejectUninstallApps drops matching rows', () => {
    const kept = rejectUninstallApps([
      { name: '微信', path: 'C:/WeChat.exe' },
      { name: 'Uninstall 微信', path: 'C:/un.exe' },
      { name: '某工具', path: 'C:/tool/卸载.exe' },
    ])
    expect(kept).toEqual([{ name: '微信', path: 'C:/WeChat.exe' }])
  })
})
