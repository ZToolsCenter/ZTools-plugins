// Owner: v038_resource_limits (Sol). Standalone numeric module interfaces, not valid ledger end-to-end states.
import path from 'node:path';
import { open as openLmdb, TransactionFlags } from 'lmdb';
import { expect, it } from 'vitest';
import { setPending, writeRow } from '../../../src/g3-verification-budget/store';
import { fingerprint, metadata, rawRows } from './factory';
import { ownedCase, receipt } from './evidence';
const FLAGS = TransactionFlags.ABORTABLE | TransactionFlags.SYNCHRONOUS_COMMIT;
it('internal writeRow: generic 4096-byte value commits; 4097-byte value aborts without any key or metadata mutation', async () => {
  const base = await ownedCase('internal-row-bytes'), directory = path.join(base, 'generic-module-kv');
  const db = openLmdb<string, string>(directory, { encoding: 'string', keyEncoding: 'ordered-binary', noSync: false });
  const encoded = (n: number) => ({ padding: 'x'.repeat(n - Buffer.byteLength(JSON.stringify({ padding: '' }))) });
  try {
    db.transactionSync(() => db.putSync('meta', JSON.stringify(metadata(new Map()))), FLAGS);
    db.transactionSync(() => writeRow(db, 'generic:accepted', encoded(4096)), FLAGS); await db.flushed;
    expect(Buffer.byteLength(db.get('generic:accepted')!)).toBe(4096);
    const before = await rawRows(directory);
    expect(() => db.transactionSync(() => { writeRow(db, 'generic:temporary', { temporary: true });
      writeRow(db, 'generic:rejected', encoded(4097)); }, FLAGS)).toThrowError('capacity');
    expect(fingerprint(await rawRows(directory))).toBe(fingerprint(before));
  } finally { await db.close(); }
  await receipt(base, { kind: 'standalone internal writeRow module boundary in real native transaction', acceptedBytes: 4096,
    rejectedBytes: 4097, limitation: 'generic values are intentionally outside ledger schema; no openExisting or public API claim' });
});
it('internal setPending: synthetic numeric precondition63 becomes64; increment65 aborts including earlier transaction writes', async () => {
  const base = await ownedCase('internal-pending'), directory = path.join(base, 'generic-module-kv');
  const db = openLmdb<string, string>(directory, { encoding: 'string', keyEncoding: 'ordered-binary', noSync: false });
  try {
    db.transactionSync(() => db.putSync('meta', JSON.stringify({ ...metadata(new Map()), pending: 63 })), FLAGS);
    db.transactionSync(() => setPending(db, 1), FLAGS); await db.flushed;
    expect(JSON.parse(db.get('meta')!).pending).toBe(64);
    const before = await rawRows(directory);
    expect(() => db.transactionSync(() => { db.putSync('temporary', 'transaction must abort'); setPending(db, 1); }, FLAGS)).toThrowError('capacity');
    expect(fingerprint(await rawRows(directory))).toBe(fingerprint(before));
  } finally { await db.close(); }
  await receipt(base, { kind: 'standalone internal setPending numeric boundary in real native transaction', acceptedPending: 64,
    rejectedPending: 65, limitation: 'synthetic meta counter is not a valid ledger state; no startup or public end-to-end claim' });
});
