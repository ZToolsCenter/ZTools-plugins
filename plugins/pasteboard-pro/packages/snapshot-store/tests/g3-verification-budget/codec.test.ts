import { afterEach, describe, expect, it } from 'vitest';
import { fixture, control, expectedControl, root, oracle, bytes, rows,
  securityRowKey, epochRowKey, type Fixture } from './fixture';

const parent = new URL('../../../../artifacts/pasteboardpro/clipboard-format-g0/v037-budget-tests/runtime/', import.meta.url).pathname;
const opened: Fixture[] = [];
async function create() { const f = await fixture(parent); opened.push(f); return f; }
afterEach(async () => { await Promise.all(opened.splice(0).map(f => f.close())); });

async function bootstrap(f: Fixture) {
  const a = await f.begin('verify-control', true);
  await f.codec.verifyControl({ control: control(), root: root(), expected: expectedControl() });
  // Explicit synthetic host attestation; the module does not implement this authority.
  await f.module.promotePreparedRoot(a, { publicFixtureAuthenticatedChain: true });
  await f.module.finishAttempt(a, 'success');
}
async function badRoot(f: Fixture) {
  const a = await f.begin('verify-control');
  await expect(f.codec.verifyControl({ control: control(), root: Buffer.alloc(32, 0x77), expected: expectedControl() }))
    .rejects.toMatchObject({ code: 'authentication-failed' });
  await f.module.finishAttempt(a, 'failure');
}
async function badPassword(f: Fixture) {
  const a = await f.begin('unlock-password');
  await expect(f.codec.unlockPassword({ control: control(), password: 'PUBLIC-wrong-password', expected: expectedControl() }))
    .rejects.toMatchObject({ code: 'authentication-failed' });
  await f.module.finishAttempt(a, 'failure');
}
async function snapshot(f: Fixture) { await f.close(); return rows(f.directory); }

