import type { PlatformInfo } from '../types'

type OsKey = 'darwin' | 'win32' | 'linux'

function joinPath(base: string, relative: string): string {
  if (!relative.trim()) return base
  const sep = base.includes('\\') ? '\\' : '/'
  const normBase = base.replace(/[\\/]+$/, '').replace(/[\\/]/g, sep)
  const normRel = relative.trim().split(/[\\/]+/).filter(Boolean).join(sep)
  return normRel ? `${normBase}${sep}${normRel}` : normBase
}

function getOsKey(): OsKey {
  const svc = typeof window !== 'undefined' ? window.services : null
  if (svc?.isWindows()) return 'win32'
  if (typeof navigator !== 'undefined' && navigator.platform?.includes('Mac')) return 'darwin'
  return 'linux'
}

function resolveRootDir(platform: { rootDir?: { darwin: string; win32: string; linux: string } }): string {
  if (!platform.rootDir) return ''
  return platform.rootDir[getOsKey()] || platform.rootDir.linux
}

function resolveSkillsPath(platform: { rootDir?: { darwin: string; win32: string; linux: string }; skillsRelativePath?: string }): string {
  const root = resolveRootDir(platform)
  if (!root || !platform.skillsRelativePath) return ''
  return joinPath(root, platform.skillsRelativePath)
}

export const defaultPlatforms: PlatformInfo[] = [
  {
    id: 'claude',
    name: 'Claude Code',
    rootDir: { darwin: '~/.claude', win32: '~/.claude', linux: '~/.claude' },
    skillsRelativePath: 'skills',
    defaultPath: '~/.claude/skills/',
    projectPath: '.claude/skills/',
    enabled: true, detected: false,
  },
  {
    id: 'copilot',
    name: 'GitHub Copilot',
    rootDir: { darwin: '~/.copilot', win32: '~/.copilot', linux: '~/.copilot' },
    skillsRelativePath: 'skills',
    defaultPath: '~/.copilot/skills/',
    projectPath: '.copilot/skills/',
    enabled: true, detected: false,
  },
  {
    id: 'cursor',
    name: 'Cursor',
    rootDir: { darwin: '~/.cursor', win32: '~/.cursor', linux: '~/.cursor' },
    skillsRelativePath: 'skills',
    defaultPath: '~/.cursor/skills/',
    projectPath: '.cursor/skills/',
    enabled: true, detected: false,
  },
  {
    id: 'cherry-studio',
    name: 'Cherry Studio',
    rootDir: { darwin: '~/Library/Application Support/CherryStudio', win32: '~/AppData/Roaming/CherryStudio', linux: '~/.config/CherryStudio' },
    skillsRelativePath: 'Data/Skills',
    defaultPath: '~/.config/CherryStudio/Data/Skills/',
    projectPath: 'Data/Skills/',
    enabled: true, detected: false,
  },
  {
    id: 'windsurf',
    name: 'Windsurf',
    rootDir: { darwin: '~/.codeium/windsurf', win32: '~/.codeium/windsurf', linux: '~/.codeium/windsurf' },
    skillsRelativePath: 'skills',
    defaultPath: '~/.codeium/windsurf/skills/',
    projectPath: '.codeium/windsurf/skills/',
    enabled: true, detected: false,
  },
  {
    id: 'kiro',
    name: 'Kiro',
    rootDir: { darwin: '~/.kiro', win32: '~/.kiro', linux: '~/.kiro' },
    skillsRelativePath: 'skills',
    defaultPath: '~/.kiro/skills/',
    projectPath: '.kiro/skills/',
    enabled: true, detected: false,
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    rootDir: { darwin: '~/.gemini', win32: '~/.gemini', linux: '~/.gemini' },
    skillsRelativePath: 'skills',
    defaultPath: '~/.gemini/skills/',
    projectPath: '.gemini/skills/',
    enabled: true, detected: false,
  },
  {
    id: 'antigravity',
    name: 'Antigravity',
    rootDir: { darwin: '~/.gemini/antigravity', win32: '~/.gemini/antigravity', linux: '~/.gemini/antigravity' },
    skillsRelativePath: 'skills',
    defaultPath: '~/.gemini/antigravity/skills/',
    projectPath: '.gemini/antigravity/skills/',
    enabled: true, detected: false,
  },
  {
    id: 'trae',
    name: 'Trae',
    rootDir: { darwin: '~/.trae', win32: '~/.trae', linux: '~/.trae' },
    skillsRelativePath: 'skills',
    defaultPath: '~/.trae/skills/',
    projectPath: '.trae/skills/',
    enabled: true, detected: false,
  },
  {
    id: 'trae-cn',
    name: 'Trae CN',
    rootDir: { darwin: '~/.trae-cn', win32: '~/.trae-cn', linux: '~/.trae-cn' },
    skillsRelativePath: 'skills',
    defaultPath: '~/.trae-cn/skills/',
    projectPath: '.trae-cn/skills/',
    enabled: true, detected: false,
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    rootDir: { darwin: '~/.config/opencode', win32: '~/.config/opencode', linux: '~/.config/opencode' },
    skillsRelativePath: 'skills',
    defaultPath: '~/.config/opencode/skills/',
    projectPath: '.opencode/skills/',
    enabled: true, detected: false,
  },
  {
    id: 'mimo',
    name: 'MiMo Code',
    rootDir: { darwin: '~/.config/mimocode', win32: '~/.config/mimocode', linux: '~/.config/mimocode' },
    skillsRelativePath: 'skills',
    defaultPath: '~/.config/mimocode/skills/',
    projectPath: '.mimocode/skills/',
    enabled: true, detected: false,
  },
  {
    id: 'cline',
    name: 'Cline',
    rootDir: { darwin: '~/.cline', win32: '~/.cline', linux: '~/.cline' },
    skillsRelativePath: 'skills',
    defaultPath: '~/.cline/skills/',
    projectPath: '.cline/skills/',
    enabled: true, detected: false,
  },
  {
    id: 'codex',
    name: 'Codex CLI',
    rootDir: { darwin: '~/.codex', win32: '~/.codex', linux: '~/.codex' },
    skillsRelativePath: 'skills',
    defaultPath: '~/.codex/skills/',
    projectPath: '.codex/skills/',
    enabled: true, detected: false,
  },
  {
    id: 'kilo',
    name: 'Kilo Code',
    rootDir: { darwin: '~/.kilo', win32: '~/.kilo', linux: '~/.kilo' },
    skillsRelativePath: 'skills',
    defaultPath: '~/.kilo/skills/',
    projectPath: '.kilo/skills/',
    enabled: true, detected: false,
  },
  {
    id: 'amp',
    name: 'Amp',
    rootDir: { darwin: '~/.config/amp', win32: '~/.config/amp', linux: '~/.config/amp' },
    skillsRelativePath: 'skills',
    defaultPath: '~/.config/amp/skills/',
    projectPath: '.amp/skills/',
    enabled: true, detected: false,
  },
  {
    id: 'openclaw',
    name: 'OpenClaw',
    rootDir: { darwin: '~/.openclaw', win32: '~/.openclaw', linux: '~/.openclaw' },
    skillsRelativePath: 'skills',
    defaultPath: '~/.openclaw/skills/',
    projectPath: '.openclaw/skills/',
    enabled: true, detected: false,
  },
  {
    id: 'qoder',
    name: 'Qoder',
    rootDir: { darwin: '~/.qoder', win32: '~/.qoder', linux: '~/.qoder' },
    skillsRelativePath: 'skills',
    defaultPath: '~/.qoder/skills/',
    projectPath: '.qoder/skills/',
    enabled: true, detected: false,
  },
  {
    id: 'hermes',
    name: 'Hermes Agent',
    rootDir: { darwin: '~/.hermes', win32: '~/.hermes', linux: '~/.hermes' },
    skillsRelativePath: 'skills',
    defaultPath: '~/.hermes/skills/',
    projectPath: '.hermes/skills/',
    enabled: true, detected: false,
  },
  {
    id: 'codebuddy',
    name: 'CodeBuddy',
    rootDir: { darwin: '~/.codebuddy', win32: '~/.codebuddy', linux: '~/.codebuddy' },
    skillsRelativePath: 'skills',
    defaultPath: '~/.codebuddy/skills/',
    projectPath: '.codebuddy/skills/',
    enabled: true, detected: false,
  },
]

