import type { V2AuthorizationRequest, V2BudgetAdapter, V2Lease } from '@pasteboard-pro/sync-protocol/v2-node';
import { BudgetError, type AttemptClaim, type BudgetOptions, type FinalizationClaim, type Scope, type VerificationBudget, type VerificationClaim } from './types.js';
import { openStore, readRow, setActiveAttempts, setPending, writeRow } from './store';
import { parseClaim } from './claim-schema';
import { assertSyncGuard } from './guard';
import { StartupBudget } from './startup-budget.js';
import { parseAttemptRow, parseSecurityRow } from './ledger-schema';
import { MAX_COUNT, attemptKey, checkAttempt, checkScope, checkVerification, epochKey, key, requireString, securityKey, stableClaim, tokenKey } from './records';

type Security = { version: 1; generation: string; unlock: string; session: string; active: string | null; pending: string | null; streak: number; locked: boolean };
type Attempt = { version: 1; claim: AttemptClaim; state: 'active' | 'success' | 'failure' | 'quarantine' | 'unknown'; units: number; failures: number };
type Epoch = { version: 1; used: number; rootId: string | null; managementInstanceId: string | null };
type Reservation = { version: 1; claim: string; security: string; attempt: string; epoch: string; state: 'pending' | 'success' | 'failure' | 'unknown' };
function noSeal(): never { throw new BudgetError('unavailable'); }
function leaseCopy(lease: V2Lease): V2Lease {
  if (!lease || typeof lease !== 'object') throw new BudgetError('invalid-input');
  const token = Object.getOwnPropertyDescriptor(lease, 'token');
  const mode = Object.getOwnPropertyDescriptor(lease, 'mode');
  if (!token || !('value' in token) || !mode || !('value' in mode) || Reflect.ownKeys(lease).length !== 2) throw new BudgetError('invalid-input');
  requireString(token.value);
  if (mode.value !== 'registered' && mode.value !== 'bootstrap-prepare') throw new BudgetError('invalid-input');
  return Object.freeze({ token: token.value, mode: mode.value });
}
function checkedSecurity(value: Security | undefined): Security {
  return parseSecurityRow(value);
}
function checkedAttempt(value: Attempt | undefined, storeId: string, installId: string): Attempt {
  return parseAttemptRow(value, storeId, installId);
}
function sameAttempt(expected: AttemptClaim, actual: AttemptClaim): boolean {
  const fields = ['storeId', 'accountBindingId', 'vaultId', 'deviceId', 'installId', 'ownerGeneration',
    'securityGeneration', 'unlockGeneration', 'sessionId', 'attemptId', 'operation'] as const;
  return fields.every(field => expected[field] === actual[field]);
}
function assertCurrent(security: Security, claim: AttemptClaim): void {
  if (security.generation !== claim.securityGeneration || security.unlock !== claim.unlockGeneration || security.session !== claim.sessionId || security.active !== claim.attemptId) throw new BudgetError('unauthorized');
}
function plainFields(input: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.getPrototypeOf(input) !== Object.prototype) throw new BudgetError('invalid-input');
  const result: Record<string, unknown> = {};
  const keys = Reflect.ownKeys(input);
  if (keys.some(k => typeof k !== 'string' || !required.includes(k) && !optional.includes(k))) throw new BudgetError('invalid-input');
  for (const name of [...required, ...optional]) {
    const d = Object.getOwnPropertyDescriptor(input, name);
    if (!d) { if (required.includes(name)) throw new BudgetError('invalid-input'); continue; }
    if (!('value' in d) || !d.enumerable) throw new BudgetError('invalid-input');
    result[name] = d.value;
  }
  return result;
}
function requestCopy(input: V2AuthorizationRequest): V2AuthorizationRequest {
  const r = plainFields(input, ['operation', 'scope', 'bindingSha256'], ['verificationUnit', 'writerDomainId', 'descriptor']);
  const scope = plainFields(r.scope, ['accountBindingId', 'vaultId', 'keyEpoch']);
  for (const value of [r.operation, r.bindingSha256, scope.accountBindingId, scope.vaultId, scope.keyEpoch]) requireString(value);
  if (r.verificationUnit !== undefined) requireString(r.verificationUnit);
  if (r.writerDomainId !== undefined) requireString(r.writerDomainId);
  if (r.descriptor !== undefined) {
    const descriptor = plainFields(r.descriptor, ['accountBindingId', 'vaultId', 'keyEpoch', 'objectType', 'objectId', 'revision', 'purpose', 'writerDomainId']);
    for (const value of Object.values(descriptor)) requireString(value);
    r.descriptor = Object.freeze(descriptor);
  }
  return Object.freeze({ ...r, scope: Object.freeze(scope) }) as V2AuthorizationRequest;
}
function matches(claim: VerificationClaim, lease: V2Lease, request: V2AuthorizationRequest): void {
  if (claim.token !== lease.token || claim.mode !== lease.mode || claim.unitOperation !== request.operation || claim.unit !== request.verificationUnit || claim.bindingSha256 !== request.bindingSha256 ||
      claim.accountBindingId !== request.scope.accountBindingId || claim.vaultId !== request.scope.vaultId || claim.keyEpoch !== request.scope.keyEpoch) throw new BudgetError('unauthorized');
}
function stableFinal(claim: FinalizationClaim): string {
  const { active: _active, ...remaining } = claim;
  return stableClaim(remaining);
}

