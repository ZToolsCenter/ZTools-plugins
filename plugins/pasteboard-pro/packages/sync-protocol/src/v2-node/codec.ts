import { verifyControlSignature, verifyControlMac, verifyPublicationMac } from "./verification.js";
import { recoverWithChain, type V2RecoveryInput } from "./recovery.js";
import type { ControlV2, PublicationRootV2 } from "../v2.js";
type RecordV2 = Record<string, unknown>;
import { V2ProtocolError, validateHeaderV2, validateControlV2, validatePublicationV2, decodeBase64urlV2, decodeCanonicalV2, } from "../v2.js";
import { CodecGate } from "./gate.js";
import { EncryptionOperations, request, type V2SealInput, type V2OpenInput } from "./encryption.js";
import { own, canonical, sha256, b64, without, equal } from "./primitives.js";
import { scope, sameScope, signedControl, signedPublication, authenticateControlSignature, authenticateControlRoot, authenticatePublication, controlBytes, publicationBytes, controlExpected, publicationExpected, checkedRecoveryPackage, checkedKeyring, validateControlSuccessor, validatePublicationSuccessor } from "./records.js";
import { V2NodeError, type V2NodeCodecOptions, type V2TrustedControlContext, type V2TrustedPublicationContext } from "./types.js";
export type V2ControlInput = {
    control: Uint8Array;
    root: Uint8Array;
    expected: V2TrustedControlContext;
};
export type V2PublicationInput = {
    publication: Uint8Array;
    root: Uint8Array;
    expected: V2TrustedPublicationContext;
};
function controlContextCopy(value: V2TrustedControlContext): V2TrustedControlContext {
    return { ...value, adminPublicKey: own(value.adminPublicKey, 32) };
}
/** Standalone trusted-helper component. Does not supply key storage, admin authority,
 * durable counters, watchdog, policy scanning, transport or activation. */
