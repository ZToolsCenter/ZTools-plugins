import type { RootDatabase } from 'lmdb';
import { BudgetError } from './types';
import type { StartupBudget } from './startup-budget.js';
import { LIMITS, attemptKey, epochKey, key, securityKey } from './records';
import { parseAttemptRow, parseEpochRow, parseMetaRow, parsePreparationRow, parseReservationRow, parseSecurityRow, parseUnlockRow, type AttemptRow, type PreparationRow, type ReservationRow, type SecurityRow } from './ledger-schema';

type Database = RootDatabase<string, string>;
type Row = Record<string, unknown>;
function parse(value: unknown): Row {
  if (typeof value !== 'string' || Buffer.byteLength(value) > LIMITS.rowBytes) throw new BudgetError('storage-failed');
  let row: unknown;
  try { row = JSON.parse(value); } catch { throw new BudgetError('storage-failed'); }
  if (!row || typeof row !== 'object' || Array.isArray(row) || JSON.stringify(row) !== value) throw new BudgetError('storage-failed');
  return row as Row;
}
function sameAttempt(a: AttemptRow['claim'], b: AttemptRow['claim']): boolean {
  const fields = ['storeId', 'accountBindingId', 'vaultId', 'deviceId', 'installId', 'ownerGeneration', 'securityGeneration', 'unlockGeneration', 'sessionId', 'attemptId', 'operation'] as const;
  return fields.every(field => a[field] === b[field]);
}
export function auditStore(db: Database, expectedStoreId: string, expectedInstallId: string, startup: StartupBudget): void {
  startup.check();
  const m = parseMetaRow(parse(db.get('meta')));
  startup.check();
  if (m.version !== 1 || m.storeId !== expectedStoreId || m.installId !== expectedInstallId) throw new BudgetError('storage-failed');
  const epochRows = new Map<string, Row>();
  const counts = new Map<string, number>();
  const securityRows = new Map<string, SecurityRow>();
  const attemptRows = new Map<string, AttemptRow>();
  const reservations: { key: string; row: ReservationRow; claim: ReturnType<typeof parseReservationRow>['claim'] }[] = [];
  const pending = new Map<string, ReservationRow>();
  const knownUnits = new Map<string, { units: number; failures: number }>();
  const preparations = new Map<string, PreparationRow>();
  const expectedPreparations = new Map<string, PreparationRow>();
  let rows = 0, scopes = 0, sessions = 0, bytes = 0, activeAttempts = 0;
  startup.check();
  for (const entry of db.getRange({})) {
    startup.check();
    if (entry.key === 'meta') continue;
    if (typeof entry.key !== 'string' || typeof entry.value !== 'string') throw new BudgetError('storage-failed');
    if (!/^(epoch|security|reservation|attempt|prepare):[0-9a-f]{64}$/.test(entry.key)) throw new BudgetError('storage-failed');
    const valueBytes = Buffer.byteLength(entry.value);
    if (valueBytes > LIMITS.rowBytes) throw new BudgetError('storage-failed');
    rows++;
    bytes += Buffer.byteLength(entry.key) + valueBytes;
    if (entry.key.startsWith('epoch:')) scopes++;
    if (entry.key.startsWith('security:')) sessions++;
    if (rows > LIMITS.rows || bytes > LIMITS.bytes || scopes > LIMITS.scopes || sessions > LIMITS.sessions) throw new BudgetError('capacity');
    const row = parse(entry.value);
    if (row.version !== 1) throw new BudgetError('storage-failed');
    if (entry.key.startsWith('epoch:')) {
      const epoch = parseEpochRow(row);
      epochRows.set(entry.key, epoch);
    } else if (entry.key.startsWith('security:')) {
      securityRows.set(entry.key, parseSecurityRow(row));
    } else if (entry.key.startsWith('reservation:')) {
      const parsed = parseReservationRow(row, entry.key, expectedStoreId, expectedInstallId);
      if (parsed.row.security !== securityKey(parsed.claim) || parsed.row.attempt !== attemptKey(parsed.claim) || parsed.row.epoch !== epochKey(parsed.claim, parsed.claim.keyEpoch)) throw new BudgetError('storage-failed');
      reservations.push({ key: entry.key, row: parsed.row, claim: parsed.claim });
      if (parsed.claim.kind === 'preparation') {
        const candidate = { version: 1 as const, candidateDigest: parsed.claim.candidateDigest, parentAttemptId: parsed.claim.parentAttemptId, step: parsed.claim.step, epoch: parsed.row.epoch };
        const preparationKey = key('prepare', expectedStoreId, parsed.claim.attemptId, parsed.claim.keyEpoch, parsed.claim.candidateDigest);
        const previous = expectedPreparations.get(preparationKey);
        if (previous && JSON.stringify(previous) !== JSON.stringify(candidate)) throw new BudgetError('storage-failed');
        expectedPreparations.set(preparationKey, candidate);
      }
      counts.set(parsed.row.epoch, (counts.get(parsed.row.epoch) ?? 0) + 1);
      if (parsed.row.state === 'pending') pending.set(entry.key, parsed.row);
      if (parsed.row.state === 'success' || parsed.row.state === 'failure') {
        const n = knownUnits.get(parsed.row.attempt) ?? { units: 0, failures: 0 };
        n.units++; if (parsed.row.state === 'failure') n.failures++;
        knownUnits.set(parsed.row.attempt, n);
      }
    } else if (entry.key.startsWith('attempt:')) {
      if (row.state === 'unlock') {
        parseUnlockRow(row, entry.key);
      } else {
        const attempt = parseAttemptRow(row, expectedStoreId, expectedInstallId);
        if (attemptKey(attempt.claim) !== entry.key) throw new BudgetError('storage-failed');
        if (attempt.state === 'active') activeAttempts++;
        attemptRows.set(entry.key, attempt);
      }
    } else if (entry.key.startsWith('prepare:')) {
      preparations.set(entry.key, parsePreparationRow(row));
    } else throw new BudgetError('storage-failed');
    if (rows > LIMITS.rows || bytes > LIMITS.bytes || scopes > LIMITS.scopes || sessions > LIMITS.sessions || pending.size > LIMITS.pending || activeAttempts > 64) throw new BudgetError('capacity');
    startup.check();
  }
  startup.check();
  if (rows !== m.rows || bytes !== m.bytes || scopes !== m.scopes || sessions !== m.sessions || pending.size !== m.pending || activeAttempts !== m.activeAttempts) throw new BudgetError('storage-failed');
  for (const [k, row] of epochRows) {
    startup.check();
    if (row.used !== (counts.get(k) ?? 0)) throw new BudgetError('storage-failed');
  }
  for (const k of counts.keys()) {
    startup.check();
    if (!epochRows.has(k)) throw new BudgetError('storage-failed');
  }
  if (preparations.size !== expectedPreparations.size) throw new BudgetError('storage-failed');
  for (const [k, value] of expectedPreparations) {
    startup.check();
    const actual = preparations.get(k);
    if (!actual || JSON.stringify(actual) !== JSON.stringify(value)) throw new BudgetError('storage-failed');
    if (!attemptRows.has(key('attempt', expectedStoreId, actual.parentAttemptId)) || !epochRows.has(actual.epoch)) throw new BudgetError('storage-failed');
  }
  for (const entry of reservations) {
    startup.check();
    const security = securityRows.get(entry.row.security), attempt = attemptRows.get(entry.row.attempt);
    if (!security || !attempt || !sameAttempt(attempt.claim, entry.claim)) throw new BudgetError('storage-failed');
    const epoch = epochRows.get(entry.row.epoch);
    if (!epoch || (entry.claim.kind === 'formal' && (epoch.rootId !== entry.claim.rootId || epoch.managementInstanceId !== entry.claim.managementInstanceId))) throw new BudgetError('storage-failed');
    if (entry.row.state === 'pending' && (security.pending !== entry.key || attempt.state !== 'active' || security.active !== attempt.claim.attemptId || security.generation !== attempt.claim.securityGeneration || security.unlock !== attempt.claim.unlockGeneration || security.session !== attempt.claim.sessionId)) throw new BudgetError('storage-failed');
  }
  for (const [k, attempt] of attemptRows) {
    startup.check();
    const totals = knownUnits.get(k) ?? { units: 0, failures: 0 };
    if (totals.units !== attempt.units || totals.failures !== attempt.failures) throw new BudgetError('storage-failed');
    const security = securityRows.get(securityKey(attempt.claim));
    if (!security) throw new BudgetError('storage-failed');
    if (attempt.state === 'active' && (security.active !== attempt.claim.attemptId || security.generation !== attempt.claim.securityGeneration || security.unlock !== attempt.claim.unlockGeneration || security.session !== attempt.claim.sessionId)) throw new BudgetError('storage-failed');
  }
  for (const [securityKeyValue, row] of securityRows) {
    startup.check();
    if (typeof row.pending === 'string' && !pending.has(row.pending)) throw new BudgetError('storage-failed');
    if (row.active !== null) {
      const attempt = attemptRows.get(key('attempt', expectedStoreId, row.active));
      if (!attempt || attempt.state !== 'active' || securityKey(attempt.claim) !== securityKeyValue) throw new BudgetError('storage-failed');
    }
  }
  startup.check();
}
