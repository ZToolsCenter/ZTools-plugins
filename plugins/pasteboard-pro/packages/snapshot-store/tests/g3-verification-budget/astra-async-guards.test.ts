import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { openVerificationBudget } from '../../src/g3-verification-budget/index';
import type { AttemptClaim, BudgetGuard, VerificationBudget } from '../../src/g3-verification-budget/types';
import { fixture, rows, scope, type Fixture } from './fixture';

const parent = new URL('../../../../artifacts/pasteboardpro/clipboard-format-g0/v037-budget-tests/runtime/', import.meta.url).pathname;
const fixtures: Fixture[] = [], modules: VerificationBudget[] = [];
afterEach(async () => {
  await Promise.all(modules.splice(0).map(m => m.close()));
  await Promise.all(fixtures.splice(0).map(f => f.close()));
});
function observedAsyncDenial() {
  let calls = 0, caught = 0;
  const promises: Promise<void>[] = [];
  // Return the SAME rejected Promise that has a handler; no unhandled-rejection
  // artefact can stand in for a module rejection. TS allows this for a void guard.
  function deny() {
    calls++;
    const promise = (async () => { throw new Error('PUBLIC-async-guard-denial'); })();
    promises.push(promise);
    void promise.catch(() => { caught++; });
    return promise;
  }
  return { deny, promises, get calls() { return calls; }, get caught() { return caught; } };
}
it('Astra async assertInit denial must fail create, never commit initialization metadata', async () => {
  const f = await fixture(parent); fixtures.push(f);
  const denial = observedAsyncDenial();
  const directory = path.join(path.dirname(f.directory), 'PUBLIC-async-init-ledger');
  const owner = { withGuard<T>(action: (guard: BudgetGuard) => Promise<T>) {
    return f.owner.withGuard(g => action({ ...g, assertInit: denial.deny }));
  } };
  let opened: VerificationBudget | undefined;
  const result = await openVerificationBudget({ ...f.options, directory, owner, mode: 'create' }).then(
    m => { opened = m; modules.push(m); return { success: true }; },
    error => ({ success: false, code: error.code }));
  const denied = await Promise.allSettled(denial.promises);
  expect(denial.calls).toBe(1);
  expect(denial.caught).toBe(1);
  expect(denied.map(p => p.status)).toEqual(['rejected']);
  if (opened) {
    await opened.close();
    // Effective RED must prove this ignored async denial reached a REAL LMDB meta.
    expect((await rows(directory)).get('meta')).toMatchObject({ storeId: scope.storeId, version: 1 });
  }
  expect(result).toMatchObject({ success: false, code: expect.any(String) });
});
it('Astra async assertActive denial must fail begin rather than commit an attempt', async () => {
  const f = await fixture(parent); fixtures.push(f); await f.close();
  const denial = observedAsyncDenial();
  const owner = { withGuard<T>(action: (guard: BudgetGuard) => Promise<T>) {
    return f.owner.withGuard(g => action({ ...g, assertActive: denial.deny }));
  } };
  const module = await openVerificationBudget({ ...f.options, owner, mode: 'openExisting' }); modules.push(module);
  const lease = { token: randomUUID(), mode: 'registered' as const };
  const claim: AttemptClaim = { ...scope, installId: 'PUBLIC-install', ownerGeneration: '0',
    securityGeneration: '0', unlockGeneration: '0', sessionId: 'PUBLIC-session', attemptId: randomUUID(), operation: 'verify-control' };
  f.claims.set(lease.token, claim);
  const result = await module.beginAttempt(lease, 'verify-control').then(
    () => ({ success: true }), error => ({ success: false, code: error.code }));
  const denied = await Promise.allSettled(denial.promises);
  expect(denial.calls).toBe(1);
  expect(denial.caught).toBe(1);
  expect(denied.map(p => p.status)).toEqual(['rejected']);
  await module.close();
  const persisted = [...await rows(f.directory)].filter(([key]) => key.startsWith('attempt:'));
  if (result.success) expect(persisted).toHaveLength(1); // proves actual bad acceptance
  expect(result).toMatchObject({ success: false, code: expect.any(String) });
  expect(persisted).toHaveLength(0);
});

it('Astra malformed thenable guard is rejected without reading or executing its then getter', async () => {
  const f = await fixture(parent); fixtures.push(f); await f.close();
  let guardCalls = 0, getterReads = 0, thenCalls = 0;
  const thenable = Object.defineProperty({}, 'then', { get() {
    getterReads++;
    return (resolve: (value: undefined) => void) => { thenCalls++; resolve(undefined); };
  } });
  const malformedGuard = () => { guardCalls++; return thenable; };
  const owner = { withGuard<T>(action: (guard: BudgetGuard) => Promise<T>) {
    return f.owner.withGuard(g => action({ ...g,
      assertActive: malformedGuard as unknown as BudgetGuard['assertActive'] }));
  } };
  const module = await openVerificationBudget({ ...f.options, owner, mode: 'openExisting' }); modules.push(module);
  const lease = { token: randomUUID(), mode: 'registered' as const };
  f.claims.set(lease.token, { ...scope, installId: 'PUBLIC-install', ownerGeneration: '0',
    securityGeneration: '0', unlockGeneration: '0', sessionId: 'PUBLIC-session',
    attemptId: randomUUID(), operation: 'verify-control' });
  const result = await module.beginAttempt(lease, 'verify-control').then(
    () => ({ success: true }), error => ({ success: false, code: error.code }));
  expect(guardCalls).toBe(1);
  expect(getterReads).toBe(0);
  expect(thenCalls).toBe(0);
  expect(result).toMatchObject({ success: false, code: expect.any(String) });
  await module.close();
  expect([...await rows(f.directory)].filter(([key]) => key.startsWith('attempt:'))).toHaveLength(0);
});
