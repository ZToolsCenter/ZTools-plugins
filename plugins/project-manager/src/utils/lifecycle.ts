export type LifecycleSaveFailureAction = 'retry' | 'continue' | 'cancel';
export type LifecycleFlushResult = 'saved' | 'continue' | 'cancel';

export async function flushBeforeLifecycle(
  flushData: () => Promise<void>,
  flushHistory: () => Promise<void>,
  resolveFailure: (error: unknown) => Promise<LifecycleSaveFailureAction>,
): Promise<LifecycleFlushResult> {
  while (true) {
    try {
      await flushData();
      await flushHistory();
      return 'saved';
    } catch (error) {
      const action = await resolveFailure(error);
      if (action === 'retry') continue;
      return action;
    }
  }
}

export function createLifecycleGuard() {
  let active = false;
  return {
    tryEnter(): boolean {
      if (active) return false;
      active = true;
      return true;
    },
    leave(): void {
      active = false;
    },
    isActive(): boolean {
      return active;
    },
  };
}
