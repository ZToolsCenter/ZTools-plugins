import { readFileSync, existsSync } from 'node:fs'
import { resolve, relative, isAbsolute } from 'node:path'
import assert from 'node:assert/strict'
import vm from 'node:vm'

/** 检查最终安装目录内的入口、元信息与可读 preload。 */
export function check(root = resolve('src-ztools')) {
  const manifest = JSON.parse(readFileSync(resolve(root, 'plugin.json'), 'utf8'))
  assert.match(manifest.name, /^[a-z][a-z0-9-]*[a-z0-9]$/)
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/)
  for (const field of ['title', 'description', 'author']) assert.ok(manifest[field])
  for (const key of ['main', 'preload', 'logo']) {
    const file = resolve(root, manifest[key])
    const rel = relative(root, file)
    assert.ok(!rel.startsWith('..') && !isAbsolute(rel), `${key} 超出插件目录`)
    assert.ok(existsSync(file), `缺少 ${key}: ${file}`)
  }
  assert.equal(readFileSync(resolve(root, manifest.logo)).subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
  assert.equal(JSON.parse(readFileSync(resolve(root, 'preload/package.json'), 'utf8')).type, 'commonjs')
  new vm.Script(readFileSync(resolve(root, manifest.preload), 'utf8'))
  assert.equal(new Set(manifest.features.map(x => x.code)).size, manifest.features.length)
  console.log(`PASS 安装目录完整：${manifest.name} v${manifest.version}`)
  return manifest
}
if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) check()
