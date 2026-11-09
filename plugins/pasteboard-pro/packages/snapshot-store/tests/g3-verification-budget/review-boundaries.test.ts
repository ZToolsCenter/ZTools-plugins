import { open as openLmdb } from 'lmdb';
import { afterEach, expect, it } from 'vitest';
import type { FinalizationClaim } from '../../src/g3-verification-budget/types';
import { fixture, request, rows, type Fixture } from './fixture';

const parent = new URL('../../../../artifacts/pasteboardpro/clipboard-format-g0/v037-budget-tests/runtime/', import.meta.url).pathname;
const opened: Fixture[] = [];
async function create() { const f = await fixture(parent); opened.push(f); return f; }
afterEach(async () => { await Promise.all(opened.splice(0).map(f => f.close())); });
const strictError = { code: expect.stringMatching(/^(invalid-input|unauthorized)$/) };

it('64 active complete attempts are allowed; a 65th cannot bypass pending-attempt capacity', async () => {
  const f = await create();
  for (let i = 0; i < 64; i++) await f.begin('verify-control', true, { deviceId: `PUBLIC-active-device-${i}` });
  await expect(f.begin('verify-control', true, { deviceId: 'PUBLIC-active-device-64' })).rejects.toMatchObject({ code: 'capacity' });
  await f.close();
  expect([...await rows(f.directory)].filter(([key]) => key.startsWith('attempt:'))).toHaveLength(64);
});
it('a string pretending to be finalizer active=false is rejected before recording authentication', async () => {
  const f = await create(); await f.begin('verify-control', true);
  const r = request(), lease = f.unit(r);
  await f.module.budget.reserveVerification(lease, r);
  f.setFinalizerTransform(claim => ({ ...claim, active: 'false' }) as unknown as FinalizationClaim);
  const result = f.module.budget.recordAuthentication(lease, true).then(
    () => ({ success: true, code: '' }), (error: any) => ({ success: false, code: error.code }));
  const outcome = await result;
  expect(f.finalizerObservations).toEqual(['false']);
  expect(outcome).toMatchObject({ success: false, ...strictError });
});
it('unknown actual verification unit cannot allocate a durable reservation', async () => {
  const f = await create(); await f.begin('verify-control', true);
  const r = request('PUBLIC-unknown-unit'), lease = f.unit(r);
  await expect(f.module.budget.reserveVerification(lease, r)).rejects.toMatchObject(strictError);
});
it('unknown trusted claim fields are rejected rather than becoming a second extensible wire', async () => {
  const f = await create(); await f.begin('verify-control', true);
  const r = request(), lease = f.unit(r), c = f.claims.get(lease.token)!;
  const withUnknownField = { ...c, PUBLIC_unknown_field: 'must-reject' };
  f.claims.set(lease.token, withUnknownField);
  await expect(f.module.budget.reserveVerification(lease, r)).rejects.toMatchObject(strictError);
});
it('reopen deeply checks completed attempt counters even when physical accounting is consistent', async () => {
  const f = await create(), a = await f.begin('verify-control', true);
  const r = request(), lease = f.unit(r);
  await f.module.budget.reserveVerification(lease, r);
  await f.module.budget.recordAuthentication(lease, true);
  await f.module.finishAttempt(a, 'success');
  await f.close();
  const db = openLmdb<string, string>({ path: f.directory, encoding: 'string' });
  try {
    db.transactionSync(() => {
      const entry = [...db.getRange({ start: 'attempt:', end: 'attempt;' })][0]!;
      const invalid = JSON.stringify({ ...JSON.parse(entry.value), units: -1 });
      // This is corrupt state, never represented as a legitimate high-budget fixture.
      const meta = JSON.parse(db.get('meta')!);
      db.putSync(entry.key, invalid);
      db.putSync('meta', JSON.stringify({ ...meta, bytes: meta.bytes + Buffer.byteLength(invalid) - Buffer.byteLength(entry.value) }));
    });
    await db.flushed;
  } finally { await db.close(); }
  await expect(f.reopen()).rejects.toMatchObject({ code: 'storage-failed' });
});

it('reentrant resolver call aborts BOTH the nested and enclosing transaction', async () => {
  const f = await create();
  let hookCalls = 0;
  let nested: Promise<{ success: boolean; code: string }> | undefined;
  f.setAttemptHook((lease, operation) => {
    hookCalls++;
    nested = f.module.beginAttempt(lease, operation).then(
      () => ({ success: true, code: '' }), error => ({ success: false, code: error.code }));
  });
  const outer = await f.begin('verify-control', true).then(
    () => ({ success: true, code: '' }), error => ({ success: false, code: error.code }));
  expect(hookCalls).toBe(1);
  expect(await nested).toEqual({ success: false, code: 'conflict' });
  expect(outer).toEqual({ success: false, code: 'conflict' });
  await f.close();
  const snapshot = await rows(f.directory);
  expect([...snapshot.keys()].filter(k => k.startsWith('attempt:'))).toHaveLength(0);
  expect([...snapshot.keys()].filter(k => k.startsWith('security:'))).toHaveLength(0);
});
