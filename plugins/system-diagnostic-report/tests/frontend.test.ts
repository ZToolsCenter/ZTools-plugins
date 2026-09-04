import assert from 'node:assert/strict'
import test from 'node:test'

import { escapeMarkdown, reportToMarkdown } from '../src/composables/formatReport'
import { normalizeReport, useSystemReport } from '../src/composables/useSystemReport'
import { getZToolsCompatibility, hostCompatibility } from '../src/composables/ztoolsCompatibility'
import type { NormalizedReport, SystemReport } from '../src/types/report'

function rawReport(generatedAt = '2026-07-30T10:20:30.000Z'): SystemReport {
  return {
    generatedAt: '1999-01-01T00:00:00.000Z',
    overview: { generatedAt, status: 'ok', privacy: 'safe' },
    device: { virtual: false },
    status: 'ok',
    warnings: [],
    errors: [],
  }
}

test('normalization uses canonical overview time and keeps false fields neutral', () => {
  const report = normalizeReport(rawReport())
  const device = report.groups.find((group) => group.id === 'device')
  const virtual = device?.fields.find((field) => field.label === '虚拟设备')

  assert.equal(report.generatedAt, '2026-07-30T10:20:30.000Z')
  assert.equal(virtual?.value, '否')
  assert.equal(virtual?.status, 'neutral')
})

test('ZTools 2.4 is the supported floor while an unreadable detected version fails closed', () => {
  assert.equal(getZToolsCompatibility('2.3.9').supported, false)
  assert.equal(getZToolsCompatibility('2.4.0-beta.1').supported, false)
  assert.equal(getZToolsCompatibility('2.4.0').supported, true)
  assert.equal(getZToolsCompatibility('3.1.9').supported, true)
  assert.equal(getZToolsCompatibility('3.2.0').supported, true)
  assert.deepEqual(getZToolsCompatibility(undefined), { supported: false, detected: true, version: null })
  assert.deepEqual(getZToolsCompatibility('current'), { supported: false, detected: true, version: null })
})

test('host compatibility allows only a bridge-free browser preview to have an unknown version', () => {
  const previousWindow = globalThis.window
  try {
    Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: {} })
    assert.deepEqual(hostCompatibility(), { supported: true, detected: false, version: null })
    for (const ztools of [
      {},
      { getAppVersion() { throw new Error('unavailable') } },
      { getAppVersion: () => '' },
      { getAppVersion: () => 'invalid' },
    ]) {
      globalThis.window = { ztools } as Window & typeof globalThis
      assert.deepEqual(hostCompatibility(), { supported: false, detected: true, version: null })
    }
  } finally {
    if (previousWindow === undefined) delete (globalThis as { window?: Window }).window
    else globalThis.window = previousWindow
  }
})

test('collector errors retain their source without being duplicated as warnings', () => {
  const report = normalizeReport({
    ...rawReport(),
    status: 'partial',
    errors: [{ source: 'cpu', code: 'COLLECTOR_FAILED', message: 'Collection failed' }],
  })

  assert.deepEqual(report.errors, ['处理器：采集失败'])
  assert.deepEqual(report.warnings, [])
})

test('failed refresh retains the prior report and marks it stale', async () => {
  const previousWindow = globalThis.window
  let shouldFail = false
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: {
      systemReport: {
        collect: async () => {
          if (shouldFail) throw new Error('private collector detail')
          return rawReport()
        },
      },
    },
  })

  try {
    const state = useSystemReport()
    const first = await state.collect()
    const firstReport = state.report.value
    shouldFail = true
    const second = await state.collect()

    assert.equal(first.ok, true)
    assert.equal(second.ok, false)
    assert.equal(second.ok ? false : second.stale, true)
    assert.equal(state.stale.value, true)
    assert.equal(state.report.value, firstReport)
    assert.doesNotMatch(state.error.value, /private collector detail/)
  } finally {
    if (previousWindow === undefined) delete (globalThis as { window?: Window }).window
    else globalThis.window = previousWindow
  }
})

test('Markdown export escapes HTML, links, control syntax, pipes, and multiline values', () => {
  assert.equal(
    escapeMarkdown('\\ *x* [link](javascript:1) | <img>\n# title & text'),
    '\\\\ \\*x\\* \\[link\\]\\(javascript:1\\) \\| &lt;img&gt;<br>\\# title &amp; text',
  )

  const report: NormalizedReport = {
    generatedAt: '2026-07-30T10:20:30.000Z',
    overallStatus: 'warning',
    recommendations: [{
      id: 'unsafe',
      title: '<script>alert(1)</script>',
      detail: '[click](javascript:alert(1))',
      status: 'warning',
    }],
    groups: [{
      id: 'unsafe',
      title: '# <img src=x onerror=alert(1)>',
      description: '',
      status: 'warning',
      fields: [{
        key: 'unsafe',
        label: 'a|b',
        value: '*bold*\n<table>',
        status: 'warning',
      }],
    }],
    warnings: ['<iframe>\n# injected'],
    errors: ['[unsafe](javascript:alert(1))'],
    raw: {},
  }
  const markdown = reportToMarkdown(report)

  assert.doesNotMatch(markdown, /<(?:script|img|table|iframe)\b/i)
  assert.doesNotMatch(markdown, /\[[^\]]+\]\(javascript:/i)
  assert.match(markdown, /&lt;script&gt;/)
  assert.match(markdown, /a\\\|b/)
  assert.match(markdown, /\\\*bold\\\*<br>&lt;table&gt;/)
})