export function createV2NodeCodec(options: V2NodeCodecOptions) {
    new CodecGate(options);
    // Own immutable limits; caller cannot raise the cap across an await.
    const limits = Object.freeze({ maxPlaintextBytes: options.limits?.maxPlaintextBytes });
    validateHeaderV2({ wireVersion: 2, suite: "PBV2-A256GCM-HKDF256-SCRYPT1", model: "portable-snapshot-v2",
        purpose: "object-seal", accountBindingId: b64(new Uint8Array(16)), vaultId: b64(new Uint8Array(16)),
        keyEpoch: "0", revision: "0", objectType: "index", objectId: b64(new Uint8Array(16)),
        writerDomainId: b64(new Uint8Array(32)), attemptId: b64(new Uint8Array(32)), nonce: b64(new Uint8Array(12)), plaintextLength: "0" }, limits);
    // Adapters are trusted but their method references must not be swapped while pending.
    const safeGate = new CodecGate({ limits, authorization: {
            authorize: options.authorization.authorize.bind(options.authorization), fence: options.authorization.fence.bind(options.authorization)
        },
        budget: { reserveSeal: options.budget.reserveSeal.bind(options.budget), registerAttempt: options.budget.registerAttempt.bind(options.budget),
            reserveVerification: options.budget.reserveVerification.bind(options.budget), recordAuthentication: options.budget.recordAuthentication.bind(options.budget) } });
    const encryption = new EncryptionOperations(safeGate);
    async function checkedControl(input: V2ControlInput) {
        const root = own(input.root, 32);
        try {
            const bytes = own(input.control, undefined, 65536), expected = controlContextCopy(input.expected);
            const c = await verifyControlSignature(safeGate, bytes, expected);
            await verifyControlMac(safeGate, c, root, sha256(bytes));
            return c;
        }
        finally {
            root.fill(0);
        }
    }
    async function checkedPublication(input: V2PublicationInput) {
        const root = own(input.root, 32);
        try {
            const bytes = own(input.publication, undefined, 8192), expected = { ...input.expected };
            return await verifyPublicationMac(safeGate, bytes, root, expected);
        }
        finally {
            root.fill(0);
        }
    }
    const api = {
        sealObject: (input: V2SealInput) => encryption.seal(input),
        openObject: (input: V2OpenInput) => encryption.open(input),
        wrapPassword: (input: Omit<V2SealInput, "plaintext"> & {
            password: string;
        }) => encryption.seal({ ...input, plaintext: input.root }, input.password),
        wrapRecovery: (input: Omit<V2SealInput, "plaintext"> & {
            recoverySecret: Uint8Array;
        }) => encryption.seal({ ...input, plaintext: input.root }, undefined, input.recoverySecret),
        unlockPassword: (input: {
            password: string;
            control: Uint8Array;
            expected: V2TrustedControlContext;
        }) => encryption.unlock(input),
        unlockRecovery: (input: {
            recoverySecret: Uint8Array;
            control: Uint8Array;
            expected: V2TrustedControlContext;
        }) => encryption.unlock(input),
        verifyControl: checkedControl,
        verifyPublication: checkedPublication,
        async signControl(input: {
            body: Omit<ControlV2, "rootMac" | "adminSignature">;
            root: Uint8Array;
            adminSeed: Uint8Array;
        }) {
            const root = own(input.root, 32), seed = own(input.adminSeed, 32);
            try {
                const body = decodeCanonicalV2(canonical(input.body), { maxBytes: 65536 }) as RecordV2;
                // Validate full shape and wrapper parameters before authorization.
                const candidate = validateControlV2({ ...body, rootMac: b64(new Uint8Array(32)), adminSignature: b64(new Uint8Array(64)) });
                const lease = await safeGate.authorize(request("sign-control", scope(candidate), sha256(canonical(candidate))));
                const bytes = signedControl(candidate, root, seed);
                await safeGate.fence(lease);
                return bytes;
            }
            finally {
                root.fill(0);
                seed.fill(0);
            }
        },
        async signPublication(input: {
            body: Omit<PublicationRootV2, "auth">;
            root: Uint8Array;
            control: Uint8Array;
            controlExpected: V2TrustedControlContext;
        }) {
            const root = own(input.root, 32), control = own(input.control, undefined, 65536), expected = controlContextCopy(input.controlExpected);
            try {
                const body = decodeCanonicalV2(canonical(input.body, 8192), { maxBytes: 8192 }) as RecordV2;
                const p = validatePublicationV2({ ...body, auth: b64(new Uint8Array(32)) });
                const c = await verifyControlSignature(safeGate, control, expected);
                await verifyControlMac(safeGate, c, root, sha256(control));
                sameScope(scope(p), scope(c));
                const cd = p.controlDescriptor;
                if (cd.controlRevision !== c.controlRevision || cd.controlSha256 !== sha256(control))
                    throw new V2NodeError("context-mismatch");
                const lease = await safeGate.authorize(request("sign-publication", scope(p), sha256(canonical(p, 8192))));
                if (lease.mode !== "registered")
                    throw new V2NodeError("unauthorized");
                const bytes = signedPublication(p, root);
                await safeGate.fence(lease);
                return bytes;
            }
            finally {
                root.fill(0);
            }
        },
        async verifyControlSuccessor(input: {
            previous: V2ControlInput;
            next: V2ControlInput;
            previousPublicationSha256: string;
        }) {
            // Snapshot all inputs before either verification yields.
            const previous = { control: own(input.previous.control, undefined, 65536), root: own(input.previous.root, 32),
                expected: controlContextCopy(input.previous.expected) };
            const next = { control: own(input.next.control, undefined, 65536), root: own(input.next.root, 32),
                expected: controlContextCopy(input.next.expected) };
            const publicationDigest = input.previousPublicationSha256;
            try {
                const a = await checkedControl(previous), b = await checkedControl(next);
                validateControlSuccessor(a, b, previous.control, publicationDigest);
                if ((a.keyEpoch === b.keyEpoch) !== equal(previous.root, next.root))
                    throw new V2NodeError("conflict");
                return b;
            }
            finally {
                previous.root.fill(0);
                next.root.fill(0);
            }
        },
        async verifyPublicationSuccessor(input: {
            previous: V2PublicationInput;
            next: V2PublicationInput;
        }) {
            const a = { publication: own(input.previous.publication, undefined, 8192), root: own(input.previous.root, 32), expected: { ...input.previous.expected } };
            const b = { publication: own(input.next.publication, undefined, 8192), root: own(input.next.root, 32), expected: { ...input.next.expected } };
            try {
                const old = await checkedPublication(a), next = await checkedPublication(b);
                validatePublicationSuccessor(old, next, a.publication);
                return next;
            }
            finally {
                a.root.fill(0);
                b.root.fill(0);
            }
        },
        recoverPackage(input: {
            packageBytes: Uint8Array;
            expectedPackageSha256: string;
        }) {
            return recoverWithChain(safeGate, encryption, input);
        },
        recoverPackageToControl(input: V2RecoveryInput) {
            return recoverWithChain(safeGate, encryption, input);
        },
    };
    return Object.freeze({
        sealObject: guard(api.sealObject),
        openObject: guard(api.openObject),
        wrapPassword: guard(api.wrapPassword),
        wrapRecovery: guard(api.wrapRecovery),
        unlockPassword: guard(api.unlockPassword),
        unlockRecovery: guard(api.unlockRecovery),
        verifyControl: guard(api.verifyControl),
        verifyPublication: guard(api.verifyPublication),
        signControl: guard(api.signControl),
        signPublication: guard(api.signPublication),
        verifyControlSuccessor: guard(api.verifyControlSuccessor),
        verifyPublicationSuccessor: guard(api.verifyPublicationSuccessor),
        recoverPackage: guard(api.recoverPackage),
        recoverPackageToControl: guard(api.recoverPackageToControl),
    });
}
function guard<A extends unknown[], R>(fn: (...args: A) => Promise<R>): (...args: A) => Promise<R> {
    return async (...args: A): Promise<R> => {
        try {
            return await fn(...args);
        }
        catch (error) {
            if (error instanceof V2NodeError)
                throw new V2NodeError(error.code);
            if (error instanceof V2ProtocolError)
                throw new V2ProtocolError(error.code);
            throw new V2NodeError("unavailable");
        }
    };
}
