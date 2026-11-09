import { describe, expect, it } from 'vitest';
import { buildPortableProjectionV2, validateProjectionV2, verifyProjectionDigestV2, V2ProtocolError } from '../src/v2';
import { snapshotLocalMetadataV2, encodeStoreManifestV2 } from '../src/v2/projection-input';
import { portableInput, hash, alias, abc, abcSha256, canonicalJson, mutable } from './portable-projection-fixture';

describe('portable projection candidate, never policy or publisher authority', () => {
  it('emits existing strict wire schema and independent SHA/JCS digest for public ABC', async () => {
    const input = await portableInput(), result = buildPortableProjectionV2(input);
    expect(result.blobs).toHaveLength(1);
    expect(Buffer.from(result.blobs[0]!.bytes).toString('hex')).toBe('616263');
    const row = result.projection.items[0]!.representations[0]!;
    expect(row).toMatchObject({ portableCodecId: 'unicode-text-utf8', codecVersion: '1', blobRevision: '0', byteLength: 3,
      sha256: abcSha256, provenance: { relation: 'undisclosed' } });
    const { projectionDigest, ...body } = result.projection;
    expect(projectionDigest).toBe(hash(Buffer.from(canonicalJson(body))));
    expect(validateProjectionV2(result.projection, input.limits.maxProjectionBytes)).toEqual(result.projection);
    expect(verifyProjectionDigestV2(result.projection, input.limits.maxProjectionBytes, hash)).toEqual(result.projection);
    expect(input.snapshot.receipt.permissions).toEqual({ preview: false, paste: false, sync: false });
    expect(input.snapshot.receipt.cloudUploadEligible).toBe(false);
    expect(Object.keys(result).sort()).toEqual(['blobs', 'projection']);
  });
  it('omits private metadata/native names/app paths/file references without copying them into wire', async () => {
    const input = await portableInput([
      { key: 'text', bytes: abc },
      { key: 'private', kind: 'rich-text', bytes: Buffer.from('PRIVATE_APP_BYTES'), format: 'com.PRIVATE_FORMAT', native: 'PRIVATE_NATIVE_NAME' },
      { key: 'files', kind: 'file-reference', bytes: Buffer.from('file:///PRIVATE_LOCAL_PATH/item.txt'), format: 'NSFilenamesPboardType' },
    ]);
    const result = buildPortableProjectionV2(input), wire = canonicalJson(result.projection);
    for (const value of ['PRIVATE_APP_BYTES', 'PRIVATE_FORMAT', 'PRIVATE_NATIVE_NAME', 'PRIVATE_LOCAL_PATH', 'PRIVATE_OS_BUILD', 'blobRef', 'policyReceiptId', 'sourceApplication', 'sourceURL', 'permissions']) expect(wire).not.toContain(value);
    expect(result.projection.omissions).toEqual([{ itemIndex: 0, reasonCode: 'unsupported' }, { itemIndex: 0, reasonCode: 'local-only' }]);
    expect(result.blobs).toHaveLength(1);
  });
  it('preserves source item order even when selections arrive reversed, with explicit empty-item omission', async () => {
    const input = mutable(await portableInput([{ key: 'a', bytes: abc, item: 0 },
      { key: 'unavailable', bytes: new Uint8Array(), item: 1, unavailable: 'timeout' },
      { key: 'c', bytes: Buffer.from('63', 'hex'), item: 2 }]));
    input.selections = [{ representationKey: 'c', encoding: 'utf8', representationHandle: alias(9), blobId: alias(10) }, ...input.selections];
    const result = buildPortableProjectionV2(input);
    expect(result.projection.items.map(i => i.itemIndex)).toEqual([0, 2]);
    expect(result.projection.omissions).toEqual([{ itemIndex: 1, reasonCode: 'unavailable' }]);
    expect(result.blobs.map(b => Buffer.from(b.bytes).toString('hex'))).toEqual(['616263', '63']);
  });
  it('rejects no eligible portable output, never returns an empty success candidate', async () => {
    const input = mutable(await portableInput()); input.selections = [];
    expect(() => buildPortableProjectionV2(input)).toThrowError(expect.objectContaining({ code: 'invalid-input' }));
  });
  for (const field of ['snapshotId', 'manifestRevision', 'hostEpoch', 'manifestRef', 'manifestSha256'] as const) {
    it(`rejects wrong journal upsert ${field} binding`, async () => {
      const input = mutable(await portableInput());
      if (input.upsert.eventType !== 'upsert') throw new Error('PUBLIC-fixture-upsert');
      input.upsert[field] = field === 'manifestSha256' ? 'f'.repeat(64) : 'wrong-public-binding';
      expect(() => buildPortableProjectionV2(input)).toThrowError(V2ProtocolError);
    });
  }
  for (const field of ['sha256', 'byteLength', 'blobRef', 'itemIndex', 'bytes'] as const) {
    it(`rejects actual raw binding ${field} mismatch`, async () => {
      const input = mutable(await portableInput()), raw = input.snapshot.representations[0]!;
      if (field === 'sha256') raw.sha256 = '0'.repeat(64);
      else if (field === 'byteLength') raw.byteLength++;
      else if (field === 'blobRef') raw.blobRef = 'sha256-wrong';
      else if (field === 'itemIndex') raw.itemIndex = 1;
      else raw.bytes[0] = 0x7a;
      expect(() => buildPortableProjectionV2(input)).toThrowError(V2ProtocolError);
    });
  }
  it('rejects missing/duplicate/extra raw rows and wrong receipt identity', async () => {
    const original = await portableInput();
    for (const change of [ (i: ReturnType<typeof mutable<typeof original>>) => { i.snapshot.representations = []; },
      (i: ReturnType<typeof mutable<typeof original>>) => { i.snapshot.representations.push(mutable(i.snapshot.representations[0]!)); },
      (i: ReturnType<typeof mutable<typeof original>>) => { i.snapshot.receipt.receiptId = 'wrong-receipt'; } ]) {
      const input = mutable(original); change(input); expect(() => buildPortableProjectionV2(input)).toThrowError(V2ProtocolError);
    }
  });
  it('requires complete opaque aliases and rejects extra authority-looking identity fields', async () => {
    const original = await portableInput();
    const incomplete = { ...original, identity: { ...original.identity, sourceSnapshotId: 'raw-source-id' } };
    expect(() => buildPortableProjectionV2(incomplete)).toThrowError(V2ProtocolError);
    const selfAuthorized = { ...original, identity: { ...original.identity, policyAuthorized: true } };
    expect(() => buildPortableProjectionV2(selfAuthorized)).toThrowError(V2ProtocolError);
    const missing = { ...original, identity: { ...original.identity, sourceManifestRevision: undefined } };
    expect(() => buildPortableProjectionV2(missing as unknown as typeof original)).toThrowError(V2ProtocolError);
  });
  it('rejects alias collisions, unknown keys and duplicate selections', async () => {
    const original = await portableInput([{ key: 'a', bytes: abc }, { key: 'b', bytes: abc }]);
    for (const selected of [
      [...original.selections, { ...original.selections[0]!, representationKey: 'b', blobId: alias(10) }],
      [...original.selections, { ...original.selections[0]!, representationKey: 'b', representationHandle: alias(10) }],
      [...original.selections, original.selections[0]!],
      [{ ...original.selections[0]!, representationKey: 'missing' }],
    ]) expect(() => buildPortableProjectionV2({ ...original, selections: selected })).toThrowError(V2ProtocolError);
  });
  it('owns ALL metadata/bytes before calling the supplied hash and gives that callback an owned copy', async () => {
    const input = mutable(await portableInput()); let calls = 0;
    const result = buildPortableProjectionV2({ ...input, sha256(bytes) {
      const digest = hash(bytes); bytes.fill(0); calls++;
      input.snapshot.representations[0]!.bytes.fill(0x7a);
      input.snapshot.manifest.source.osBuild = 'MUTATED_PRIVATE_METADATA';
      input.identity.projectionId = alias(15);
      input.selections[0]!.blobId = alias(14);
      if (input.upsert.eventType === 'upsert') input.upsert.changeSeq = '999';
      return digest;
    } });
    expect(calls).toBeGreaterThan(0);
    expect(Buffer.from(result.blobs[0]!.bytes).toString('hex')).toBe('616263');
    expect(result.projection).toMatchObject({ projectionId: alias(1), sourceCursor: { changeSeq: '7' } });
    expect(result.blobs[0]!.blobId).toBe(alias(6));
  });
  it('enforces aggregate/raw/output/metadata byte caps without silent partial success', async () => {
    const original = await portableInput();
    for (const limits of [{ ...original.limits, maxInputBytes: 2 }, { ...original.limits, maxOutputBytes: 2 }, { ...original.limits, maxProjectionBytes: 10 }]) {
      expect(() => buildPortableProjectionV2({ ...original, limits })).toThrowError(expect.objectContaining({ code: 'over-limit' }));
    }
  });
  it('whitelist: caller cannot label PRIVATE native bytes as portable Unicode just by claiming text/utf8', async () => {
    const input = await portableInput([{ key: 'private-text', bytes: abc, kind: 'text', format: 'com.PRIVATE-text', native: 'PRIVATE_NATIVE' }]);
    expect(() => buildPortableProjectionV2(input)).toThrowError(V2ProtocolError);
  });
  it('whitelist: caller cannot reinterpret UTF8 native format using a CF_UNICODETEXT declaration', async () => {
    const input = mutable(await portableInput([{ key: 'text', bytes: Buffer.from('61000000', 'hex') }]));
    input.selections[0]!.encoding = 'cf-unicode-text';
    expect(() => buildPortableProjectionV2(input)).toThrowError(V2ProtocolError);
  });
  it('whitelist: Windows producer remains unsupported until actual native manifest mapping is verified', async () => {
    const input = await portableInput([{ key: 'text', bytes: Buffer.from('61000000', 'hex'), format: 'CF_UNICODETEXT', native: 'CF_UNICODETEXT' }], 'windows');
    expect(() => buildPortableProjectionV2(input)).toThrowError(V2ProtocolError);
  });
  it('hashes LOCAL manifest using its store JSON encoding rather than requiring portable-wire Unicode', async () => {
    const input = mutable(await portableInput()); input.snapshot.manifest.source.osBuild = 'PRIVATE-\ud800';
    if (input.upsert.eventType !== 'upsert') throw new Error('PUBLIC-fixture-upsert');
    input.upsert.manifestSha256 = hash(Buffer.from(canonicalJson(input.snapshot.manifest)));
    const result = buildPortableProjectionV2(input);
    expect(Buffer.from(result.blobs[0]!.bytes).toString('hex')).toBe('616263');
    expect(canonicalJson(result.projection)).not.toContain('PRIVATE-');
  });
});

