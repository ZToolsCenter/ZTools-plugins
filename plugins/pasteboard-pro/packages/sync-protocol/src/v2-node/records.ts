import type { ControlV2, PublicationRootV2, RecoveryPackageV2, HistoryKeyringV2 } from "../v2.js";
type RecordV2 = Record<string, unknown>;
import { decodeCanonicalV2, decodeBase64urlV2, validateControlV2, validatePublicationV2, validateRecoveryPackageV2, validateHistoryKeyringV2 } from "../v2.js";
import { own, canonical, without, sha256, b64, equal, mac, adminPublic, adminSign, adminVerify } from "./primitives.js";
import { V2NodeError, type V2Scope, type V2TrustedControlContext, type V2TrustedPublicationContext } from "./types.js";
export function scope(record: RecordV2): V2Scope {
    return { accountBindingId: record.accountBindingId as string, vaultId: record.vaultId as string, keyEpoch: record.keyEpoch as string };
}
export function sameScope(a: V2Scope, b: V2Scope): void {
    for (const k of ["accountBindingId", "vaultId", "keyEpoch"] as const)
        if (a[k] !== b[k])
            throw new V2NodeError("context-mismatch");
}
export function controlBytes(bytes: Uint8Array): ControlV2 {
    return validateControlV2(decodeCanonicalV2(bytes, { maxBytes: 65536 }));
}
export function publicationBytes(bytes: Uint8Array): PublicationRootV2 {
    return validatePublicationV2(decodeCanonicalV2(bytes, { maxBytes: 8192 }));
}
export function requireMac(actual: unknown, expected: string): void {
    const a = decodeBase64urlV2(actual, 32), b = decodeBase64urlV2(expected, 32);
    if (!equal(a, b))
        throw new V2NodeError("authentication-failed");
}
/** Signature and caller's complete checkpoint descriptor checked BEFORE password KDF. */
export function authenticateControlSignature(bytes: Uint8Array, expected: V2TrustedControlContext): ControlV2 {
    const c = controlBytes(bytes);
    sameScope(scope(c), expected);
    if (c.controlRevision !== expected.controlRevision || c.rootId !== expected.rootId ||
        c.managementInstanceId !== expected.managementInstanceId || sha256(bytes) !== expected.controlSha256 ||
        c.adminPublicKey !== b64(own(expected.adminPublicKey, 32)))
        throw new V2NodeError("context-mismatch");
    if (!adminVerify(expected.adminPublicKey, canonical(without(c, "adminSignature")), c.adminSignature))
        throw new V2NodeError("authentication-failed");
    return c;
}
export function authenticateControlRoot(c: ControlV2, root: Uint8Array): void {
    requireMac(c.rootMac, mac(root, scope(c), "control-auth", canonical(without(c, "rootMac", "adminSignature"))));
}
export function signedControl(input: Omit<ControlV2, "rootMac" | "adminSignature">, root: Uint8Array, seed: Uint8Array): Uint8Array {
    // Strict shape before signing; placeholders are fixed size, never accepted authority.
    const c = validateControlV2({ ...input, rootMac: b64(new Uint8Array(32)), adminSignature: b64(new Uint8Array(64)) });
    if (c.adminPublicKey !== b64(adminPublic(seed)))
        throw new V2NodeError("context-mismatch");
    const withMac = { ...c, rootMac: mac(root, scope(c), "control-auth", canonical(without(c, "rootMac", "adminSignature"))) };
    const signed = { ...withMac, adminSignature: adminSign(seed, canonical(without(withMac, "adminSignature"))) };
    validateControlV2(signed);
    return canonical(signed);
}
export function signedPublication(input: Omit<PublicationRootV2, "auth">, root: Uint8Array): Uint8Array {
    const p = validatePublicationV2({ ...input, auth: b64(new Uint8Array(32)) });
    return canonical({ ...p, auth: mac(root, scope(p), "publication-auth", canonical(without(p, "auth"), 8192)) }, 8192);
}
export function authenticatePublication(bytes: Uint8Array, root: Uint8Array, expected: V2TrustedPublicationContext): PublicationRootV2 {
    const p = publicationBytes(bytes);
    sameScope(scope(p), expected);
    const cd = p.controlDescriptor as RecordV2;
    if (p.publicationRevision !== expected.publicationRevision || sha256(bytes) !== expected.publicationSha256 ||
        cd.controlRevision !== expected.controlRevision || cd.controlSha256 !== expected.controlSha256)
        throw new V2NodeError("context-mismatch");
    requireMac(p.auth, mac(root, scope(p), "publication-auth", canonical(without(p, "auth"), 8192)));
    return p;
}
export function controlExpected(c: ControlV2, bytes: Uint8Array, publicKey: Uint8Array): V2TrustedControlContext {
    return { ...scope(c), adminPublicKey: own(publicKey, 32), controlRevision: c.controlRevision as string,
        controlSha256: sha256(bytes), rootId: c.rootId as string, managementInstanceId: c.managementInstanceId as string };
}
export function publicationExpected(p: PublicationRootV2, bytes: Uint8Array, c: ControlV2, control: Uint8Array): V2TrustedPublicationContext {
    return { ...scope(c), publicationRevision: p.publicationRevision as string, publicationSha256: sha256(bytes),
        controlRevision: c.controlRevision as string, controlSha256: sha256(control) };
}
export function validateControlSuccessor(previous: ControlV2, next: ControlV2, previousBytes: Uint8Array, previousPublicationSha256: string): void {
    if (previous.accountBindingId !== next.accountBindingId || previous.vaultId !== next.vaultId ||
        previous.adminPublicKey !== next.adminPublicKey || next.prevControlDigest !== sha256(previousBytes) ||
        BigInt(next.controlRevision as string) !== BigInt(previous.controlRevision as string) + 1n)
        throw new V2NodeError("conflict");
    if (next.keyEpoch === previous.keyEpoch) {
        if (next.rootId !== previous.rootId || next.managementInstanceId !== previous.managementInstanceId || next.transition !== null)
            throw new V2NodeError("conflict");
        const oldDomains = previous.writerDomains, newDomains = next.writerDomains;
        for (const old of oldDomains) {
            const found = newDomains.find(d => d.writerDomainId === old.writerDomainId);
            if (!found || (old.status === "revoked" && found.status !== "revoked"))
                throw new V2NodeError("conflict");
        }
    }
    else {
        const t = next.transition;
        if (BigInt(next.keyEpoch as string) <= BigInt(previous.keyEpoch as string) || next.rootId === previous.rootId ||
            next.managementInstanceId === previous.managementInstanceId || !t ||
            t.previousEpoch !== previous.keyEpoch || t.previousRootId !== previous.rootId ||
            t.previousManagementInstanceId !== previous.managementInstanceId || t.previousControlDigest !== sha256(previousBytes) ||
            t.previousPublicationDigest !== previousPublicationSha256)
            throw new V2NodeError("conflict");
    }
}
/** Rejects intrinsically invalid publication links. An increasing epoch is not an
 * admin grant: callers must also verify its signed control/transition chain. */
