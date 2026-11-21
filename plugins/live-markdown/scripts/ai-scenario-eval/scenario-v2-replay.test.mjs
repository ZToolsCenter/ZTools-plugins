import test from 'node:test';
import assert from 'node:assert/strict';
import { replayPlanner } from './scenario-v2-runner.mjs';
const item = { instruction: '底部加hello', source: 'body' };
const record = () => ({ snapshot: { selection: null }, calls: [{ phase: 'planning', raw: 'captured' }] });
const modules = {
  buildAiIntentCandidates: () => ({ headings: [], literals: [] }),
  parseIntentOutput: () => ({ kind: 'edit' }),
  async planAiIntent(_instruction, _selected, _candidates, invoke) { await invoke(); return { kind: 'edit' }; }
};
test('awaits captured async planner before oracle reads canonical intent or replay counts', async () => {
  const value = record();
  await replayPlanner(item, value, modules);
  assert.deepEqual(value.plannerIntent, { kind: 'edit' });
  assert.equal(value.plannerReplayCalls, 1);
});
test('records asynchronous parser failures without escaping the test process', async () => {
  const value = record();
  await replayPlanner(item, value, { ...modules, async planAiIntent(_i,_s,_c,invoke) { await invoke(); throw Object.assign(new Error('bad wire'), { code: 'invalid_output' }); } });
  assert.equal(value.plannerError?.code, 'invalid_output');
  assert.equal(value.plannerReplayCalls, 1);
});
