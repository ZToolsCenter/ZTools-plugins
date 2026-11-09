// Owner: v038_resource_limits (Sol). Pure arithmetic is not persistent end-to-end evidence.
import { expect, it } from 'vitest';
import { ownedCase, receipt } from './evidence';
it('arithmetic only: 2^32 and 512MiB cannot precede the 100000-row bound in a valid ledger', async () => {
  const base = await ownedCase('arithmetic');
  const maximumRows = 100000, maximumValueBytes = 4096, maximumKeyBytes = 76;
  const upperBound = maximumRows * (maximumValueBytes + maximumKeyBytes);
  expect(upperBound).toBe(417200000); expect(upperBound).toBeLessThan(536870912);
  // An epoch used count is exactly its real reservation count, each requiring one nonmeta row.
  expect(maximumRows).toBeLessThan(4294967296);
  const isolated = (n: bigint) => { if (n >= 4294967296n) return { accepted: false, value: n }; return { accepted: true, value: n + 1n }; };
  expect(isolated(4294967295n)).toEqual({ accepted: true, value: 4294967296n });
  expect(isolated(4294967296n)).toEqual({ accepted: false, value: 4294967296n });
  await receipt(base, { kind: 'independent mathematical and isolated arithmetic demonstration only', upperBoundLogicalBytes: upperBound,
    upperBoundMiB: upperBound / 1048576, unreachableLogicalCapBytes: 536870912, epochUsedUpperBoundFromRows: maximumRows,
    limitation: 'not a production MAX_COUNT branch test or a fabricated persistent huge-used/bytes state' });
});
