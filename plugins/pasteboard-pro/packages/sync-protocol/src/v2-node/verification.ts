import type { ControlV2, PublicationRootV2 } from "../v2.js";
import { CodecGate } from "./gate.js";
import { own, sha256 } from "./primitives.js";
import { authenticateControlSignature, authenticateControlRoot, authenticatePublication, controlBytes, publicationBytes, sameScope, scope } from "./records.js";
import { V2NodeError, type V2AuthorizationRequest, V2Lease, V2Operation, V2Scope, V2TrustedControlContext, V2TrustedPublicationContext, V2VerificationUnit } from "./types.js";
/** One durable reservation/result per actual signature, root MAC, publication MAC or
 * GCM envelope verification. Extra conservative reservations are never refunded.
 * These adapters remain host-owned; this module does not implement durable storage. */
export function verificationRequest(operation: V2Operation, expected: V2Scope, bindingSha256: string, verificationUnit: V2VerificationUnit): V2AuthorizationRequest {
    return Object.freeze({ operation, scope: Object.freeze({ accountBindingId: expected.accountBindingId, vaultId: expected.vaultId, keyEpoch: expected.keyEpoch }), bindingSha256, verificationUnit });
}
async function parentFence(gate: CodecGate, parent?: V2Lease): Promise<void> {
    if (parent)
        await gate.fence(parent);
}
function wipeResult(value: unknown): void {
    if (value instanceof Uint8Array)
        value.fill(0);
}
export async function verifyAttempt<T>(gate: CodecGate, lease: V2Lease, req: V2AuthorizationRequest, verify: (lease: V2Lease) => T | Promise<T>, parent?: V2Lease): Promise<T> {
    await gate.reserveVerification(lease, req);
    await parentFence(gate, parent);
    let result: T | undefined, verified = false;
    try {
        result = await verify(lease);
        verified = true;
        await gate.fence(lease);
        await parentFence(gate, parent);
    }
    catch (error) {
        // Authentication failure is false. A successful crypto check followed by
        // cancellation is still counted as success, but no material may be released.
        try {
            await gate.authentication(lease, verified);
            await parentFence(gate, parent);
        }
        finally {
            wipeResult(result);
        }
        throw error;
    }
    try {
        await gate.authentication(lease, true);
        await parentFence(gate, parent);
        return result as T;
    }
    catch (error) {
        wipeResult(result);
        throw error;
    }
}
async function admitted<T>(gate: CodecGate, req: V2AuthorizationRequest, verify: () => T, parent?: V2Lease): Promise<T> {
    const lease = await gate.authorize(req);
    await parentFence(gate, parent);
    return await verifyAttempt(gate, lease, req, verify, parent);
}
export async function verifyControlSignature(gate: CodecGate, input: Uint8Array, expected: V2TrustedControlContext, parent?: V2Lease): Promise<ControlV2> {
    const bytes = own(input, undefined, 65536);
    const context = { ...expected, adminPublicKey: own(expected.adminPublicKey, 32) };
    const candidate = controlBytes(bytes);
    // Caller supplies the trust scope/public key. Candidate identity is only bounded
    // verification preparation; it cannot grant writes or establish a new authority.
    sameScope(scope(candidate), context);
    return await admitted(gate, verificationRequest("verify-control", context, sha256(bytes), "control-signature"), () => authenticateControlSignature(bytes, context), parent);
}
export async function verifyControlMac(gate: CodecGate, c: ControlV2, inputRoot: Uint8Array, controlSha256: string, parent?: V2Lease): Promise<void> {
    const root = own(inputRoot, 32);
    try {
        await admitted(gate, verificationRequest("verify-control", scope(c), controlSha256, "control-root-mac"), () => authenticateControlRoot(c, root), parent);
    }
    finally {
        root.fill(0);
    }
}
export async function verifyPublicationMac(gate: CodecGate, input: Uint8Array, inputRoot: Uint8Array, expected: V2TrustedPublicationContext, parent?: V2Lease): Promise<PublicationRootV2> {
    const bytes = own(input, undefined, 8192), root = own(inputRoot, 32), context = { ...expected };
    try {
        const candidate = publicationBytes(bytes);
        // Reject scope/epoch and authenticated control-descriptor substitution BEFORE MAC.
        sameScope(scope(candidate), context);
        if (candidate.controlDescriptor.controlRevision !== context.controlRevision ||
            candidate.controlDescriptor.controlSha256 !== context.controlSha256)
            throw new V2NodeError("context-mismatch");
        return await admitted(gate, verificationRequest("verify-publication", context, sha256(bytes), "publication-mac"), () => authenticatePublication(bytes, root, context), parent);
    }
    finally {
        root.fill(0);
    }
}
