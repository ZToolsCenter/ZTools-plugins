import { constants } from 'node:fs';
import { AsyncLocalStorage } from 'node:async_hooks';
import { lstat, mkdir, open, realpath, unlink } from 'node:fs/promises';
import path from 'node:path';
import { open as openLmdb, TransactionFlags, type RootDatabase } from 'lmdb';
import { BudgetError, type BudgetGuard, type BudgetOptions } from './types';
import { LIMITS, requireString } from './records';
import { auditStore } from './audit';
import { assertSyncGuard } from './guard';
import type { StartupBudget } from './startup-budget.js';
import { parseInitIntent, parseMetaRow, type MetaRow } from './ledger-schema';

const FLAGS = TransactionFlags.ABORTABLE | TransactionFlags.SYNCHRONOUS_COMMIT;
const active = new Set<string>();
type Database = RootDatabase<string, string>;
type Meta = MetaRow;
export type Store = Readonly<{
  transact<T>(action: (db: Database, guard: BudgetGuard) => T, startup?: StartupBudget): Promise<T>;
  close(): Promise<void>;
}>;

async function syncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, constants.O_RDONLY);
  try { await handle.sync(); } finally { await handle.close(); }
}
function decode(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string' || Buffer.byteLength(value) > LIMITS.rowBytes) throw new BudgetError('storage-failed');
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new BudgetError('storage-failed'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || JSON.stringify(parsed) !== value) throw new BudgetError('storage-failed');
  return parsed as Record<string, unknown>;
}
export function readRow<T>(db: Database, key: string): T | undefined {
  const value = db.get(key);
  return value === undefined ? undefined : decode(value) as T;
}
function meta(db: Database): Meta {
  return parseMetaRow(readRow<Meta>(db, 'meta'));
}
export function writeRow(db: Database, key: string, row: object): void {
  const value = JSON.stringify(row);
  const byteCount = Buffer.byteLength(key) + Buffer.byteLength(value);
  if (Buffer.byteLength(value) > LIMITS.rowBytes) throw new BudgetError('capacity');
  const m = meta(db);
  const old = db.get(key);
  const oldSize = old === undefined ? 0 : Buffer.byteLength(key) + Buffer.byteLength(old);
  const bytes = m.bytes - oldSize + byteCount;
  const rows = m.rows + (old === undefined ? 1 : 0);
  const scopes = m.scopes + (old === undefined && key.startsWith('epoch:') ? 1 : 0);
  const sessions = m.sessions + (old === undefined && key.startsWith('security:') ? 1 : 0);
  if (rows > LIMITS.rows || scopes > LIMITS.scopes || sessions > LIMITS.sessions || bytes > LIMITS.bytes) throw new BudgetError('capacity');
  db.putSync(key, value);
  db.putSync('meta', JSON.stringify({ ...m, rows, scopes, sessions, bytes }));
}
export function setPending(db: Database, delta: number): void {
  const m = meta(db);
  const pending = m.pending + delta;
  if (!Number.isSafeInteger(pending) || pending < 0 || pending > LIMITS.pending) throw new BudgetError('capacity');
  db.putSync('meta', JSON.stringify({ ...m, pending }));
}
export function setActiveAttempts(db: Database, delta: number): void {
  const m = meta(db);
  const activeAttempts = m.activeAttempts + delta;
  if (!Number.isSafeInteger(activeAttempts) || activeAttempts < 0 || activeAttempts > 64)
    throw new BudgetError('capacity');
  db.putSync('meta', JSON.stringify({ ...m, activeAttempts }));
}
export async function openStore(options: BudgetOptions, startup: StartupBudget): Promise<Store> {
  startup.check();
  if (!options || !['create', 'openExisting'].includes(options.mode) || typeof options.directory !== 'string' || !path.isAbsolute(options.directory) ||
      !options.owner || typeof options.owner.withGuard !== 'function' || !options.resolver) throw new BudgetError('invalid-input');
  requireString(options.expectedStoreId); requireString(options.expectedInstallId);
  if (process.platform === 'win32') throw new BudgetError('unavailable');
  const directory = path.resolve(options.directory);
  if (directory === path.parse(directory).root) throw new BudgetError('invalid-input');
  if (active.has(directory)) throw new BudgetError('conflict');
  active.add(directory);
  let db: Database | undefined;
  try {
    await startup.run(() => options.owner.withGuard(async guard => {
      assertSyncGuard(() => guard.assertOwner());
      assertSyncGuard(() => guard.assertInit(options.mode, directory, options.expectedStoreId, options.expectedInstallId));
      const parent = await startup.run(() => realpath(path.dirname(directory)));
      if (parent !== path.dirname(directory)) throw new BudgetError('unavailable');
      if (options.mode === 'create') {
        await startup.run(() => mkdir(directory, { mode: 0o700 }));
        await startup.run(() => syncDirectory(parent));
        startup.check();
        const intent = await open(path.join(directory, '.g3-init'), 'wx', 0o600);
        try { startup.check(); await startup.run(() => intent.writeFile(JSON.stringify(parseInitIntent({ storeId: options.expectedStoreId, installId: options.expectedInstallId })))); await startup.run(() => intent.sync()); } finally { await intent.close(); }
        startup.check();
        await startup.run(() => syncDirectory(directory));
      } else {
        const data = await startup.run(() => lstat(path.join(directory, 'data.mdb')));
        const lock = await startup.run(() => lstat(path.join(directory, 'lock.mdb')));
        if (!data.isFile() || data.isSymbolicLink() || !lock.isFile() || lock.isSymbolicLink()) throw new BudgetError('storage-failed');
        try { await startup.run(() => lstat(path.join(directory, '.g3-init'))); throw new BudgetError('unavailable'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      }
      const stat = await startup.run(() => lstat(directory));
      if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 || (process.getuid && stat.uid !== process.getuid())) throw new BudgetError('unavailable');
      assertSyncGuard(() => guard.assertOwner());
      startup.check();
      db = openLmdb<string, string>(directory, { encoding: 'string', keyEncoding: 'ordered-binary', cache: false, noSync: false, noMetaSync: false, useWritemap: false, overlappingSync: false, mapSize: 1024 * 1024 * 1024 });
      startup.check();
      if (options.mode === 'create') {
        db.transactionSync(() => { if (db!.getCount() !== 0) throw new BudgetError('conflict'); db!.putSync('meta', JSON.stringify({ version: 1, storeId: options.expectedStoreId, installId: options.expectedInstallId, rows: 0, scopes: 0, sessions: 0, pending: 0, activeAttempts: 0, bytes: 0 })); }, FLAGS);
        startup.check();
        await startup.run(() => db!.flushed); assertSyncGuard(() => guard.assertOwner());
        await startup.run(() => guard.confirmCreated(options.expectedStoreId, options.expectedInstallId));
        await startup.run(() => unlink(path.join(directory, '.g3-init'))); await startup.run(() => syncDirectory(directory));
      }
      auditStore(db, options.expectedStoreId, options.expectedInstallId, startup);
      assertSyncGuard(() => guard.assertOwner());
      startup.check();
    }));
  } catch (error) {
    if (db) await db.close().catch(() => undefined);
    active.delete(directory);
    if (error instanceof BudgetError) throw error;
    throw new BudgetError('storage-failed');
  }
  const database = db!;
  let tail: Promise<void> = Promise.resolve(), closed = false, poisoned = false;
  const transactionContext = new AsyncLocalStorage<{ violated: boolean; committed: boolean }>();
  return Object.freeze({
    transact<T>(action: (db: Database, guard: BudgetGuard) => T, startup?: StartupBudget): Promise<T> {
      if (closed || poisoned) return Promise.reject(new BudgetError('unavailable'));
      const parent = transactionContext.getStore();
      if (parent) {
        parent.violated = true;
        if (parent.committed) poisoned = true;
        return Promise.reject(new BudgetError('conflict'));
      }
      const run = async (): Promise<T> => {
        let committed = false;
        let transactionStarted = false;
        let callbackError: unknown;
        const context = { violated: false, committed: false };
        try {
          startup?.check();
          if (poisoned) throw new BudgetError('unavailable');
          const guardedResult = await options.owner.withGuard(async guard => {
            startup?.check();
            assertSyncGuard(() => guard.assertOwner());
            startup?.check();
            transactionStarted = true;
            const result = database.transactionSync(() => {
              try {
                assertSyncGuard(() => guard.assertOwner());
                const output = transactionContext.run(context, () => action(database, guard));
                if (output && typeof (output as { then?: unknown }).then === 'function') throw new BudgetError('invalid-input');
                if (context.violated) throw new BudgetError('conflict');
                assertSyncGuard(() => guard.assertOwner());
                startup?.check();
                return output;
              } catch (error) {
                callbackError = error;
                throw error;
              }
            }, FLAGS);
            committed = true;
            context.committed = true;
            startup?.check();
            await database.flushed;
            startup?.check();
            assertSyncGuard(() => guard.assertOwner());
            startup?.check();
            if (context.violated || poisoned) throw new BudgetError('unavailable');
            return result;
          });
          startup?.check();
          if (context.violated || poisoned) throw new BudgetError('unavailable');
          return guardedResult;
        } catch (error) {
          // withGuard itself can fail after its callback committed or flushed.
          const ordinaryAbort = transactionStarted && error === callbackError && error instanceof BudgetError &&
            ['invalid-input', 'unauthorized', 'expired', 'conflict', 'locked', 'capacity'].includes(error.code);
          if (committed || (transactionStarted && !ordinaryAbort)) {
            poisoned = true;
            if (error instanceof BudgetError && error.code === 'capacity') throw error;
            throw new BudgetError('unavailable');
          }
          if (!(error instanceof BudgetError)) throw new BudgetError('storage-failed');
          throw error;
        }
      };
      const operation = tail.then(run, run);
      tail = operation.then(() => undefined, () => undefined);
      return operation;
    },
    async close() { if (closed) return; closed = true; await tail; try { await database.close(); } finally { active.delete(directory); } },
  });
}
