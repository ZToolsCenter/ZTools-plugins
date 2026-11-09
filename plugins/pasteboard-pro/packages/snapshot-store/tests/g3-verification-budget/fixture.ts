import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { open as openLmdb } from 'lmdb';
import { createV2NodeCodec } from '../../../sync-protocol/src/v2-node';
import type { V2AuthorizationRequest, V2Lease } from '../../../sync-protocol/src/v2-node';
import { openVerificationBudget } from '../../src/g3-verification-budget/index';
import { BudgetError, type AttemptClaim, type BudgetGuard, type BudgetOwner,
  type BudgetResolver, type FinalizationClaim, type VerificationClaim,
  type VerificationBudget, type Scope } from '../../src/g3-verification-budget/types';

// PUBLIC synthetic cryptographic values. These fixtures are not a host authorizer.
export const oracle = JSON.parse(readFileSync(new URL('../../../sync-protocol/fixtures/crypto-v2.json', import.meta.url), 'utf8'));
export const bytes = (hex: string): Buffer => Buffer.from(hex, 'hex');
export const control = (): Buffer => bytes(oracle.vectors.control.expected.canonicalHex);
export const root = (): Buffer => bytes(oracle.vectors.blob.input.ikmHex);
export const scope: Scope = Object.freeze({ storeId: 'PUBLIC-budget-store', deviceId: 'PUBLIC-device',
  accountBindingId: oracle.vectors.blob.input.header.accountBindingId,
  vaultId: oracle.vectors.blob.input.header.vaultId });
export const expectedControl = () => ({ accountBindingId: scope.accountBindingId, vaultId: scope.vaultId,
  keyEpoch: '0', adminPublicKey: bytes(oracle.vectors.control.input.adminPublicKeyHex),
  controlRevision: '0', controlSha256: oracle.vectors.control.expected.sha256,
  rootId: oracle.vectors.control.expected.record.rootId,
  managementInstanceId: oracle.vectors.control.expected.record.managementInstanceId });
export const request = (unit = 'control-signature', epoch = '0'): V2AuthorizationRequest => ({
  operation: 'verify-control', scope: { accountBindingId: scope.accountBindingId, vaultId: scope.vaultId, keyEpoch: epoch },
  bindingSha256: 'a'.repeat(64), verificationUnit: unit as NonNullable<V2AuthorizationRequest['verificationUnit']>,
});

