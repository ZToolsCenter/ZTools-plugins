import { open as openLmdb } from 'lmdb';
import { afterEach, describe, expect, it } from 'vitest';
import { readFile, writeFile, lstat } from 'node:fs/promises';
import { openVerificationBudget } from '../../src/g3-verification-budget/index';
import { MAX_COUNT } from '../../src/g3-verification-budget/records';
import { fixture, request, rows, epochRowKey, securityRowKey, type Fixture } from './fixture';

const parent = new URL('../../../../artifacts/pasteboardpro/clipboard-format-g0/v037-budget-tests/runtime/', import.meta.url).pathname;
const opened: Fixture[] = [];
async function create() { const f = await fixture(parent); opened.push(f); return f; }
afterEach(async () => { await Promise.all(opened.splice(0).map(f => f.close())); });
async function mutate(f: Fixture, change: (db: ReturnType<typeof openLmdb<string, string>>) => void) {
  await f.close();
  const db = openLmdb<string, string>({ path: f.directory, encoding: 'string' });
  try { db.transactionSync(() => change(db)); await db.flushed; } finally { await db.close(); }
}

describe('ledger integrity and real capacity, not fabricated lifetime counters', () => {
  it('isolates 2^32 arithmetic from LMDB consistency evidence', () => {
    // No database mutation: actual row/tombstone capacity is reached much sooner.
    expect(MAX_COUNT).toBe(2 ** 32);
    expect(MAX_COUNT - 1 < MAX_COUNT).toBe(true);
    expect(MAX_COUNT - 1 + 1).toBe(MAX_COUNT);
    expect(MAX_COUNT < MAX_COUNT).toBe(false);
  });
  it('openExisting missing environment is rejected without creating a new empty directory', async () => {
    const f = await create(), missing = `${f.directory}-missing`;
    const permissiveInit = { ...f.guard, assertInit() {} };
    await expect(openVerificationBudget({ ...f.options, mode: 'openExisting', directory: missing,
      owner: { withGuard: action => action(permissiveInit) } })).rejects.toMatchObject({ code: 'storage-failed' });
    await expect(lstat(missing)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('same on-disk environment cannot be reopened as a different store identity', async () => {
    const f = await create(); await f.close();
    const permissiveInit = { ...f.guard, assertInit() {} };
    await expect(openVerificationBudget({ ...f.options, mode: 'openExisting', expectedStoreId: 'PUBLIC-other-store',
      owner: { withGuard: action => action(permissiveInit) } })).rejects.toMatchObject({ code: 'storage-failed' });
  });
  it('unknown metadata version cannot be treated as a new store', async () => {
    const f = await create();
    await mutate(f, db => { const m = JSON.parse(db.get('meta')!); db.putSync('meta', JSON.stringify({ ...m, version: 999 })); });
    await expect(f.reopen()).rejects.toMatchObject({ code: 'storage-failed' });
  });
  it('corrupt persisted record is rejected rather than silently dropping the charge', async () => {
    const f = await create(); await f.begin('verify-control', true);
    const r = request(), lease = f.unit(r); await f.module.budget.reserveVerification(lease, r);
    await mutate(f, db => db.putSync(epochRowKey(), '{broken-public-test-record'));
    await expect(f.reopen()).rejects.toMatchObject({ code: 'storage-failed' });
  });
  it('used inconsistent with retained reservation count is corruption, not valid high-budget proof', async () => {
    const f = await create(); await f.begin('verify-control', true);
    const r = request(), lease = f.unit(r); await f.module.budget.reserveVerification(lease, r);
    await mutate(f, db => { const e = JSON.parse(db.get(epochRowKey())!); db.putSync(epochRowKey(), JSON.stringify({ ...e, used: MAX_COUNT - 1 })); });
    await expect(f.reopen()).rejects.toMatchObject({ code: 'storage-failed' });
  });
  it('64 actual simultaneous pending units are allowed, 65th rejected atomically', async () => {
    const f = await create();
    for (let i = 0; i < 64; i++) {
      await f.begin('verify-control', true, { deviceId: `PUBLIC-device-${i}` });
      const r = request(), lease = f.unit(r);
      await f.module.budget.reserveVerification(lease, r);
    }
    await expect(f.begin('verify-control', true, { deviceId: 'PUBLIC-device-64' }))
      .rejects.toMatchObject({ code: 'capacity' });
    await f.close();
    const snapshot = await rows(f.directory);
    expect(snapshot.get('meta')).toMatchObject({ pending: 64, activeAttempts: 64 });
    expect([...snapshot.keys()].filter(k => k.startsWith('reservation:'))).toHaveLength(64);
  }, 30000);
  it('reopen preserves token-hash tombstones and does not persist raw bearer tokens', async () => {
    const f = await create(), a = await f.begin('verify-control', true);
    const r = request(), lease = f.unit(r); await f.module.budget.reserveVerification(lease, r);
    await f.module.budget.recordAuthentication(lease, false); await f.module.finishAttempt(a, 'failure');
    await f.reopen(); await f.close();
    const snapshot = await rows(f.directory);
    expect([...snapshot.keys()].filter(k => k.startsWith('reservation:'))).toHaveLength(1);
    expect(JSON.stringify([...snapshot])).not.toContain(lease.token);
    expect(snapshot.get(securityRowKey())).toMatchObject({ streak: 1, locked: false });
  });
  it('owner failure after callback commit poisons module and pending recovery never refunds', async () => {
    const f = await create(); await f.begin('verify-control', true);
    const r = request(), lease = f.unit(r); f.setPostActionFailure(true);
    await expect(f.module.budget.reserveVerification(lease, r)).rejects.toMatchObject({ code: 'unavailable', message: 'unavailable' });
    f.setPostActionFailure(false);
    await expect(f.module.budget.recordAuthentication(lease, true)).rejects.toMatchObject({ code: 'unavailable' });
    await f.reopen();
    await expect(f.begin()).rejects.toMatchObject({ code: 'locked' });
    await f.close();
    const snapshot = await rows(f.directory);
    expect(snapshot.get(epochRowKey())).toMatchObject({ used: 1 });
    expect(snapshot.get(securityRowKey())).toMatchObject({ locked: true });
  });
  it('unknown initialization confirmation retains intent and openExisting stays blocked', async () => {
    const f = await create(); await f.close();
    // Public synthetic metadata, no real credential or key contents.
    await writeFile(`${f.directory}/.g3-init`, JSON.stringify({ publicTestUnknownConfirmation: true }), { mode: 0o600 });
    await expect(f.reopen()).rejects.toMatchObject({ code: 'unavailable' });
    expect(await readFile(`${f.directory}/.g3-init`, 'utf8')).toContain('publicTestUnknownConfirmation');
  });
});
