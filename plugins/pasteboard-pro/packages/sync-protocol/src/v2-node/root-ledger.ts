import { own, equal } from "./primitives.js";
import { V2NodeError } from "./types.js";
/** In-call consistency evidence only. Not a durable checkpoint or key store.
 * Keeps authenticated roots until all comparison work is complete. */
export class AuthenticatedRoots {
    private readonly roots = new Map<string, Buffer>();
    remember(epoch: string, input: Uint8Array, freshEpoch = false): void {
        const key = own(input, 32);
        try {
            const known = this.roots.get(epoch);
            if (known) {
                if (!equal(known, key))
                    throw new V2NodeError("conflict");
                return;
            }
            for (const [otherEpoch, other] of this.roots) {
                if (otherEpoch !== epoch && equal(other, key))
                    throw new V2NodeError("conflict");
            }
            if (this.roots.size >= 256)
                throw new V2NodeError("unavailable");
            // Both a newly authenticated epoch and authenticated history entries
            // must conserve any previously known association; neither self-labels trust.
            void freshEpoch;
            this.roots.set(epoch, own(key, 32));
        }
        finally {
            key.fill(0);
        }
    }
    close(): void {
        for (const key of this.roots.values())
            key.fill(0);
        this.roots.clear();
    }
}
