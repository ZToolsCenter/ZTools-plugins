import { BudgetError, type AttemptClaim } from './types';
import { parseClaim, parseStoredVerification } from './claim-schema';
import { requireCounter } from './records';

export type SecurityRow = { version: 1; generation: string; unlock: string; session: string; active: string | null; pending: string | null; streak: number; locked: boolean };
export type AttemptRow = { version: 1; claim: AttemptClaim; state: 'active' | 'success' | 'failure' | 'quarantine' | 'unknown'; units: number; failures: number };
export type ReservationRow = { version: 1; claim: string; security: string; attempt: string; epoch: string; state: 'pending' | 'success' | 'failure' | 'unknown' };
function fields(value: unknown, expected: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new BudgetError('storage-failed');
  const names = Object.keys(value);
  if (names.length !== expected.length || names.some(k => !expected.includes(k))) throw new BudgetError('storage-failed');
  return value as Record<string, unknown>;
}
function string(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value); }
export function parseSecurityRow(value: unknown): SecurityRow {
  const r = fields(value, ['version', 'generation', 'unlock', 'session', 'active', 'pending', 'streak', 'locked']);
  try { requireCounter(r.generation); requireCounter(r.unlock); } catch { throw new BudgetError('storage-failed'); }
  if (r.version !== 1 || !string(r.session) || !(r.active === null || string(r.active)) || !(r.pending === null || string(r.pending)) || !Number.isSafeInteger(r.streak) || (r.streak as number) < 0 || (r.streak as number) > 32 || typeof r.locked !== 'boolean' || (r.streak === 32 && !r.locked) || (r.pending !== null && r.active === null)) throw new BudgetError('storage-failed');
  return r as unknown as SecurityRow;
}
export function parseAttemptRow(value: unknown, storeId: string, installId: string): AttemptRow {
  const r = fields(value, ['version', 'claim', 'state', 'units', 'failures']);
  if (r.version !== 1 || !['active', 'success', 'failure', 'quarantine', 'unknown'].includes(r.state as string) || !Number.isSafeInteger(r.units) || (r.units as number) < 0 || !Number.isSafeInteger(r.failures) || (r.failures as number) < 0 || (r.failures as number) > (r.units as number)) throw new BudgetError('storage-failed');
  try { parseClaim(r.claim as object, 'attempt', storeId, installId); } catch { throw new BudgetError('storage-failed'); }
  return r as unknown as AttemptRow;
}
export function parseReservationRow(value: unknown, reservationKey: string, storeId: string, installId: string): { row: ReservationRow; claim: ReturnType<typeof parseStoredVerification> } {
  const r = fields(value, ['version', 'claim', 'security', 'attempt', 'epoch', 'state']);
  if (r.version !== 1 || !string(r.security) || !string(r.attempt) || !string(r.epoch) || !['pending', 'success', 'failure', 'unknown'].includes(r.state as string)) throw new BudgetError('storage-failed');
  const claim = parseStoredVerification(r.claim, reservationKey, storeId, installId);
  return { row: r as unknown as ReservationRow, claim };
}

export type MetaRow = { version: 1; storeId: string; installId: string; rows: number; scopes: number; sessions: number; pending: number; activeAttempts: number; bytes: number };
export type EpochRow = { version: 1; used: number; rootId: string | null; managementInstanceId: string | null };
export type PreparationRow = { version: 1; candidateDigest: string; parentAttemptId: string; step: number; epoch: string };
export type InitIntent = { storeId: string; installId: string };
function uint(value: unknown, maximum: number): boolean {
  return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= maximum;
}
function rootId(value: unknown): boolean {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value)) return false;
  const bytes = Buffer.from(value, 'base64url');
  return bytes.length === 32 && bytes.toString('base64url') === value;
}
export function parseMetaRow(value: unknown): MetaRow {
  const r = fields(value, ['version', 'storeId', 'installId', 'rows', 'scopes', 'sessions', 'pending', 'activeAttempts', 'bytes']);
  if (r.version !== 1 || !string(r.storeId) || !string(r.installId) || !uint(r.rows, 100000) || !uint(r.scopes, 4096) || !uint(r.sessions, 4096) || !uint(r.pending, 64) || !uint(r.activeAttempts, 64) || !uint(r.bytes, 512 * 1024 * 1024)) throw new BudgetError('storage-failed');
  return r as unknown as MetaRow;
}
export function parseEpochRow(value: unknown): EpochRow {
  const r = fields(value, ['version', 'used', 'rootId', 'managementInstanceId']);
  if (r.version !== 1 || !uint(r.used, 4294967296) || r.used === 0 || !((r.rootId === null && r.managementInstanceId === null) || (rootId(r.rootId) && rootId(r.managementInstanceId)))) throw new BudgetError('storage-failed');
  return r as unknown as EpochRow;
}
export function parsePreparationRow(value: unknown): PreparationRow {
  const r = fields(value, ['version', 'candidateDigest', 'parentAttemptId', 'step', 'epoch']);
  if (r.version !== 1 || typeof r.candidateDigest !== 'string' || !/^[0-9a-f]{64}$/.test(r.candidateDigest) || !string(r.parentAttemptId) || !uint(r.step, 127) || typeof r.epoch !== 'string' || !/^epoch:[0-9a-f]{64}$/.test(r.epoch)) throw new BudgetError('storage-failed');
  return r as unknown as PreparationRow;
}
export function parseInitIntent(value: unknown): InitIntent {
  const r = fields(value, ['storeId', 'installId']);
  if (!string(r.storeId) || !string(r.installId)) throw new BudgetError('storage-failed');
  return r as unknown as InitIntent;
}
export function parseUnlockRow(value: unknown, rowKey: string): void {
  const r = fields(value, ['version', 'state', 'tokenHash']);
  if (r.version !== 1 || r.state !== 'unlock' || r.tokenHash !== rowKey || !/^attempt:[0-9a-f]{64}$/.test(rowKey)) throw new BudgetError('storage-failed');
}
