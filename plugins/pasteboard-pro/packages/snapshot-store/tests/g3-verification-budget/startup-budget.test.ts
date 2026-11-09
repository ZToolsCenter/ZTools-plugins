import { afterEach, expect, it, vi } from 'vitest';

// Mock ONLY the product's module import, never global performance or Vitest's
// timers. Every DB row/transaction below still uses the actual LMDB dependency.
const clock = vi.hoisted(() => ({ now: 0, mode: 'none', scans: [] as string[], afterAudit: false,
  auditRows: 0, nativeOpens: 0, committedProof: null as Record<string, unknown> | null,
  writerProof: null as Record<string, unknown> | null }));
vi.mock('node:perf_hooks', async importOriginal => {
  const real = await importOriginal<typeof import('node:perf_hooks')>();
  return { ...real, performance: new Proxy(real.performance, { get(target, key) {
    if (key === 'now') return () => clock.now;
    const value = Reflect.get(target, key, target);
    return typeof value === 'function' ? value.bind(target) : value;
  } }) };
});
vi.mock('lmdb', async importOriginal => {
  const real = await importOriginal<typeof import('lmdb')>();
  return { ...real, open(...args: Parameters<typeof real.open>) {
    const db: ReturnType<typeof real.open> = Reflect.apply(real.open, real, args);
    clock.nativeOpens++;
    if (clock.mode === 'after-native-open') clock.now = 30000;
    const proof = () => {
      const m = JSON.parse(String(db.get('meta')));
      const r = [...db.getRange({ start: 'reservation:', end: 'reservation;' })][0];
      return { pending: m.pending, activeAttempts: m.activeAttempts,
        reservationState: r ? JSON.parse(String(r.value)).state : null };
    };
    return new Proxy(db, { get(target, name) {
      const original = Reflect.get(target, name, target);
      if (name === 'getRange') return (...rangeArgs: unknown[]) => {
        const range = Reflect.apply(original, target, rangeArgs) as Iterable<unknown>;
        const options = rangeArgs[0] as { start?: string } | undefined;
        const prefix = options?.start ?? 'audit';
        return (function* () {
          let seen = false;
          for (const value of range) {
            if (!seen) {
              seen = true;
              if (clock.mode === 'across-recovery') {
                clock.scans.push(prefix);
                if (prefix === 'attempt:') clock.now = 20000;
                if (prefix === 'reservation:') { clock.writerProof = proof(); clock.now = 30000; }
              }
            }
            if (prefix === 'audit') clock.auditRows++;
            yield value;
          }
          if (prefix === 'audit') {
            clock.afterAudit = true;
            if (clock.mode === 'across-recovery') clock.now = 10000;
          }
        })();
      };
      if (name === 'transactionSync') return (...txnArgs: unknown[]) => {
        const result = Reflect.apply(original, target, txnArgs);
        if (clock.mode === 'after-recovery-commit') {
          clock.committedProof = proof();
          clock.now = 30000;
        }
        return result;
      };
      return typeof original === 'function' ? original.bind(target) : original;
    } });
  } };
});
import { open as openLmdb } from 'lmdb';
import { StartupBudget } from '../../src/g3-verification-budget/startup-budget';
import { auditStore } from '../../src/g3-verification-budget/audit';
import { openVerificationBudget } from '../../src/g3-verification-budget/index';
import type { VerificationBudget } from '../../src/g3-verification-budget/types';
import { fixture, request, rows, scope, epochRowKey, securityRowKey, type Fixture } from './fixture';