it('boundary: oversized metadata structure is rejected before Zod walks accessor-backed items', async () => {
  const input = mutable(await portableInput()); let reads = 0;
  const originalRepresentations = input.snapshot.manifest.items[0]!.representations;
  const item = { index: 0, get representations() { reads++; return originalRepresentations; } };
  input.snapshot.manifest.items = Array.from({ length: 33 }, () => item);
  let hashes = 0;
  expect(() => buildPortableProjectionV2({ ...input, sha256(bytes) { hashes++; return hash(bytes); } })).toThrowError(V2ProtocolError);
  expect(reads).toBe(0);
  expect(hashes).toBe(0);
});
it('boundary: small caller raw-byte budget rejects before any hash callback', async () => {
  const input = await portableInput(); let hashes = 0;
  expect(() => buildPortableProjectionV2({ ...input, limits: { ...input.limits, maxInputBytes: 2 },
    sha256(bytes) { hashes++; return hash(bytes); } })).toThrowError(expect.objectContaining({ code: 'over-limit' }));
  expect(hashes).toBe(0);
});
it('boundary: supplied hash cannot expose a mutated protocol error message or private fields', async () => {
  const input = await portableInput();
  const injected = Object.assign(new V2ProtocolError('invalid-input'), { message: 'PRIVATE_CALLBACK_PATH/file.txt', privatePath: '/PRIVATE_CALLBACK_PATH' });
  try {
    buildPortableProjectionV2({ ...input, sha256() { throw injected; } });
    throw new Error('PUBLIC-expected-builder-error');
  } catch (error) {
    expect(error).toBeInstanceOf(V2ProtocolError);
    expect((error as V2ProtocolError).message).toBe((error as V2ProtocolError).code);
    expect(error).not.toBe(injected);
    expect(JSON.stringify(error)).not.toContain('PRIVATE_CALLBACK_PATH');
  }
});


