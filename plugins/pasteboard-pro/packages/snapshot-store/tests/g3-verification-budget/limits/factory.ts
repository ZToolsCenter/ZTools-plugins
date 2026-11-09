// Owner: v038_resource_limits (Sol). Synthetic owner; no host authorization.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { open as openLmdb, TransactionFlags } from 'lmdb';
import { openVerificationBudget } from '../../../src/g3-verification-budget/index';
import type { AttemptClaim, BudgetGuard, BudgetResolver, Scope, VerificationClaim } from '../../../src/g3-verification-budget/types';

export const STORE = 'PUBLIC-v038-store', INSTALL = 'PUBLIC-v038-install';
export const hash = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
export const rowKey = (kind: string, ...parts: string[]) => `${kind}:${hash(JSON.stringify(parts))}`;
export const scope = (vault = 'PUBLIC-vault'): Scope => ({ storeId: STORE, accountBindingId: 'PUBLIC-account', vaultId: vault, deviceId: 'PUBLIC-device' });
export const securityKey = (s: Scope) => rowKey('security', s.storeId, s.accountBindingId, s.vaultId, s.deviceId);
export const epochKey = (s: Scope, epoch: string) => rowKey('epoch', s.storeId, s.accountBindingId, s.vaultId, s.deviceId, epoch);
export const attemptKey = (c: AttemptClaim) => rowKey('attempt', c.storeId, c.attemptId);
export const unlockKey = (store: string, token: string) => rowKey('attempt', store, `unlock:${token}`);
export function attempt(s = scope(), id = 'PUBLIC-attempt', unlock = '0', install = INSTALL): AttemptClaim {
  return { ...s, installId: install, ownerGeneration: '0', securityGeneration: '0', unlockGeneration: unlock,
    sessionId: 'PUBLIC-session', attemptId: id, operation: 'verify-control' };
}
export function verification(c: AttemptClaim, epoch: string, token: string): VerificationClaim {
  return { ...c, keyEpoch: epoch, token, mode: 'registered', unit: 'control-signature', unitOperation: 'verify-control',
    bindingSha256: 'a'.repeat(64), kind: 'preparation', candidateDigest: 'c'.repeat(64), parentAttemptId: c.attemptId, step: 0 };
}
export const request = (c: VerificationClaim) => ({ operation: 'verify-control' as const,
  scope: { accountBindingId: c.accountBindingId, vaultId: c.vaultId, keyEpoch: c.keyEpoch },
  verificationUnit: 'control-signature' as const, bindingSha256: c.bindingSha256 });