export function validatePublicationSuccessor(previous: PublicationRootV2, next: PublicationRootV2, bytes: Uint8Array): void {
    if (previous.accountBindingId !== next.accountBindingId || previous.vaultId !== next.vaultId ||
        BigInt(next.keyEpoch) < BigInt(previous.keyEpoch) ||
        BigInt(next.publicationRevision as string) !== BigInt(previous.publicationRevision as string) + 1n ||
        next.previousPublicationDigest !== sha256(bytes))
        throw new V2NodeError("conflict");
}
export function checkedRecoveryPackage(bytes: Uint8Array, expectedPackageSha256: string): {
    package: RecoveryPackageV2;
    control: Uint8Array;
    publication: Uint8Array;
    seed: Buffer;
    secret: Buffer;
    publicKey: Uint8Array;
} {
    if (sha256(bytes) !== expectedPackageSha256)
        throw new V2NodeError("context-mismatch");
    const p = validateRecoveryPackageV2(decodeCanonicalV2(bytes, { maxBytes: 256 * 1024 }));
    if (sha256(canonical(without(p, "checksum"), 256 * 1024)) !== p.checksum)
        throw new V2NodeError("authentication-failed");
    const seed = own(decodeBase64urlV2(p.adminSeed, 32), 32), secret = own(decodeBase64urlV2(p.recoverySecret, 32), 32);
    try {
        const publicKey = adminPublic(seed);
        if (sha256(publicKey) !== p.adminPublicKeyFingerprint)
            throw new V2NodeError("authentication-failed");
        return { package: p, control: decodeBase64urlV2(p.anchorControl, undefined, 65536),
            publication: decodeBase64urlV2(p.anchorPublication, undefined, 8192), seed, secret, publicKey };
    }
    catch (error) {
        seed.fill(0);
        secret.fill(0);
        throw error;
    }
}
export function checkedKeyring(bytes: Uint8Array, scopeExpected: V2Scope): HistoryKeyringV2 {
    const k = validateHistoryKeyringV2(decodeCanonicalV2(bytes, { maxBytes: 65536 }));
    sameScope(scope(k), scopeExpected);
    return k;
}
