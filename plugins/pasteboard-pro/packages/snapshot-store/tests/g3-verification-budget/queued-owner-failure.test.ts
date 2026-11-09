import { expect, it } from 'vitest';
import { fixture, request, rows, epochRowKey } from './fixture';

const parent = new URL('../../../../artifacts/pasteboardpro/clipboard-format-g0/v037-budget-tests/runtime/', import.meta.url).pathname;
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  return { promise, resolve };
}
it('queued B never commits after A poisons the module at owner tail', async () => {
  const f = await fixture(parent);
  const entered = deferred(), release = deferred();
  try {
    await f.begin('verify-control', true);
    const r = request(), a = f.unit(r);
    let first = true;
    f.setPostActionHook(async () => {
      if (!first) return;
      first = false;
      entered.resolve();
      await release.promise;
      throw new Error('PUBLIC-post-commit-owner-loss');
    });
    // Both operations must be accepted into the queue BEFORE the poison is known.
    const resultA = f.module.budget.reserveVerification(a, r).then(
      () => ({ success: true, code: '' }), (error: any) => ({ success: false, code: error.code }));
    await entered.promise;
    const resultB = f.begin('verify-control', true, { deviceId: 'PUBLIC-independent-device-B' }).then(
      () => ({ success: true, code: '' }), (error: any) => ({ success: false, code: error.code }));
    release.resolve();
    expect(await resultA).toEqual({ success: false, code: 'unavailable' });
    expect(await resultB).toEqual({ success: false, code: 'unavailable' });
    await f.close();
    const snapshot = await rows(f.directory);
    expect(snapshot.get(epochRowKey())).toMatchObject({ used: 1 });
    expect([...snapshot.keys()].filter(k => k.startsWith('attempt:'))).toHaveLength(1);
    expect([...snapshot.keys()].filter(k => k.startsWith('security:'))).toHaveLength(1);
  } finally { release.resolve(); f.setPostActionHook(undefined); await f.close(); }
});

it('independent external client B queues during healthy A guard-tail wait and both succeed', async () => {
  const f = await fixture(parent);
  const entered = deferred(), release = deferred();
  try {
    await f.begin('verify-control', true);
    const r = request(), a = f.unit(r);
    let first = true;
    f.setPostActionHook(async () => {
      if (!first) return;
      first = false;
      entered.resolve();
      await release.promise;
    });
    const resultA = f.module.budget.reserveVerification(a, r);
    await entered.promise;
    // This continuation belongs to the original EXTERNAL test client. It does
    // not call B from an owner callback or resolver execution context.
    const resultB = f.begin('verify-control', true, { deviceId: 'PUBLIC-healthy-independent-B' });
    release.resolve();
    await expect(resultA).resolves.toBeUndefined();
    await expect(resultB).resolves.toMatchObject({ mode: 'registered' });
    await f.close();
    const snapshot = await rows(f.directory);
    expect(snapshot.get(epochRowKey())).toMatchObject({ used: 1 });
    expect([...snapshot.keys()].filter(k => k.startsWith('attempt:'))).toHaveLength(2);
    expect([...snapshot.keys()].filter(k => k.startsWith('security:'))).toHaveLength(2);
  } finally { release.resolve(); f.setPostActionHook(undefined); await f.close(); }
});
