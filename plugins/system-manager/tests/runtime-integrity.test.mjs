import assert from 'node:assert/strict'
import { appendFile, cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'

import { root } from '../scripts/config.mjs'
import { verifyRuntimeDependencyDirectory } from '../scripts/runtime-dependency-integrity.mjs'

const dependency = 'systeminformation'
const source = path.join(root, 'node_modules', dependency)
const locked = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'))
  .packages[`node_modules/${dependency}`]

function verify(directory, packageIntegrity = locked.integrity) {
  return verifyRuntimeDependencyDirectory({
    directory,
    dependency,
    version: locked.version,
    packageIntegrity
  })
}

async function copiedFixture(t) {
  const scratch = await mkdtemp(path.join(root, '.runtime-integrity-test-'))
  const target = path.join(scratch, dependency)
  await cp(source, target, { recursive: true })
  t.after(() => rm(scratch, { recursive: true, force: true }))
  return target
}

test('locked runtime dependency matches the committed exact file manifest', async () => {
  assert.deepEqual(await verify(source), { files: 27 })
})

test('runtime dependency verification rejects changed privileged source bytes', async (t) => {
  const target = await copiedFixture(t)
  await appendFile(path.join(target, 'lib', 'index.js'), '\n// tampered fixture\n')
  await assert.rejects(verify(target), /文件哈希不匹配：lib\/index\.js/)
})

test('runtime dependency verification rejects extra files and lock integrity drift', async (t) => {
  const target = await copiedFixture(t)
  await writeFile(path.join(target, 'unexpected.cjs'), "module.exports = 'unexpected'\n")
  await assert.rejects(verify(target), /文件集合不匹配.*unexpected\.cjs/)
  await assert.rejects(verify(source, 'sha512-invalid'), /未绑定当前锁文件 integrity/)
})
