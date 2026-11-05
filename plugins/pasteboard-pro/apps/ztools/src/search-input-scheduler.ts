export const SEARCH_INPUT_DELAY_MS = 300;
export const SEARCH_INPUT_MAX_WAIT_MS = 1_000;

/** Coalesce typing without starving results during sustained input. */
export class SearchInputScheduler {
  private delayTimer: ReturnType<typeof setTimeout> | undefined;
  private maxWaitTimer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;

  constructor(private readonly search: () => void | Promise<void>) {}

  get pending(): boolean { return this.delayTimer !== undefined; }

  schedule(): void {
    if (this.disposed) return;
    clearTimeout(this.delayTimer);
    this.delayTimer = setTimeout(() => { void this.flush(); }, SEARCH_INPUT_DELAY_MS);
    this.maxWaitTimer ??= setTimeout(() => { void this.flush(); }, SEARCH_INPUT_MAX_WAIT_MS);
  }

  flush(): void | Promise<void> {
    const pending = this.pending;
    this.cancel();
    if (pending && !this.disposed) return this.search();
  }

  cancel(): void {
    clearTimeout(this.delayTimer);
    clearTimeout(this.maxWaitTimer);
    this.delayTimer = undefined;
    this.maxWaitTimer = undefined;
  }

  dispose(): void {
    this.cancel();
    this.disposed = true;
  }
}
