import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('bounded metadata strings do not retain their multi-megabyte parents', () => {
  const modules = {
    linuxApps: path.join(root, 'modules/application-uninstaller/public/preload/platform/linux.cjs'),
    darwinApps: path.join(root, 'modules/application-uninstaller/public/preload/platform/darwin.cjs'),
    win32Apps: path.join(root, 'modules/application-uninstaller/public/preload/platform/win32.cjs'),
    startupModel: path.join(root, 'modules/startup-manager/public/preload/core/model.cjs'),
    startupLinux: path.join(root, 'modules/startup-manager/public/preload/adapters/linux.cjs'),
  }
  const script = `
    const linuxApps = require(${JSON.stringify(modules.linuxApps)})
    const darwinApps = require(${JSON.stringify(modules.darwinApps)})
    const win32Apps = require(${JSON.stringify(modules.win32Apps)})
    const startupModel = require(${JSON.stringify(modules.startupModel)})
    const startupLinux = require(${JSON.stringify(modules.startupLinux)})
    const retained = []
    const collect = () => { for (let index = 0; index < 5; index += 1) global.gc() }
    collect()
    const before = process.memoryUsage().heapUsed
    for (let index = 0; index < 32; index += 1) {
      const suffix = String(index).padStart(4, '0')
      const large = suffix + 'x'.repeat(1024 * 1024)
      retained.push(linuxApps.cleanMetadataText(large, 64))
      retained.push(darwinApps.cleanMetadataText(large, '', 64))
      retained.push(win32Apps.cleanMetadataText(large, 64))
      retained.push(startupModel.cleanText(large, 64))
      const desktop = linuxApps.parseDesktop('[Desktop Entry]\\nName=' + large + '\\nExec=' + large)
      retained.push(desktop.Name, desktop.Exec)
      retained.push(darwinApps.normalizeBundleId(' '.repeat(1024 * 1024) + 'io.example.App' + suffix))
      retained.push(darwinApps.normalizeResidualName(' '.repeat(1024 * 1024) + 'App' + suffix))
      retained.push(...startupLinux.parseSystemdList('fixture-' + suffix + '.service enabled ' + 'z'.repeat(1024 * 1024)).flatMap(Object.values))
    }
    collect()
    const delta = process.memoryUsage().heapUsed - before
    if (retained.some((value) => typeof value !== 'string')) throw new Error('expected copied strings')
    if (delta > 16 * 1024 * 1024) throw new Error('retained heap delta: ' + delta)
    process.stdout.write(JSON.stringify({ delta, retained: retained.length }))
  `
  const result = spawnSync(process.execPath, ['--expose-gc', '-e', script], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
    timeout: 30_000,
  })
  assert.equal(result.status, 0, result.stderr || result.stdout)
  const measurement = JSON.parse(result.stdout)
  assert.equal(measurement.retained, 320)
  assert.ok(measurement.delta <= 16 * 1024 * 1024)
})
