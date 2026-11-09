import { createHash } from 'node:crypto';
import { BudgetError, type AttemptClaim, type Scope, type VerificationClaim } from './types';

export const LIMITS = Object.freeze({ rows: 100000, scopes: 4096, sessions: 4096, pending: 64, bytes: 512 * 1024 * 1024, rowBytes: 4096 });
export const MAX_COUNT = 4294967296;

export function requireString(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 256 || /[\u0000-\u001f\u007f]/.test(value)) throw new BudgetError('invalid-input');
}
export function requireOpaque32(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value)) throw new BudgetError('invalid-input');
  const bytes = Buffer.from(value, 'base64url');
  if (bytes.length !== 32 || bytes.toString('base64url') !== value) throw new BudgetError('invalid-input');
}
export function requireCounter(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,19})$/.test(value) || BigInt(value) > 18446744073709551615n) throw new BudgetError('invalid-input');
}
export function copyClaim<T extends object>(value: T): T {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new BudgetError('unauthorized');
  const copy: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(value)) {
    const d = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || !d || !('value' in d) || !d.enumerable || (typeof d.value !== 'string' && typeof d.value !== 'number' && typeof d.value !== 'boolean')) throw new BudgetError('unauthorized');
    copy[key] = d.value;
  }
  return Object.freeze(copy) as T;
}
export function checkScope(value: Scope, storeId: string): void {
  for (const key of ['storeId', 'accountBindingId', 'vaultId', 'deviceId'] as const) requireString(value[key]);
  if (value.storeId !== storeId) throw new BudgetError('unauthorized');
}
export function checkAttempt(value: AttemptClaim, storeId: string, installId: string): void {
  checkScope(value, storeId);
  for (const key of ['installId', 'ownerGeneration', 'securityGeneration', 'unlockGeneration', 'sessionId', 'attemptId', 'operation'] as const) requireString(value[key]);
  requireCounter(value.ownerGeneration); requireCounter(value.securityGeneration); requireCounter(value.unlockGeneration);
  if (value.installId !== installId) throw new BudgetError('unauthorized');
}
export function checkVerification(value: VerificationClaim, storeId: string, installId: string): void {
  checkAttempt(value, storeId, installId);
  for (const key of ['keyEpoch', 'token', 'unit', 'unitOperation', 'bindingSha256'] as const) requireString(value[key]);
  requireCounter(value.keyEpoch);
  if (!/^[0-9a-f]{64}$/.test(value.bindingSha256) || value.mode !== 'registered') throw new BudgetError('unauthorized');
  if (value.kind === 'formal') {
    requireOpaque32(value.rootId); requireOpaque32(value.managementInstanceId);
  } else if (value.kind === 'preparation') {
    requireString(value.candidateDigest); requireString(value.parentAttemptId);
    if (!/^[0-9a-f]{64}$/.test(value.candidateDigest) || value.parentAttemptId !== value.attemptId || !Number.isSafeInteger(value.step) || value.step! < 0 || value.step! >= 128) throw new BudgetError('unauthorized');
  } else throw new BudgetError('unauthorized');
}
export function digest(value: string): string { return createHash('sha256').update(value, 'utf8').digest('hex'); }
export function key(kind: string, ...parts: string[]): string { return `${kind}:${digest(JSON.stringify(parts))}`; }
export function securityKey(scope: Scope): string { return key('security', scope.storeId, scope.accountBindingId, scope.vaultId, scope.deviceId); }
export function epochKey(scope: Scope, epoch: string): string { return key('epoch', scope.storeId, scope.accountBindingId, scope.vaultId, scope.deviceId, epoch); }
export function tokenKey(token: string): string { return `reservation:${digest(token)}`; }
export function attemptKey(claim: AttemptClaim): string { return key('attempt', claim.storeId, claim.attemptId); }
export function stableClaim(claim: VerificationClaim): string {
  const { token, ...rest } = claim;
  const stored: Record<string, unknown> = { ...rest, tokenHash: digest(token) };
  return JSON.stringify(Object.keys(stored).sort().map(k => [k, stored[k]]));
}
