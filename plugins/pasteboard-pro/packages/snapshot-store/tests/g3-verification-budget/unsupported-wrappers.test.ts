import { randomUUID } from 'node:crypto';
import { afterEach, expect, it } from 'vitest';
import { createV2NodeCodec } from '../../../sync-protocol/src/v2-node';
import { fixture, oracle, root, type Fixture } from './fixture';

const parent = new URL('../../../../artifacts/pasteboardpro/clipboard-format-g0/v037-budget-tests/runtime/', import.meta.url).pathname;
const opened: Fixture[] = [];
afterEach(async () => { await Promise.all(opened.splice(0).map(f => f.close())); });
function context() {
  const h = oracle.vectors.passwordWrap.input.header;
  return { accountBindingId: h.accountBindingId, vaultId: h.vaultId, keyEpoch: h.keyEpoch,
    objectType: 'root-wrap' as const, objectId: h.objectId, revision: h.revision, writerDomainId: h.writerDomainId };
}

function syntheticBootstrapCodec(f: Fixture) {
  // TEST ONLY: no production owner, writer registration or bootstrap authority.
  const lease = Object.freeze({ token: randomUUID(), mode: 'bootstrap-prepare' as const });
  let reservations = 0;
  const codec = createV2NodeCodec({ limits: { maxPlaintextBytes: 1048576 },
    authorization: { async authorize() { return lease; }, async fence(actual) {
      if (actual.token !== lease.token || actual.mode !== lease.mode) throw new Error('PUBLIC-fixture-lease-mismatch');
    } }, budget: { ...f.module.budget, async reserveSeal(...args) {
      reservations++;
      return f.module.budget.reserveSeal(...args);
    } },
  });
  return { codec, get reservations() { return reservations; } };
}
it('actual public password wrapping is unavailable with verification-only ledger', async () => {
  const f = await fixture(parent); opened.push(f); await f.begin('wrap-password');
  const h = syntheticBootstrapCodec(f);
  await expect(h.codec.wrapPassword({ context: context(), root: root(), password: 'PUBLIC-candidate-password',
    authority: { bootstrap: true } })).rejects.toMatchObject({ code: 'unavailable' });
  expect(h.reservations).toBe(1);
});
it('actual public recovery wrapping is unavailable with verification-only ledger', async () => {
  const f = await fixture(parent); opened.push(f); await f.begin('wrap-recovery');
  const h = syntheticBootstrapCodec(f);
  await expect(h.codec.wrapRecovery({ context: context(), root: root(), recoverySecret: Buffer.alloc(32, 0x53),
    authority: { bootstrap: true } })).rejects.toMatchObject({ code: 'unavailable' });
  expect(h.reservations).toBe(1);
});
