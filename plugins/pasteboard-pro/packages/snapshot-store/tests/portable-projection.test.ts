import { mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { openSnapshotStoreV2, PolicyCommitAuthorityV2 } from '../src/index.js';
import { makeStoreCaptureV2, makeManifestFromReceiptV2, type StoreRepresentationFixtureV2 } from './store-fixtures.js';
import { buildPortableProjectionV2, verifyProjectionDigestV2, validateProjectionV2, V2ProtocolError,
  type BuildPortableProjectionInputV2 } from '../../sync-protocol/src/v2.js';
import { identity, alias, hash, abc, abcSha256, canonicalJson, mutable } from '../../sync-protocol/tests/portable-projection-fixture.js';

const artifactRoot = fileURLToPath(new URL('../../../artifacts/pasteboardpro/clipboard-format-g0/v039-projection-tests/runtime/', import.meta.url));
const opened: Awaited<ReturnType<typeof openSnapshotStoreV2>>[] = [];
afterEach(async () => { await Promise.all(opened.splice(0).map(store => store.close())); });
const text = (): StoreRepresentationFixtureV2 => ({ representationKey: 'source-text', itemIndex: 0, contentKind: 'text', bytes: abc,
  formatId: 'public.utf8-plain-text', nativeName: 'public.utf8-plain-text' });
async function captured(rows: readonly StoreRepresentationFixtureV2[] = [text()], privateBuild?: string) {
  await mkdir(artifactRoot, { recursive: true, mode: 0o700 });
  const sandbox = await mkdtemp(path.join(artifactRoot, 'real-store-')), directory = path.join(sandbox, 'store');
  const options = { directory, policy: new PolicyCommitAuthorityV2('policy-1'),
    scan: async (request: Parameters<NonNullable<Parameters<typeof openSnapshotStoreV2>[0]['scan']>>[0]) => request.requiredScopes.map(scope => ({ scope, status: 'passed' as const })) };
  const store = await openSnapshotStoreV2(options); opened.push(store);
  const fixture = makeStoreCaptureV2({ contentRulesEnabled: false, rows });
  const committed = await store.captureAndCommit({ capture: fixture.capture, expectedManifestRevision: null, manifest(receipt) {
    const m = makeManifestFromReceiptV2(fixture, receipt, store.hostEpoch);
    return { ...m, source: { ...m.source, osBuild: privateBuild ?? m.source.osBuild,
      sourceApplication: { kind: 'bundle-id' as const, identifier: 'com.PRIVATE_SOURCE_APP' }, attribution: 'trusted' as const } };
  } });
  expect(committed.status).toBe('committed');
  if (committed.status !== 'committed') throw new Error('PUBLIC-real-store-commit-failed');
  const page = await store.readChanges({ hostEpoch: store.hostEpoch, after: '0', limit: 10 });
  expect(page.status).toBe('ok');
  if (page.status !== 'ok' || page.events[0]?.eventType !== 'upsert') throw new Error('PUBLIC-real-upsert-missing');
  const upsert = page.events[0];
  expect(upsert).toEqual(committed.event);
  await store.close();
  const reopened = await openSnapshotStoreV2(options); opened.push(reopened);
  const snapshot = await reopened.readSnapshot(upsert.snapshotId, upsert.manifestRevision);
  if (!snapshot) throw new Error('PUBLIC-real-snapshot-missing');
  const input: BuildPortableProjectionInputV2 = { snapshot, upsert, identity: identity(),
    selections: [{ representationKey: 'source-text', encoding: 'utf8', representationHandle: alias(5), blobId: alias(6) }],
    limits: { maxInputBytes: 8192, maxOutputBytes: 8192, maxProjectionBytes: 16384 }, sha256: hash };
  return { reopened, input, sandbox };
}
it('REAL store commit → durable journal upsert → reopen/readSnapshot → portable schema/digest consumer', async () => {
  const { input } = await captured();
  expect(input.snapshot.representations).toHaveLength(1);
  expect(input.snapshot.representations[0]!.sha256).toBe(abcSha256);
  expect(input.snapshot.receipt.permissions).toEqual({ preview: false, paste: false, sync: false });
  expect(input.snapshot.receipt.cloudUploadEligible).toBe(false);
  const result = buildPortableProjectionV2(input);
  expect(Buffer.from(result.blobs[0]!.bytes).toString('hex')).toBe('616263');
  expect(result.projection.sourceCursor).toEqual({ hostEpoch: input.upsert.hostEpoch, changeSeq: input.upsert.changeSeq });
  expect(result.projection.sourceSnapshotId).toBe(alias(2));
  expect(result.projection.sourceSnapshotId).not.toBe(input.snapshot.manifest.snapshotId);
  expect(validateProjectionV2(result.projection, 16384)).toEqual(result.projection);
  expect(verifyProjectionDigestV2(result.projection, 16384, hash)).toEqual(result.projection);
});
it('REAL retained file-reference has a raw binding, validates it, then emits local-only omission without paths', async () => {
  const { input } = await captured([text(), { representationKey: 'files', itemIndex: 0, contentKind: 'file-reference',
    bytes: Buffer.from('file:///PRIVATE_LOCAL_PATH/file.txt'), formatId: 'NSFilenamesPboardType', nativeName: 'NSFilenamesPboardType',
    references: [{ url: 'file:///PRIVATE_LOCAL_PATH/file.txt', isDirectory: false, observedAvailability: 'available' }] },
    { representationKey: 'html', itemIndex: 0, contentKind: 'rich-text', bytes: Buffer.from('<p>PRIVATE_SOURCE_URL</p>'), formatId: 'public.html', nativeName: 'public.html' }]);
  expect(input.snapshot.representations.map(r => r.representationKey)).toContain('files');
  const result = buildPortableProjectionV2(input), wire = canonicalJson(result.projection);
  expect(result.projection.omissions).toEqual([{ itemIndex: 0, reasonCode: 'local-only' }, { itemIndex: 0, reasonCode: 'unsupported' }]);
  expect(result.blobs).toHaveLength(1);
  for (const forbidden of ['PRIVATE_LOCAL_PATH', 'PRIVATE_SOURCE_URL', 'PRIVATE_SOURCE_APP', 'NSFilenamesPboardType', 'blobRef']) expect(wire).not.toContain(forbidden);
});
it('REAL LOCAL manifest can contain a private lone surrogate and still produce only valid portable metadata', async () => {
  const privateBuild = 'PRIVATE-\ud800';
  const { input } = await captured([text()], privateBuild);
  // This proves actual store acceptance and read-back before testing the builder.
  expect(input.snapshot.manifest.source.osBuild).toBe(privateBuild);
  if (input.upsert.eventType !== 'upsert') throw new Error('PUBLIC-upsert-fixture');
  expect(input.upsert.manifestSha256).toBe(hash(Buffer.from(canonicalJson(input.snapshot.manifest))));
  const result = buildPortableProjectionV2(input);
  expect(Buffer.from(result.blobs[0]!.bytes).toString('hex')).toBe('616263');
  expect(canonicalJson(result.projection)).not.toContain('PRIVATE-');
  expect(verifyProjectionDigestV2(result.projection, 16384, hash)).toEqual(result.projection);
});
it('REAL partial snapshot records unavailable item as omission, does not invent an empty portable item', async () => {
  const { input } = await captured([text(), { representationKey: 'missing', itemIndex: 1, contentKind: 'text', bytes: new Uint8Array(),
    formatId: 'public.utf8-plain-text', nativeName: 'public.utf8-plain-text', unavailableReason: 'timeout' }]);
  expect(input.snapshot.manifest.captureState).toBe('partial');
  const result = buildPortableProjectionV2(input);
  expect(result.projection.items.map(i => i.itemIndex)).toEqual([0]);
  expect(result.projection.omissions).toEqual([{ itemIndex: 1, reasonCode: 'unavailable' }]);
});
it('mutating readSnapshot bytes cannot change durable originals or a separately owned candidate', async () => {
  const { input, reopened } = await captured();
  const result = buildPortableProjectionV2(input);
  input.snapshot.representations[0]!.bytes.fill(0x7a);
  expect(Buffer.from(result.blobs[0]!.bytes).toString('hex')).toBe('616263');
  expect(() => buildPortableProjectionV2(input)).toThrowError(V2ProtocolError);
  const fresh = await reopened.readSnapshot(input.snapshot.manifest.snapshotId, input.snapshot.manifest.manifestRevision);
  expect(Buffer.from(fresh!.representations[0]!.bytes).toString('hex')).toBe('616263');
});
it('opaque aliases cannot select a retained LOCAL file reference or grant any receipt permission', async () => {
  const { input } = await captured([text(), { representationKey: 'files', itemIndex: 0, contentKind: 'file-reference',
    bytes: Buffer.from('file:///PRIVATE_LOCAL_PATH/file.txt'), formatId: 'NSFilenamesPboardType', nativeName: 'NSFilenamesPboardType' }]);
  const changed = mutable(input); changed.selections = [{ representationKey: 'files', encoding: 'utf8', representationHandle: alias(10), blobId: alias(11) }];
  expect(() => buildPortableProjectionV2(changed)).toThrowError(V2ProtocolError);
  expect(input.snapshot.receipt.permissions).toEqual({ preview: false, paste: false, sync: false });
});