const artifactRoot = new URL('../../../../artifacts/pasteboardpro/clipboard-format-g0/v038-budget-tests/runtime/', import.meta.url).pathname;
const fixtures: Fixture[] = [], modules: VerificationBudget[] = [];
function resetClock() {
  clock.now = 0; clock.mode = 'none'; clock.scans = []; clock.afterAudit = false;
  clock.auditRows = 0; clock.nativeOpens = 0; clock.committedProof = null; clock.writerProof = null;
}
afterEach(async () => {
  await Promise.all(modules.splice(0).map(m => m.close()));
  await Promise.all(fixtures.splice(0).map(f => f.close()));
  vi.restoreAllMocks(); resetClock();
});
async function fresh() { const f = await fixture(artifactRoot); fixtures.push(f); return f; }
async function pending() {
  const f = await fresh(); await f.begin('verify-control', true);
  const r = request(), lease = f.unit(r); await f.module.budget.reserveVerification(lease, r);
  await f.close(); resetClock(); return f;
}
async function attemptOpen(f: Fixture) {
  return openVerificationBudget({ ...f.options, mode: 'openExisting' }).then(
    module => { modules.push(module); return { ok: true, code: '' }; },
    error => ({ ok: false, code: error.code }));
}
it('internal monotonic startup budget accepts 0/29999 and rejects exact 30000', () => {
  let now = 0;
  const budget = new StartupBudget(() => now);
  expect(() => budget.check()).not.toThrow();
  now = 29999; expect(() => budget.check()).not.toThrow();
  now = 30000; expect(() => budget.check()).toThrowError(expect.objectContaining({ code: 'capacity' }));
});
it('wall Date changes do not alter a monotonic startup deadline', () => {
  clock.now = 0; const budget = new StartupBudget();
  const date = vi.spyOn(Date, 'now');
  try {
    date.mockReturnValue(-1_000_000_000); clock.now = 29999; expect(() => budget.check()).not.toThrow();
    date.mockReturnValue(9_000_000_000_000); expect(() => budget.check()).not.toThrow();
    clock.now = 30000; expect(() => budget.check()).toThrowError(expect.objectContaining({ code: 'capacity' }));
  } finally { date.mockRestore(); }
});
for (const invalid of [NaN, Infinity, -Infinity, -1]) {
  it(`invalid monotonic clock ${String(invalid)} fails closed`, () => {
    expect(() => new StartupBudget(() => invalid)).toThrowError(expect.objectContaining({ code: 'unavailable' }));
    let value = 0; const budget = new StartupBudget(() => value);
    value = invalid;
    expect(() => budget.check()).toThrowError(expect.objectContaining({ code: 'unavailable' }));
  });
}
it('clock exceptions and backwards movement fail closed', () => {
  expect(() => new StartupBudget(() => { throw new Error('PUBLIC-clock-fault'); }))
    .toThrowError(expect.objectContaining({ code: 'unavailable' }));
  let broken = false;
  const throwsLater = new StartupBudget(() => { if (broken) throw new Error('PUBLIC-later-clock-fault'); return 0; });
  broken = true;
  expect(() => throwsLater.check()).toThrowError(expect.objectContaining({ code: 'unavailable' }));
  let now = 10; const budget = new StartupBudget(() => now);
  now = 9; expect(() => budget.check()).toThrowError(expect.objectContaining({ code: 'unavailable' }));
});
it('run checks after await and never returns a result completed at the deadline', async () => {
  let now = 0, actions = 0;
  const budget = new StartupBudget(() => now);
  await expect(budget.run(async () => { actions++; await Promise.resolve(); now = 30000; return 'PUBLIC-result'; }))
    .rejects.toMatchObject({ code: 'capacity' });
  expect(actions).toBe(1);
});
it('later audit cross-reference loops consume the SAME budget after a complete real row scan', async () => {
  const f = await pending();
  const db = openLmdb<string, string>({ path: f.directory, readOnly: true, encoding: 'string' });
  let crossReferenceChecks = 0;
  const budget = new StartupBudget(() => clock.afterAudit ? 29997 + (++crossReferenceChecks) : clock.now);
  clock.now = 20000;
  try {
    expect(() => auditStore(db, scope.storeId, 'PUBLIC-install', budget))
      .toThrowError(expect.objectContaining({ code: 'capacity' }));
    expect(clock.afterAudit).toBe(true);
    expect(clock.auditRows).toBeGreaterThanOrEqual(6); // real meta + five record families
    expect(crossReferenceChecks).toBe(3); // scan-end, epoch reference, reservation-count reference
  } finally { await db.close(); }
});
it('factory shares one deadline across audit and BOTH recovery scans, atomically aborting recovery writes', async () => {
  const f = await pending(); clock.mode = 'across-recovery';
  const result = await attemptOpen(f);
  expect(result).toEqual({ ok: false, code: 'capacity' });
  expect(clock.scans).toEqual(['audit', 'attempt:', 'reservation:']);
  // First recovery scan REALLY wrote unknown and cleared pending inside writer.
  expect(clock.writerProof).toEqual({ pending: 0, activeAttempts: 0, reservationState: 'unknown' });
  clock.mode = 'none';
  const snapshot = await rows(f.directory);
  expect(snapshot.get(epochRowKey())).toMatchObject({ used: 1 });
  expect(snapshot.get('meta')).toMatchObject({ pending: 1, activeAttempts: 1 });
  expect(snapshot.get(securityRowKey())).toMatchObject({ locked: false, pending: expect.any(String) });
  expect([...snapshot.values()].some(row => row.state === 'unknown')).toBe(false);
  expect([...snapshot.values()].some(row => row.state === 'pending')).toBe(true);
});
it('deadline reached after real recovery COMMIT closes output without pretending rollback/refund', async () => {
  const f = await pending(); clock.mode = 'after-recovery-commit';
  expect(await attemptOpen(f)).toEqual({ ok: false, code: 'capacity' });
  expect(clock.committedProof).toEqual({ pending: 0, activeAttempts: 0, reservationState: 'unknown' });
  clock.mode = 'none';
  const snapshot = await rows(f.directory);
  expect(snapshot.get(epochRowKey())).toMatchObject({ used: 1 });
  expect(snapshot.get('meta')).toMatchObject({ pending: 0, activeAttempts: 0 });
  expect(snapshot.get(securityRowKey())).toMatchObject({ locked: true, pending: null });
  expect([...snapshot.values()].filter(row => row.state === 'unknown')).toHaveLength(2);
});
it('factory checks deadline after awaiting the trusted owner boundary', async () => {
  const f = await pending(); let ownerTailCalls = 0;
  f.setPostActionHook(async () => { ownerTailCalls++; clock.now = 30000; });
  expect(await attemptOpen(f)).toEqual({ ok: false, code: 'capacity' });
  expect(ownerTailCalls).toBe(1);
  f.setPostActionHook(undefined); resetClock();
  const snapshot = await rows(f.directory);
  expect(snapshot.get('meta')).toMatchObject({ pending: 1, activeAttempts: 1 });
});
it('factory checks immediately after real native open and releases the failed handle', async () => {
  const f = await pending(); clock.mode = 'after-native-open';
  expect(await attemptOpen(f)).toEqual({ ok: false, code: 'capacity' });
  expect(clock.nativeOpens).toBe(1);
  resetClock();
  // A clean retry can acquire the same environment; no failed-open handle leak.
  expect(await attemptOpen(f)).toEqual({ ok: true, code: '' });
});
it('startup deadline never becomes a 30-second Module lifetime limit after successful open', async () => {
  const f = await fresh(); clock.now = 60000;
  const a = await f.begin('verify-control', true), r = request(), lease = f.unit(r);
  await f.module.budget.reserveVerification(lease, r);
  await f.module.budget.recordAuthentication(lease, false);
  await f.module.finishAttempt(a, 'failure');
  await f.close();
  expect((await rows(f.directory)).get(epochRowKey())).toMatchObject({ used: 1 });
});
