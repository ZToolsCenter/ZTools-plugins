/** Monotonic request IDs prevent stale callbacks from changing a newer result. */
export class RequestGeneration {
  private currentId = 0;

  start(): number {
    this.currentId += 1;
    return this.currentId;
  }

  cancel(): number {
    this.currentId += 1;
    return this.currentId;
  }

  isCurrent(id: number): boolean {
    return id === this.currentId;
  }
}
