import { writeFile } from 'node:fs/promises';
import { it } from 'vitest';
import { fixture, request } from './fixture';

// Child-only durable-ledger fixture. No OS owner-lock assurance is asserted.
it.skipIf(!process.env.V037_BUDGET_CHILD_MARKER)('pause after a real completed reserve for parent SIGKILL', async () => {
  const parent = process.env.V037_BUDGET_CHILD_PARENT!;
  const f = await fixture(parent);
  await f.begin('verify-control', true);
  const r = request(), lease = f.unit(r);
  await f.module.budget.reserveVerification(lease, r);
  await writeFile(process.env.V037_BUDGET_CHILD_MARKER!, JSON.stringify({ directory: f.directory, pause: 'reserve-resolved' }), { mode: 0o600 });
  await new Promise<void>(() => {});
}, 30000);
