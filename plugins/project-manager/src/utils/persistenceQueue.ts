export interface PersistenceSaveQueue {
  markPersisted(serialized: string): void;
  enqueue(serialized: string, force?: boolean): Promise<void>;
}

export function createPersistenceSaveQueue(
  write: (serialized: string) => Promise<void>,
): PersistenceSaveQueue {
  let lastPersisted = '';
  let pending: string | null = null;
  let activeSave: Promise<void> | null = null;

  async function drain() {
    while (pending !== null) {
      const serialized = pending;
      pending = null;

      if (serialized === lastPersisted) continue;

      await write(serialized);
      lastPersisted = serialized;
    }
  }

  function ensureSave() {
    if (!activeSave) {
      activeSave = drain().finally(() => {
        activeSave = null;
      });
    }
    return activeSave;
  }

  return {
    markPersisted(serialized) {
      lastPersisted = serialized;
      pending = null;
    },
    enqueue(serialized, force = false) {
      if (!force && serialized === lastPersisted && pending === null) {
        return activeSave || Promise.resolve();
      }

      pending = serialized;
      return ensureSave();
    },
  };
}
