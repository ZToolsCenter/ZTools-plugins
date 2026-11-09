// Owner: v038_resource_limits (Sol). Metadata shape coverage is not V2 wire or host identity acceptance.
import path from 'node:path';
import { expect, it } from 'vitest';
import { attempt, attemptKey, fingerprint, fixture, rawRows, scope } from './factory';
import { ownedCase, receipt } from './evidence';
import type { AttemptClaim } from '../../../src/g3-verification-budget/types';
function sizedClaim(target: number): AttemptClaim {
  const s = { ...scope(), storeId: '界'.repeat(256) };
  const c = { ...attempt(s, 'i', '0', '界'.repeat(256)), deviceId: 'd', sessionId: 's' };
  const size = () => Buffer.byteLength(JSON.stringify({ version: 1, claim: c, state: 'active', units: 0, failures: 0 }));
  const fields = ['deviceId', 'sessionId', 'attemptId'] as const;
  for (const field of fields) {
    while (c[field].length < 256 && size() + 3 <= target) c[field] += '界';
    while (c[field].length < 256 && size() < target) c[field] += 'a';
  }
  if (size() !== target) throw new Error(`cannot construct ${target}: ${size()}`);
  return c;
}
it('4KiB legal metadata: public active4092 becomes quarantine4096, reopens, and active4097 is rejected atomically', async () => {
  const base = await ownedCase('row-bytes-4096'), started = performance.now(), c = sizedClaim(4092);
  const directory = path.join(base, 'ledger'), f = await fixture(directory, false, c.storeId, c.installId);
  let hash = '';
  try {
    const a = await f.begin(c); await f.module.finishAttempt(a, 'quarantine'); await f.reopen();
    const before = await rawRows(directory); expect(Buffer.byteLength(before.get(attemptKey(c))!)).toBe(4096);
    const rejected = { ...sizedClaim(4097) };
    expect(attemptKey(rejected)).not.toBe(attemptKey(c));
    await expect(f.begin(rejected)).rejects.toMatchObject({ code: 'capacity' });
    expect(fingerprint(await rawRows(directory))).toBe(fingerprint(before)); hash = fingerprint(before);
  } finally { await f.close(); }
  await receipt(base, { kind: 'public budget metadata schema, not canonical V2 wire ID or host identity attestation',
    acceptedTerminalValueBytes: 4096, rejectedActiveValueBytes: 4097, unchangedHash: hash, elapsedMs: performance.now() - started });
});
it('64 active and pending: real public API histories accept 64 units and reject attempt65 with full persistent state unchanged', async () => {
  const base = await ownedCase('active-pending-64'), started = performance.now(), directory = path.join(base, 'ledger');
  const f = await fixture(directory); let hash = '';
  try {
    for (let n = 0; n < 64; n++) { const c = attempt(scope(`PUBLIC-vault:${n}`), `PUBLIC-active:${n}`); await f.begin(c); await f.reserve(c, '0'); }
    const before = await rawRows(directory), m = JSON.parse(before.get('meta')!);
    expect(m.activeAttempts).toBe(64); expect(m.pending).toBe(64);
    await expect(f.begin(attempt(scope('PUBLIC-vault:64'), 'PUBLIC-active:64'))).rejects.toMatchObject({ code: 'capacity' });
    hash = fingerprint(before); expect(fingerprint(await rawRows(directory))).toBe(hash);
    await f.reopen();
    const recovered = await rawRows(directory), rm = JSON.parse(recovered.get('meta')!);
    expect(rm.activeAttempts).toBe(0); expect(rm.pending).toBe(0);
    expect([...recovered].filter(([k,v]) => k.startsWith('reservation:') && JSON.parse(v).state === 'unknown')).toHaveLength(64);
    expect([...recovered].filter(([k,v]) => k.startsWith('security:') && JSON.parse(v).locked)).toHaveLength(64);
  } finally { await f.close(); }
  await receipt(base, { kind: 'real public API calls, no bulk seed', activeAttempts: 64, pending: 64, rejectedAttempt: 65,
    unchangedHashAtRejection: hash, elapsedMs: performance.now() - started,
    limitation: 'independent pending65 is unreachable in a valid state because active64 already limits slots' });
});
