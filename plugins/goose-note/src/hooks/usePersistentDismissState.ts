import { useCallback, useEffect, useState } from "react";
import {
  readPersistentDismissState,
  writePersistentDismissState,
} from "@/lib/dismiss-state";

export function usePersistentDismissState(id: string) {
  const [dismissed, setDismissed] = useState(() =>
    readPersistentDismissState(id),
  );

  useEffect(() => {
    setDismissed(readPersistentDismissState(id));
  }, [id]);

  const dismiss = useCallback(() => {
    writePersistentDismissState(id, true);
    setDismissed(true);
  }, [id]);

  const reset = useCallback(() => {
    writePersistentDismissState(id, false);
    setDismissed(false);
  }, [id]);

  return {
    dismissed,
    visible: !dismissed,
    dismiss,
    reset,
  };
}
