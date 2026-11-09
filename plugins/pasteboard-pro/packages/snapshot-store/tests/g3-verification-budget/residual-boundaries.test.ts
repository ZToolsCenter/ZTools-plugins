import { open as openLmdb } from 'lmdb';
import { afterEach, expect, it } from 'vitest';
import { fixture, request, rows, type Fixture } from './fixture';

const parent = new URL('../../../../artifacts/pasteboardpro/clipboard-format-g0/v037-budget-tests/runtime/', import.meta.url).pathname;
const opened: Fixture[] = [];
async function prepared() {
  const f = await fixture(parent); opened.push(f);
  const a = await f.begin('verify-control', true), r = request(), lease = f.unit(r);
  await f.module.budget.reserveVerification(lease, r);
  await f.module.budget.recordAuthentication(lease, false);
  await f.module.finishAttempt(a, 'failure');
  return f;
}
afterEach(async () => { await Promise.all(opened.splice(0).map(f => f.close())); });

async function corrupt(f: Fixture, prefix: string, edit: (row: Record<string, unknown>) => Record<string, unknown>) {
  await f.close();
  const db = openLmdb<string, string>({ path: f.directory, encoding: 'string' });
  let changedKey = '';
  try {
    db.transactionSync(() => {
      const entry = [...db.getRange({ start: prefix, end: `${prefix.slice(0, -1)};` })][0]!;
      expect(entry).toBeDefined();
      changedKey = String(entry.key);
      const changed = JSON.stringify(edit(JSON.parse(entry.value)));
      const meta = JSON.parse(db.get('meta')!);
      db.putSync(entry.key, changed);
      db.putSync('meta', JSON.stringify({ ...meta,
        bytes: meta.bytes + Buffer.byteLength(changed) - Buffer.byteLength(entry.value) }));
    });
    await db.flushed;
  } finally { await db.close(); }
  return (await rows(f.directory)).get(changedKey)!;
}

it('residual epoch unknown field is rejected even when actual byte accounting matches', async () => {
  const f = await prepared();
  const changed = await corrupt(f, 'epoch:', row => ({ ...row, PUBLIC_unknown: 'persisted-corruption' }));
  expect(changed.PUBLIC_unknown).toBe('persisted-corruption');
  await expect(f.reopen()).rejects.toMatchObject({ code: 'storage-failed' });
});
it('residual preparation negative step is rejected after verifying changed bytes really persisted', async () => {
  const f = await prepared();
  const changed = await corrupt(f, 'prepare:', row => ({ ...row, step: -1 }));
  expect(changed.step).toBe(-1);
  await expect(f.reopen()).rejects.toMatchObject({ code: 'storage-failed' });
});
it('residual committed microtask reentry poisons output; outer cannot release success', async () => {
  const f = await fixture(parent); opened.push(f);
  let hooks = 0;
  let nested: Promise<{ success: boolean; code: string }> | undefined;
  f.setAttemptHook((lease, operation) => {
    hooks++;
    queueMicrotask(() => {
      nested = f.module.beginAttempt(lease, operation).then(
        () => ({ success: true, code: '' }), error => ({ success: false, code: error.code }));
    });
  });
  const outer = await f.begin('verify-control', true).then(
    () => ({ success: true, code: '' }), error => ({ success: false, code: error.code }));
  expect(hooks).toBe(1);
  expect(await nested).toEqual({ success: false, code: 'conflict' });
  await f.close();
  // Commit already happened; poison must forbid output, not pretend rollback.
  expect([...await rows(f.directory)].filter(([key]) => key.startsWith('attempt:'))).toHaveLength(1);
  expect(outer).toEqual({ success: false, code: 'unavailable' });
});
