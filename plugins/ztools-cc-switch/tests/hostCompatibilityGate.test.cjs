'use strict'

const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const path = require('node:path')
const test = require('node:test')

const { getHostCompatibility } = require('../preload/ztoolsCompatibility')

test('only a bridge-free browser preview may proceed without a readable version', () => {
  assert.deepEqual(getHostCompatibility(undefined), { supported: true, detected: false, version: null })
  for (const api of [
    {},
    { getAppVersion() { throw new Error('unavailable') } },
    { getAppVersion: () => '' },
    { getAppVersion: () => 'current' },
    { getAppVersion: () => '3' },
    { getAppVersion: () => null },
  ]) {
    assert.deepEqual(getHostCompatibility(api), { supported: false, detected: true, version: null })
  }
})

test('2.4 through 3.1 remain supported while earlier versions are rejected', () => {
  assert.equal(getHostCompatibility({ getAppVersion: () => '2.3.9' }).supported, false)
  assert.equal(getHostCompatibility({ getAppVersion: () => '2.4.0-beta.1' }).supported, false)
  for (const version of ['2.4.0', '2.9.7', '3.0.0', '3.1.9']) {
    assert.deepEqual(getHostCompatibility({ getAppVersion: () => version }), {
      supported: true,
      detected: true,
      version,
    })
  }
})

test('unsupported detected hosts expose only the gate bridge before manager startup', () => {
  const child = path.join(__dirname, 'preload-gate-child.cjs')
  const preload = path.join(__dirname, '..', 'preload', 'index.js')
  for (const mode of ['missing', 'throwing', 'empty', 'invalid', 'below-floor']) {
    const result = spawnSync(process.execPath, [child, preload, mode], {
      cwd: path.join(__dirname, '..'),
      encoding: 'utf8',
      timeout: 10_000,
    })
    assert.equal(result.status, 0, `${mode}: ${result.stderr}`)
    const state = JSON.parse(result.stdout)
    assert.deepEqual(state.bridgeMethods, ['getHostCompatibility'], mode)
    assert.equal(state.compatibility.supported, false, mode)
    assert.equal(state.compatibility.detected, true, mode)
    assert.deepEqual(state.managerLoads, [], mode)
    assert.equal(state.timeoutCount, 0, mode)
    assert.equal(state.intervalCount, 0, mode)
  }
})
