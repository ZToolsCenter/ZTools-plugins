import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { registerHooks } from 'node:module'
import assert from 'node:assert/strict'
import { adaptCliUpstream } from './publish-platform.mjs'

// 所有 Git 写入均指向新建临时仓库；GitHub 和认证接口由本文件替换为演练响应。
const root = mkdtempSync(join(tmpdir(), 'lx-publish-'))
const project = join(root, 'project')
const seed = join(root, 'seed')
const remote = join(root, 'remote.git')
const cache = join(root, 'config')
const source = process.cwd()
const manifest = JSON.parse(readFileSync(join(source, 'src-ztools/plugin.json'), 'utf8'))
/** 在指定临时仓库运行 Git，失败时立即停止。 */
function git(cwd, ...args) { return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim() }
mkdirSync(seed)
git(seed, 'init', '-b', 'main')
git(seed, 'config', 'user.name', 'Local rehearsal')
git(seed, 'config', 'user.email', 'rehearsal@localhost')
writeFileSync(join(seed, 'README.md'), 'Local publish rehearsal\n')
git(seed, 'add', '.')
git(seed, 'commit', '-m', 'seed')
git(root, 'clone', '--bare', seed, remote)
git(root, 'clone', source, project)
process.env.ZTOOLS_CONFIG_DIR = cache
process.env.ZTOOLS_UPSTREAM_URL = remote
process.env.LX_REHEARSAL_REMOTE = remote
process.env.LX_REHEARSAL_RECORD = join(root, 'draft-pr.json')
process.chdir(project)
registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL?.includes('/@ztools-center/plugin-cli/dist/')) {
      if (specifier === './auth.js') return { url: 'lx-test:auth', shortCircuit: true }
      if (specifier === './github.js') return { url: 'lx-test:github', shortCircuit: true }
    }
    return next(specifier, context)
  },
  load(url, context, next) {
    if (url.endsWith('/@ztools-center/plugin-cli/dist/upstream.js')) return { format: 'module', shortCircuit: true, source: adaptCliUpstream(readFileSync(new URL(url), 'utf8')) }
    if (url === 'lx-test:auth') return { format: 'module', shortCircuit: true, source: 'export async function ensureAuth(){ return "local-test-only" }' }
    if (url === 'lx-test:github') return { format: 'module', shortCircuit: true, source: `
      import fs from 'node:fs';
      export async function getCurrentUser(){ return {login:'local-rehearsal'} }
      export async function ensureFork(){ return {clone_url:process.env.LX_REHEARSAL_REMOTE, html_url:'local://fork'} }
      export async function syncForkMain(){ return {ok:true} }
      export async function findOpenPullRequest(){ return fs.existsSync(process.env.LX_REHEARSAL_RECORD) ? JSON.parse(fs.readFileSync(process.env.LX_REHEARSAL_RECORD)) : null }
      export async function pluginExistsUpstream(){ return false }
      export async function createPullRequest(token,head,title,body){ const pr={number:1,html_url:'local://draft-pr/1',draft:true,head,title,body}; fs.writeFileSync(process.env.LX_REHEARSAL_RECORD,JSON.stringify(pr,null,2)); return pr }
    ` }
    return next(url, context)
  }
})
const { publish } = await import('@ztools-center/plugin-cli/dist/publish.js')
await publish()
const record = JSON.parse(readFileSync(process.env.LX_REHEARSAL_RECORD, 'utf8'))
assert.equal(record.draft, true)
assert.equal(record.title, `Add plugin ${manifest.title} v${manifest.version}`)
const tree = git(root, '--git-dir=' + remote, 'ls-tree', '-r', '--name-only', 'plugin/lx-music-ztools')
assert.ok(tree.includes('plugins/lx-music-ztools/src-ztools/plugin.json'))
assert.ok(!tree.includes('node_modules/'))
assert.ok(!tree.includes('src-ztools/dist/'))
assert.ok(!tree.includes('artifacts/'))
assert.ok(existsSync(join(project, '.git')))
// Reproduce an existing PR on a machine without saved upstream-sync state.
// This forces the CLI to quote the already-published branch in git fetch.
unlinkSync(join(project, '.git', 'ztools-upstream-sync.json'))
await publish()
assert.equal(JSON.parse(readFileSync(process.env.LX_REHEARSAL_RECORD, 'utf8')).number, 1)
process.chdir(source)
mkdirSync('../output/lx-music-ztools', { recursive: true })
writeFileSync('../output/lx-music-ztools/publish-rehearsal.json', JSON.stringify({ result: 'PASS', mode: 'local Git + mocked GitHub/auth', cli: '1.3.2', checks: ['first publish', 'repeat publish without saved upstream state', 'draft PR body', 'source file filtering'], evidenceRoot: root }, null, 2))
console.log('PASS 官方 CLI 隔离发布演练；未请求 GitHub，未验证真实 OAuth/PR。')
