import type { IDEConfig } from './types'

const CONFIG_PREFIX = 'vscode_plugin.'

export function newConfig(code: string, command: string = code): IDEConfig {
  console.log('[config] newConfig called:', { code, command })
  return {
    code,
    icon: '',
    terminal: '',
    command,
    database: '',
    timeout: '3000',
  }
}

export function getIDEConfigs(): (IDEConfig & { _configKey: string })[] {
  console.log('[config] getIDEConfigs start')
  const db = window.ztools.db
  if (!db) {
    console.error('[config] window.ztools.db not available')
    return []
  }
  const docs = db.allDocs(CONFIG_PREFIX)
  console.log('[config] db.allDocs result:', docs)
  const configs: (IDEConfig & { _configKey: string })[] = []
  for (const doc of docs) {
    const key = doc._id
    if (!key) continue
    console.log('[config] processing key:', key)
    const config = window.ztools.dbStorage.getItem(key) as IDEConfig | null
    console.log('[config] loaded config:', key, config)
    if (config && config.code) {
      configs.push({ ...config, _configKey: key })
    } else {
      console.warn('[config] config invalid or missing code:', config)
    }
  }
  console.log('[config] getIDEConfigs result:', configs.length, 'configs')
  return configs
}

export function getIDEConfig(code: string): IDEConfig {
  console.log('[config] getIDEConfig called for code:', code)
  const configs = getIDEConfigs()
  const found = configs.find((c) => c.code === code)
  if (found) {
    console.log('[config] found existing config:', found)
    return found
  }
  console.log('[config] no existing config, creating default')
  return createDefaultConfig(code)
}

export function saveIDEConfig(config: IDEConfig): void {
  const key = CONFIG_PREFIX + config.code
  console.log('[config] saveIDEConfig key:', key)
  console.log('[config] saveIDEConfig value:', JSON.stringify(config))
  console.log('[config] dbStorage available:', !!window.ztools.dbStorage)
  window.ztools.dbStorage.setItem(key, config)
  // 保存后验证
  const verified = window.ztools.dbStorage.getItem(key) as IDEConfig | null
  console.log('[config] save verified:', verified)
}

export function deleteIDEConfig(code: string): void {
  const key = CONFIG_PREFIX + code
  console.log('[config] deleteIDEConfig key:', key)
  window.ztools.dbStorage.removeItem(key)
  const verified = window.ztools.dbStorage.getItem(key)
  console.log('[config] delete verified (should be null):', verified)
}

function createDefaultConfig(code: string): IDEConfig {
  const appName = code === 'vscode' ? 'Code' : code === 'cursor' ? 'Cursor' : code
  const config = newConfig(code, code)
  // 使用 '/' 拼接（跨平台兼容，Windows 也支持 '/' 作为路径分隔符）
  const appData = window.ztools.getPath('appData')
  const sep = appData.includes('\\') ? '\\' : '/'
  const databasePath = appData + sep + appName + sep + 'User' + sep + 'globalStorage' + sep + 'state.vscdb'
  console.log('[config] createDefaultConfig path:', databasePath)
  config.database = databasePath
  saveIDEConfig(config)
  return config
}
