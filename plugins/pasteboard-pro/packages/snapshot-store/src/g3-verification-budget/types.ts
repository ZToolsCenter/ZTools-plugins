import type { V2AuthorizationRequest, V2BudgetAdapter, V2Lease } from '@pasteboard-pro/sync-protocol/v2-node';

export type BudgetErrorCode = 'invalid-input' | 'unauthorized' | 'expired' | 'conflict' | 'locked' | 'capacity' | 'storage-failed' | 'unavailable';
export class BudgetError extends Error {
  constructor(readonly code: BudgetErrorCode) {
    super(code);
    this.name = 'BudgetError';
  }
}

/** Only a trusted host may supply claims, resolver or owner; no defaults exist. */
export type Scope = Readonly<{ storeId: string; accountBindingId: string; vaultId: string; deviceId: string }>;
export type AttemptClaim = Scope & Readonly<{
  installId: string; ownerGeneration: string; securityGeneration: string; unlockGeneration: string;
  sessionId: string; attemptId: string; operation: string;
}>;
export type VerificationClaim = AttemptClaim & Readonly<{
  keyEpoch: string; token: string; mode: V2Lease['mode'];
  unit: NonNullable<V2AuthorizationRequest['verificationUnit']>;
  unitOperation: V2AuthorizationRequest['operation']; bindingSha256: string;
}> & (
  | Readonly<{ kind: 'formal'; rootId: string; managementInstanceId: string }>
  | Readonly<{ kind: 'preparation'; candidateDigest: string; parentAttemptId: string; step: number }>
);
export type FinalizationClaim = VerificationClaim & Readonly<{ active: boolean }>;
export type PromotionClaim = AttemptClaim & Readonly<{
  keyEpoch: string; rootId: string; managementInstanceId: string; candidateDigest: string;
  parentAttemptId: string; authenticatedChainDigest: string;
}>;
export type UnlockClaim = Scope & Readonly<{ installId: string; ownerGeneration: string; token: string; helperTerminated: true }>;
export type BudgetGuard = Readonly<{
  assertOwner(): void;
  assertActive(claim: AttemptClaim | VerificationClaim | PromotionClaim | UnlockClaim): void;
  assertFinalizer(claim: FinalizationClaim): void;
  assertInit(mode: 'create' | 'openExisting', directory: string, storeId: string, installId: string): void;
  confirmCreated(storeId: string, installId: string): Promise<void>;
}>;
export type BudgetOwner = Readonly<{
  /** Holds trusted exclusive owner and serialization until async action completes. */
  withGuard<T>(action: (guard: BudgetGuard) => Promise<T>): Promise<T>;
}>;
export type BudgetResolver = Readonly<{
  attempt(lease: V2Lease, operation: string): AttemptClaim;
  active(lease: V2Lease, request: V2AuthorizationRequest): VerificationClaim;
  finalization(lease: V2Lease): FinalizationClaim;
  /** Must attest complete actual codec result and the required nonempty verification chain. */
  finish(lease: V2Lease, outcome: 'success' | 'failure' | 'quarantine'): AttemptClaim;
  /** Must attest complete chain against trusted anchor; no renderer-controlled authority. */
  promotion(lease: V2Lease, authenticatedChain: unknown): PromotionClaim;
  unlock(lease: V2Lease, scope: Scope): UnlockClaim;
}>;
export type BudgetOptions = Readonly<{
  mode: 'create' | 'openExisting'; directory: string; expectedStoreId: string; expectedInstallId: string;
  owner: BudgetOwner; resolver: BudgetResolver;
}>;
export type VerificationBudget = Readonly<{
  budget: V2BudgetAdapter;
  beginAttempt(lease: V2Lease, operation: string): Promise<V2Lease>;
  finishAttempt(lease: V2Lease, outcome: 'success' | 'failure' | 'quarantine'): Promise<void>;
  promotePreparedRoot(lease: V2Lease, authenticatedChain: unknown): Promise<void>;
  unlockSession(lease: V2Lease, scope: Scope): Promise<void>;
  close(): Promise<void>;
}>;
