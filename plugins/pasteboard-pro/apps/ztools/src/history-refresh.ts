/** Serialize reads and merge a burst of change notifications into one follow-up. */
export function createHistoryRefresh<T>(
  read: () => Promise<T>,
  apply: (value: T) => void,
): () => Promise<void> {
  let pending: Promise<void> | undefined;
  let dirty = false;
  return () => {
    dirty = true;
    pending ??= Promise.resolve().then(async () => {
      try {
        while (dirty) {
          dirty = false;
          const value = await read();
          // A newer change arrived while reading; don't replace the UI with a
          // stale snapshot. All callers wait for the final, up-to-date result.
          if (!dirty) apply(value);
        }
      } finally {
        pending = undefined;
      }
    });
    return pending;
  };
}
