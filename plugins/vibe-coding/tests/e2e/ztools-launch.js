import path from 'node:path'

const INSTALLED_ZTOOLS_PATH = '/Applications/ZTools.app/Contents/MacOS/ZTools'
const DEVELOPMENT_SETTINGS_URL = 'http://127.0.0.1:15177'
const INSTALLED_SETTINGS_URL_FRAGMENT = 'internal-plugins/setting/index.html'

/**
 * 根据当前平台解析 ZTools 源码仓库所安装的 Electron 可执行文件。
 * @param {string} sourceRoot ZTools 源码仓库绝对路径。
 * @returns {string} Electron 可执行文件绝对路径。
 * @throws {Error} 当前平台不受开发态 E2E 启动器支持时抛出。
 */
function resolveDevelopmentElectronPath(sourceRoot) {
  if (process.platform === 'darwin') return path.join(sourceRoot, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  if (process.platform === 'win32') return path.join(sourceRoot, 'node_modules/electron/dist/electron.exe')
  if (process.platform === 'linux') return path.join(sourceRoot, 'node_modules/electron/dist/electron')
  throw new Error(`当前平台不支持 ZTools 开发态 E2E：${process.platform}`)
}

/**
 * 构建隔离启动 ZTools 所需的 Playwright Electron 参数。
 * @param {string} dataRoot 测试专用 ZTools 数据目录。
 * @param {string} legacyRoot 测试专用旧版数据目录。
 * @returns {Record<string, unknown>} 可直接传入 `electron.launch` 的参数。
 */
export function createZToolsLaunchOptions(dataRoot, legacyRoot) {
  const sourceRoot = String(process.env.ZTOOLS_E2E_APP_ROOT || '').trim()
  const environment = {
    ...Object.fromEntries(Object.entries(process.env).filter(([, value]) => value)),
    ZTOOLS_DATA_ROOT: dataRoot,
    ZTOOLS_E2E: '1',
    ZTOOLS_LEGACY_USER_DATA_PATH: legacyRoot,
    ...(sourceRoot ? { ZTOOLS_SETTING_DEV_SERVER_URL: DEVELOPMENT_SETTINGS_URL } : {}),
  }

  // 开发态直接加载源码根目录；生产态保持显式可执行文件且不传应用参数。
  if (sourceRoot) {
    return {
      executablePath: resolveDevelopmentElectronPath(sourceRoot),
      args: [sourceRoot],
      cwd: sourceRoot,
      env: environment,
    }
  }
  return {
    executablePath: process.env.ZTOOLS_E2E_EXECUTABLE_PATH || INSTALLED_ZTOOLS_PATH,
    args: [],
    env: environment,
  }
}

/**
 * 返回当前宿主模式下用于定位内置设置页的 URL 特征。
 * @returns {string} 开发设置页地址或生产设置页路径片段。
 */
export function getZToolsSettingsUrlFragment() {
  return process.env.ZTOOLS_E2E_APP_ROOT ? DEVELOPMENT_SETTINGS_URL : INSTALLED_SETTINGS_URL_FRAGMENT
}