it('metadata-cap: generic prevalidation helper counts actual JSON escapes at real default 8MiB cap', async () => {
  const input = await portableInput();
  const cap = 8 * 1024 * 1024;
  const controls = '\u0001'.repeat(Math.floor(cap / 6) + 1); // ~1.4MiB input, not 100MiB pressure
  // This extra generic field is deliberately NOT a legal core manifest. It tests
  // the helper's pre-Zod resource boundary, not a valid store end-to-end record.
  const generic = { ...input.snapshot.manifest, PUBLIC_generic_padding: controls };
  expect(Buffer.byteLength(JSON.stringify(generic), 'utf8')).toBeGreaterThan(cap);
  expect(() => {
    const owned = snapshotLocalMetadataV2(generic, input.snapshot.receipt);
    return encodeStoreManifestV2(owned.manifest);
  }).toThrowError(expect.objectContaining({ code: 'over-limit' }));
});
it('metadata-cap: over-node sparse Proxy length is rejected BEFORE ownKeys without a dense allocation', async () => {
  const input = await portableInput(); let ownKeys = 0, elementGets = 0;
  const sparse = new Proxy([], {
    get(target, key, receiver) {
      if (key === 'length') return 100001;
      if (typeof key === 'string' && /^\d+$/.test(key)) elementGets++;
      return Reflect.get(target, key, receiver);
    },
    ownKeys(target) { ownKeys++; return Reflect.ownKeys(target); },
  });
  let error: unknown;
  try { snapshotLocalMetadataV2({ ...input.snapshot.manifest, PUBLIC_generic_sparse: sparse }, input.snapshot.receipt); }
  catch (caught) { error = caught; }
  expect(error).toBeInstanceOf(V2ProtocolError);
  expect(elementGets).toBe(0);
  expect(ownKeys).toBe(0);
  expect(error).toMatchObject({ code: 'over-limit' });
});
