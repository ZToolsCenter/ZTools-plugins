import { V2NodeError, type V2AuthorizationRequest, type V2Lease, type V2NodeCodecOptions } from "./types.js";
/** Coordination only: adapter implementations must enforce durable invariants in host. */
export class CodecGate {
    private counters = new Map<string, bigint>();
    private wrapperIds = new Set<string>();
    constructor(readonly options: V2NodeCodecOptions) {
        const a = options?.authorization, b = options?.budget;
        if (!a || typeof a.authorize !== "function" || typeof a.fence !== "function" || !b ||
            ["reserveSeal", "registerAttempt", "reserveVerification", "recordAuthentication"].some(k => typeof b[k as keyof typeof b] !== "function"))
            throw new V2NodeError("unavailable");
    }
    async fence(lease: V2Lease): Promise<void> {
        try {
            await this.options.authorization.fence(lease);
        }
        catch {
            throw new V2NodeError("unauthorized");
        }
    }
    async authorize(request: V2AuthorizationRequest): Promise<V2Lease> {
        let lease: V2Lease;
        try {
            lease = await this.options.authorization.authorize(request);
        }
        catch {
            throw new V2NodeError("unauthorized");
        }
        if (!lease || typeof lease.token !== "string" || !lease.token || !["registered", "bootstrap-prepare"].includes(lease.mode))
            throw new V2NodeError("unavailable");
        lease = Object.freeze({ token: lease.token, mode: lease.mode });
        await this.fence(lease);
        return lease;
    }
    async reserveSeal(lease: V2Lease, request: V2AuthorizationRequest): Promise<string> {
        if (request.descriptor?.objectType === "root-wrap") {
            const id = [request.scope.accountBindingId, request.scope.vaultId, request.scope.keyEpoch, request.descriptor.objectId].join(":");
            if (this.wrapperIds.has(id) || this.wrapperIds.size >= 4096)
                throw new V2NodeError("unavailable");
            // Attempted/unknown reservations retain this supplemental process-local tombstone.
            this.wrapperIds.add(id);
        }
        let result: {
            counter: string;
        };
        try {
            result = await this.options.budget.reserveSeal(lease, request);
        }
        catch {
            throw new V2NodeError("unavailable");
        }
        await this.fence(lease);
        if (!result || typeof result.counter !== "string" || !/^(0|[1-9][0-9]{0,9})$/.test(result.counter) ||
            BigInt(result.counter) >= 4294967296n)
            throw new V2NodeError("unavailable");
        const id = [request.scope.accountBindingId, request.scope.vaultId, request.scope.keyEpoch, request.writerDomainId].join(":");
        const previous = this.counters.get(id), counter = BigInt(result.counter);
        if (previous !== undefined && counter <= previous)
            throw new V2NodeError("unavailable");
        if (!this.counters.has(id) && this.counters.size >= 4096)
            throw new V2NodeError("unavailable");
        this.counters.set(id, counter);
        return result.counter;
    }
    async attempt(lease: V2Lease, counter: string, attempt: string): Promise<void> {
        try {
            await this.options.budget.registerAttempt(lease, counter, attempt);
        }
        catch {
            throw new V2NodeError("unavailable");
        }
        await this.fence(lease);
    }
    async reserveVerification(lease: V2Lease, request: V2AuthorizationRequest): Promise<void> {
        try {
            await this.options.budget.reserveVerification(lease, request);
        }
        catch {
            throw new V2NodeError("unavailable");
        }
        await this.fence(lease);
    }
    async authentication(lease: V2Lease, valid: boolean): Promise<void> {
        try {
            await this.options.budget.recordAuthentication(lease, valid);
        }
        catch {
            throw new V2NodeError("unavailable");
        }
        await this.fence(lease);
    }
}
