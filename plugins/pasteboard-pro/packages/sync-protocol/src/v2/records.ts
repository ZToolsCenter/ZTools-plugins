import { encodeCanonicalV2, failV2, snapshotJsonV2 } from './canonical.js';
import type { ControlV2, PublicationRootV2, RecoveryPackageV2, HistoryKeyringV2, V2Descriptor } from './types.js';
import { parseUntrustedEnvelopeV2, V2_MODEL, V2_SUITE } from './envelope.js';
import { assertVersionV2, arrayV2, b16V2, b32V2, decodeBase64urlV2, literalV2, oneOfV2, recordV2, shaV2, u64V2, type RecordV2 } from './primitives.js';
const common = ['suite', 'model', 'accountBindingId', 'vaultId', 'keyEpoch'];
function base(r: RecordV2) {
    literalV2(r.suite, V2_SUITE);
    literalV2(r.model, V2_MODEL);
    b16V2(r.accountBindingId);
    b16V2(r.vaultId);
    u64V2(r.keyEpoch);
}
function prior(rev: unknown, digest: unknown) {
    u64V2(rev);
    if (rev === '0')
        literalV2(digest, null);
    else
        shaV2(digest);
}
export function validateObjectDescriptorV2(v: unknown, type?: string): V2Descriptor {
    const owned = snapshotJsonV2<V2Descriptor>(v, 8192);
    const r = recordV2(owned, ['objectType', 'objectId', 'revision', 'envelopeSha256']);
    oneOfV2(r.objectType, ['projection', 'tombstone', 'index', 'keyring']);
    if (type)
        literalV2(r.objectType, type);
    b16V2(r.objectId);
    u64V2(r.revision);
    shaV2(r.envelopeSha256);
    return owned;
}
export function validateControlV2(v: unknown): ControlV2 {
    assertVersionV2(v, 'controlVersion');
    const owned = snapshotJsonV2(v, 65536);
    const r = recordV2(owned, ['controlVersion', ...common, 'rootId', 'managementInstanceId', 'controlRevision', 'prevControlDigest', 'adminPublicKey', 'writerDomains', 'passwordWrap', 'recoveryWrap', 'keyringDescriptor', 'transition', 'rootMac', 'adminSignature']);
    if (r.controlVersion !== 2)
        failV2('unsupported-version');
    base(r);
    b32V2(r.rootId);
    b32V2(r.managementInstanceId);
    prior(r.controlRevision, r.prevControlDigest);
    b32V2(r.adminPublicKey);
    b32V2(r.rootMac);
    decodeBase64urlV2(r.adminSignature, 64);
    arrayV2(r.writerDomains, 32);
    let prev = '';
    for (const d of r.writerDomains) {
        const x = recordV2(d, ['writerDomainId', 'status']);
        b32V2(x.writerDomainId);
        oneOfV2(x.status, ['active', 'revoked']);
        if ((x.writerDomainId as string) <= prev)
            failV2();
        prev = x.writerDomainId as string;
    }
    for (const [name, purpose] of [['passwordWrap', 'password-wrap'], ['recoveryWrap', 'recovery-wrap']] as const) {
        const bytes = decodeBase64urlV2(r[name], undefined, 8192);
        const e = parseUntrustedEnvelopeV2(bytes, { maxPlaintextBytes: 32 });
        const h = e.header;
        if (h.purpose !== purpose || h.accountBindingId !== r.accountBindingId || h.vaultId !== r.vaultId || h.keyEpoch !== r.keyEpoch || !r.writerDomains.some(d => (d as RecordV2).writerDomainId === h.writerDomainId))
            failV2();
    }
    if (r.keyringDescriptor !== null)
        validateObjectDescriptorV2(r.keyringDescriptor, 'keyring');
    if (r.transition !== null) {
        const t = recordV2(r.transition, ['previousEpoch', 'previousRootId', 'previousManagementInstanceId', 'previousControlDigest', 'previousPublicationDigest']);
        u64V2(t.previousEpoch);
        if (BigInt(t.previousEpoch) >= BigInt(r.keyEpoch as string))
            failV2();
        b32V2(t.previousRootId);
        b32V2(t.previousManagementInstanceId);
        shaV2(t.previousControlDigest);
        shaV2(t.previousPublicationDigest);
    }
    if (r.keyEpoch === '0' && (r.transition !== null || r.keyringDescriptor !== null))
        failV2();
    if (r.keyEpoch !== '0' && r.keyringDescriptor === null)
        failV2();
    return owned as ControlV2;
}
export function validatePublicationV2(v: unknown): PublicationRootV2 {
    assertVersionV2(v, 'publicationVersion');
    const owned = snapshotJsonV2(v, 8192);
    const r = recordV2(owned, ['publicationVersion', ...common, 'publicationRevision', 'previousPublicationDigest', 'controlDescriptor', 'indexDescriptor', 'auth']);
    if (r.publicationVersion !== 2)
        failV2('unsupported-version');
    base(r);
    prior(r.publicationRevision, r.previousPublicationDigest);
    b32V2(r.auth);
    const c = recordV2(r.controlDescriptor, ['controlRevision', 'controlSha256']);
    u64V2(c.controlRevision);
    shaV2(c.controlSha256);
    validateObjectDescriptorV2(r.indexDescriptor, 'index');
    return owned as PublicationRootV2;
}
export function validateRecoveryPackageV2(v: unknown): RecoveryPackageV2 {
    assertVersionV2(v, 'packageVersion');
    const owned = snapshotJsonV2(v, 256 * 1024);
    const r = recordV2(owned, ['packageVersion', 'suite', 'model', 'accountBindingId', 'vaultId', 'recoverySecret', 'adminSeed', 'adminPublicKeyFingerprint', 'anchorControl', 'anchorPublication', 'checksum']);
    if (r.packageVersion !== 2)
        failV2('unsupported-version');
    literalV2(r.suite, V2_SUITE);
    literalV2(r.model, V2_MODEL);
    b16V2(r.accountBindingId);
    b16V2(r.vaultId);
    b32V2(r.recoverySecret);
    b32V2(r.adminSeed);
    shaV2(r.adminPublicKeyFingerprint);
    shaV2(r.checksum);
    const controlBytes = decodeBase64urlV2(r.anchorControl, undefined, 65536);
    const pubBytes = decodeBase64urlV2(r.anchorPublication, undefined, 8192);
    // Nested canonical records are structurally parsed, not cryptographically verified.
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let control: unknown, publication: unknown;
    try {
        control = JSON.parse(decoder.decode(controlBytes));
        publication = JSON.parse(decoder.decode(pubBytes));
    }
    catch {
        failV2();
    }
    const c = validateControlV2(control), p = validatePublicationV2(publication);
    for (const [bytes, value, max] of [[controlBytes, c, 65536], [pubBytes, p, 8192]] as const) {
        const enc = encodeCanonicalV2(value, { maxBytes: max });
        if (enc.length !== bytes.length || enc.some((b, i) => b !== bytes[i]))
            failV2('non-canonical');
    }
    if (c.accountBindingId !== r.accountBindingId || c.vaultId !== r.vaultId || p.accountBindingId !== r.accountBindingId || p.vaultId !== r.vaultId || p.keyEpoch !== c.keyEpoch)
        failV2();
    return owned as RecoveryPackageV2;
}
export function validateHistoryKeyringV2(v: unknown): HistoryKeyringV2 {
    assertVersionV2(v, 'keyringVersion');
    const owned = snapshotJsonV2(v, 65536);
    const r = recordV2(owned, ['keyringVersion', 'accountBindingId', 'vaultId', 'keyEpoch', 'history']);
    if (r.keyringVersion !== 2)
        failV2('unsupported-version');
    b16V2(r.accountBindingId);
    b16V2(r.vaultId);
    u64V2(r.keyEpoch);
    arrayV2(r.history, 128);
    let last = -1n;
    for (const e of r.history) {
        const x = recordV2(e, ['keyEpoch', 'root']);
        u64V2(x.keyEpoch);
        b32V2(x.root);
        const n = BigInt(x.keyEpoch);
        if (n <= last || n >= BigInt(r.keyEpoch))
            failV2();
        last = n;
    }
    return owned as HistoryKeyringV2;
}
