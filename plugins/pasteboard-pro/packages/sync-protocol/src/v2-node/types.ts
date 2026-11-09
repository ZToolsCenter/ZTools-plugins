import type { V2Header, V2Limits, V2ExpectedDescriptor } from "../v2.js";
export type V2Scope = Pick<V2Header, "accountBindingId" | "vaultId" | "keyEpoch">;
export type V2SealContext = V2Scope & Pick<V2Header, "objectType" | "objectId" | "revision" | "writerDomainId">;
export type V2Expected = V2ExpectedDescriptor & {
    purpose: V2Header["purpose"];
    envelopeSha256: string;
    blobBinding?: {
        sha256: string;
        byteLength: number;
        portableCodecId: string;
        codecVersion: string;
    };
};
export type V2Operation = "seal-object" | "open-object" | "wrap-password" | "wrap-recovery" | "unlock-password" | "unlock-recovery" | "sign-control" | "verify-control" | "sign-publication" | "verify-publication" | "recover-package";
export type V2VerificationUnit = "control-signature" | "control-root-mac" | "publication-mac" | "gcm-envelope";
export type V2AuthorizationRequest = Readonly<{
    operation: V2Operation;
    scope: Readonly<V2Scope>;
    bindingSha256: string;
    verificationUnit?: V2VerificationUnit;
    writerDomainId?: string;
    descriptor?: Readonly<V2SealContext & {
        purpose: V2Header["purpose"];
    }>;
}>;
export type V2Lease = Readonly<{
    token: string;
    mode: "registered" | "bootstrap-prepare";
}>;
/** Implemented only by the trusted host. Must bind request, installation, scope,
 * policy and generation; sign-control requires the independent admin role.
 * fence must reject revoked/changed state, including after async completion. */
export interface V2AuthorizationAdapter {
    authorize(request: V2AuthorizationRequest): Promise<V2Lease>;
    fence(lease: V2Lease): Promise<void>;
}
/** Durable host adapter, NOT implemented here. Unknown reservations consume budget.
 * reserveSeal must enforce domain registration/identity, monotonic counter <2^32,
 * unique attempt registration, immutable root-wrap IDs and bootstrap intent restrictions. It must not refund.
 * The descriptor is an owned immutable copy; the host checks persistent wrapper/domain registries.
 * reserveVerification enforces per-device epoch <=2^32 and session failure lockout.
 * Every actual signature, root MAC, publication MAC and GCM verification is a
 * separate unit, including failures; requests identify verificationUnit explicitly.
 * recordAuthentication must durably count failures (32 consecutive locks session).
 */
export interface V2BudgetAdapter {
    reserveSeal(lease: V2Lease, request: V2AuthorizationRequest): Promise<{
        counter: string;
    }>;
    registerAttempt(lease: V2Lease, counter: string, attemptId: string): Promise<void>;
    reserveVerification(lease: V2Lease, request: V2AuthorizationRequest): Promise<void>;
    recordAuthentication(lease: V2Lease, authenticated: boolean): Promise<void>;
}
export type V2NodeCodecOptions = {
    limits: V2Limits;
    authorization: V2AuthorizationAdapter;
    budget: V2BudgetAdapter;
};
export type V2TrustedControlContext = V2Scope & {
    adminPublicKey: Uint8Array;
    controlRevision: string;
    controlSha256: string;
    rootId: string;
    managementInstanceId: string;
};
export type V2TrustedPublicationContext = V2Scope & {
    publicationRevision: string;
    publicationSha256: string;
    controlRevision: string;
    controlSha256: string;
};
export class V2NodeError extends Error {
    constructor(readonly code: "unavailable" | "unauthorized" | "authentication-failed" | "context-mismatch" | "conflict" | "obsolete-recovery-package") {
        super(code);
        this.name = "V2NodeError";
    }
}
