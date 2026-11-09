import { decodeCanonicalV2, encodeCanonicalV2, failV2, snapshotJsonV2 } from './canonical.js';
import type { ProjectionV2, BlobMetadataV2, IndexV2, TombstoneV2 } from './types.js';
import { validateByteLimitV2, assertVersionV2, arrayV2, b16V2, b32V2, idV2, intV2, literalV2, oneOfV2, recordV2, shaV2, u64V2, type RecordV2 } from './primitives.js';
const bodyKeys = ['bodyVersion'];


function version(r: RecordV2) {
    if (r.bodyVersion !== 2)
        failV2('unsupported-version');
}
function cursor(v: unknown) {
    const r = recordV2(v, ['hostEpoch', 'changeSeq']);
    idV2(r.hostEpoch);
    u64V2(r.changeSeq);
}
function provenance(v: unknown) {
    if (!v || typeof v !== 'object')
        failV2();
    const x = v as RecordV2;
    oneOfV2(x.relation, ['byte-identical', 'converted', 'undisclosed']);
    if (x.relation === 'undisclosed') {
        recordV2(x, ['relation']);
        return;
    }
    const r = recordV2(x, x.relation === 'converted' ? ['relation', 'sourceAlias', 'sourceSha256', 'codecId', 'codecVersion'] : ['relation', 'sourceAlias', 'sourceSha256']);
    b16V2(r.sourceAlias);
    shaV2(r.sourceSha256);
    if (x.relation === 'converted') {
        idV2(r.codecId);
        idV2(r.codecVersion);
    }
}
export function validateProjectionV2(v: unknown, maxBytes: number): ProjectionV2 {
    assertVersionV2(v, 'bodyVersion');
    const owned = snapshotJsonV2(v, maxBytes);
    const r = recordV2(owned, [...bodyKeys, 'projectionId', 'sourceSnapshotId', 'sourceManifestRevision', 'sourceCursor', 'originDeviceId', 'items', 'omissions', 'projectionDigest']);
    version(r);
    b16V2(r.projectionId);
    b16V2(r.sourceSnapshotId);
    b16V2(r.sourceManifestRevision);
    b16V2(r.originDeviceId);
    cursor(r.sourceCursor);
    shaV2(r.projectionDigest);
    arrayV2(r.items, 32);
    arrayV2(r.omissions, 1024);
    const seen = new Set<string>();
    let last = -1;
    for (const item of r.items) {
        const i = recordV2(item, ['itemIndex', 'representations']);
        intV2(i.itemIndex, 31);
        if (i.itemIndex <= last)
            failV2();
        last = i.itemIndex;
        arrayV2(i.representations, 32);
        for (const row of i.representations) {
            const x = recordV2(row, ['representationHandle', 'portableCodecId', 'codecVersion', 'blobId', 'blobRevision', 'sha256', 'byteLength', 'provenance']);
            b16V2(x.representationHandle);
            if (seen.has(x.representationHandle))
                failV2();
            seen.add(x.representationHandle);
            idV2(x.portableCodecId);
            idV2(x.codecVersion);
            b16V2(x.blobId);
            u64V2(x.blobRevision);
            shaV2(x.sha256);
            intV2(x.byteLength, 200 * 1024 * 1024);
            provenance(x.provenance);
        }
    }
    for (const omission of r.omissions) {
        const x = recordV2(omission, ['itemIndex', 'reasonCode']);
        intV2(x.itemIndex, 31);
        oneOfV2(x.reasonCode, ['unsupported', 'policy-blocked', 'local-only', 'over-limit', 'unavailable']);
    }
    return owned as ProjectionV2;
}
export function validateBlobMetadataV2(v: unknown): BlobMetadataV2 {
    assertVersionV2(v, 'bodyVersion');
    const owned = snapshotJsonV2(v, 4096);
    const r = recordV2(owned, ['bodyVersion', 'blobId', 'blobRevision', 'byteLength', 'sha256', 'portableCodecId', 'codecVersion']);
    version(r);
    b16V2(r.blobId);
    u64V2(r.blobRevision);
    intV2(r.byteLength, 200 * 1024 * 1024);
    shaV2(r.sha256);
    idV2(r.portableCodecId);
    idV2(r.codecVersion);
    return owned as BlobMetadataV2;
}
export function parseUntrustedBlobBodyV2(input: Uint8Array, maxBytes: number): {
    metadata: BlobMetadataV2;
    bytes: Uint8Array;
} {
    validateByteLimitV2(maxBytes);
    if (!(input instanceof Uint8Array) || input.buffer instanceof SharedArrayBuffer || input.length > maxBytes || input.length < 5)
        failV2();
    const own = Uint8Array.from(input);
    const len = new DataView(own.buffer).getUint32(0, false);
    if (len < 1 || len > 4096 || 4 + len > own.length)
        failV2();
    const metadata = validateBlobMetadataV2(decodeCanonicalV2(own.subarray(4, 4 + len), { maxBytes: 4096 }));
    const bytes = own.slice(4 + len);
    if (metadata.byteLength !== bytes.length)
        failV2();
    return { metadata, bytes };
}
export function validateIndexV2(v: unknown, maxBytes: number): IndexV2 {
    assertVersionV2(v, 'bodyVersion');
    const owned = snapshotJsonV2(v, maxBytes);
    const r = recordV2(owned, ['bodyVersion', 'indexRevision', 'entries', 'sourceWatermarks']);
    version(r);
    u64V2(r.indexRevision);
    arrayV2(r.entries, 100000);
    arrayV2(r.sourceWatermarks, 100000);
    let previous = '';
    for (const entry of r.entries) {
        const x = recordV2(entry, ['objectType', 'objectId', 'revision', 'envelopeSha256']);
        oneOfV2(x.objectType, ['projection', 'tombstone']);
        b16V2(x.objectId);
        u64V2(x.revision);
        shaV2(x.envelopeSha256);
        const key = x.objectType + '\0' + x.objectId;
        if (key <= previous)
            failV2();
        previous = key;
    }
    previous = '';
    for (const w of r.sourceWatermarks) {
        const x = recordV2(w, ['originDeviceId', 'approvedHostEpoch', 'sourceSnapshotId', 'changeSeq', 'deleted']);
        b16V2(x.originDeviceId);
        idV2(x.approvedHostEpoch);
        b16V2(x.sourceSnapshotId);
        u64V2(x.changeSeq);
        if (typeof x.deleted !== 'boolean')
            failV2();
        const key = x.originDeviceId + '\0' + x.approvedHostEpoch + '\0' + x.sourceSnapshotId;
        if (key <= previous)
            failV2();
        previous = key;
    }
    return owned as IndexV2;
}
export function validateTombstoneV2(v: unknown, maxBytes: number): TombstoneV2 {
    assertVersionV2(v, 'bodyVersion');
    const owned = snapshotJsonV2(v, maxBytes);
    const r = recordV2(owned, ['bodyVersion', 'sourceSnapshotId', 'originDeviceId', 'sourceCursor', 'tombstoneRevision']);
    version(r);
    b16V2(r.sourceSnapshotId);
    b16V2(r.originDeviceId);
    cursor(r.sourceCursor);
    u64V2(r.tombstoneRevision);
    return owned as TombstoneV2;
}
export type ProjectionParseResultV2 = {
    status: 'ok';
    value: ProjectionV2;
} | {
    status: 'quarantine';
    ciphertext: Uint8Array;
};
// Caller supplies the original authenticated ciphertext for the sole forward-compatible body case.
export function parseProjectionOrQuarantineV2(value: unknown, ciphertext: Uint8Array, maxBytes: number): ProjectionParseResultV2 {
    validateByteLimitV2(maxBytes);
    if (!(ciphertext instanceof Uint8Array) || ciphertext.buffer instanceof SharedArrayBuffer)
        failV2('invalid-input');
    if (ciphertext.length > maxBytes)
        failV2('over-limit');
    const owned = snapshotJsonV2(value, maxBytes);
    if (!owned || typeof owned !== 'object' || Array.isArray(owned))
        failV2();
    const descriptor = Object.getOwnPropertyDescriptor(owned, 'bodyVersion');
    if (!descriptor || !('value' in descriptor))
        failV2();
    const version = descriptor.value;
    if (typeof version === 'number' && Number.isSafeInteger(version) && version > 2)
        return { status: 'quarantine', ciphertext: Uint8Array.from(ciphertext) };
    return { status: 'ok', value: validateProjectionV2(owned, maxBytes) };
}
/** Requires a trusted digest implementation; this verifies bytes, not sender authorization. */
export function verifyBlobBodyV2(input: Uint8Array, maxBytes: number, sha256: (owned: Uint8Array) => string): {
    metadata: BlobMetadataV2;
    bytes: Uint8Array;
} {
    const parsed = parseUntrustedBlobBodyV2(input, maxBytes);
    const digest = sha256(Uint8Array.from(parsed.bytes));
    shaV2(digest);
    if (digest !== parsed.metadata.sha256)
        failV2();
    return parsed;
}
export function verifyProjectionDigestV2(value: unknown, maxBytes: number, sha256: (owned: Uint8Array) => string): ProjectionV2 {
    const r = validateProjectionV2(value, maxBytes);
    const { projectionDigest, ...body } = r;
    const digest = sha256(encodeCanonicalV2(body, { maxBytes }));
    shaV2(digest);
    if (digest !== projectionDigest)
        failV2();
    return r;
}