export function detectPlatforms(): PlatformInfo[] {
  const svc = typeof window !== 'undefined' ? window.services : null
  if (!svc) return defaultPlatforms.map((p) => ({ ...p, detected: false }))

  return defaultPlatforms.map((p) => {
    let detected = false
    if (p.rootDir) {
      const rootExpanded = resolveRootDir(p).replace(/^~/, svc.homeDir())
      detected = svc.pathExists(rootExpanded)
    } else {
      const checkPath = p.defaultPath || p.projectPath || ''
      if (checkPath) {
        const expanded = checkPath.replace(/^~/, svc.homeDir())
        detected = svc.pathExists(expanded)
      }
    }
    return { ...p, detected }
  })
}

export function getPlatformPath(platform: PlatformInfo, mode: 'global' | 'project' = 'global'): string {
  const svc = typeof window !== 'undefined' ? window.services : null
  if (mode === 'global' && platform.rootDir && platform.skillsRelativePath) {
    const root = resolveRootDir(platform).replace(/^~/, svc ? svc.homeDir() : '~')
    return joinPath(root, platform.skillsRelativePath)
  }
  const base = mode === 'global'
    ? platform.customPath || platform.defaultPath
    : platform.customProjectPath || platform.projectPath
  return base ? base.replace(/^~/, svc ? svc.homeDir() : '~') : ''
}