export async function openVerificationBudget(options: BudgetOptions): Promise<VerificationBudget> {
  const startup = new StartupBudget();
  startup.check();
  if (!options?.owner || typeof options.owner.withGuard !== 'function' || !options.resolver || ['attempt', 'active', 'finalization', 'finish', 'promotion', 'unlock'].some(k => typeof options.resolver[k as keyof typeof options.resolver] !== 'function')) throw new BudgetError('invalid-input');
  const rawResolver = options.resolver;
  const resolver = Object.freeze({
    attempt: rawResolver.attempt.bind(rawResolver), active: rawResolver.active.bind(rawResolver),
    finalization: rawResolver.finalization.bind(rawResolver), finish: rawResolver.finish.bind(rawResolver),
    promotion: rawResolver.promotion.bind(rawResolver), unlock: rawResolver.unlock.bind(rawResolver),
  });
  const owner = Object.freeze({ withGuard: options.owner.withGuard.bind(options.owner) });
  const ownedOptions = Object.freeze({ mode: options.mode, directory: options.directory, expectedStoreId: options.expectedStoreId,
    expectedInstallId: options.expectedInstallId, owner, resolver });
  const store = await openStore(ownedOptions, startup);
  const { expectedStoreId: storeId, expectedInstallId: installId } = ownedOptions;
  // A crash may leave a reserved unit or active attempt; the next owner locks it before use.
  try {
    startup.check();
    await store.transact((db, guard) => {
    startup.check();
    assertSyncGuard(() => guard.assertOwner());
    for (const entry of db.getRange({ start: 'attempt:', end: 'attempt;' })) {
      startup.check();
      const row = readRow<Attempt>(db, entry.key);
      startup.check();
      if (!row || row.version !== 1) throw new BudgetError('storage-failed');
      if ((row.state as string) === 'unlock') { startup.check(); continue; }
      if (!['active', 'success', 'failure', 'quarantine', 'unknown'].includes(row.state)) throw new BudgetError('storage-failed');
      if (row.state !== 'active') { startup.check(); continue; }
      const sk = securityKey(row.claim), security = checkedSecurity(readRow<Security>(db, sk));
      startup.check();
      if (security.active !== row.claim.attemptId) throw new BudgetError('storage-failed');
      if (security.pending) {
        const reservation = readRow<Reservation>(db, security.pending);
        startup.check();
        if (!reservation || reservation.state !== 'pending' || reservation.attempt !== entry.key) throw new BudgetError('storage-failed');
        writeRow(db, security.pending, { ...reservation, state: 'unknown' });
        startup.check();
        setPending(db, -1);
        startup.check();
      }
      setActiveAttempts(db, -1);
      startup.check();
      writeRow(db, entry.key, { ...row, state: 'unknown' });
      startup.check();
      writeRow(db, sk, { ...security, active: null, pending: null, locked: true });
      startup.check();
    }
    for (const entry of db.getRange({ start: 'reservation:', end: 'reservation;' })) {
      startup.check();
      const row = readRow<Reservation>(db, entry.key);
      startup.check();
      if (!row || row.version !== 1 || !['pending', 'success', 'failure', 'unknown'].includes(row.state) || row.state === 'pending') throw new BudgetError('storage-failed');
      startup.check();
    }
    startup.check();
    }, startup);
    startup.check();
  } catch (error) {
    await store.close();
    throw error;
  }
  const budget: V2BudgetAdapter = Object.freeze({
    async reserveSeal() { return noSeal(); },
    async registerAttempt() { return noSeal(); },
    async reserveVerification(input: V2Lease, requestInput: V2AuthorizationRequest) {
      const lease = leaseCopy(input), request = requestCopy(requestInput);
      await store.transact((db, guard) => {
        const claim = parseClaim(resolver.active(lease, request), 'verification', storeId, installId);
        checkVerification(claim, storeId, installId); matches(claim, lease, request); assertSyncGuard(() => guard.assertActive(claim));
        const sk = securityKey(claim), ak = attemptKey(claim), tk = tokenKey(lease.token), ek = epochKey(claim, claim.keyEpoch);
        const security = checkedSecurity(readRow<Security>(db, sk)), attempt = checkedAttempt(readRow<Attempt>(db, ak), storeId, installId);
        assertCurrent(security, claim);
        if (security.locked) throw new BudgetError('locked');
        if (security.pending || attempt.state !== 'active' || !sameAttempt(attempt.claim, claim) || readRow(db, tk)) throw new BudgetError('conflict');
        const epoch = readRow<Epoch>(db, ek) ?? { version: 1 as const, used: 0, rootId: null, managementInstanceId: null };
        if (epoch.version !== 1 || !Number.isSafeInteger(epoch.used) || epoch.used < 0 || epoch.used >= MAX_COUNT) throw new BudgetError('capacity');
        if (claim.kind === 'formal' && (!epoch.rootId || epoch.rootId !== claim.rootId || epoch.managementInstanceId !== claim.managementInstanceId)) throw new BudgetError('conflict');
        writeRow(db, ek, { ...epoch, used: epoch.used + 1 });
        writeRow(db, tk, { version: 1, claim: stableClaim(claim), security: sk, attempt: ak, epoch: ek, state: 'pending' });
        if (claim.kind === 'preparation') {
          const pk = key('prepare', storeId, claim.attemptId, claim.keyEpoch, claim.candidateDigest!);
          const prepared = { version: 1, candidateDigest: claim.candidateDigest, parentAttemptId: claim.parentAttemptId, step: claim.step, epoch: ek };
          const existing = readRow(db, pk);
          if (existing && JSON.stringify(existing) !== JSON.stringify(prepared)) throw new BudgetError('conflict');
          if (!existing) writeRow(db, pk, prepared);
        }
        setPending(db, 1); writeRow(db, sk, { ...security, pending: tk });
      });
    },
    async recordAuthentication(input: V2Lease, authenticated: boolean) {
      const lease = leaseCopy(input);
      if (typeof authenticated !== 'boolean') throw new BudgetError('invalid-input');
      const conflict = await store.transact((db, guard) => {
        const claim = parseClaim(resolver.finalization(lease), 'finalization', storeId, installId);
        checkVerification(claim, storeId, installId); assertSyncGuard(() => guard.assertFinalizer(claim));
        if (claim.token !== lease.token || claim.mode !== lease.mode) throw new BudgetError('unauthorized');
        const tk = tokenKey(lease.token), row = readRow<Reservation>(db, tk);
        if (!row || row.claim !== stableFinal(claim)) throw new BudgetError('unauthorized');
        const result = authenticated ? 'success' : 'failure';
        if (row.state === result) return false;
        if (row.state !== 'pending') {
          const oldSecurity = checkedSecurity(readRow<Security>(db, row.security));
          if (oldSecurity.generation === claim.securityGeneration && oldSecurity.unlock === claim.unlockGeneration)
            writeRow(db, row.security, { ...oldSecurity, locked: true });
          return true;
        }
        const security = checkedSecurity(readRow<Security>(db, row.security));
        const attempt = checkedAttempt(readRow<Attempt>(db, row.attempt), storeId, installId);
        if (security.pending !== tk || attempt.state !== 'active' || !sameAttempt(attempt.claim, claim)) throw new BudgetError('conflict');
        assertCurrent(security, claim);
        const streak = Math.min(32, security.streak + (authenticated ? 0 : 1));
        writeRow(db, tk, { ...row, state: result });
        writeRow(db, row.attempt, { ...attempt, units: attempt.units + 1, failures: attempt.failures + (authenticated ? 0 : 1) });
        setPending(db, -1);
        writeRow(db, row.security, { ...security, pending: null, streak, locked: security.locked || streak >= 32 || !claim.active });
        return false;
      });
      if (conflict) throw new BudgetError('conflict');
    },
  });
  try { startup.check(); } catch (error) { await store.close(); throw error; }
  return Object.freeze({
    budget,
    async beginAttempt(input, operation) {
      const lease = leaseCopy(input); requireString(operation);
      return store.transact((db, guard) => {
        const claim = parseClaim(resolver.attempt(lease, operation), 'attempt', storeId, installId); checkAttempt(claim, storeId, installId); assertSyncGuard(() => guard.assertActive(claim));
        if (claim.operation !== operation) throw new BudgetError('unauthorized');
        const sk = securityKey(claim), ak = attemptKey(claim);
        const current = readRow<Security>(db, sk);
        const security = current ? checkedSecurity(current) : { version: 1 as const, generation: claim.securityGeneration, unlock: claim.unlockGeneration, session: claim.sessionId, active: null, pending: null, streak: 0, locked: false };
        if (security.generation !== claim.securityGeneration || security.unlock !== claim.unlockGeneration) throw new BudgetError('unauthorized');
        if (security.locked) throw new BudgetError('locked');
        if (security.active || security.pending || readRow(db, ak)) throw new BudgetError('conflict');
        setActiveAttempts(db, 1);
        writeRow(db, ak, { version: 1, claim, state: 'active', units: 0, failures: 0 });
        writeRow(db, sk, { ...security, session: claim.sessionId, active: claim.attemptId });
        return lease;
      });
    },
    async finishAttempt(input, outcome) {
      const lease = leaseCopy(input);
      if (!['success', 'failure', 'quarantine'].includes(outcome)) throw new BudgetError('invalid-input');
      await store.transact((db, guard) => {
        const claim = parseClaim(resolver.finish(lease, outcome), 'attempt', storeId, installId); checkAttempt(claim, storeId, installId); assertSyncGuard(() => guard.assertActive(claim));
        const ak = attemptKey(claim), row = checkedAttempt(readRow<Attempt>(db, ak), storeId, installId), sk = securityKey(claim), security = checkedSecurity(readRow<Security>(db, sk));
        if (!sameAttempt(row.claim, claim)) throw new BudgetError('unauthorized');
        if (row.state === outcome) return;
        assertCurrent(security, claim);
        if (row.state !== 'active' || security.pending) throw new BudgetError('conflict');
        if (outcome === 'success' && (security.locked || row.units === 0 || row.failures !== 0)) throw new BudgetError('unauthorized');
        const locked = security.locked || (outcome === 'failure' && row.failures === 0);
        setActiveAttempts(db, -1);
        writeRow(db, ak, { ...row, state: outcome });
        writeRow(db, sk, { ...security, active: null, locked, streak: outcome === 'success' ? 0 : security.streak });
      });
    },
    async promotePreparedRoot(input, authenticatedChain) {
      const lease = leaseCopy(input);
      await store.transact((db, guard) => {
        const claim = parseClaim(resolver.promotion(lease, authenticatedChain), 'promotion', storeId, installId); checkAttempt(claim, storeId, installId); assertSyncGuard(() => guard.assertActive(claim));
        for (const value of [claim.keyEpoch, claim.rootId, claim.managementInstanceId, claim.candidateDigest, claim.parentAttemptId, claim.authenticatedChainDigest]) requireString(value);
        const security = checkedSecurity(readRow<Security>(db, securityKey(claim))); assertCurrent(security, claim);
        const attempt = checkedAttempt(readRow<Attempt>(db, attemptKey(claim)), storeId, installId);
        if (attempt.state !== 'active' || !sameAttempt(attempt.claim, claim) || attempt.units === 0 || attempt.failures !== 0) throw new BudgetError('unauthorized');
        if (security.locked || security.pending || claim.parentAttemptId !== claim.attemptId) throw new BudgetError('locked');
        const ek = epochKey(claim, claim.keyEpoch), epoch = readRow<Epoch>(db, ek);
        const prepared = readRow<{ candidateDigest: string; parentAttemptId: string; epoch: string }>(db, key('prepare', storeId, claim.attemptId, claim.keyEpoch, claim.candidateDigest));
        if (!epoch || !prepared || prepared.epoch !== ek || prepared.parentAttemptId !== claim.attemptId || prepared.candidateDigest !== claim.candidateDigest) throw new BudgetError('unauthorized');
        if (epoch.rootId && (epoch.rootId !== claim.rootId || epoch.managementInstanceId !== claim.managementInstanceId)) throw new BudgetError('conflict');
        if (!epoch.rootId) writeRow(db, ek, { ...epoch, rootId: claim.rootId, managementInstanceId: claim.managementInstanceId });
      });
    },
    async unlockSession(input, scopeInput) {
      const lease = leaseCopy(input), scope = parseClaim(scopeInput, 'scope', storeId, installId); checkScope(scope, storeId);
      await store.transact((db, guard) => {
        const claim = parseClaim(resolver.unlock(lease, scope), 'unlock', storeId, installId); checkScope(claim, storeId); assertSyncGuard(() => guard.assertActive(claim));
        if (!claim.helperTerminated || securityKey(claim) !== securityKey(scope) || claim.installId !== installId) throw new BudgetError('unauthorized');
        const sk = securityKey(scope), security = checkedSecurity(readRow<Security>(db, sk));
        if (security.active || security.pending) throw new BudgetError('conflict');
        const marker = key('attempt', storeId, `unlock:${claim.token}`);
        if (readRow(db, marker)) throw new BudgetError('conflict');
        writeRow(db, marker, { version: 1, state: 'unlock', tokenHash: marker });
        writeRow(db, sk, { ...security, locked: false, streak: 0, unlock: String(BigInt(security.unlock) + 1n) });
      });
    },
    close: store.close,
  });
}
