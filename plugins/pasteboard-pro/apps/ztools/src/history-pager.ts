import type { HistoryPage, HistoryRequest } from "../preload/history-page";

/** Serializes reads; a new query supersedes in-flight pages before they reach Vue. */
export class HistoryPager {
  private request: HistoryRequest = {};
  private revision = 0;
  private dirty = false;
  private desiredCount = 50;
  private pending: Promise<void> | undefined;
  private page: HistoryPage = { items: [], total: 0 };
  private disposed = false;

  constructor(
    private readonly read: (request: HistoryRequest) => Promise<HistoryPage>,
    private readonly apply: (page: HistoryPage) => void,
  ) {}

  refresh(request: HistoryRequest, preserveCount = false): Promise<void> {
    this.request = request;
    this.revision++;
    this.desiredCount = preserveCount ? Math.max(50, this.page.items.length) : 50;
    this.dirty = true;
    return this.run();
  }

  loadMore(): Promise<void> {
    if (this.pending !== undefined || this.page.nextCursor === undefined) return this.pending ?? Promise.resolve();
    return this.run(true);
  }

  invalidate(): void { this.revision++; this.dirty = false; }
  dispose(): void { this.disposed = true; this.invalidate(); }

  private async readCurrent(request: HistoryRequest, revision: number): Promise<HistoryPage | undefined> {
    try { return await this.read(request); }
    catch (error) {
      if (revision !== this.revision || this.disposed) return undefined;
      throw error;
    }
  }

  private run(append = false): Promise<void> {
    this.pending ??= Promise.resolve().then(async () => {
      try {
        do {
          if (this.disposed) return;
          const revision = this.revision;
          const request = this.request;
          const continuing = append && !this.dirty;
          this.dirty = false;
          let page = await this.readCurrent({
            ...request, limit: 50,
            ...(continuing && this.page.nextCursor !== undefined ? { cursor: this.page.nextCursor } : {}),
          }, revision);
          if (page === undefined) { append = false; continue; }
          if (revision !== this.revision || this.disposed) { append = false; continue; }
          if (continuing && !page.reset) page = { ...page, items: [...this.page.items, ...page.items] };
          // Refresh the previously loaded range so clipboard changes do not
          // discard a scrolled-to page or its keyboard selection.
          while (!continuing && page.items.length < this.desiredCount && page.nextCursor !== undefined) {
            const next = await this.readCurrent({ ...request, limit: 50, cursor: page.nextCursor }, revision);
            if (next === undefined) break;
            if (revision !== this.revision || this.disposed) break;
            if (next.reset) { this.dirty = true; break; }
            page = { ...next, items: [...page.items, ...next.items] };
          }
          if (revision === this.revision && !this.disposed && !this.dirty) {
            const seen = new Set<string>();
            this.page = { ...page, items: page.items.filter(item => !seen.has(item.id) && !!seen.add(item.id)) };
            this.apply(this.page);
          }
          append = false;
        } while (this.dirty && !this.disposed);
      } finally { this.pending = undefined; }
    });
    return this.pending;
  }
}
