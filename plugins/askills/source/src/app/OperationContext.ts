import { createContext } from "react";

export type OperationProgress = {
  completedFiles: number;
  totalFiles: number;
  completedBytes: number;
  totalBytes: number;
  currentFile: string;
  stage?: string;
};

type OperationState = {
  error: string;
  busy: string;
  notice: string;
  cancel: () => void;
  dismissError: () => void;
  dismissNotice: () => void;
  progress: OperationProgress | null;
  reportProgress: (progress: OperationProgress | null) => void;
  notify: (message: string) => void;
  fail: (message: string) => void;
  isCancellationRequested: () => boolean;
};

export const OperationContext = createContext<OperationState>({
  error: "",
  busy: "",
  notice: "",
  cancel: () => {},
  dismissError: () => {},
  dismissNotice: () => {},
  progress: null,
  reportProgress: () => {},
  notify: () => {},
  fail: () => {},
  isCancellationRequested: () => false,
});
