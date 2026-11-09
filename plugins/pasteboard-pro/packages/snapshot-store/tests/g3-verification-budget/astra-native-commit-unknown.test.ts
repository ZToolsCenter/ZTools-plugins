import { expect, it, vi } from 'vitest';

const boundary = vi.hoisted(() => ({ armed: false, committedThrows: 0,
  metaImmediatelyAfterRealCommit: null as Record<string, unknown> | null }));
vi.mock('lmdb', async importOriginal => {
  const real = await importOriginal<typeof import('lmdb')>();
  return { ...real, open(...args: Parameters<typeof real.open>) {
    const db: ReturnType<typeof real.open> = Reflect.apply(real.open, real, args);
    // TEST ONLY boundary: invoke the REAL native transactionSync first, then
    // emulate a native post-commit return/reset failure. This is not a fake DB.
    return new Proxy(db, { get(target, name) {
      const original = Reflect.get(target, name, target);
      if (name === 'transactionSync') return (...transactionArgs: unknown[]) => {
        const output = Reflect.apply(original, target, transactionArgs);
        if (boundary.armed) {
          boundary.armed = false;
          boundary.committedThrows++;
          const raw = target.get('meta');
          if (typeof raw === 'string') boundary.metaImmediatelyAfterRealCommit = JSON.parse(raw);
          throw new Error('PUBLIC-native-post-commit-return-failure');
        }
        return output;
      };
      return typeof original === 'function' ? original.bind(target) : original;
    } });
  } };
});
import { fixture, request, rows, epochRowKey, securityRowKey } from './fixture';

const parent = new URL('../../../../artifacts/pasteboardpro/clipboard-format-g0/v037-budget-tests/runtime/', import.meta.url).pathname;
it('Astra native post-commit throw poisons already queued B and subsequent C without refund/second commit', async () => {
  const f = await fixture(parent);
  try {
    await f.begin('verify-control', true);
    const r = request(), lease = f.unit(r);
    boundary.armed = true;
    const resultA = f.module.budget.reserveVerification(lease, r).then(
      () => ({ success: true, code: '' }), (error: any) => ({ success: false, code: error.code }));
    // B is queued before A's native return fault is observed by its Promise.
    const resultB = f.begin('verify-control', true, { deviceId: 'PUBLIC-native-device-B' }).then(
      () => ({ success: true, code: '' }), (error: any) => ({ success: false, code: error.code }));
    const a = await resultA, b = await resultB;
    const c = await f.begin('verify-control', true, { deviceId: 'PUBLIC-native-device-C' }).then(
      () => ({ success: true, code: '' }), (error: any) => ({ success: false, code: error.code }));
    await f.close();
    const snapshot = await rows(f.directory);
    const attempts = [...snapshot.values()].filter(row => row.state === 'active');
    expect(boundary.committedThrows).toBe(1);
    expect(boundary.metaImmediatelyAfterRealCommit).toMatchObject({ activeAttempts: 1, pending: 1 });
    expect(snapshot.get(epochRowKey())).toMatchObject({ used: 1 });
    expect([...snapshot.values()].some(row => row.state === 'pending')).toBe(true);
    expect(attempts.some(row => (row.claim as Record<string, unknown>).deviceId === 'PUBLIC-device')).toBe(true);
    expect(a).toMatchObject({ success: false, code: expect.stringMatching(/^(storage-failed|unavailable)$/) });
    expect({ b, c }).toEqual({ b: { success: false, code: 'unavailable' }, c: { success: false, code: 'unavailable' } });
    expect(attempts).toHaveLength(1);
    await f.reopen();
    await expect(f.begin('recover-package', true)).rejects.toMatchObject({ code: 'locked' });
    await f.close();
    const recovered = await rows(f.directory);
    expect(recovered.get(epochRowKey())).toMatchObject({ used: 1 });
    expect(recovered.get(securityRowKey())).toMatchObject({ locked: true, pending: null });
    expect([...recovered.values()].some(row => row.state === 'unknown')).toBe(true);
  } finally { boundary.armed = false; await f.close(); }
});
