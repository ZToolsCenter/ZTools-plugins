import { access, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'

const required = [
  'index.html', 'plugin.json', 'README.md', 'CHANGELOG.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'default-rules.json',
  'preload/index.js', 'preload/configManager.js', 'preload/sidecarClient.js', 'preload/clientVisibility.js',
  'preload/skillManager.js', 'preload/routerManager.js', 'preload/claudeDesktopManager.js', 'preload/balanceManager.js', 'preload/hostStartupManager.js', 'preload/codexHistoryManager.js', 'preload/usageScriptManager.js', 'preload/logManager.js',
  'preload/failoverManager.js',
  'preload/activityStore.js', 'preload/extensionManager.js', 'preload/backupManager.js',
  'preload/webdavSyncManager.js',
  'preload/authManager.js',
  'preload/s3SyncManager.js',
  'preload/subscriptionManager.js',
  'preload/sessionManager.js',
  'preload/terminalLauncher.js',
  'preload/workspaceManager.js',
  'preload/envManager.js',
  'preload/usageImportManager.js',
  'preload/profileManager.js',
  'preload/outboundProxyManager.js',
  'preload/agentConfigManager.js',
  'preload/hermesRuntimeManager.js',
  'preload/deepLinkManager.js',
  'preload/connectivityCheckManager.js',
  'preload/modelFetchManager.js',
  'preload/omoManager.js',
  'preload/codingPlanManager.js',
  'preload/toolRuntimeManager.js',
  'preload/providerTerminalManager.js',
  'preload/protocolAdapter.js',
  'preload/codexCompat.js',
  'preload/sseTransformer.js',
  'preload/package.json', 'preload/package-lock.json'
]

const sidecarNames = {
  darwin: ['cc-switch-sidecar-darwin-arm64', 'cc-switch-sidecar-darwin-x64'],
  win32: [`cc-switch-sidecar-win32-${process.arch}.exe`],
  linux: [`cc-switch-sidecar-linux-${process.arch}`]
}
required.push(...(sidecarNames[process.platform] || []).map((name) => `preload/bin/${name}`))
if (process.env.CC_SWITCH_UNIVERSAL_BUILD === '1') {
  required.push(...[
    'cc-switch-sidecar-darwin-arm64',
    'cc-switch-sidecar-darwin-x64',
    'cc-switch-sidecar-win32-x64.exe',
    'cc-switch-sidecar-linux-x64'
  ].map((name) => `preload/bin/${name}`))
}

for (const relative of required) await access(path.resolve('dist', relative))
const preloadRequire = createRequire(path.resolve('dist/preload/index.js'))
for (const dependency of ['adm-zip', 'json5', 'node-fetch', 'proxy-agent', 'proxy-from-env', 'tar', 'yaml']) {
  preloadRequire.resolve(dependency)
}
const plugin = JSON.parse(await readFile(path.resolve('dist/plugin.json'), 'utf8'))
const packageJson = JSON.parse(await readFile(path.resolve('package.json'), 'utf8'))
if (plugin.version !== packageJson.version) {
  throw new Error(`plugin.json (${plugin.version}) 与 package.json (${packageJson.version}) 版本不一致`)
}
console.log(`Verified dist: ${required.length} required files, version ${plugin.version}`)
