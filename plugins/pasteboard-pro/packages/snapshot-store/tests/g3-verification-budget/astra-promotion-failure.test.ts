import { expect, it } from 'vitest';
import { fixture, request, rows, epochRowKey, securityRowKey } from './fixture';

const parent = new URL('../../../../artifacts/pasteboardpro/clipboard-format-g0/v037-budget-tests/runtime/', import.meta.url).pathname;
it('Astra promotion cannot override the active attempt own durable authentication failure', async () => {
  const f = await fixture(parent);
  try {
    const a = await f.begin('verify-control', true), r = request(), lease = f.unit(r);
    await f.module.budget.reserveVerification(lease, r);
    await f.module.budget.recordAuthentication(lease, false);
    // Existing explicit fixture resolver attests promotion, but the ledger's own
    // known false witness must take precedence. No full-operation finish occurs.
    const result = await f.module.promotePreparedRoot(a, { PUBLIC_fixture_attests_chain: true }).then(
      () => ({ success: true }), error => ({ success: false, code: error.code }));
    await f.close();
    const snapshot = await rows(f.directory);
    expect(snapshot.get(epochRowKey())).toMatchObject({ used: 1 });
    expect(snapshot.get(securityRowKey())).toMatchObject({ streak: 1 });
    expect([...snapshot.values()].some(row => row.state === 'failure')).toBe(true);
    expect(result).toMatchObject({ success: false, code: expect.any(String) });
    expect(snapshot.get(epochRowKey())).toMatchObject({ rootId: null, managementInstanceId: null });
  } finally { await f.close(); }
});
