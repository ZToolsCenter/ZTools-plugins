import { BudgetError, type AttemptClaim, type FinalizationClaim, type PromotionClaim, type Scope, type UnlockClaim, type VerificationClaim } from './types';
import { checkAttempt, checkScope, checkVerification, copyClaim, requireOpaque32, requireString } from './records';

const attemptFields = ['storeId', 'accountBindingId', 'vaultId', 'deviceId', 'installId', 'ownerGeneration', 'securityGeneration', 'unlockGeneration', 'sessionId', 'attemptId', 'operation'] as const;
const verificationFields = [...attemptFields, 'keyEpoch', 'token', 'mode', 'unit', 'unitOperation', 'bindingSha256', 'kind'] as const;
const operations = ['seal-object', 'open-object', 'wrap-password', 'wrap-recovery', 'unlock-password', 'unlock-recovery', 'sign-control', 'verify-control', 'sign-publication', 'verify-publication', 'recover-package'];
const units = ['control-signature', 'control-root-mac', 'publication-mac', 'gcm-envelope'];
type Kind = 'attempt' | 'verification' | 'finalization' | 'promotion' | 'unlock' | 'scope';
function exact(value: object, keys: readonly string[]): void {
  const actual = Reflect.ownKeys(value);
  if (actual.length !== keys.length || actual.some(k => typeof k !== 'string' || !keys.includes(k))) throw new BudgetError('unauthorized');
}
export function parseClaim(value: object, kind: 'attempt', storeId: string, installId: string): AttemptClaim;
export function parseClaim(value: object, kind: 'verification', storeId: string, installId: string): VerificationClaim;
export function parseClaim(value: object, kind: 'finalization', storeId: string, installId: string): FinalizationClaim;
export function parseClaim(value: object, kind: 'promotion', storeId: string, installId: string): PromotionClaim;
export function parseClaim(value: object, kind: 'unlock', storeId: string, installId: string): UnlockClaim;
export function parseClaim(value: object, kind: 'scope', storeId: string, installId: string): Scope;
export function parseClaim(value: object, kind: Kind, storeId: string, installId: string): AttemptClaim | VerificationClaim | FinalizationClaim | PromotionClaim | UnlockClaim | Scope {
  const claim = copyClaim(value) as unknown as Record<string, unknown>;
  if (kind === 'scope') {
    exact(claim, ['storeId', 'accountBindingId', 'vaultId', 'deviceId']);
    checkScope(claim as unknown as Scope, storeId);
    return claim as unknown as Scope;
  }
  if (kind === 'unlock') {
    exact(claim, ['storeId', 'accountBindingId', 'vaultId', 'deviceId', 'installId', 'ownerGeneration', 'token', 'helperTerminated']);
    checkScope(claim as unknown as Scope, storeId);
    for (const k of ['installId', 'ownerGeneration', 'token']) requireString(claim[k]);
    if (claim.installId !== installId || claim.helperTerminated !== true || !/^(0|[1-9][0-9]{0,19})$/.test(claim.ownerGeneration as string) || BigInt(claim.ownerGeneration as string) > 18446744073709551615n) throw new BudgetError('unauthorized');
    return claim as unknown as UnlockClaim;
  }
  if (kind === 'attempt') exact(claim, attemptFields);
  else if (kind === 'promotion') exact(claim, [...attemptFields, 'keyEpoch', 'rootId', 'managementInstanceId', 'candidateDigest', 'parentAttemptId', 'authenticatedChainDigest']);
  else {
    if (claim.kind !== 'formal' && claim.kind !== 'preparation') throw new BudgetError('unauthorized');
    exact(claim, [...verificationFields, ...(claim.kind === 'formal' ? ['rootId', 'managementInstanceId'] : ['candidateDigest', 'parentAttemptId', 'step']), ...(kind === 'finalization' ? ['active'] : [])]);
  }
  const attempt = claim as unknown as AttemptClaim;
  checkAttempt(attempt, storeId, installId);
  if (!operations.includes(attempt.operation)) throw new BudgetError('unauthorized');
  if (kind === 'verification' || kind === 'finalization') {
    const verification = claim as unknown as VerificationClaim;
    checkVerification(verification, storeId, installId);
    if (!operations.includes(verification.unitOperation) || !units.includes(verification.unit)) throw new BudgetError('unauthorized');
    if (kind === 'finalization' && typeof claim.active !== 'boolean') throw new BudgetError('unauthorized');
  }
  if (kind === 'promotion') {
    for (const k of ['keyEpoch', 'rootId', 'managementInstanceId', 'candidateDigest', 'parentAttemptId', 'authenticatedChainDigest']) requireString(claim[k]);
    requireOpaque32(claim.rootId);
    requireOpaque32(claim.managementInstanceId);
    if (!/^(0|[1-9][0-9]{0,19})$/.test(claim.keyEpoch as string) || BigInt(claim.keyEpoch as string) > 18446744073709551615n || !/^[0-9a-f]{64}$/.test(claim.candidateDigest as string) || !/^[0-9a-f]{64}$/.test(claim.authenticatedChainDigest as string) || claim.parentAttemptId !== claim.attemptId) throw new BudgetError('unauthorized');
  }
  return claim as unknown as AttemptClaim | VerificationClaim | FinalizationClaim | PromotionClaim;
}

/** Parse the stored token-free claim and bind it to the reservation key. */
export function parseStoredVerification(encoded: unknown, reservationKey: string, storeId: string, installId: string): VerificationClaim {
  if (typeof encoded !== 'string' || Buffer.byteLength(encoded) > 4096) throw new BudgetError('storage-failed');
  let pairs: unknown;
  try { pairs = JSON.parse(encoded); } catch { throw new BudgetError('storage-failed'); }
  if (!Array.isArray(pairs) || pairs.some(p => !Array.isArray(p) || p.length !== 2 || typeof p[0] !== 'string')) throw new BudgetError('storage-failed');
  const entries = pairs as [string, unknown][];
  if (new Set(entries.map(p => p[0])).size !== entries.length || JSON.stringify([...entries].sort((a,b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)) !== encoded) throw new BudgetError('storage-failed');
  const record = Object.fromEntries(entries);
  if (typeof record.tokenHash !== 'string' || !/^[0-9a-f]{64}$/.test(record.tokenHash) || reservationKey !== `reservation:${record.tokenHash}`) throw new BudgetError('storage-failed');
  delete record.tokenHash;
  record.token = 'stored-token';
  try { return parseClaim(record, 'verification', storeId, installId); } catch { throw new BudgetError('storage-failed'); }
}
