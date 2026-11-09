// Owner: v038_resource_limits (Sol). Small real API histories before any bulk seed.
import path from 'node:path';
import { expect, it } from 'vitest';
import { attempt, fixture, historyRows, metadata, rawRows, scope } from './factory';
import { ownedCase, receipt } from './evidence';
it('small public histories exactly match independently generated linked seed rows', async () => {
  const base = await ownedCase('small-factory'), started = performance.now();
  const f = await fixture(path.join(base, 'ledger'));
  const c = attempt();
  try { await f.complete(c, ['0', '1']); await f.unlock(scope(), 0); await f.unlock(scope(), 1); }
  finally { await f.close(); }
  const actual = await rawRows(f.options.directory), expected = historyRows(c, ['0', '1'], 2);
  expect(JSON.parse(actual.get('meta')!)).toEqual(metadata(expected));
  actual.delete('meta'); expect([...actual].sort()).toEqual([...expected].sort());
  const reopened = await fixture(f.options.directory, true); await reopened.close();
  await receipt(base, { kind: 'small real public API history, not bulk seed', elapsedMs: performance.now() - started,
    publicApi: { begin: 1, reserve: 2, record: 2, finish: 1, unlock: 2, reopen: 1 }, rows: actual.size });
});

it('small public histories across two completed vaults match independent security seed rows', async () => {
  const base = await ownedCase('small-multi-vault'), started = performance.now();
  const f = await fixture(path.join(base, 'ledger')), expected = new Map<string, string>();
  try {
    for (let n = 0; n < 2; n++) {
      const c = attempt(scope(`PUBLIC-vault:${n}`), `PUBLIC-attempt:${n}`);
      await f.complete(c, ['0']);
      for (const entry of historyRows(c, ['0'])) expected.set(...entry);
    }
  } finally { await f.close(); }
  const actual = await rawRows(f.options.directory);
  expect(JSON.parse(actual.get('meta')!)).toEqual(metadata(expected));
  actual.delete('meta'); expect([...actual].sort()).toEqual([...expected].sort());
  const reopened = await fixture(f.options.directory, true); await reopened.close();
  await receipt(base, { kind: 'small real public API multi-vault history, not bulk seed',
    elapsedMs: performance.now() - started, completedVaults: 2, rows: actual.size });
});
