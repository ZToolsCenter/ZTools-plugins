// ztools CLI 使用 Node 原生 https.request，不识别 HTTPS_PROXY 环境变量，
// 国内网络直连 github.com 会 ETIMEDOUT。
// 此脚本通过 global-agent 注入全局代理后再启动 CLI。
const { spawnSync } = require('child_process')
const path = require('path')

process.env.GLOBAL_AGENT_HTTPS_PROXY =
  process.env.GLOBAL_AGENT_HTTPS_PROXY ||
  process.env.HTTPS_PROXY ||
  'http://127.0.0.1:7897'

const cli = path.join(
  __dirname, '..', 'node_modules', '@ztools-center', 'plugin-cli', 'dist', 'index.js'
)

const result = spawnSync(
  process.execPath,
  ['-r', 'global-agent/bootstrap', cli, ...process.argv.slice(2)],
  { stdio: 'inherit', cwd: path.join(__dirname, '..') }
)
process.exit(result.status === null ? 1 : result.status)
