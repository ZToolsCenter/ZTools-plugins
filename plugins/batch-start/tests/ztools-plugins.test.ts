import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  EXCLUDED_PLUGIN_NAMES,
  commandAppPath,
  listTextCmds,
  scanZtoolsCommands,
  versionFromArtifactName,
} from '../src/services/scanner/ztoolsPlugins'

describe('ztoolsCommands', () => {
  it('listTextCmds skips manage cmds, exclude set, and group: features', () => {
    expect(
      listTextCmds(
        [
          { code: 'manage', cmds: ['批量启动', '颜色助手'] },
          { code: 'group:abc', cmds: ['startWork'] },
          { cmds: ['colors', 'skip-me'] },
        ],
        { excludeCmds: new Set(['skip-me']) },
      ),
    ).toEqual(['颜色助手', 'colors'])
  })

  it('versionFromArtifactName parses asar install names', () => {
    expect(versionFromArtifactName('ztools-kill-process-1.0.2-ef21d1e7.asar')).toBe('1.0.2')
    expect(versionFromArtifactName('colors')).toBeNull()
  })

  it('prefers installed registry and ignores disk leftovers', async () => {
    const scanned = await scanZtoolsCommands('win32', {
      excludeCmds: new Set(),
      listInstalledPlugins: async () => [
        {
          name: 'colors',
          title: '调色板',
          path: '/plugins/colors',
          features: [{ cmds: ['颜色助手', 'colors'] }],
        },
      ],
      // Would otherwise pick up uninstalled leftovers if registry ignored:
      pluginsRoot: '/plugins',
      readDir: async () => ['gone-plugin', 'colors'],
      readFile: async (file) => {
        if (file.includes('gone-plugin')) {
          return JSON.stringify({
            name: 'gone-plugin',
            title: '已卸载',
            features: [{ cmds: ['残留指令'] }],
          })
        }
        throw new Error('should not read disk when registry provided')
      },
      access: async () => {
        throw new Error('no logo')
      },
    })

    expect(scanned.map((s) => s.name)).toEqual(['颜色助手', 'colors'])
    expect(scanned.every((s) => s.pluginName === 'colors')).toBe(true)
  })

  it('disk fallback scans asar packages and keeps newest version only', async () => {
    const root = path.join('mock-ztools', 'plugins')
    const files: Record<string, string> = {
      [path.join(root, 'wechat-multiopen-1.0.0-e2c43859.asar', 'plugin.json')]: JSON.stringify({
        name: 'wechat-multiopen',
        title: '微信多开',
        version: '1.0.0',
        features: [{ cmds: ['微信双开'] }],
      }),
      [path.join(root, 'ztools-kill-process-1.0.1-ffeb2f13.asar', 'plugin.json')]: JSON.stringify({
        name: 'ztools-kill-process',
        title: '杀进程',
        version: '1.0.1',
        features: [{ cmds: ['杀进程'] }],
      }),
      [path.join(root, 'ztools-kill-process-1.0.2-ef21d1e7.asar', 'plugin.json')]: JSON.stringify({
        name: 'ztools-kill-process',
        title: '杀进程/进程管理',
        version: '1.0.2',
        features: [{ cmds: ['杀进程', 'kill'] }],
      }),
      [path.join(root, 'batch-start', 'plugin.json')]: JSON.stringify({
        name: 'batch-start',
        title: '批量启动',
        features: [{ cmds: ['批量启动'] }],
      }),
    }

    const scanned = await scanZtoolsCommands('win32', {
      pluginsRoot: root,
      listInstalledPlugins: async () => null,
      readDir: async () => [
        'wechat-multiopen-1.0.0-e2c43859.asar',
        'ztools-kill-process-1.0.1-ffeb2f13.asar',
        'ztools-kill-process-1.0.2-ef21d1e7.asar',
        'ztools-kill-process-1.0.2-ef21d1e7.asar.unpacked',
        'batch-start',
        '.installing',
      ],
      readFile: async (file) => {
        if (!(file in files)) throw new Error(`missing ${file}`)
        return files[file]
      },
      access: async () => {
        throw new Error('no logo')
      },
    })

    expect(scanned.map((s) => s.name).sort()).toEqual(['kill', '微信双开', '杀进程'].sort())
    expect(scanned.find((s) => s.launchCmd === '杀进程')?.pluginTitle).toBe('杀进程/进程管理')
    expect(EXCLUDED_PLUGIN_NAMES.has('system')).toBe(true)
    expect(scanned.some((s) => s.path === commandAppPath('batch-start', '批量启动'))).toBe(false)
  })
})
