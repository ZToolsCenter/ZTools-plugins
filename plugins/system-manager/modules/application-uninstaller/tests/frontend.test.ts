import assert from 'node:assert/strict'
import test from 'node:test'
import { defaultSelectedIds, filterApps, formatBytes, summarizeResult } from '../src/model/uninstall.ts'
import type { AppSummary, Candidate } from '../src/types.ts'

const app = (name: string, publisher: string | null): AppSummary => ({ id: name, platform: 'linux', name, version: '1.0', publisher, install: { kind: 'desktop', path: null, scope: 'user' }, uninstall: { mode: 'trash', requiresElevation: false, supported: true }, protected: false })

test('search matches name, publisher and install metadata', () => {
  const apps = [app('Acme Editor', 'Acme'), app('Notes', null)]
  assert.deepEqual(filterApps(apps, 'acme'), [apps[0]])
  assert.deepEqual(filterApps(apps, 'desktop'), apps)
  assert.deepEqual(filterApps(apps, 'missing'), [])
})

test('defaults never select weak or non-deletable candidates', () => {
  const base = { path: '/x', category: 'cache', sizeBytes: null, exists: true, ownership: 'user', reason: 'x' } as const
  const candidates: Candidate[] = [
    { ...base, id: 'exact', confidence: 'exact', selectedByDefault: true, deletable: true },
    { ...base, id: 'strong', confidence: 'strong', selectedByDefault: true, deletable: true },
    { ...base, id: 'weak', confidence: 'weak', selectedByDefault: true, deletable: true },
    { ...base, id: 'manual', confidence: 'exact', selectedByDefault: true, deletable: false },
  ]
  assert.deepEqual(defaultSelectedIds(candidates), ['exact'])
})

test('result summary and byte labels are stable', () => {
  const summary = summarizeResult({ planId: 'p', completedAt: '', results: [
    { candidateId: 'a', status: 'trashed' }, { candidateId: 'b', status: 'failed' }, { candidateId: 'c', status: 'launched-uninstaller' },
  ] })
  assert.deepEqual(summary, { trashed: 1, launched: 1, skipped: 0, failed: 1 })
  assert.equal(formatBytes(null), '目录')
  assert.equal(formatBytes(1536), '1.5 KB')
})
