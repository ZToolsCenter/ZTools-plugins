'use strict'

const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const path = require('node:path')
const test = require('node:test')

const { getHostCompatibility } = require('../public/preload/host-compatibility.cjs')

test('browser preview is allowed and detected hosts fail closed on unreadable versions', () => {
  assert.deepEqual(getHostCompatibility({}), { supported: true, detected: false, version: null })
  for (const api of [
    {},
    { getAppVersion() { throw new Error('unavailable') } },
    { getAppVersion: () => '' },
    { getAppVersion: () => 'current' },
    { getAppVersion: () => '3' },
    { getAppVersion: () => null },
  ]) {
    assert.deepEqual(getHostCompatibility({ ztools: api }), { supported: false, detected: true, version: null })
  }
})

test('2.4 through 3.1 remain supported while older hosts are gated', () => {
  assert.equal(getHostCompatibility({ ztools: { getAppVersion: () => '2.3.9' } }).supported, false)
  assert.equal(getHostCompatibility({ ztools: { getAppVersion: () => '2.4.0-beta.1' } }).supported, false)
  for (const version of ['2.4.0', '2.8.3', '3.0.0', '3.1.9']) {
    assert.deepEqual(getHostCompatibility({ ztools: { getAppVersion: () => version } }), {
      supported: true,
      detected: true,
      version,
    })
  }
})

test('unsupported detected hosts do not load systeminformation or collector modules', () => {
  const child = path.join(__dirname, 'preload-gate-child.cjs')
  const services = path.join(__dirname, '..', 'public', 'preload', 'services.js')
  for (const mode of ['missing', 'throwing', 'empty', 'invalid', 'below-floor']) {
    const result = spawnSync(process.execPath, [child, services, mode], {
      cwd: path.join(__dirname, '..'),
      encoding: 'utf8',
      timeout: 10_000,
    })
    assert.equal(result.status, 0, `${mode}: ${result.stderr}`)
    const state = JSON.parse(result.stdout)
    assert.deepEqual(state.heavyLoads, [], mode)
    assert.deepEqual(state.bridgeMethods, ['collect', 'copyText', 'saveReport', 'startDrag'], mode)
  }
})
