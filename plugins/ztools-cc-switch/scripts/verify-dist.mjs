import { access, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'

const required = [
  'index.html', 'plugin.json', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'default-rules.json',
  'preload/index.js', 'preload/configManager.js', 'preload/sidecarClient.js', 'preload/clientVisibility.js',
  'preload/skillManager.js', 'preload/routerManager.js', 'preload/claudeDesktopManager.js', 'preload/balanceManager.js', 'preload/hostStartupManager.js', 'preload/codexHistoryManager.js', 'preload/usageScriptManager.js', 'preload/logManager.js',
  'preload/failoverManager.js',
  'preload/activityStore.js', 'preload/extensionManager.js', 'preload/backupManager.js',
  'preload/webdavSyncManager.js',
  'preload/authManager.js',
  'preload/s3SyncManager.js',
  'preload/subscriptionManager.js',
  'preload/sessionManager.js',
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

if (process.platform === 'darwin') {
  required.push(
    'preload/bin/cc-switch-sidecar-darwin-arm64',
    'preload/bin/cc-switch-sidecar-darwin-x64'
  )
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
