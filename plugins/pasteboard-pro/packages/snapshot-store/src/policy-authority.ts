import { SnapshotStoreErrorV2 } from "./errors.js";

function validRevision(value: string): boolean {
  return typeof value === "string" && value.trim().length > 0 && Buffer.byteLength(value, "utf8") <= 512;
}

/** Policy activation and durable commits share one linear order in the trusted owner. */
export class PolicyCommitAuthorityV2 {
  private revision: string;
  private tail: Promise<void> = Promise.resolve();

  constructor(initialRevision: string) {
    if (!validRevision(initialRevision)) throw new SnapshotStoreErrorV2("invalid-input");
    this.revision = initialRevision;
  }

  currentRevision(): string { return this.revision; }

  private enqueue<T>(action: () => Promise<T>): Promise<T> {
    const result = this.tail.then(action);
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }

  activate(revision: string): Promise<void> {
    if (!validRevision(revision)) return Promise.reject(new SnapshotStoreErrorV2("invalid-input"));
    return this.enqueue(async () => { this.revision = revision; });
  }

  withinCommit<T>(expected: string, action: (guard: () => void) => Promise<T>): Promise<T> {
    return this.enqueue(async () => {
      const guard = () => {
        if (this.revision !== expected) throw new SnapshotStoreErrorV2("policy-changed");
      };
      guard();
      return action(guard);
    });
  }
}
