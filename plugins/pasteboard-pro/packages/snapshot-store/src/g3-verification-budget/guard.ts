import { types } from 'node:util';
import { BudgetError } from './types';

/** Guard assertions must finish synchronously before a transaction can commit. */
export function assertSyncGuard(call: () => unknown): void {
  let result: unknown;
  try {
    result = call();
  } catch (error) {
    if (error instanceof BudgetError) throw error;
    throw new BudgetError('unauthorized');
  }
  if (result === undefined) return;
  // Do not inspect or invoke arbitrary thenables. A genuine Promise may already
  // be rejected, so attach a rejection handler without trusting its properties.
  if (types.isPromise(result)) {
    try { void Promise.prototype.then.call(result, undefined, () => undefined); } catch { /* reject the guard below */ }
  }
  throw new BudgetError('unauthorized');
}
