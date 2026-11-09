import { afterEach, describe, expect, it } from 'vitest';
import { openVerificationBudget } from '../../src/g3-verification-budget/index';
import { fixture, rows, request, scope, securityRowKey, epochRowKey, type Fixture } from './fixture';

const parent = new URL('../../../../artifacts/pasteboardpro/clipboard-format-g0/v037-budget-tests/runtime/', import.meta.url).pathname;
const opened: Fixture[] = [];
async function create() { const f = await fixture(parent); opened.push(f); return f; }
afterEach(async () => { await Promise.all(opened.splice(0).map(f => f.close())); });
async function reserve(f: Fixture, authenticated: boolean, epoch = '0') {
  const r = request('control-signature', epoch), lease = f.unit(r);
  await f.module.budget.reserveVerification(lease, r);
  await f.module.budget.recordAuthentication({ ...lease }, authenticated);
  return lease;
}
async function prepare(f: Fixture) {
  const lease = await f.begin('verify-control', true);
  await reserve(f, true);
  await f.module.promotePreparedRoot(lease, { publicFixtureCompleteChain: true });
  await f.module.finishAttempt(lease, 'success');
}
async function state(f: Fixture) { await f.close(); return rows(f.directory); }

describe('real LMDB verification budget; all owner/resolver authority is a TEST fixture', () => {
  it('requires explicit owner/resolver and never creates an openExisting path', async () => {
    const f = await create();
    await expect(openVerificationBudget({ mode: 'openExisting', directory: `${f.directory}-missing`,
      expectedStoreId: scope.storeId, expectedInstallId: 'PUBLIC-install', owner: f.owner, resolver: f.resolver }))
      .rejects.toMatchObject({ code: expect.any(String) });
    await expect(openVerificationBudget({ mode: 'create' } as never)).rejects.toMatchObject({ code: 'invalid-input' });
  });
  it('refuses to overwrite an existing environment or open the active one twice', async () => {
    const f = await create();
    await expect(openVerificationBudget({ mode: 'create', directory: f.directory,
      expectedStoreId: scope.storeId, expectedInstallId: 'PUBLIC-install', owner: f.owner, resolver: f.resolver }))
      .rejects.toMatchObject({ code: 'conflict' });
  });
  it('seal counter and attempt registration are typed unavailable, never fake success', async () => {
    const f = await create(), lease = await f.begin('seal-object');
    await expect(f.module.budget.reserveSeal(lease, request())).rejects.toMatchObject({ code: 'unavailable' });
    await expect(f.module.budget.registerAttempt(lease, '0', 'PUBLIC-attempt')).rejects.toMatchObject({ code: 'unavailable' });
  });
  it('formal verification cannot self-register an unbound root', async () => {
    const f = await create(); await f.begin();
    const r = request(), lease = f.unit(r);
    await expect(f.module.budget.reserveVerification(lease, r)).rejects.toMatchObject({ code: 'conflict' });
  });
  it('preparation then formal verification share one epoch row and used counter', async () => {
    const f = await create(); await prepare(f);
    const a = await f.begin(); await reserve(f, true); await f.module.finishAttempt(a, 'success');
    const snapshot = await state(f);
    expect(snapshot.get(epochRowKey())).toMatchObject({ used: 2, rootId: expect.any(String) });
    expect([...snapshot.keys()].filter(k => k.startsWith('epoch:'))).toHaveLength(1);
  });
  it('same security scope permits only one complete attempt across formal/preparation', async () => {
    const f = await create(); await f.begin('verify-control', true);
    await expect(f.begin('recover-package', true)).rejects.toMatchObject({ code: 'conflict' });
    await expect(f.begin('verify-control', false)).rejects.toMatchObject({ code: 'conflict' });
  });
  it('one pending verification prevents a second unit from reserving', async () => {
    const f = await create(); await f.begin('verify-control', true);
    const r = request(), one = f.unit(r), two = f.unit(r);
    await f.module.budget.reserveVerification(one, r);
    await expect(f.module.budget.reserveVerification(two, r)).rejects.toMatchObject({ code: 'conflict' });
  });
  it('matching completion is idempotent by token VALUE; token reuse cannot reserve twice', async () => {
    const f = await create(); const a = await f.begin('verify-control', true);
    const r = request(), unit = await reserve(f, false);
    await f.module.budget.recordAuthentication({ token: unit.token, mode: unit.mode }, false);
    await expect(f.module.budget.reserveVerification({ ...unit }, r)).rejects.toMatchObject({ code: 'conflict' });
    await f.module.finishAttempt(a, 'failure');
    const snapshot = await state(f);
    expect(snapshot.get(epochRowKey())).toMatchObject({ used: 1 });
    expect(snapshot.get(securityRowKey())).toMatchObject({ streak: 1, locked: false });
  });
  it('opposite completion conflicts AND locks without double charging or replacing fact', async () => {
    const f = await create(); await f.begin('verify-control', true);
    const unit = await reserve(f, true);
    await expect(f.module.budget.recordAuthentication(unit, false)).rejects.toMatchObject({ code: 'conflict' });
    const snapshot = await state(f);
    expect(snapshot.get(epochRowKey())).toMatchObject({ used: 1 });
    expect(snapshot.get(securityRowKey())).toMatchObject({ locked: true });
    expect([...snapshot.values()].filter(v => v.state === 'success')).toHaveLength(1);
  });
  it('unit success never clears streak; only complete authenticated finish does', async () => {
    const f = await create(); await prepare(f);
    const failed = await f.begin(); await reserve(f, false); await f.module.finishAttempt(failed, 'failure');
    const good = await f.begin(); await reserve(f, true);
    await f.close();
    expect((await rows(f.directory)).get(securityRowKey())).toMatchObject({ streak: 1 });
    // Closing/reopening an active operation is unknown, not a successful finish.
    await f.reopen();
    await expect(f.module.finishAttempt(good, 'success')).rejects.toMatchObject({ code: expect.any(String) });
    expect((await state(f)).get(securityRowKey())).toMatchObject({ locked: true, streak: 1 });
  });
  it('complete authenticated success resets streak, quarantine cannot', async () => {
    const f = await create(); await prepare(f);
    let a = await f.begin(); await reserve(f, false); await f.module.finishAttempt(a, 'failure');
    a = await f.begin(); await reserve(f, true); await f.module.finishAttempt(a, 'quarantine');
    a = await f.begin(); await reserve(f, true); await f.module.finishAttempt(a, 'success');
    expect((await state(f)).get(securityRowKey())).toMatchObject({ streak: 0, locked: false });
  });
  it('empty or failed attempt cannot be called authenticated success', async () => {
    const f = await create(); const a = await f.begin('verify-control', true);
    await expect(f.module.finishAttempt(a, 'success')).rejects.toMatchObject({ code: 'unauthorized' });
    await reserve(f, false);
    await expect(f.module.finishAttempt(a, 'success')).rejects.toMatchObject({ code: 'unauthorized' });
  });
  it('revocation after reservation records actual success but locks the session', async () => {
    const f = await create(); await f.begin('verify-control', true);
    const r = request(), unit = f.unit(r);
    await f.module.budget.reserveVerification(unit, r); f.revoke(unit.token);
    await f.module.budget.recordAuthentication(unit, true);
    const snapshot = await state(f);
    expect(snapshot.get(securityRowKey())).toMatchObject({ locked: true });
    expect(snapshot.get(epochRowKey())).toMatchObject({ used: 1 });
    expect([...snapshot.values()].some(v => v.state === 'success')).toBe(true);
  });
  it('wrong operation/hash/unit/scope cannot reserve against a trusted token claim', async () => {
    const f = await create(); await f.begin('verify-control', true);
    const r = request(), lease = f.unit(r);
    for (const changed of [ { ...r, bindingSha256: 'b'.repeat(64) },
      { ...r, operation: 'open-object' as const }, { ...r, verificationUnit: 'publication-mac' as const },
      { ...r, scope: { ...r.scope, keyEpoch: '1' } } ]) {
      await expect(f.module.budget.reserveVerification(lease, changed)).rejects.toMatchObject({ code: 'unauthorized' });
    }
    expect((await state(f)).get(epochRowKey())).toBeUndefined();
  });
  it('restart turns pending into unknown, retains charge, and locks across epoch changes', async () => {
    const f = await create(); await f.begin('verify-control', true);
    const r = request(), lease = f.unit(r); await f.module.budget.reserveVerification(lease, r);
    await f.reopen();
    await expect(f.begin('recover-package', true)).rejects.toMatchObject({ code: 'locked' });
    const snapshot = await state(f);
    expect(snapshot.get(epochRowKey())).toMatchObject({ used: 1 });
    expect(snapshot.get(securityRowKey())).toMatchObject({ locked: true, pending: null });
    expect([...snapshot.values()].some(v => v.state === 'unknown')).toBe(true);
  });
  it('explicit fixture-admin unlock increments generation but retains used and dedup history', async () => {
    const f = await create(); await f.begin('verify-control', true);
    const r = request(), old = f.unit(r); await f.module.budget.reserveVerification(old, r);
    await f.reopen();
    await f.module.unlockSession({ token: 'PUBLIC-admin', mode: 'registered' }, scope);
    f.nextUnlockGeneration();
    const a = await f.begin('verify-control', true); await reserve(f, true); await f.module.finishAttempt(a, 'success');
    await expect(f.module.budget.recordAuthentication(old, true)).rejects.toMatchObject({ code: 'conflict' });
    const snapshot = await state(f);
    expect(snapshot.get(epochRowKey())).toMatchObject({ used: 2 });
    expect(snapshot.get(securityRowKey())).toMatchObject({ unlock: '1', locked: false, streak: 0 });
  });
  it('losing explicit owner authority fails closed, never returns a reservation', async () => {
    const f = await create(); await f.begin('verify-control', true); const r = request(), lease = f.unit(r);
    f.setOwner(false);
    await expect(f.module.budget.reserveVerification(lease, r)).rejects.toMatchObject({ code: 'unavailable' });
    f.setOwner(true);
    expect((await state(f)).get(epochRowKey())).toBeUndefined();
  });
});
