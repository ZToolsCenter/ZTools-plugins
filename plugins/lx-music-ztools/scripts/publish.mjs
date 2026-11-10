import { execFileSync } from 'node:child_process'
import { registerHooks } from 'node:module'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { adaptCliUpstream } from './publish-platform.mjs'

// 复用用户已经登录的 GitHub CLI，不把凭据写入项目或 CLI 配置。
const token = execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
process.env.ZTOOLS_CONFIG_DIR ||= join(homedir(), '.config', 'ztools', 'lx-music-ztools-sparse')
const cache = join(process.env.ZTOOLS_CONFIG_DIR, 'ZTools-plugins')
const write = process.stdout.write.bind(process.stdout)
const errorWrite = process.stderr.write.bind(process.stderr)
process.stdout.write = (chunk, ...args) => write(String(chunk).replaceAll(token, '[REDACTED]'), ...args)
process.stderr.write = (chunk, ...args) => errorWrite(String(chunk).replaceAll(token, '[REDACTED]'), ...args)
globalThis[Symbol.for('lx-publish-token')] = token
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === './auth.js' && context.parentURL?.includes('/@ztools-center/plugin-cli/dist/')) return { url: 'lx-auth:gh', shortCircuit: true }
    return next(specifier, context)
  },
  load(url, context, next) {
    if (url.endsWith('/@ztools-center/plugin-cli/dist/upstream.js')) return { format: 'module', shortCircuit: true, source: adaptCliUpstream(readFileSync(new URL(url), 'utf8')) }
    if (url === 'lx-auth:gh') return { format: 'module', shortCircuit: true, source: 'export async function ensureAuth(){ return globalThis[Symbol.for("lx-publish-token")] }' }
    if (url.endsWith('/@ztools-center/plugin-cli/dist/github.js')) {
      // Windows 当前网络下 Node HTTPS 直连失败；保留官方 API 业务逻辑，使用 gh 发送真实请求。
      let source = readFileSync(new URL(url), 'utf8')
      const start = source.indexOf('function githubRequest(')
      const end = source.indexOf('export async function getCurrentUser', start)
      if (start < 0 || end < 0) throw new Error('CLI GitHub transport changed; inspect before publishing')
      source = source.slice(0, start) + `async function githubRequest(path, accessToken, method = 'GET', body) {
        const args = ['api', path, '--method', method];
        if (body !== undefined) args.push('--input', '-');
        const result = await import('node:child_process').then(({execFileSync}) => execFileSync('gh', args, { encoding: 'utf8', input: body === undefined ? undefined : JSON.stringify(body), stdio: ['pipe','pipe','pipe'] }));
        return result.trim() ? JSON.parse(result) : null;
      }\n` + source.slice(end)
      return { format: 'module', shortCircuit: true, source }
    }
    return next(url, context)
  }
})
/** 移除发布缓存 remote URL 中的认证信息。 */
function cleanCredentialURL() {
  if (!existsSync(join(cache, '.git'))) return
  try {
    const url = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: cache, encoding: 'utf8' }).trim()
    execFileSync('git', ['remote', 'set-url', 'origin', url.replace(/https:\/\/[^/]*@github\.com\//, 'https://github.com/')], { cwd: cache, stdio: 'ignore' })
  } catch { /* 不让清理错误遮蔽发布失败原因。 */ }
}
process.once('exit', cleanCredentialURL)
try {
  const { publish } = await import('@ztools-center/plugin-cli/dist/publish.js')
  await publish()
} finally {
  // 官方 CLI 会将认证 URL 写入缓存 remote；完成后移除其中的凭据。
  cleanCredentialURL()
  delete globalThis[Symbol.for('lx-publish-token')]
}
