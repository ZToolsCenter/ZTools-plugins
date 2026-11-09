import { AuthenticatedRoots } from "./root-ledger.js";
import { verifyControlSignature, verifyControlMac, verifyPublicationMac } from "./verification.js";
import { decodeBase64urlV2, type ControlV2, type PublicationRootV2 } from "../v2.js";
import { CodecGate } from "./gate.js";
import { EncryptionOperations, request } from "./encryption.js";
import { own, sha256, canonical, equal } from "./primitives.js";
import { checkedRecoveryPackage, controlBytes, publicationBytes, controlExpected, publicationExpected, authenticateControlSignature, authenticateControlRoot, authenticatePublication, validateControlSuccessor, validatePublicationSuccessor, checkedKeyring, scope } from "./records.js";
import { V2NodeError } from "./types.js";
export type V2RecoveryStep = Readonly<{
    control: Uint8Array;
    publication: Uint8Array;
    keyringEnvelope?: Uint8Array;
}>;
export type V2RecoveryInput = Readonly<{
    packageBytes: Uint8Array;
    expectedPackageSha256: string;
    steps?: readonly V2RecoveryStep[];
}>;
/** Read-only anchored recovery. Does not discover HEAD, choose forks, persist
 * checkpoints, grant domains, import admin identity, publish or activate records. */
export async function recoverWithChain(gate: CodecGate, encryption: EncryptionOperations, input: V2RecoveryInput) {
    const bytes = own(input.packageBytes, undefined, 256 * 1024);
    if (input.steps && input.steps.length > 128)
        throw new V2NodeError("unavailable");
    const steps = (input.steps ?? []).map(step => ({ control: own(step.control, undefined, 65536),
        publication: own(step.publication, undefined, 8192),
        ...(step.keyringEnvelope ? { keyringEnvelope: own(step.keyringEnvelope, undefined, 65536 + 4120) } : {}) }));
    const parts = checkedRecoveryPackage(bytes, input.expectedPackageSha256);
    let root: Uint8Array | undefined;
    const history = new Map<string, Buffer>();
    const authenticatedRoots = new AuthenticatedRoots();
    try {
        let currentControlBytes = parts.control, currentPublicationBytes = parts.publication;
        let c: ControlV2 = controlBytes(currentControlBytes), p: PublicationRootV2 = publicationBytes(currentPublicationBytes);
        const expected = controlExpected(c, currentControlBytes, parts.publicKey);
        const binding = sha256(canonical([sha256(bytes), steps.map(s => [sha256(s.control), sha256(s.publication),
                s.keyringEnvelope ? sha256(s.keyringEnvelope) : null])], 65536));
        const lease = await gate.authorize(request("recover-package", scope(c), binding));
        if (lease.mode !== "registered")
            throw new V2NodeError("unauthorized");
        await verifyControlSignature(gate, currentControlBytes, expected, lease);
        root = await encryption.unlock({ control: currentControlBytes, expected, recoverySecret: parts.secret }, lease);
        await gate.fence(lease);
        authenticatedRoots.remember(c.keyEpoch, root);
        await verifyPublicationMac(gate, currentPublicationBytes, root, publicationExpected(p, currentPublicationBytes, c, currentControlBytes), lease);
        for (const step of steps) {
            const next = controlBytes(step.control);
            await verifyControlSignature(gate, step.control, controlExpected(next, step.control, parts.publicKey), lease);
            const sameControl = sha256(step.control) === sha256(currentControlBytes);
            if (!sameControl)
                validateControlSuccessor(c, next, currentControlBytes, sha256(currentPublicationBytes));
            if (next.keyEpoch !== c.keyEpoch) {
                let nextRoot: Uint8Array | undefined;
                try {
                    nextRoot = await encryption.unlock({ control: step.control, expected: controlExpected(next, step.control, parts.publicKey),
                        recoverySecret: parts.secret }, lease);
                }
                catch (error) {
                    if (error instanceof V2NodeError && error.code === "authentication-failed")
                        throw new V2NodeError("obsolete-recovery-package");
                    throw error;
                }
                try {
                    await gate.fence(lease);
                    authenticatedRoots.remember(next.keyEpoch, nextRoot, true);
                    root.fill(0);
                    root = nextRoot;
                    nextRoot = undefined;
                }
                finally {
                    nextRoot?.fill(0);
                }
            }
            await verifyControlMac(gate, next, root, sha256(step.control), lease);
            const nextPublication = publicationBytes(step.publication);
            await verifyPublicationMac(gate, step.publication, root, publicationExpected(nextPublication, step.publication, next, step.control), lease);
            validatePublicationSuccessor(p, nextPublication, currentPublicationBytes);
            if (step.keyringEnvelope) {
                const descriptor = next.keyringDescriptor;
                if (!descriptor)
                    throw new V2NodeError("context-mismatch");
                const result = await encryption.open({ root, envelope: step.keyringEnvelope, expected: { ...scope(next),
                        objectType: "keyring", objectId: descriptor.objectId, revision: descriptor.revision, purpose: "object-seal",
                        envelopeSha256: descriptor.envelopeSha256 } }, lease);
                try {
                    await gate.fence(lease);
                    if (result.status !== "ok")
                        throw new V2NodeError("context-mismatch");
                    const keyring = checkedKeyring(result.plaintext, scope(next));
                    for (const entry of keyring.history) {
                        const old = history.get(entry.keyEpoch), key = own(decodeBase64urlV2(entry.root, 32), 32);
                        try {
                            authenticatedRoots.remember(entry.keyEpoch, key);
                        }
                        catch (error) {
                            key.fill(0);
                            throw error;
                        }
                        if (old && !equal(old, key)) {
                            key.fill(0);
                            throw new V2NodeError("conflict");
                        }
                        old?.fill(0);
                        history.set(entry.keyEpoch, key);
                    }
                }
                finally {
                    if (result.status === "ok")
                        result.plaintext.fill(0);
                }
            }
            else if (next.keyEpoch !== c.keyEpoch) {
                // An epoch transition is incomplete until its signed history keyring is obtained.
                throw new V2NodeError("unavailable");
            }
            c = next;
            p = nextPublication;
            currentControlBytes = step.control;
            currentPublicationBytes = step.publication;
        }
        await gate.fence(lease);
        return Object.freeze({ status: "read-only-recovered" as const, scope: Object.freeze(scope(c)), root: new Uint8Array(root),
            rootId: c.rootId, managementInstanceId: c.managementInstanceId, controlSha256: sha256(currentControlBytes),
            publicationSha256: sha256(currentPublicationBytes), freshness: "trusted-anchor-only" as const,
            history: Object.freeze([...history].map(([keyEpoch, key]) => Object.freeze({ keyEpoch, root: new Uint8Array(key) }))) });
    }
    finally {
        parts.seed.fill(0);
        parts.secret.fill(0);
        root?.fill(0);
        authenticatedRoots.close();
        for (const key of history.values())
            key.fill(0);
    }
}
