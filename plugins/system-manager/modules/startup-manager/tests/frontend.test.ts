import assert from 'node:assert/strict'
import test from 'node:test'
import { filterItems, kindLabel, summarize } from '../src/composables/startupLogic.ts'
import type { StartupItem } from '../src/types/startup.ts'

const base: StartupItem = {
  id: '1', name: 'Cloud Sync', scope: 'user', kind: 'desktop-autostart', source: { label: 'XDG', location: '~/.config/autostart/cloud.desktop' }, trigger: '登录时', commandSummary: '~/bin/sync', enabled: true, running: false, status: 'idle', impact: { level: 'low', basis: 'heuristic', reasons: ['登录项'] }, action: { canToggle: true, requiresElevation: false, reason: null }, metadata: {},
}

test('frontend filters across query, scope, state and kind', () => {
  const service: StartupItem = { ...base, id: '2', name: 'Audio', scope: 'system', kind: 'service', enabled: false, action: { canToggle: false, requiresElevation: true, reason: '只读' } }
  assert.deepEqual(filterItems([base, service], { query: 'sync', scope: 'all', state: 'enabled', kind: 'all' }).map((item) => item.id), ['1'])
  assert.deepEqual(filterItems([base, service], { query: '', scope: 'system', state: 'disabled', kind: 'service' }).map((item) => item.id), ['2'])
})

test('frontend summary separates enabled, running and manageable', () => {
  const running = { ...base, id: '2', running: true, action: { ...base.action, canToggle: false } }
  assert.deepEqual(summarize([base, running]), { total: 2, enabled: 2, running: 1, manageable: 1 })
  assert.equal(kindLabel('scheduled-task'), '计划任务')
})
