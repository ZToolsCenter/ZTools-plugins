import { decodeCanonicalV2, encodeCanonicalV2, failV2, snapshotJsonV2 } from './canonical.js';
import { b16V2, b32V2, decodeBase64urlV2, literalV2, oneOfV2, recordV2, u64V2 } from './primitives.js';
export const V2_SUITE = 'PBV2-A256GCM-HKDF256-SCRYPT1' as const;
export const V2_MODEL = 'portable-snapshot-v2' as const;
export const V2_MAX_PLAINTEXT = 200 * 1024 * 1024;
export type V2Limits = {
    maxPlaintextBytes: number;
};
export type V2HeaderBase = Readonly<{
    wireVersion: 2; suite: typeof V2_SUITE; model: typeof V2_MODEL;
    accountBindingId: string; vaultId: string; keyEpoch: string; revision: string;
    objectId: string; writerDomainId: string; attemptId: string; nonce: string; plaintextLength: string;
}>;
export type PasswordWrapParamsV2 = Readonly<{ kind: 'password'; kdf: 'scrypt'; N: 131072; r: 8; p: 1; dkLen: 32; salt: string }>;
export type RecoveryWrapParamsV2 = Readonly<{ kind: 'recovery'; kdf: 'hkdf-sha256' }>;
export type V2Header = V2HeaderBase & (
    | Readonly<{ purpose: 'object-seal'; objectType: 'projection' | 'blob' | 'index' | 'tombstone' | 'keyring'; wrapParams?: never }>
    | Readonly<{ purpose: 'password-wrap'; objectType: 'root-wrap'; wrapParams: PasswordWrapParamsV2 }>
    | Readonly<{ purpose: 'recovery-wrap'; objectType: 'root-wrap'; wrapParams: RecoveryWrapParamsV2 }>
);
export type V2ExpectedDescriptor = Pick<V2Header, 'accountBindingId' | 'vaultId' | 'keyEpoch' | 'objectType' | 'objectId' | 'revision'>;
export function validateHeaderV2(input: unknown, limits: V2Limits): V2Header {
    if (!limits || !Number.isSafeInteger(limits.maxPlaintextBytes) || limits.maxPlaintextBytes < 0 || limits.maxPlaintextBytes > V2_MAX_PLAINTEXT)
        failV2();
    if (!input || typeof input !== 'object')
        failV2();
    input = snapshotJsonV2(input, 4096);
    const descriptors = Object.getOwnPropertyDescriptors(input as object);
    for (const d of Object.values(descriptors))
        if (!('value' in d))
            failV2();
    const candidate = input as Record<string, unknown>;
    if (candidate.wireVersion !== 2 || candidate.suite !== V2_SUITE || candidate.model !== V2_MODEL)
        failV2('unsupported-version');
    const keys = ['wireVersion', 'suite', 'model', 'purpose', 'accountBindingId', 'vaultId', 'keyEpoch', 'revision', 'objectType', 'objectId', 'writerDomainId', 'attemptId', 'nonce', 'plaintextLength'];
    const wrapper = candidate.objectType === 'root-wrap';
    if (wrapper)
        keys.push('wrapParams');
    const h = recordV2(input, keys);
    oneOfV2(h.purpose, ['object-seal', 'password-wrap', 'recovery-wrap']);
    oneOfV2(h.objectType, ['projection', 'blob', 'index', 'tombstone', 'keyring', 'root-wrap']);
    b16V2(h.accountBindingId);
    b16V2(h.vaultId);
    b16V2(h.objectId);
    b32V2(h.writerDomainId);
    b32V2(h.attemptId);
    decodeBase64urlV2(h.nonce, 12);
    u64V2(h.keyEpoch);
    u64V2(h.revision);
    u64V2(h.plaintextLength);
    if (BigInt(h.plaintextLength) > BigInt(limits.maxPlaintextBytes))
        failV2('over-limit');
    if (wrapper) {
        if (h.revision !== '0' || h.plaintextLength !== '32')
            failV2();
        if (h.purpose === 'password-wrap') {
            const p = recordV2(h.wrapParams, ['kind', 'kdf', 'N', 'r', 'p', 'dkLen', 'salt']);
            literalV2(p.kind, 'password');
            literalV2(p.kdf, 'scrypt');
            literalV2(p.N, 131072);
            literalV2(p.r, 8);
            literalV2(p.p, 1);
            literalV2(p.dkLen, 32);
            b32V2(p.salt);
        }
        else if (h.purpose === 'recovery-wrap') {
            const p = recordV2(h.wrapParams, ['kind', 'kdf']);
            literalV2(p.kind, 'recovery');
            literalV2(p.kdf, 'hkdf-sha256');
        }
        else
            failV2();
    }
    else if (h.purpose !== 'object-seal')
        failV2();
    return h as V2Header;
}
const magic = new Uint8Array([80, 66, 86, 50]);
export type UntrustedEnvelopeV2 = {
    header: V2Header;
    ciphertext: Uint8Array;
    tag: Uint8Array;
    aad: Uint8Array;
};
export function parseUntrustedEnvelopeV2(bytes: Uint8Array, limits: V2Limits): UntrustedEnvelopeV2 {
    if (!(bytes instanceof Uint8Array) || bytes.buffer instanceof SharedArrayBuffer || bytes.byteLength < 25)
        failV2();
    if (!magic.every((v, i) => bytes[i] === v))
        failV2('unsupported-version');
    const length = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, false);
    if (length < 1 || length > 4096 || bytes.length < 8 + length + 16)
        failV2();
    const header = validateHeaderV2(decodeCanonicalV2(bytes.subarray(8, 8 + length), { maxBytes: 4096 }), limits);
    const bodyLen = Number(BigInt(header.plaintextLength));
    if (bytes.length !== 8 + length + bodyLen + 16)
        failV2();
    return {
        header,
        ciphertext: Uint8Array.from(bytes.subarray(8 + length, -16)),
        tag: Uint8Array.from(bytes.subarray(-16)),
        aad: Uint8Array.from(bytes.subarray(0, 8 + length)),
    };
}
export function encodeEnvelopeV2(header: V2Header, ciphertext: Uint8Array, tag: Uint8Array, limits: V2Limits): Uint8Array {
    const ownedHeader = validateHeaderV2(header, limits);
    if (!(ciphertext instanceof Uint8Array) || ciphertext.buffer instanceof SharedArrayBuffer || !(tag instanceof Uint8Array) || tag.buffer instanceof SharedArrayBuffer || tag.length !== 16 || BigInt(ciphertext.length) !== BigInt(ownedHeader.plaintextLength))
        failV2();
    const h = encodeCanonicalV2(ownedHeader, { maxBytes: 4096 });
    const out = new Uint8Array(8 + h.length + ciphertext.length + 16);
    out.set(magic);
    new DataView(out.buffer).setUint32(4, h.length, false);
    out.set(h, 8);
    out.set(ciphertext, 8 + h.length);
    out.set(tag, 8 + h.length + ciphertext.length);
    return out;
}