type Claims = AttemptClaim | VerificationClaim;
export async function fixture(parent: string, existingDirectory?: string) {
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const base = await mkdtemp(path.join(parent, 'public-budget-'));
  const directory = existingDirectory ?? path.join(base, 'ledger');
  let module: VerificationBudget;
  let attempt: AttemptClaim | undefined;
  let kind: 'formal' | 'preparation' = 'preparation';
  let ownerActive = true;
  let failAfterAction = false;
  let postActionHook: (() => Promise<void>) | undefined;
  let attemptHook: ((lease: V2Lease, operation: string) => void) | undefined;
  let finalizerTransform: ((claim: FinalizationClaim) => FinalizationClaim) | undefined;
  const finalizerObservations: unknown[] = [];
  let unlockGeneration = '0';
  let sessionId = 'PUBLIC-session';
  let tail: Promise<unknown> = Promise.resolve();
  const revoked = new Set<string>();
  const claims = new Map<string, Claims>();
  const events: { token: string; unit: string; authenticated?: boolean }[] = [];
  const guard: BudgetGuard = {
    assertOwner() { if (!ownerActive) throw new BudgetError('unavailable'); },
    assertActive(c) {
      if (!ownerActive || ('token' in c && revoked.has(String(c.token)))) throw new BudgetError('expired');
      if ('unlockGeneration' in c && c.unlockGeneration !== unlockGeneration) throw new BudgetError('expired');
    },
    assertFinalizer(c) { if (!claims.has(c.token)) throw new BudgetError('unauthorized'); },
    assertInit(_mode, dir, storeId, installId) {
      if (dir !== directory || storeId !== scope.storeId || installId !== 'PUBLIC-install') throw new BudgetError('unauthorized');
    },
    async confirmCreated() { if (!ownerActive) throw new BudgetError('unavailable'); },
  };
  const owner: BudgetOwner = {
    withGuard<T>(action: (g: BudgetGuard) => Promise<T>): Promise<T> {
      const result = tail.then(async () => {
        const result = await action(guard);
        if (postActionHook) await postActionHook();
        if (failAfterAction) throw new Error('PUBLIC-test-owner-post-commit-fault');
        return result;
      });
      tail = result.catch(() => undefined);
      return result;
    },
  };
  function lookup(lease: V2Lease): Claims {
    const c = claims.get(lease.token);
    if (!c) throw new BudgetError('unauthorized');
    return c;
  }
  const resolver: BudgetResolver = {
    attempt: (lease, operation) => { attemptHook?.(lease, operation); return lookup(lease); },
    active: lease => lookup(lease) as VerificationClaim,
    finalization: lease => {
      const claim = { ...lookup(lease), active: !revoked.has(lease.token) } as FinalizationClaim;
      const result = finalizerTransform ? finalizerTransform(claim) : claim;
      finalizerObservations.push(result.active);
      return result;
    },
    finish: lease => lookup(lease),
    promotion: lease => ({ ...lookup(lease), keyEpoch: '0', rootId: expectedControl().rootId,
      managementInstanceId: expectedControl().managementInstanceId, candidateDigest: 'c'.repeat(64),
      parentAttemptId: lookup(lease).attemptId, authenticatedChainDigest: 'd'.repeat(64) }),
    unlock: () => ({ ...scope, installId: 'PUBLIC-install', ownerGeneration: '0', token: randomUUID(), helperTerminated: true }),
  };
  const options = { directory, expectedStoreId: scope.storeId, expectedInstallId: 'PUBLIC-install', owner, resolver };
  module = await openVerificationBudget({ ...options, mode: existingDirectory ? 'openExisting' : 'create' });
  async function begin(operation = 'verify-control', preparation = false, patch: Partial<AttemptClaim> = {}): Promise<V2Lease> {
    kind = preparation ? 'preparation' : 'formal';
    const lease = Object.freeze({ token: randomUUID(), mode: 'registered' as const });
    const c: AttemptClaim = Object.freeze({ ...scope, installId: 'PUBLIC-install', ownerGeneration: '0',
      securityGeneration: '0', unlockGeneration, sessionId, attemptId: randomUUID(), operation, ...patch });
    claims.set(lease.token, c);
    const accepted = await module.beginAttempt(lease, operation);
    attempt = c;
    return accepted;
  }
  function unit(req: V2AuthorizationRequest): V2Lease {
    if (!attempt) throw new Error('fixture requires beginAttempt');
    const token = randomUUID();
    const base = { ...attempt, keyEpoch: req.scope.keyEpoch, token,
      mode: 'registered' as const, unit: req.verificationUnit!, unitOperation: req.operation,
      bindingSha256: req.bindingSha256 };
    const c: VerificationClaim = kind === 'formal'
      ? Object.freeze({ ...base, kind: 'formal' as const, rootId: expectedControl().rootId,
        managementInstanceId: expectedControl().managementInstanceId })
      : Object.freeze({ ...base, kind: 'preparation' as const, candidateDigest: 'c'.repeat(64),
        parentAttemptId: attempt.attemptId, step: 0 });
    claims.set(token, c);
    events.push({ token, unit: c.unit });
    return { token, mode: 'registered' };
  }
  const authorization = {
    async authorize(req: V2AuthorizationRequest) { return unit(req); },
    async fence(lease: V2Lease) { guard.assertOwner(); guard.assertActive(lookup(lease)); },
  };
  const observedBudget = {
    reserveSeal: (...args: Parameters<VerificationBudget['budget']['reserveSeal']>) => module.budget.reserveSeal(...args),
    registerAttempt: (...args: Parameters<VerificationBudget['budget']['registerAttempt']>) => module.budget.registerAttempt(...args),
    reserveVerification: (...args: Parameters<VerificationBudget['budget']['reserveVerification']>) => module.budget.reserveVerification(...args),
    async recordAuthentication(lease: V2Lease, authenticated: boolean) {
      events.find(e => e.token === lease.token)!.authenticated = authenticated;
      await module.budget.recordAuthentication(lease, authenticated);
    },
  };
  return {
    directory, claims, events, owner, resolver, guard, finalizerObservations,
    get module() { return module; },
    options,
    codec: createV2NodeCodec({ limits: { maxPlaintextBytes: 1048576 }, authorization, budget: observedBudget }),
    begin, unit,
    revoke(token: string) { revoked.add(token); },
    setOwner(value: boolean) { ownerActive = value; },
    setPostActionFailure(value: boolean) { failAfterAction = value; },
    setPostActionHook(value: (() => Promise<void>) | undefined) { postActionHook = value; },
    setAttemptHook(value: (lease: V2Lease, operation: string) => void) { attemptHook = value; },
    setFinalizerTransform(value: (claim: FinalizationClaim) => FinalizationClaim) { finalizerTransform = value; },
    nextUnlockGeneration() { unlockGeneration = String(BigInt(unlockGeneration) + 1n); sessionId = randomUUID(); },
    async reopen() { await module.close(); module = await openVerificationBudget({ ...options, mode: 'openExisting' }); },
    async close() { await module.close(); },
  };
}
export type Fixture = Awaited<ReturnType<typeof fixture>>;

/** Read only after the module is closed. Never writes fabricated large counters. */
export async function rows(directory: string): Promise<Map<string, Record<string, unknown>>> {
  const db = openLmdb<string, string>({ path: directory, readOnly: true, encoding: 'string' });
  try { return new Map([...db.getRange({})].map(entry => [String(entry.key), JSON.parse(entry.value)])); }
  finally { await db.close(); }
}
export function rowKey(kind: string, ...parts: string[]): string {
  return `${kind}:${createHash('sha256').update(JSON.stringify(parts)).digest('hex')}`;
}
export const securityRowKey = () => rowKey('security', scope.storeId, scope.accountBindingId, scope.vaultId, scope.deviceId);
export const epochRowKey = (epoch = '0') => rowKey('epoch', scope.storeId, scope.accountBindingId, scope.vaultId, scope.deviceId, epoch);