export function historyRows(c: AttemptClaim, epochs: string[], unlocks = 0): Map<string, string> {
  const rows = new Map<string, string>();
  rows.set(securityKey(c), JSON.stringify({ version: 1, generation: '0', unlock: String(unlocks), session: c.sessionId,
    active: null, pending: null, streak: 0, locked: false }));
  rows.set(attemptKey(c), JSON.stringify({ version: 1, claim: c, state: 'success', units: epochs.length, failures: 0 }));
  for (const epoch of epochs) {
    const token = `PUBLIC-unit:${c.attemptId}:${epoch}`, v = verification(c, epoch, token);
    const { token: omitted, ...withoutToken } = v;
    const record: Record<string, unknown> = { ...withoutToken, tokenHash: hash(omitted) };
    const storedClaim = JSON.stringify(Object.keys(record).sort().map(k => [k, record[k]]));
    const ek = epochKey(c, epoch);
    rows.set(ek, JSON.stringify({ version: 1, used: 1, rootId: null, managementInstanceId: null }));
    rows.set(`reservation:${hash(token)}`, JSON.stringify({ version: 1, claim: storedClaim, security: securityKey(c),
      attempt: attemptKey(c), epoch: ek, state: 'success' }));
    rows.set(rowKey('prepare', c.storeId, c.attemptId, epoch, 'c'.repeat(64)), JSON.stringify({ version: 1,
      candidateDigest: 'c'.repeat(64), parentAttemptId: c.attemptId, step: 0, epoch: ek }));
  }
  for (let n = 0; n < unlocks; n++) {
    const key = unlockKey(c.storeId, `PUBLIC-unlock:${n}`);
    rows.set(key, JSON.stringify({ version: 1, state: 'unlock', tokenHash: key }));
  }
  return rows;
}
export function metadata(rows: Map<string, string>, storeId = STORE, installId = INSTALL) {
  let bytes = 0, scopes = 0, sessions = 0, activeAttempts = 0, pending = 0;
  for (const [key, value] of rows) {
    bytes += Buffer.byteLength(key, 'utf8') + Buffer.byteLength(value, 'utf8');
    if (key.startsWith('epoch:')) scopes++;
    if (key.startsWith('security:')) sessions++;
    const row = JSON.parse(value);
    if (key.startsWith('attempt:') && row.state === 'active') activeAttempts++;
    if (key.startsWith('reservation:') && row.state === 'pending') pending++;
  }
  return { version: 1, storeId, installId, rows: rows.size, scopes, sessions, pending, activeAttempts, bytes };
}
/** Separate read-only process observes a consistent snapshot without closing the active owner. */
export async function rawRows(directory: string): Promise<Map<string, string>> {
  const entry = createRequire(import.meta.url).resolve('lmdb');
  const code = `import {createRequire} from 'node:module';const require=createRequire(import.meta.url);const {open}=require(process.argv[1]);const db=open({path:process.argv[2],readOnly:true,encoding:'string',keyEncoding:'ordered-binary'});try{process.stdout.write(JSON.stringify([...db.getRange({})].map(e=>[String(e.key),e.value])))}finally{await db.close()}`;
  const child = spawnSync('/Users/harris/.nvm/versions/node/v24.15.0/bin/node', ['--input-type=module', '-e', code, entry, directory],
    { encoding: 'utf8', timeout: 30000, maxBuffer: 128 * 1024 * 1024 });
  if (child.error || child.status !== 0) throw new Error(`readonly oracle failed: ${child.error ?? child.stderr}`);
  return new Map(JSON.parse(child.stdout));
}
export function fingerprint(rows: Map<string, string>): string {
  return hash(JSON.stringify([...rows].sort(([a], [b]) => a.localeCompare(b))));
}
/** Real native LMDB seed, not repeated public API calls. Metadata is counted from actual bytes. */
export async function seed(directory: string, rows: Map<string, string>, storeId = STORE, installId = INSTALL) {
  const db = openLmdb<string, string>(directory, { encoding: 'string', keyEncoding: 'ordered-binary', cache: false,
    noSync: false, noMetaSync: false, useWritemap: false, overlappingSync: false, mapSize: 1024 * 1024 * 1024 });
  try {
    const entries = [...rows];
    for (let offset = 0; offset < entries.length; offset += 1000) {
      db.transactionSync(() => { for (const [k, v] of entries.slice(offset, offset + 1000)) db.putSync(k, v); },
        TransactionFlags.ABORTABLE | TransactionFlags.SYNCHRONOUS_COMMIT);
      await db.flushed;
    }
    db.transactionSync(() => db.putSync('meta', JSON.stringify(metadata(rows, storeId, installId))),
      TransactionFlags.ABORTABLE | TransactionFlags.SYNCHRONOUS_COMMIT);
    await db.flushed;
  } finally { await db.close(); }
}
export async function fixture(directory: string, existing = false, storeId = STORE, installId = INSTALL) {
  const claims = new Map<string, AttemptClaim | VerificationClaim>();
  let unlockToken = 'PUBLIC-unlock:0';
  const lookup = (lease: { token: string }) => { const c = claims.get(lease.token); if (!c) throw new Error('unknown fixture lease'); return c; };
  const guard: BudgetGuard = { assertOwner() {}, assertActive() {}, assertFinalizer() {}, assertInit() {}, async confirmCreated() {} };
  const owner = { async withGuard<T>(action: (g: BudgetGuard) => Promise<T>) { return action(guard); } };
  const resolver: BudgetResolver = { attempt: lookup, active: lease => lookup(lease) as VerificationClaim,
    finalization: lease => ({ ...lookup(lease) as VerificationClaim, active: true }), finish: lookup,
    promotion() { throw new Error('outside fixture'); },
    unlock: (_lease, s) => ({ ...s, installId, ownerGeneration: '0', token: unlockToken, helperTerminated: true }) };
  const options = { directory, expectedStoreId: storeId, expectedInstallId: installId, owner, resolver };
  let module = await openVerificationBudget({ ...options, mode: existing ? 'openExisting' : 'create' });
  let serial = 0;
  async function begin(c = attempt()) {
    const lease = { token: `PUBLIC-attempt-lease:${serial++}`, mode: 'registered' as const };
    claims.set(lease.token, c); await module.beginAttempt(lease, c.operation); return lease;
  }
  async function reserve(c: AttemptClaim, epoch: string) {
    const token = `PUBLIC-unit:${c.attemptId}:${epoch}`, v = verification(c, epoch, token);
    const lease = { token, mode: 'registered' as const }; claims.set(token, v);
    await module.budget.reserveVerification(lease, request(v)); return lease;
  }
  return { get module() { return module; }, options, begin, reserve,
    async complete(c: AttemptClaim, epochs: string[]) {
      const a = await begin(c);
      for (const epoch of epochs) { const v = await reserve(c, epoch); await module.budget.recordAuthentication(v, true); }
      await module.finishAttempt(a, 'success');
    },
    async unlock(s: Scope, n: number) { unlockToken = `PUBLIC-unlock:${n}`; await module.unlockSession({ token: unlockToken, mode: 'registered' }, s); },
    async reopen() { await module.close(); module = await openVerificationBudget({ ...options, mode: 'openExisting' }); },
    close: () => module.close() };
}
