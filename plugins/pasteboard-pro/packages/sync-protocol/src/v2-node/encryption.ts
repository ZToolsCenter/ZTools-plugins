import { verifyControlSignature, verifyControlMac, verifyAttempt } from "./verification.js";
import { randomBytes } from "node:crypto";
import { validateHeaderV2, parseUntrustedEnvelopeV2, V2_SUITE, V2_MODEL, decodeBase64urlV2, type V2Header } from "../v2.js";
import { CodecGate } from "./gate.js";
import { own, b64, sha256, canonical, passwordBytes, passwordKey, sealDeterministic, openAuthenticated } from "./primitives.js";
import { authenticateControlSignature, authenticateControlRoot, controlBytes, scope, sameScope } from "./records.js";
import { validatePlaintext } from "./body.js";
import { V2NodeError, type V2SealContext, type V2Expected, type V2TrustedControlContext, type V2AuthorizationRequest, type V2Operation, type V2Lease } from "./types.js";
export type V2WriterAuthority = {
    control: Uint8Array;
    expected: V2TrustedControlContext;
} | {
    bootstrap: true;
};
export type V2SealInput = {
    context: V2SealContext;
    root: Uint8Array;
    plaintext: Uint8Array;
    authority: V2WriterAuthority;
};
export type V2OpenInput = {
    root: Uint8Array;
    envelope: Uint8Array;
    expected: V2Expected;
};
export type V2OpenResult = {
    status: "ok";
    header: V2Header;
    plaintext: Uint8Array;
} | {
    status: "quarantine";
    header: V2Header;
    envelope: Uint8Array;
};
export function request(operation: V2Operation, context: {
    accountBindingId: string;
    vaultId: string;
    keyEpoch: string;
    objectType?: V2Header["objectType"];
    objectId?: string;
    revision?: string;
    purpose?: V2Header["purpose"];
    writerDomainId?: string;
}, bindingSha256: string, writerDomainId?: string): V2AuthorizationRequest {
    return Object.freeze({ operation, scope: Object.freeze({ accountBindingId: context.accountBindingId, vaultId: context.vaultId, keyEpoch: context.keyEpoch }),
        bindingSha256, ...(writerDomainId ? { writerDomainId } : {}),
        ...(context.objectType && context.objectId && context.revision !== undefined && context.purpose && context.writerDomainId ?
            { descriptor: Object.freeze({ accountBindingId: context.accountBindingId, vaultId: context.vaultId, keyEpoch: context.keyEpoch,
                    objectType: context.objectType, objectId: context.objectId, revision: context.revision, purpose: context.purpose, writerDomainId: context.writerDomainId }) } : {}) });
}
function headerFor(context: V2SealContext, purpose: V2Header["purpose"], length: number, wrapParams?: V2Header["wrapParams"]): unknown {
    return { ...context, wireVersion: 2, suite: V2_SUITE, model: V2_MODEL, purpose,
        attemptId: b64(new Uint8Array(32)), nonce: b64(new Uint8Array(12)), plaintextLength: String(length),
        ...(wrapParams ? { wrapParams } : {}) };
}
async function authority(gate: CodecGate, root: Uint8Array, header: V2Header, value: V2WriterAuthority): Promise<boolean> {
    if (value && "bootstrap" in value && value.bootstrap === true) {
        if (header.objectType !== "root-wrap" && header.objectType !== "keyring")
            throw new V2NodeError("unauthorized");
        return true;
    }
    if (!value || !("control" in value))
        throw new V2NodeError("unauthorized");
    const bytes = own(value.control, undefined, 65536), expected = { ...value.expected, adminPublicKey: own(value.expected.adminPublicKey, 32) };
    const candidate = controlBytes(bytes);
    sameScope(scope(candidate), header);
    // An untrusted candidate can only cause early denial, never confer authority.
    if (!candidate.writerDomains.some(d => d.writerDomainId === header.writerDomainId && d.status === "active"))
        throw new V2NodeError("unauthorized");
    if (header.objectType === "root-wrap") {
        for (const old of [candidate.passwordWrap, candidate.recoveryWrap])
            if (parseUntrustedEnvelopeV2(decodeBase64urlV2(old, undefined, 8192), { maxPlaintextBytes: 32 }).header.objectId === header.objectId)
                throw new V2NodeError("context-mismatch");
    }
    const c = await verifyControlSignature(gate, bytes, expected);
    await verifyControlMac(gate, c, root, sha256(bytes));
    return false;
}
function checkExpected(header: V2Header, bytes: Uint8Array, expected: V2Expected): void {
    if (typeof expected.envelopeSha256 !== "string" || !/^[0-9a-f]{64}$/.test(expected.envelopeSha256))
        throw new V2NodeError("context-mismatch");
    if (sha256(bytes) !== expected.envelopeSha256)
        throw new V2NodeError("context-mismatch");
    if (header.objectType === "blob") {
        const b = expected.blobBinding;
        if (!b || !/^[0-9a-f]{64}$/.test(b.sha256) || !Number.isSafeInteger(b.byteLength) || b.byteLength < 0 ||
            b.byteLength > 200 * 1024 * 1024 || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(b.portableCodecId) ||
            !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(b.codecVersion))
            throw new V2NodeError("context-mismatch");
    }
    for (const k of ["accountBindingId", "vaultId", "keyEpoch", "objectType", "objectId", "revision", "purpose"] as const)
        if (header[k] !== expected[k])
            throw new V2NodeError("context-mismatch");
}
export class EncryptionOperations {
    constructor(readonly gate: CodecGate) { }
    async seal(input: V2SealInput, password?: string, recoverySecret?: Uint8Array): Promise<Uint8Array> {
        const root = own(input.root, 32);
        let plain: Buffer | undefined, pwd: Buffer | undefined, secret: Buffer | undefined, ikm: Buffer | undefined;
        try {
            plain = own(input.plaintext, undefined, this.gate.options.limits.maxPlaintextBytes);
            pwd = password === undefined ? undefined : passwordBytes(password);
            secret = recoverySecret === undefined ? undefined : own(recoverySecret, 32);
            const purpose = pwd ? "password-wrap" : secret ? "recovery-wrap" : "object-seal";
            const params = pwd ? { kind: "password", kdf: "scrypt", N: 131072, r: 8, p: 1, dkLen: 32, salt: b64(new Uint8Array(32)) } as const :
                secret ? { kind: "recovery", kdf: "hkdf-sha256" } as const : undefined;
            let header = validateHeaderV2(headerFor(input.context, purpose, plain.length, params), this.gate.options.limits);
            if ((pwd || secret) && (!plain.equals(root) || header.objectType !== "root-wrap"))
                throw new V2NodeError("context-mismatch");
            if (!pwd && !secret && header.objectType === "root-wrap")
                throw new V2NodeError("context-mismatch");
            validatePlaintext(header, plain, this.gate.options.limits.maxPlaintextBytes);
            const bootstrap = await authority(this.gate, root, header, input.authority);
            const op = purpose === "object-seal" ? "seal-object" : pwd ? "wrap-password" : "wrap-recovery";
            const req = request(op, header, sha256(canonical([header, sha256(plain)], 8192)), header.writerDomainId);
            const lease = await this.gate.authorize(req);
            if ((lease.mode === "bootstrap-prepare") !== bootstrap)
                throw new V2NodeError("unauthorized");
            const counter = await this.gate.reserveSeal(lease, req);
            header = validateHeaderV2({ ...header, attemptId: b64(randomBytes(32)), nonce: b64(randomBytes(12)),
                ...(header.wrapParams?.kind === "password" ? { wrapParams: { ...header.wrapParams, salt: b64(randomBytes(32)) } } : {}) }, this.gate.options.limits);
            await this.gate.attempt(lease, counter, header.attemptId);
            if (pwd) {
                ikm = await passwordKey(pwd, decodeBase64urlV2((header.wrapParams as {
                    salt: string;
                }).salt, 32));
                await this.gate.fence(lease);
            }
            else
                ikm = own(secret ?? root, 32);
            const output = sealDeterministic(ikm, header, plain, this.gate.options.limits);
            await this.gate.fence(lease);
            return output;
        }
        finally {
            root.fill(0);
            plain?.fill(0);
            pwd?.fill(0);
            secret?.fill(0);
            ikm?.fill(0);
        }
    }
    async open(input: V2OpenInput, parent?: V2Lease): Promise<V2OpenResult> {
        const root = own(input.root, 32);
        let plaintext: Buffer | undefined;
        try {
            const bytes = own(input.envelope, undefined, this.gate.options.limits.maxPlaintextBytes + 4120);
            const parsed = parseUntrustedEnvelopeV2(bytes, this.gate.options.limits);
            const expected = { ...input.expected, ...(input.expected.blobBinding ? { blobBinding: { ...input.expected.blobBinding } } : {}) };
            checkExpected(parsed.header, bytes, expected);
            if (parsed.header.purpose !== "object-seal")
                throw new V2NodeError("context-mismatch");
            const req = Object.freeze({ ...request("open-object", parsed.header, sha256(bytes)), verificationUnit: "gcm-envelope" as const });
            const lease = await this.gate.authorize(req);
            if (parent)
                await this.gate.fence(parent);
            if (lease.mode !== "registered")
                throw new V2NodeError("unauthorized");
            plaintext = await verifyAttempt(this.gate, lease, req, () => openAuthenticated(root, parsed), parent);
            const result = validatePlaintext(parsed.header, plaintext, this.gate.options.limits.maxPlaintextBytes, expected, true);
            await this.gate.fence(lease);
            return result === "quarantine" ? { status: "quarantine", header: parsed.header, envelope: new Uint8Array(bytes) } :
                { status: "ok", header: parsed.header, plaintext: new Uint8Array(plaintext) };
        }
        finally {
            root.fill(0);
            plaintext?.fill(0);
        }
    }
    async unlock(input: {
        control: Uint8Array;
        expected: V2TrustedControlContext;
        password?: string;
        recoverySecret?: Uint8Array;
    }, parent?: V2Lease): Promise<Uint8Array> {
        const control = own(input.control, undefined, 65536);
        const expected = { ...input.expected, adminPublicKey: own(input.expected.adminPublicKey, 32) };
        const isPassword = input.password !== undefined;
        if (isPassword === (input.recoverySecret !== undefined))
            throw new V2NodeError("context-mismatch");
        let pwd: Buffer | undefined, secret: Buffer | undefined, ikm: Buffer | undefined, plain: Buffer | undefined;
        try {
            pwd = isPassword ? passwordBytes(input.password!) : undefined;
            secret = isPassword ? undefined : own(input.recoverySecret!, 32);
            // Signature consumes its own unit and must pass before expensive KDF.
            const c = await verifyControlSignature(this.gate, control, expected, parent);
            const bytes = decodeBase64urlV2(isPassword ? c.passwordWrap : c.recoveryWrap, undefined, 8192);
            const parsed = parseUntrustedEnvelopeV2(bytes, { maxPlaintextBytes: 32 });
            const req = Object.freeze({ ...request(isPassword ? "unlock-password" : "unlock-recovery", parsed.header, sha256(control)),
                verificationUnit: "gcm-envelope" as const });
            const lease = await this.gate.authorize(req);
            if (parent)
                await this.gate.fence(parent);
            if (lease.mode !== "registered")
                throw new V2NodeError("unauthorized");
            plain = await verifyAttempt(this.gate, lease, req, async (currentLease) => {
                if (pwd) {
                    ikm = await passwordKey(pwd, decodeBase64urlV2((parsed.header.wrapParams as {
                        salt: string;
                    }).salt, 32));
                    await this.gate.fence(currentLease);
                    if (parent)
                        await this.gate.fence(parent);
                }
                else
                    ikm = own(secret!, 32);
                return openAuthenticated(ikm, parsed);
            }, parent);
            await verifyControlMac(this.gate, c, plain, sha256(control), parent);
            await this.gate.fence(lease);
            if (parent)
                await this.gate.fence(parent);
            return new Uint8Array(plain);
        }
        finally {
            pwd?.fill(0);
            secret?.fill(0);
            ikm?.fill(0);
            plain?.fill(0);
        }
    }
}
