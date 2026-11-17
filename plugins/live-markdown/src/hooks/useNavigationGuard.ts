import { useCallback, useRef, useState } from "react";
import { LoadedDocument } from "../types/typora";
import { clearDocumentRecovery } from "../core/documentRecovery";

export interface NavigationGuardOptions {
  getDocument: () => LoadedDocument;
  flushPendingSave: () => Promise<boolean>;
  saveAs: (onSaved: () => void) => void;
}

export function useNavigationGuard({ getDocument, flushPendingSave, saveAs }: NavigationGuardOptions) {
  const [open, setOpen] = useState(false);
  const resolveRef = useRef<((allow: boolean) => void) | null>(null);
  const pendingPromiseRef = useRef<Promise<boolean> | null>(null);

  const beforeNavigate = useCallback(async (): Promise<boolean> => {
    const current = getDocument();
    if (!current.isDirty) return true;
    if (current.path && !current.recoveryNeedsSaveAs) return flushPendingSave();
    if (pendingPromiseRef.current) return pendingPromiseRef.current;
    setOpen(true);
    const pending = new Promise<boolean>((resolve) => { resolveRef.current = resolve; });
    pendingPromiseRef.current = pending;
    return pending;
  }, [flushPendingSave, getDocument]);

  const settle = useCallback((allow: boolean) => {
    setOpen(false);
    const resolve = resolveRef.current;
    resolveRef.current = null;
    pendingPromiseRef.current = null;
    resolve?.(allow);
  }, []);

  const discardAndContinue = useCallback(() => {
    clearDocumentRecovery(localStorage);
    settle(true);
  }, [settle]);

  const saveAndContinue = useCallback(() => {
    saveAs(() => settle(true));
  }, [saveAs, settle]);

  const cancel = useCallback(() => settle(false), [settle]);

  return { open, beforeNavigate, saveAndContinue, discardAndContinue, cancel };
}
