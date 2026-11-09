import { performance } from 'node:perf_hooks';
import { BudgetError } from './types.js';

/** Internal cooperative deadline; it cannot interrupt a blocking native call. */
export class StartupBudget {
  private readonly started: number;
  private previous: number;

  constructor(private readonly clock: () => number = () => performance.now()) {
    this.started = this.readClock();
    this.previous = this.started;
  }

  private readClock(): number {
    try {
      const value = this.clock();
      if (Number.isFinite(value) && value >= 0) return value;
    } catch { /* reported as unavailable */ }
    throw new BudgetError('unavailable');
  }

  check(): void {
    const now = this.readClock();
    if (now < this.previous) throw new BudgetError('unavailable');
    this.previous = now;
    if (now - this.started >= 30_000) throw new BudgetError('capacity');
  }

  async run<T>(action: () => Promise<T>): Promise<T> {
    this.check();
    const result = await action();
    this.check();
    return result;
  }
}
