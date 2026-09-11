import path from 'node:path'

export function resolveNpmInvocation(options = {}) {
  const pathApi = options.pathApi || path
  const node = options.node || process.execPath
  const npmCli = options.npmCli || process.env.npm_execpath
  if (typeof node !== 'string' || !pathApi.isAbsolute(node)) throw new Error('Node 可执行文件必须是绝对路径')
  if (typeof npmCli !== 'string' || !pathApi.isAbsolute(npmCli) || !/^npm-cli\.(?:c?js)$/i.test(pathApi.basename(npmCli))) {
    throw new Error('npm_execpath 必须指向绝对 npm-cli.js；请通过 npm run build 执行')
  }
  return Object.freeze({ file: node, prefix: Object.freeze([npmCli]) })
}