describe('public V2 codec with REAL local LMDB ledger, synthetic trusted seams only', () => {
  it('accounts separate signature/rootMAC/publicationMAC/GCM actual units', async () => {
    const f = await create(); await bootstrap(f);
    const p = oracle.vectors.publication, v = oracle.vectors.blob;
    let a = await f.begin('verify-publication');
    await f.codec.verifyPublication({ publication: bytes(p.expected.canonicalHex), root: root(), expected: {
      accountBindingId: expectedControl().accountBindingId, vaultId: expectedControl().vaultId, keyEpoch: '0',
      publicationRevision: '0', publicationSha256: p.expected.sha256,
      controlRevision: '0', controlSha256: expectedControl().controlSha256,
    } });
    await f.module.finishAttempt(a, 'success');
    a = await f.begin('open-object');
    const h = v.input.header;
    const result = await f.codec.openObject({ root: root(), envelope: bytes(v.expected.envelopeHex), expected: {
      accountBindingId: h.accountBindingId, vaultId: h.vaultId, keyEpoch: h.keyEpoch,
      objectType: h.objectType, objectId: h.objectId, revision: h.revision, purpose: h.purpose,
      envelopeSha256: v.expected.envelopeSha256, blobBinding: v.input.metadata,
    } });
    expect(result.status).toBe('ok');
    await f.module.finishAttempt(a, 'success');
    expect(f.events.map(e => e.unit)).toEqual(['control-signature', 'control-root-mac', 'publication-mac', 'gcm-envelope']);
    expect(f.events.every(e => e.authenticated === true)).toBe(true);
    expect((await snapshot(f)).get(epochRowKey())).toMatchObject({ used: 4 });
  });
  it('32 valid signatures plus wrong root MAC lock; intermediate signature success does not reset', async () => {
    const f = await create(); await bootstrap(f);
    for (let i = 0; i < 31; i++) await badRoot(f);
    await badRoot(f);
    await expect(f.begin()).rejects.toMatchObject({ code: 'locked' });
    const state = await snapshot(f);
    expect(state.get(epochRowKey())).toMatchObject({ used: 66 });
    expect(state.get(securityRowKey())).toMatchObject({ streak: 32, locked: true });
    expect(f.events.filter(e => e.authenticated === false)).toHaveLength(32);
    expect(f.events.filter(e => e.authenticated === true)).toHaveLength(34);
  }, 30000);
  it('32 valid signatures plus wrong password GCM lock without a root/plaintext result', async () => {
    const f = await create(); await bootstrap(f);
    for (let i = 0; i < 32; i++) await badPassword(f);
    await expect(f.begin('unlock-password')).rejects.toMatchObject({ code: 'locked' });
    const state = await snapshot(f);
    expect(state.get(epochRowKey())).toMatchObject({ used: 66 });
    expect(state.get(securityRowKey())).toMatchObject({ streak: 32, locked: true });
    expect(f.events.filter(e => e.unit === 'gcm-envelope' && e.authenticated === false)).toHaveLength(32);
  }, 90000);
  it('mixed root-MAC/password failures share one stable-device-vault lock', async () => {
    const f = await create(); await bootstrap(f);
    for (let i = 0; i < 16; i++) { await badRoot(f); await badPassword(f); }
    await expect(f.begin('recover-package', true)).rejects.toMatchObject({ code: 'locked' });
    expect((await snapshot(f)).get(securityRowKey())).toMatchObject({ streak: 32, locked: true });
  }, 90000);
  it('locked target security blocks preparation from an old anchor before any crypto unit', async () => {
    const f = await create(); await bootstrap(f);
    for (let i = 0; i < 32; i++) await badRoot(f);
    const before = f.events.length;
    await expect(f.begin('recover-package', true)).rejects.toMatchObject({ code: 'locked' });
    expect(f.events).toHaveLength(before);
  }, 30000);
  it('existing formal attempt blocks preparation before old-anchor verification', async () => {
    const f = await create(); await bootstrap(f); await f.begin('verify-control');
    const before = f.events.length;
    await expect(f.begin('recover-package', true)).rejects.toMatchObject({ code: 'conflict' });
    expect(f.events).toHaveLength(before);
  });
  it('same-root promotion neither refunds used nor clears a previous failed attempt', async () => {
    const f = await create(); await bootstrap(f); await badRoot(f);
    const a = await f.begin('verify-control', true);
    await f.codec.verifyControl({ control: control(), root: root(), expected: expectedControl() });
    await f.module.promotePreparedRoot(a, { publicFixtureAuthenticatedChain: true });
    await f.module.finishAttempt(a, 'quarantine');
    const state = await snapshot(f);
    expect(state.get(epochRowKey())).toMatchObject({ used: 6 });
    expect(state.get(securityRowKey())).toMatchObject({ streak: 1, locked: false });
  });
  it('only full authenticated codec success plus durable finish resets prior failures', async () => {
    const f = await create(); await bootstrap(f); await badRoot(f);
    const a = await f.begin('verify-control');
    await f.codec.verifyControl({ control: control(), root: root(), expected: expectedControl() });
    await f.module.finishAttempt(a, 'success');
    expect((await snapshot(f)).get(securityRowKey())).toMatchObject({ streak: 0, locked: false });
  });
  it('actual public seal stays unavailable with verification-only adapter', async () => {
    const f = await create(); await bootstrap(f); await f.begin('seal-object');
    const h = oracle.vectors.blob.input.header;
    await expect(f.codec.sealObject({ context: {
      accountBindingId: h.accountBindingId, vaultId: h.vaultId, keyEpoch: h.keyEpoch,
      objectType: h.objectType, objectId: h.objectId, revision: h.revision, writerDomainId: h.writerDomainId,
    }, root: root(), plaintext: bytes(oracle.vectors.blob.input.plaintextHex),
    authority: { control: control(), expected: expectedControl() } })).rejects.toMatchObject({ code: 'unavailable' });
  });
});
