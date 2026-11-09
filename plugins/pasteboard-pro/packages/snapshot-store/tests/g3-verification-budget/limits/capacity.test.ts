// Owner: v038_resource_limits (Sol). Seeded native states are not repeated API calls.
import path from 'node:path';
import { expect, it } from 'vitest';
import { attempt, attemptKey, epochKey, fingerprint, fixture, historyRows, metadata, rawRows, scope, seed } from './factory';
import { ownedCase, receipt } from './evidence';
async function rejectsUnchanged(directory: string, operation: () => Promise<unknown>) {
  const before = await rawRows(directory);
  await expect(operation()).rejects.toMatchObject({ code: 'capacity' });
  const after = await rawRows(directory);
  expect(fingerprint(after)).toBe(fingerprint(before));
  expect(after.get('meta')).toBe(before.get('meta'));
  return fingerprint(after);
}
it('100000 rows: seeded unlock history reaches 99999 then public unlock accepts 100000 and rejects 100001 atomically', async () => {
  const base = await ownedCase('rows-100000'), started = performance.now(), directory = path.join(base, 'ledger');
  const initial = await fixture(directory); await initial.close();
  const generated = historyRows(attempt(), ['0'], 99994);
  expect(generated.size).toBe(99999);
  const seedStarted = performance.now(); await seed(directory, generated); const seedMs = performance.now() - seedStarted;
  const seeded = await rawRows(directory);
  expect(JSON.parse(seeded.get('meta')!)).toEqual(metadata(generated));
  const openStarted = performance.now(), f = await fixture(directory, true), reopenMs = performance.now() - openStarted;
  let unchangedHash = '';
  try {
    await f.unlock(scope(), 99994);
    expect(JSON.parse((await rawRows(directory)).get('meta')!).rows).toBe(100000);
    unchangedHash = await rejectsUnchanged(directory, () => f.unlock(scope(), 99995));
  } finally { await f.close(); }
  const reopened = await fixture(directory, true); await reopened.close();
  const final = await rawRows(directory);
  expect(JSON.parse(final.get('meta')!).rows).toBe(100000);
  expect(fingerprint(final)).toBe(unchangedHash);
  await receipt(base, { kind: 'real LMDB seeded public-API-reachable unlock history', seededRows: 99999, seedMs, reopenMs,
    actualFinalRows: 100000, rejectedRequestedRows: 100001, unchangedHash, elapsedMs: performance.now() - started,
    distinction: '99994 unlock tombstones seeded; only the final boundary operations ran through public API' });
});
it('4096 security rows: completed multi-vault seeded histories avoid active64 and public begin rejects vault4097 atomically', async () => {
  const base = await ownedCase('security-4096'), started = performance.now(), directory = path.join(base, 'ledger');
  const initial = await fixture(directory); await initial.close();
  const generated = new Map<string, string>();
  for (let n = 0; n < 4095; n++) for (const entry of historyRows(attempt(scope(`PUBLIC-vault:${n}`), `PUBLIC-attempt:${n}`), ['0'])) generated.set(...entry);
  const seedStarted = performance.now(); await seed(directory, generated); const seedMs = performance.now() - seedStarted;
  const f = await fixture(directory, true); let unchangedHash = '';
  try {
    const accepted = await f.begin(attempt(scope('PUBLIC-vault:4095'), 'PUBLIC-attempt:4095'));
    await f.module.finishAttempt(accepted, 'quarantine');
    const m = JSON.parse((await rawRows(directory)).get('meta')!);
    expect(m.sessions).toBe(4096); expect(m.activeAttempts).toBe(0);
    unchangedHash = await rejectsUnchanged(directory, () => f.begin(attempt(scope('PUBLIC-vault:4096'), 'PUBLIC-attempt:4096')));
    await f.reopen();
  } finally { await f.close(); }
  expect(fingerprint(await rawRows(directory))).toBe(unchangedHash);
  await receipt(base, { kind: 'real LMDB seeded completed multi-vault histories', seededRows: generated.size, seedMs,
    actualSecurityRows: 4096, rejectedSecurityRows: 4097, unchangedHash, elapsedMs: performance.now() - started });
});
it('4096 epoch rows: fully linked reservations and preparation rows preserve actual used counts and reject epoch4097 atomically', async () => {
  const base = await ownedCase('epoch-4096'), started = performance.now(), directory = path.join(base, 'ledger');
  const initial = await fixture(directory); await initial.close();
  const generated = historyRows(attempt(), Array.from({ length: 4095 }, (_, n) => String(n)));
  const seedStarted = performance.now(); await seed(directory, generated); const seedMs = performance.now() - seedStarted;
  const f = await fixture(directory, true); let unchangedHash = '';
  try {
    await f.complete(attempt(scope(), 'PUBLIC-last-epoch'), ['4095']);
    const m = JSON.parse((await rawRows(directory)).get('meta')!); expect(m.scopes).toBe(4096);
    const next = attempt(scope(), 'PUBLIC-rejected-epoch'); const lease = await f.begin(next);
    unchangedHash = await rejectsUnchanged(directory, () => f.reserve(next, '4096'));
    expect((await rawRows(directory)).has(epochKey(scope(), '4096'))).toBe(false);
    await f.module.finishAttempt(lease, 'quarantine'); await f.reopen();
  } finally { await f.close(); }
  const final = await rawRows(directory);
  expect(JSON.parse(final.get('meta')!).scopes).toBe(4096);
  expect(JSON.parse(final.get(attemptKey(attempt()))!).units).toBe(4095);
  await receipt(base, { kind: 'real LMDB seeded cross-epoch completed history', seededRows: generated.size, seedMs,
    actualEpochRows: 4096, rejectedEpochRows: 4097, unchangedHashAtRejection: unchangedHash, elapsedMs: performance.now() - started });
});
